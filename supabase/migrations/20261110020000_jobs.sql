-- pgmq-backed encrypted image tasks. Queue payloads contain identifiers only.
select pgmq.create('life_image_jobs');
create table public.runtime_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null default 'image' check(kind='image'),
 status text not null default 'queued' check(status in ('queued','running','retry','succeeded','failed','cancelled')),
 payload_ciphertext text not null check(length(payload_ciphertext)>0),
 result_ciphertext text,
 attempts integer not null default 0 check(attempts between 0 and 3),
 next_attempt_at timestamptz not null default now(),
 lease_token uuid,
 lease_expires_at timestamptz,
 queue_message_id bigint,
 idempotency_key text not null check(length(idempotency_key) between 1 and 200),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
create index runtime_jobs_pending_idx on public.runtime_jobs(status,next_attempt_at);
alter table public.runtime_jobs enable row level security;
revoke all on public.runtime_jobs from public,anon,authenticated;
grant select on public.runtime_jobs to service_role;
revoke insert,update,delete,truncate on public.runtime_jobs from service_role;

create function public.enqueue_runtime_job(p_user_id uuid,p_idempotency_key text,p_payload_ciphertext text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.runtime_jobs%rowtype; message_id bigint;
begin
 -- Parent locking serializes duplicate enqueue and account deletion.
 perform 1 from auth.users where id=p_user_id for update;
 if not found then raise exception 'job owner does not exist'; end if;
 select * into j from public.runtime_jobs where user_id=p_user_id and idempotency_key=p_idempotency_key;
 if found then return j.id; end if;
 insert into public.runtime_jobs(user_id,idempotency_key,payload_ciphertext) values(p_user_id,p_idempotency_key,p_payload_ciphertext) returning * into j;
 message_id:=pgmq.send('life_image_jobs',jsonb_build_object('user_id',p_user_id,'job_id',j.id));
 update public.runtime_jobs set queue_message_id=message_id where id=j.id;
 return j.id;
end $$;

create function public.claim_runtime_job() returns setof public.runtime_jobs
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q record; j public.runtime_jobs%rowtype; tries integer;
begin
 -- Bounded scan prevents a busy worker looping forever on dangling/future messages.
 for tries in 1..20 loop
  select * into q from pgmq.read('life_image_jobs',90,1);
  if not found then return; end if;
  if jsonb_typeof(q.message) is distinct from 'object'
    or q.message->>'user_id' is null or q.message->>'job_id' is null then
   perform pgmq.delete('life_image_jobs',q.msg_id); continue;
  end if;
  -- Compare as text to avoid UUID parse errors for malformed messages.
  select * into j from public.runtime_jobs where id::text=q.message->>'job_id'
    and user_id::text=q.message->>'user_id' and queue_message_id=q.msg_id for update skip locked;
  if not found then
   -- A locked live row must not have its queue entry removed by a competing worker.
   if not exists(select 1 from public.runtime_jobs where id::text=q.message->>'job_id' and user_id::text=q.message->>'user_id' and queue_message_id=q.msg_id)
   then perform pgmq.delete('life_image_jobs',q.msg_id); end if;
   continue;
  end if;
  if j.status in ('succeeded','failed','cancelled') then perform pgmq.delete('life_image_jobs',q.msg_id); continue; end if;
  if j.status='running' and j.lease_expires_at>now() then continue; end if;
  if j.next_attempt_at>now() then continue; end if;
  if j.attempts>=3 then
   update public.runtime_jobs set status='failed',lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
   perform pgmq.delete('life_image_jobs',q.msg_id); continue;
  end if;
  update public.runtime_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
   lease_expires_at=now()+interval '90 seconds',updated_at=now() where id=j.id returning * into j;
  return next j; return;
 end loop;
 return;
end $$;

create function public.complete_runtime_job(p_user_id uuid,p_job_id uuid,p_lease_token uuid,p_result_ciphertext text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.runtime_jobs%rowtype;
begin
 if p_result_ciphertext is null or length(p_result_ciphertext)=0 then raise exception 'encrypted result required'; end if;
 select * into j from public.runtime_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=now() then return false; end if;
 update public.runtime_jobs set status='succeeded',result_ciphertext=p_result_ciphertext,lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 perform pgmq.delete('life_image_jobs',j.queue_message_id);
 return true;
end $$;

create function public.fail_runtime_job(p_user_id uuid,p_job_id uuid,p_lease_token uuid,p_retry boolean default true)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.runtime_jobs%rowtype; message_id bigint;
begin
 select * into j from public.runtime_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=now() then return false; end if;
 perform pgmq.delete('life_image_jobs',j.queue_message_id);
 if p_retry and j.attempts<3 then
  message_id:=pgmq.send('life_image_jobs',jsonb_build_object('user_id',p_user_id,'job_id',j.id),30);
  update public.runtime_jobs set status='retry',next_attempt_at=now()+interval '30 seconds',queue_message_id=message_id,
   lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 else
  update public.runtime_jobs set status='failed',lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 end if;
 return true;
end $$;

create function public.cancel_runtime_job(p_user_id uuid,p_job_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.runtime_jobs%rowtype;
begin
 select * into j from public.runtime_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found or j.status in ('succeeded','failed','cancelled') then return false; end if;
 update public.runtime_jobs set status='cancelled',payload_ciphertext='',result_ciphertext=null,
  lease_token=null,lease_expires_at=null,updated_at=now() where id=j.id;
 perform pgmq.delete('life_image_jobs',j.queue_message_id);
 return true;
end $$;
-- Cancellation destroys encrypted payload; allow empty only in terminal cancelled rows.
alter table public.runtime_jobs drop constraint runtime_jobs_payload_ciphertext_check;
alter table public.runtime_jobs add constraint runtime_jobs_payload_ciphertext_check check(status='cancelled' or length(payload_ciphertext)>0);
revoke all on function public.enqueue_runtime_job(uuid,text,text),public.claim_runtime_job(),public.complete_runtime_job(uuid,uuid,uuid,text),public.fail_runtime_job(uuid,uuid,uuid,boolean),public.cancel_runtime_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_runtime_job(uuid,text,text),public.claim_runtime_job(),public.complete_runtime_job(uuid,uuid,uuid,text),public.fail_runtime_job(uuid,uuid,uuid,boolean),public.cancel_runtime_job(uuid,uuid) to service_role;
