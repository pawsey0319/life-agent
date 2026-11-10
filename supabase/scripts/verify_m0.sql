-- Run after migration with `supabase db reset` or psql against a real Supabase DB.
-- This is an executable verification script, not a substitute for integration execution.

begin;

select plan(16);
select has_table('public', 'users', 'users exists');
select has_table('public', 'pa', 'pa exists');
select has_table('public', 'blocks', 'blocks exists');
select has_table('public', 'sessions', 'sessions exists');
select has_table('public', 'messages', 'messages exists');
select has_table('public', 'memories', 'memories exists');
select has_table('public', 'runtime_state', 'runtime_state exists');
select has_column('public', 'memories', 'embedding', 'memories has vector');
select ok((select atttypmod = 1024 and atttypid = 'extensions.vector'::regtype from pg_attribute where attrelid = 'public.memories'::regclass and attname = 'embedding'), 'embedding is vector(1024)');
select has_function('public', 'save_runtime_state', array['uuid','text','text','integer'], 'CAS RPC exists');
select ok(has_function_privilege('service_role', 'public.save_runtime_state(uuid,text,text,integer)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.save_runtime_state(uuid,text,text,integer)', 'EXECUTE'), 'CAS service-only');
select ok((select relrowsecurity from pg_class where oid = 'public.memories'::regclass), 'memories RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), 'audit RLS enabled');
select ok((select count(*) > 0 from pg_trigger where tgrelid = 'public.audit_log'::regclass and tgname = 'audit_no_update_delete'), 'audit append-only trigger exists');
select ok((select count(*) > 0 from pg_trigger where tgrelid = 'public.memories'::regclass and tgname = 'memories_core_protection'), 'core protection trigger exists');
select ok((select count(*) = 0 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'dek_keys' and grantee in ('anon','authenticated')), 'DEK keys not browser-readable');
select * from finish();
rollback;

-- Additional manual checks for local Supabase SQL editor:
-- 1. authenticated INSERT/UPDATE/DELETE on any business table must fail (no browser write grants).
-- 2. Cross-user composite FK inserts must fail even when user_id columns are forged.
-- 3. Direct UPDATE/DELETE of audit_log must raise `audit_log is append-only`.
-- 4. CAS absent: service_role save(..., expected_revision=0) returns 1; repeat expected 0 fails;
--    save expected 1 returns 2. Concurrent calls serialize via FOR UPDATE and only one expected revision wins.
-- 5. Controlled core writes use a NOLOGIN owner role and role-specific RLS policies;
--    caller-set GUCs confer no authority. Run verify_projection.sql for controlled deletion.
