-- M0 core schema and security boundary.
-- Apply with Supabase CLI against a real local/hosted project. No plaintext user content is stored
-- by this migration; content/ciphertext columns are application-encrypted payloads.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
-- pgmq is commonly non-relocatable; let the provider install it in its packaged schema.
create extension if not exists pgmq;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pa (
  user_id uuid primary key references public.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  avatar_asset text,
  persona_json jsonb not null default '{}'::jsonb,
  stage text not null default 'hatched' check (stage in ('incubating','hatched')),
  hatched_at timestamptz,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  manifest_id text not null,
  manifest_version integer not null check (manifest_version > 0),
  manifest_json jsonb not null default '{}'::jsonb,
  kind text not null check (kind in ('official','custom','template','external')),
  status text not null default 'active' check (status in ('active','paused','pending')),
  name text not null check (length(name) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  block_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (block_id, user_id) references public.blocks(id, user_id) on delete cascade,
  unique (id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null,
  role text not null check (role in ('user','assistant','system','tool')),
  ciphertext text not null,
  ephemeral boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.sessions(id, user_id) on delete cascade
);

create table if not exists public.block_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  block_id uuid not null,
  field text not null,
  payload_ciphertext text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (block_id, user_id) references public.blocks(id, user_id) on delete cascade,
  unique (id, user_id)
);

create table if not exists public.field_registry (
  field text primary key,
  domain text not null,
  schema_json jsonb not null default '{}'::jsonb,
  sensitivity text not null check (sensitivity in ('normal','sensitive','forbidden')),
  version integer not null default 1 check (version > 0),
  enabled boolean not null default true
);

create table if not exists public.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_block_id uuid not null,
  grantee_block_id uuid not null,
  field text not null references public.field_registry(field),
  purpose text not null,
  scope text not null check (scope in ('once','long')),
  expires_at timestamptz,
  consumed_at timestamptz,
  created_via text not null check (created_via in ('user','runtime','request')),
  created_at timestamptz not null default now(),
  check (source_block_id <> grantee_block_id),
  foreign key (source_block_id, user_id) references public.blocks(id, user_id) on delete cascade,
  foreign key (grantee_block_id, user_id) references public.blocks(id, user_id) on delete cascade
);

create table if not exists public.grant_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_block_id uuid not null,
  grantee_block_id uuid not null,
  field text not null references public.field_registry(field),
  purpose text not null,
  status text not null default 'pending' check (status in ('pending','allowed','denied','expired')),
  expires_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_block_id <> grantee_block_id),
  foreign key (source_block_id, user_id) references public.blocks(id, user_id) on delete cascade,
  foreign key (grantee_block_id, user_id) references public.blocks(id, user_id) on delete cascade
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  actor_block_id uuid,
  action text not null,
  field text,
  source_block_id uuid,
  decision text,
  external boolean not null default false,
  at timestamptz not null default now()
  -- Audit block identifiers are immutable historical references, not live FKs: block
  -- removal must neither mutate audit nor prevent uninstall. Runtime validates identity.
);

create table if not exists public.pa_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  from_block_id uuid,
  kind text not null check (kind in ('summary','achievement','push')),
  payload_ciphertext text not null,
  priority integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (from_block_id, user_id) references public.blocks(id, user_id) on delete cascade
);

create table if not exists public.core_categories (
  category text primary key,
  description text not null default '',
  examples jsonb not null default '[]'::jsonb,
  always_load boolean not null default false,
  version integer not null default 1 check (version > 0)
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  content_ciphertext text not null,
  subject text,
  category text,
  tier text not null check (tier in ('core','normal','trivial')),
  tier_source text not null check (tier_source in ('user','rule','model','uncertain','promoted','corrected')),
  tier_reason text not null default '',
  sensitivity text not null check (sensitivity in ('normal','sensitive')),
  state text not null default 'active' check (state in ('active','faded','archived','historical','pending_confirm')),
  pinned boolean not null default false,
  activation real not null default 1 check (activation between 0 and 1),
  last_used_at timestamptz,
  event_date date,
  superseded_by uuid,
  embedding extensions.vector(1024),
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (superseded_by, user_id) references public.memories(id, user_id) on delete set null (superseded_by)
);

-- Add the composite key required by ownership FKs before dependent tables are created.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'memories_id_user_unique' and conrelid = 'public.memories'::regclass) then
    alter table public.memories add constraint memories_id_user_unique unique (id, user_id);
  end if;
end $$;

