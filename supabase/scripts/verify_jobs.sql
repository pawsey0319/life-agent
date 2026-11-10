-- Run as postgres on disposable local Supabase after all migrations.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/verify_jobs.sql
begin;
do $$
declare u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); jid uuid; j public.runtime_jobs%rowtype; ok boolean; token uuid;
begin
 insert into auth.users(id) values(u),(v);
 jid:=public.enqueue_runtime_job(u,'fixture-unique-key','encrypted-prompt');
 if public.enqueue_runtime_job(u,'fixture-unique-key','different-ciphertext')<>jid then raise exception 'FAIL idempotency'; end if;
 select * into j from public.claim_runtime_job();
 -- Run on an empty disposable queue, otherwise this fixture may not be the first job.
 if j.id is distinct from jid or j.attempts<>1 or j.status<>'running' then raise exception 'FAIL claim (requires empty queue)'; end if;
 token:=j.lease_token;
 if public.complete_runtime_job(v,jid,token,'encrypted-result') then raise exception 'FAIL cross owner ack'; end if;
 if public.complete_runtime_job(u,jid,gen_random_uuid(),'encrypted-result') then raise exception 'FAIL stale token ack'; end if;
 if not public.fail_runtime_job(u,jid,token,true) then raise exception 'FAIL retry'; end if;
 if public.complete_runtime_job(u,jid,token,'late-result') then raise exception 'FAIL old worker result'; end if;
 select * into j from public.runtime_jobs where id=jid;
 if j.status<>'retry' or j.attempts<>1 or j.lease_token is not null then raise exception 'FAIL retry state'; end if;
 if not public.cancel_runtime_job(u,jid) then raise exception 'FAIL cancellation'; end if;
 if public.complete_runtime_job(u,jid,token,'late-result') then raise exception 'FAIL cancellation overwritten'; end if;
 select * into j from public.runtime_jobs where id=jid;
 if j.payload_ciphertext<>'' then raise exception 'FAIL cancelled payload retained'; end if;
 jid:=public.enqueue_runtime_job(u,'cleanup-fixture','encrypted-prompt');
 delete from auth.users where id=u;
 if exists(select 1 from public.runtime_jobs where user_id=u) then raise exception 'FAIL account cleanup'; end if;
 -- Dangling queue envelopes are removed, never create rows or expose payloads.
 perform public.claim_runtime_job();
 if has_function_privilege('authenticated','public.claim_runtime_job()','EXECUTE') then raise exception 'FAIL browser claim'; end if;
 if has_table_privilege('service_role','public.runtime_jobs','UPDATE') then raise exception 'FAIL direct job update'; end if;
 raise notice 'PASS job idempotency, ownership, stale lease, retry, cancel, account cleanup and ACL';
end $$;
rollback;
