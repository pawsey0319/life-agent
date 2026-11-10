-- Read-only hosted project inventory. Run in Supabase SQL Editor before migrations.
-- No user rows, credential values, settings, function bodies or ciphertext are returned.
-- Expected new-project result: no existing public application tables; required
-- extensions may be available but not installed. Availability is not permission proof.
begin transaction read only;
select current_user as deployment_role, current_database() as database_name,
       current_setting('server_version') as postgres_version;
select name, default_version, installed_version
from pg_available_extensions where name in ('pgcrypto','vector','pgmq') order by name;
select n.nspname as schema_name,c.relname as relation_name,c.relkind,
       c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p','v','m')
order by c.relname;
select rolname,rolcreaterole,rolcreatedb,rolsuper,rolbypassrls
from pg_roles where rolname=current_user;
select rolname,rolcanlogin,rolinherit,rolbypassrls
from pg_roles where rolname='life_memory_writer';
-- Existing migration history table only; no raw SQL or migration contents.
select exists(select 1 from information_schema.tables
where table_schema='supabase_migrations' and table_name='schema_migrations')
as has_cli_migration_history;
rollback;