create table if not exists public.memory_tier_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  memory_id uuid not null,
  from_tier text not null check (from_tier in ('core','normal','trivial')),
  to_tier text check (to_tier in ('core','normal','trivial')),
  kind text not null check (kind in ('upgrade','downgrade','forgot_complaint','dont_remember')),
  category text,
  tier_source_before text,
  at timestamptz not null default now(),
  foreign key (memory_id, user_id) references public.memories(id, user_id) on delete cascade
);

create table if not exists public.memory_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  candidate_ciphertext text not null,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','allowed','denied','expired')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.memory_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  existing_memory_id uuid not null,
  candidate_ciphertext text not null,
  status text not null default 'pending' check (status in ('pending','allowed','denied','expired')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (existing_memory_id, user_id) references public.memories(id, user_id) on delete cascade
);

create table if not exists public.dek_keys (
  user_id uuid primary key references public.users(id) on delete cascade,
  wrapped_dek text not null,
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.runtime_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null,
  wrapped_key text not null,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists memories_user_state_idx on public.memories(user_id, state);
create index if not exists sessions_user_block_idx on public.sessions(user_id, block_id);
create index if not exists messages_session_created_idx on public.messages(session_id, created_at);
create index if not exists audit_user_at_idx on public.audit_log(user_id, at desc);

-- A dedicated NOLOGIN role owns narrowly scoped SECURITY DEFINER operations. A
-- caller-set GUC is never authority: only this current_user identity can alter core rows.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'life_memory_writer') then
    create role life_memory_writer nologin noinherit;
  end if;
end $$;
grant usage on schema public to life_memory_writer;
grant select, update, delete on public.memories to life_memory_writer;
grant select on public.users to life_memory_writer;
-- Fresh baseline: narrowly scoped policies replace the superuser-only BYPASSRLS flag.
create policy memories_controlled_writer on public.memories for all to life_memory_writer using (true) with check (true);
create policy users_controlled_writer_lookup on public.users for select to life_memory_writer using (true);

create or replace function public.protect_core_memory() returns trigger
language plpgsql security invoker as $$
begin
  if tg_op = 'DELETE' then
    -- The FK cascade from auth/public account deletion is itself a privileged operation.
    if not exists (select 1 from public.users where id = old.user_id) then return old; end if;
    if old.tier = 'core' and current_user <> 'life_memory_writer' then
      raise exception 'core memory requires controlled operation';
    end if;
    return old;
  end if;
  -- Only activation/last-used bookkeeping is safe without a controlled operation.
  if old.tier = 'core' and (to_jsonb(new) - array['activation','last_used_at','updated_at'])
      is distinct from (to_jsonb(old) - array['activation','last_used_at','updated_at'])
     and current_user <> 'life_memory_writer' then
    raise exception 'core memory requires controlled operation';
  end if;
  return new;
end;
$$;
drop trigger if exists memories_core_protection on public.memories;
create trigger memories_core_protection before update or delete on public.memories
for each row execute function public.protect_core_memory();

-- An audit row may only be inserted. Account cleanup is the sole deletion path and is performed
-- by the privileged account-deletion workflow, not by browser roles.
create or replace function public.reject_audit_mutation() returns trigger
language plpgsql as $$
begin
  -- ON DELETE CASCADE runs after the referenced user is gone. A privileged account
  -- cleanup may therefore remove dependent audit rows, while ordinary mutations fail.
  if tg_op = 'DELETE' and not exists (select 1 from public.users where id = old.user_id)
     then
    return old;
  end if;
  raise exception 'audit_log is append-only';
end;
$$;
drop trigger if exists audit_no_update_delete on public.audit_log;
create trigger audit_no_update_delete before update or delete on public.audit_log
for each row execute function public.reject_audit_mutation();

-- CAS snapshot persistence. The function locks the user's row when present. Initial insert uses
-- revision 0; callers pass expected_revision=0 for absent state. It is deliberately callable only
-- by service_role and never trusts a client-provided set_config value.
create or replace function public.save_runtime_state(
  p_user_id uuid,
  p_ciphertext text,
  p_wrapped_key text,
  p_revision integer
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_revision integer;
  next_revision integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), current_setting('role', true), '') <> 'service_role' then
    raise exception 'save_runtime_state requires service_role';
  end if;
  if p_user_id is null or p_ciphertext is null or p_wrapped_key is null or p_revision is null or p_revision < 0 then
    raise exception 'invalid runtime state arguments';
  end if;
  -- Lock the parent as well, including the absent-snapshot case: concurrent initial
  -- saves then serialize rather than racing into a unique-constraint violation.
  perform 1 from auth.users where id = p_user_id for update;
  if not found then raise exception 'runtime state user does not exist'; end if;
  select revision into current_revision from public.runtime_state where user_id = p_user_id for update;
  if current_revision is null then
    if p_revision <> 0 then raise exception 'runtime state revision conflict'; end if;
    insert into public.runtime_state(user_id, ciphertext, wrapped_key, revision)
      values (p_user_id, p_ciphertext, p_wrapped_key, 1);
    return 1;
  end if;
  if current_revision <> p_revision then raise exception 'runtime state revision conflict'; end if;
  next_revision := current_revision + 1;
  update public.runtime_state set ciphertext = p_ciphertext, wrapped_key = p_wrapped_key,
    revision = next_revision, updated_at = now() where user_id = p_user_id;
  return next_revision;
