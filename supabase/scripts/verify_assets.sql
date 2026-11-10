-- Run as postgres on disposable local Supabase after all migrations.
-- No actual Storage HTTP upload/removal is performed; those require configured tests.
begin;
do $$
declare u uuid:=gen_random_uuid(); a record; failed boolean;
begin
 insert into auth.users(id) values(u);
 select * into a from public.reserve_runtime_asset(u);
 if a.path not like u::text||'/%' then raise exception 'FAIL asset owner prefix'; end if;
 if not public.finalize_runtime_asset(u,a.id,a.reservation_token) then raise exception 'FAIL finalize'; end if;
 if public.finalize_runtime_asset(u,a.id,gen_random_uuid()) then raise exception 'FAIL stale reservation'; end if;
 if not exists(select 1 from public.runtime_asset_cleanup where path=a.path) then raise exception 'FAIL missing preupload ledger'; end if;
 perform public.begin_runtime_account_deletion(u);
 failed:=false; begin perform public.reserve_runtime_asset(u); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL fenced upload'; end if;
 failed:=false; begin perform public.enqueue_runtime_job(u,'fenced','ciphertext'); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL fenced enqueue'; end if;
 failed:=false; begin perform public.save_runtime_projection(u,'wrapped',0,'[]'); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL fenced save'; end if;
 if public.finalize_runtime_asset(u,a.id,a.reservation_token) then raise exception 'FAIL fenced finalize'; end if;
 delete from auth.users where id=u;
 if exists(select 1 from public.runtime_assets where user_id=u) then raise exception 'FAIL asset metadata cascade'; end if;
 if not exists(select 1 from public.runtime_account_fences where user_id=u) then raise exception 'FAIL deletion fence disappeared'; end if;
 if not exists(select 1 from public.list_runtime_asset_cleanup(1000) c where c.path=a.path) then raise exception 'FAIL cleanup disappeared'; end if;
 perform public.record_runtime_asset_sweep(a.path);
 if not exists(select 1 from public.runtime_asset_cleanup where path=a.path and last_swept_at is not null) then raise exception 'FAIL sweep removed ledger'; end if;
 if has_function_privilege('authenticated','public.reserve_runtime_asset(uuid,uuid,uuid)','EXECUTE') then raise exception 'FAIL browser reserve'; end if;
 if (select public from storage.buckets where id='life-agent-assets') then raise exception 'FAIL public bucket'; end if;
 raise notice 'PASS asset reservation, fencing, cascade, persistent ledger and ACL';
end $$;
rollback;
