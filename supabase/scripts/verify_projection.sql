-- Executable behavioral integration checks, run as postgres on disposable local Supabase:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/verify_projection.sql
-- All fixtures roll back. No claim of execution in environments without PostgreSQL.
begin;
do $$
declare u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); rows jsonb; result integer; failed boolean;
begin
 if (select rolbypassrls or rolcanlogin from pg_roles where rolname='life_memory_writer') then raise exception 'FAIL controlled role broader than required'; end if;
 if has_function_privilege('service_role','public.apply_controlled_projection(uuid,text,jsonb)','EXECUTE') then raise exception 'FAIL private helper exposed'; end if;
 insert into auth.users(id) values(u),(v);
 rows:=jsonb_build_array(jsonb_build_object('kind','memory','id','m1','ordinal',0,'ciphertext','encrypted-fixture','fingerprint','stable-content-hmac','guard',jsonb_build_object('tier','core','state','active','pinned',false,'sensitive',false,'subjectKey','subject-hmac')));
 result:=public.save_runtime_projection(u,'wrapped-test-key',0,rows);
 if result<>1 then raise exception 'FAIL initial revision'; end if;
 failed:=false; begin perform public.save_runtime_projection(u,'key',0,rows); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL stale revision accepted'; end if;
 -- Ciphertext may rotate while stable content fingerprint remains unchanged.
 rows:=jsonb_set(rows,'{0,ciphertext}','"new-random-ciphertext"');
 result:=public.save_runtime_projection(u,'key',1,rows);
 if result<>2 then raise exception 'FAIL stable core save'; end if;
 failed:=false; begin perform public.save_runtime_projection(u,'key',2,jsonb_set(rows,'{0,guard,state}','"historical"')); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL nightly core historical accepted'; end if;
 failed:=false; begin perform public.save_runtime_projection(u,'key',2,'[]'); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL core deletion accepted'; end if;
 perform set_config('app.controlled_memory_write','on',true);
 failed:=false; begin update public.runtime_entities set fingerprint='spoofed' where user_id=u; exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL GUC bypass'; end if;
 -- A user's sessions cannot refer to a block present only for another user.
 perform public.save_runtime_projection(v,'key',0,'[{"kind":"block","id":"foreign","ordinal":0,"ciphertext":"x","fingerprint":"h"}]');
 failed:=false; begin perform public.save_runtime_projection(u,'key',2,rows||'[{"kind":"session","id":"s1","block_id":"foreign","ordinal":0,"ciphertext":"x","fingerprint":"h"}]'); exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL foreign block accepted'; end if;
 rows:=rows||'[{"kind":"audit","id":"a1","ordinal":0,"action":"allow","at":"2026-11-10T00:00:00Z"}]';
 result:=public.save_runtime_projection(u,'key',2,rows);
 failed:=false; begin update public.runtime_audit_events set metadata='{}' where user_id=u; exception when others then failed:=true; end;
 if not failed then raise exception 'FAIL audit mutable'; end if;
 perform public.save_runtime_projection(u,'key',3,'[]','[{"id":"m1","operation":"delete"}]');
 if exists(select 1 from public.runtime_entities where user_id=u and kind='memory') then raise exception 'FAIL controlled deletion'; end if;
 if not exists(select 1 from public.runtime_audit_events where user_id=u) then raise exception 'FAIL omitted audit erased'; end if;
 delete from auth.users where id=u;
 if exists(select 1 from public.runtime_audit_events where user_id=u) then raise exception 'FAIL account cascade'; end if;
 if has_function_privilege('authenticated','public.save_runtime_projection(uuid,text,integer,jsonb,jsonb)','EXECUTE') then raise exception 'FAIL browser execute'; end if;
 if has_table_privilege('service_role','public.runtime_entities','UPDATE') then raise exception 'FAIL service direct update'; end if;
 raise notice 'PASS projection behavioral checks (revision, core, GUC, ownership, audit, cleanup, ACL)';
end $$;
rollback;