end;
$$;
revoke all on function public.save_runtime_state(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.save_runtime_state(uuid,text,text,integer) to service_role;

-- Narrow core operations; no arbitrary SQL, GUC authority, or generic JSON column patch.
create or replace function public.controlled_memory_edit(
  p_user_id uuid, p_memory_id uuid, p_content_ciphertext text,
  p_tier text, p_state text, p_pinned boolean
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_tier not in ('core','normal','trivial') or p_state not in ('active','historical','archived') then
    raise exception 'invalid controlled memory state';
  end if;
  update public.memories set content_ciphertext = coalesce(p_content_ciphertext, content_ciphertext),
    tier = p_tier, state = p_state, pinned = p_pinned, updated_at = now()
    where id = p_memory_id and user_id = p_user_id;
  if not found then raise exception 'memory not found'; end if;
end $$;
create or replace function public.controlled_memory_delete(p_user_id uuid, p_memory_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  delete from public.memories where id = p_memory_id and user_id = p_user_id;
end $$;
grant create on schema public to life_memory_writer;
alter function public.controlled_memory_edit(uuid,uuid,text,text,text,boolean) owner to life_memory_writer;
alter function public.controlled_memory_delete(uuid,uuid) owner to life_memory_writer;
revoke create on schema public from life_memory_writer;
revoke all on function public.controlled_memory_edit(uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.controlled_memory_delete(uuid,uuid) from public, anon, authenticated;
grant execute on function public.controlled_memory_edit(uuid,uuid,text,text,text,boolean) to service_role;
grant execute on function public.controlled_memory_delete(uuid,uuid) to service_role;

-- Browser access is read-only for owned, non-sensitive display data; all writes go through Runtime/RPC.
do $$ declare t text; begin
  foreach t in array array['users','pa','blocks','sessions','messages','block_records','field_registry','grants','grant_requests','audit_log','pa_inbox','memories','memory_tier_feedback','core_categories','memory_consents','memory_conflicts','dek_keys','runtime_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.users, public.pa, public.blocks, public.sessions, public.messages, public.block_records,
  public.field_registry, public.grants, public.grant_requests, public.audit_log, public.pa_inbox,
  public.memories, public.memory_tier_feedback, public.core_categories, public.memory_consents,
  public.memory_conflicts to authenticated;

create policy users_select_own on public.users for select to authenticated using (id = auth.uid());
create policy pa_select_own on public.pa for select to authenticated using (user_id = auth.uid());
create policy blocks_select_own on public.blocks for select to authenticated using (user_id = auth.uid());
create policy sessions_select_own on public.sessions for select to authenticated using (user_id = auth.uid());
create policy messages_select_own on public.messages for select to authenticated using (user_id = auth.uid());
create policy block_records_select_own on public.block_records for select to authenticated using (user_id = auth.uid());
create policy field_registry_select_enabled on public.field_registry for select to authenticated using (enabled);
create policy grants_select_own on public.grants for select to authenticated using (user_id = auth.uid());
create policy grant_requests_select_own on public.grant_requests for select to authenticated using (user_id = auth.uid());
create policy audit_select_own on public.audit_log for select to authenticated using (user_id = auth.uid());
create policy pa_inbox_select_own on public.pa_inbox for select to authenticated using (user_id = auth.uid());
create policy memories_select_own on public.memories for select to authenticated using (user_id = auth.uid() and state <> 'pending_confirm');
create policy feedback_select_own on public.memory_tier_feedback for select to authenticated using (user_id = auth.uid());
create policy categories_select_all on public.core_categories for select to authenticated using (true);
create policy consents_select_own on public.memory_consents for select to authenticated using (user_id = auth.uid());
create policy conflicts_select_own on public.memory_conflicts for select to authenticated using (user_id = auth.uid());
-- dek_keys and runtime_state are intentionally not granted to browser roles.

comment on table public.runtime_state is 'Encrypted aggregate CAS snapshot; not a substitute for normalized tables or their trigger/RLS protections.';
comment on function public.save_runtime_state(uuid,text,text,integer) is 'Service-role-only locked compare-and-swap; expected revision 0 creates revision 1.';
