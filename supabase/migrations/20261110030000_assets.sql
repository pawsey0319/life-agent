-- Storage is NOT transactional with Auth/Postgres. Persistent fences and cleanup ledgers
-- deliberately survive account deletion and drive repeated server-side object sweeps.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('life-agent-assets','life-agent-assets',false,20971520,array['application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No storage.objects browser policy is added. Upload ciphertext only, using server credentials.
create table public.runtime_account_fences (
 user_id uuid primary key,
 deleting_at timestamptz not null default now()
);
create table public.runtime_assets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid references public.runtime_jobs(id) on delete cascade,
 job_lease_token uuid,
 path text not null unique,
 reservation_token uuid not null,
 status text not null default 'reserved' check(status in ('reserved','ready')),
 created_at timestamptz not null default now(),
 finalized_at timestamptz
);
create table public.runtime_asset_cleanup (
 path text primary key,
 user_id uuid not null,
 reserved_at timestamptz not null default now(),
 -- Ledger is permanent for deleted users: repeated removal catches late uncertain uploads.
 last_swept_at timestamptz,
 next_check_at timestamptz not null default now()
);
alter table public.runtime_account_fences enable row level security;
alter table public.runtime_assets enable row level security;
alter table public.runtime_asset_cleanup enable row level security;
revoke all on public.runtime_account_fences,public.runtime_assets,public.runtime_asset_cleanup from public,anon,authenticated,service_role;
grant select on public.runtime_account_fences,public.runtime_assets,public.runtime_asset_cleanup to service_role;

-- Acquire same parent lock as projection/enqueue before inspecting persistent fence.
-- A deletion begun after this check waits for the database transaction; network uploads
-- still require finalize + deletion cleanup protocol described in docs.
create function public.reject_fenced_runtime_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform 1 from auth.users where id=new.user_id for update;
 if not found or exists(select 1 from public.runtime_account_fences where user_id=new.user_id)
 then raise exception 'account deletion in progress'; end if;
 return new;
end $$;
create trigger projection_fence before insert or update on public.runtime_entities for each row execute function public.reject_fenced_runtime_write();
create trigger projection_state_fence before insert or update on public.runtime_projection_state for each row execute function public.reject_fenced_runtime_write();
create trigger legacy_state_fence before insert or update on public.runtime_state for each row execute function public.reject_fenced_runtime_write();
create trigger job_account_fence before insert or update on public.runtime_jobs for each row execute function public.reject_fenced_runtime_write();
create trigger asset_account_fence before insert or update on public.runtime_assets for each row execute function public.reject_fenced_runtime_write();

create function public.begin_runtime_account_deletion(p_user_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare queued record;
begin
 -- Must be invoked only after Runtime verifies fresh user reauthentication.
 perform 1 from auth.users where id=p_user_id for update;
 if p_user_id is null then raise exception 'owner required'; end if;
 insert into public.runtime_account_fences(user_id) values(p_user_id) on conflict do nothing;
 -- Remove queue envelopes without mutating fenced task rows. This also prevents
 -- fenced jobs from starving the global queue if Auth deletion needs retry.
 for queued in select queue_message_id from public.runtime_jobs where user_id=p_user_id and queue_message_id is not null loop
  perform pgmq.delete('life_image_jobs',queued.queue_message_id);
 end loop;
 -- Outstanding claim/complete will fail; Auth deletion later cascades durable jobs.
 update public.runtime_asset_cleanup set next_check_at=now() where user_id=p_user_id;
end $$;

create function public.reserve_runtime_asset(p_user_id uuid,p_job_id uuid default null,p_lease_token uuid default null)
returns table(id uuid,path text,reservation_token uuid)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare asset_id uuid:=gen_random_uuid(); token uuid:=gen_random_uuid(); object_path text;
begin
 perform 1 from auth.users where auth.users.id=p_user_id for update;
 if not found or exists(select 1 from public.runtime_account_fences f where f.user_id=p_user_id) then raise exception 'account deletion in progress'; end if;
 if p_job_id is not null and not exists(select 1 from public.runtime_jobs j where j.id=p_job_id and j.user_id=p_user_id and j.status='running' and j.lease_token=p_lease_token and j.lease_expires_at>now()) then raise exception 'asset job not owned or running'; end if;
 object_path:=p_user_id::text||'/'||asset_id::text||'.bin';
 insert into public.runtime_assets(id,user_id,job_id,job_lease_token,path,reservation_token) values(asset_id,p_user_id,p_job_id,p_lease_token,object_path,token);
 insert into public.runtime_asset_cleanup(path,user_id) values(object_path,p_user_id);
 return query select asset_id,object_path,token;
end $$;

create function public.finalize_runtime_asset(p_user_id uuid,p_asset_id uuid,p_reservation_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform 1 from auth.users where id=p_user_id for update;
 if not found or exists(select 1 from public.runtime_account_fences where user_id=p_user_id) then return false; end if;
 update public.runtime_assets set status='ready',finalized_at=now()
 where id=p_asset_id and user_id=p_user_id and reservation_token=p_reservation_token and status='reserved'
 and (job_id is null or exists(select 1 from public.runtime_jobs j where j.id=runtime_assets.job_id and j.user_id=p_user_id and j.status='running' and j.lease_token=runtime_assets.job_lease_token and j.lease_expires_at>now()));
 return found;
end $$;

create function public.list_runtime_asset_cleanup(p_limit integer default 100)
returns table(path text,user_id uuid)
language sql security definer set search_path=pg_catalog,public as $$
 select c.path,c.user_id from public.runtime_asset_cleanup c
 where c.next_check_at<=now() and (exists(select 1 from public.runtime_account_fences f where f.user_id=c.user_id)
   or not exists(select 1 from auth.users u where u.id=c.user_id)
   or (c.reserved_at<now()-interval '15 minutes' and (
      not exists(select 1 from public.runtime_assets a where a.path=c.path and a.status='ready')
      or exists(select 1 from public.runtime_assets a join public.runtime_jobs j on j.id=a.job_id and j.user_id=a.user_id
        where a.path=c.path and a.status='ready' and j.status<>'succeeded'
          and (j.status in ('failed','cancelled') or j.lease_token is distinct from a.job_lease_token)))))
 order by c.next_check_at,c.path limit greatest(1,least(coalesce(p_limit,100),1000));
$$;
create function public.record_runtime_asset_sweep(p_path text) returns void
language sql security definer set search_path=pg_catalog,public as $$
 update public.runtime_asset_cleanup set last_swept_at=now(),next_check_at=now()+interval '5 minutes' where path=p_path;
$$;
revoke all on function public.begin_runtime_account_deletion(uuid),public.reserve_runtime_asset(uuid,uuid,uuid),public.finalize_runtime_asset(uuid,uuid,uuid),public.list_runtime_asset_cleanup(integer),public.record_runtime_asset_sweep(text) from public,anon,authenticated;
grant execute on function public.begin_runtime_account_deletion(uuid),public.reserve_runtime_asset(uuid,uuid,uuid),public.finalize_runtime_asset(uuid,uuid,uuid),public.list_runtime_asset_cleanup(integer),public.record_runtime_asset_sweep(text) to service_role;
