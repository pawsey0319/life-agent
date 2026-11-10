-- Authoritative encrypted entity persistence; aggregate runtime_state is legacy cache only.
create table public.runtime_projection_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 wrapped_key text not null,
 revision integer not null check(revision > 0),
 updated_at timestamptz not null default now()
);
create table public.runtime_entities (
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('pa','candidate','block','session','message','record','schedule','inbox','style','event','memory','pending','feedback','grant','request','tombstone','metadata')),
 entity_id text not null check(length(entity_id) between 1 and 200),
 ordinal integer not null check(ordinal >= 0),
 ciphertext text not null check(length(ciphertext)>0),
 fingerprint text not null check(length(fingerprint)>0),
 block_id text,
 parent_id text,
 guard jsonb not null default '{}'::jsonb,
 primary key(user_id,kind,entity_id)
);
create table public.runtime_audit_events (
 user_id uuid not null references auth.users(id) on delete cascade,
 source_id text not null,
 ordinal integer not null check(ordinal>=0),
 metadata jsonb not null,
 primary key(user_id,source_id)
);
alter table public.runtime_projection_state enable row level security;
alter table public.runtime_entities enable row level security;
alter table public.runtime_audit_events enable row level security;
revoke all on public.runtime_projection_state, public.runtime_entities, public.runtime_audit_events from public, anon, authenticated;
grant select on public.runtime_projection_state, public.runtime_entities, public.runtime_audit_events to service_role;
-- No direct service-role mutation: authoritative writes go through the transaction below.
revoke insert,update,delete,truncate on public.runtime_projection_state, public.runtime_entities, public.runtime_audit_events from service_role;

create function public.runtime_projection_guard() returns trigger language plpgsql as $$
begin
 if tg_table_name = 'runtime_audit_events' then
   if tg_op='DELETE' and not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
   raise exception 'runtime audit is append-only';
 end if;
 if tg_op='DELETE' then
    -- Private helper identity needs no broad Auth read privilege.
    if current_user='life_memory_writer' then return old; end if;
   if old.kind='memory' and old.guard->>'tier'='core'
      and exists(select 1 from auth.users where id=old.user_id)
      and current_user <> 'life_memory_writer' then raise exception 'core projection requires controlled operation'; end if;
   return old;
 end if;
 if old.kind='memory' and old.guard->>'tier'='core'
   and (new.fingerprint is distinct from old.fingerprint or new.guard is distinct from old.guard)
   and current_user <> 'life_memory_writer' then raise exception 'core projection requires controlled operation'; end if;
 return new;
end $$;
create trigger runtime_entities_core before update or delete on public.runtime_entities for each row execute function public.runtime_projection_guard();
create trigger runtime_audit_append_only before update or delete on public.runtime_audit_events for each row execute function public.runtime_projection_guard();

-- This helper has NO public/service execute privilege; the transaction RPC calls it only
-- after matching one explicit per-entity user action. Workers never supply such actions.
grant select,update,delete on public.runtime_entities to life_memory_writer;
create policy runtime_entities_controlled_writer on public.runtime_entities for all to life_memory_writer using (true) with check (true);
create function public.apply_controlled_projection(p_user_id uuid,p_id text,p_row jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_row is null then delete from public.runtime_entities where user_id=p_user_id and kind='memory' and entity_id=p_id;
 else update public.runtime_entities set ordinal=(p_row->>'ordinal')::integer,ciphertext=p_row->>'ciphertext',
 fingerprint=p_row->>'fingerprint',guard=coalesce(p_row->'guard','{}'::jsonb),block_id=p_row->>'block_id',parent_id=p_row->>'parent_id'
 where user_id=p_user_id and kind='memory' and entity_id=p_id; end if;
end $$;
grant create on schema public to life_memory_writer;
alter function public.apply_controlled_projection(uuid,text,jsonb) owner to life_memory_writer;
revoke create on schema public from life_memory_writer;
revoke all on function public.apply_controlled_projection(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.save_runtime_projection(p_user_id uuid,p_wrapped_key text,p_revision integer,
 p_entities jsonb,p_core_actions jsonb default '[]'::jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_revision integer; next_revision integer; row_data jsonb; old_row public.runtime_entities%rowtype;
 action text; k text; eid text; audit_data jsonb;
begin
 -- EXECUTE privilege, not JWT/GUC values, is the authority for this server-only RPC.
 if p_user_id is null or p_revision is null or p_revision<0 or p_wrapped_key is null
  or jsonb_typeof(p_entities) is distinct from 'array' or jsonb_typeof(p_core_actions) is distinct from 'array' then
  raise exception 'invalid projection arguments'; end if;
 perform 1 from auth.users where id=p_user_id for update;
 if not found then raise exception 'projection user does not exist'; end if;
 select revision into old_revision from public.runtime_projection_state where user_id=p_user_id for update;
 if coalesce(old_revision,0)<>p_revision then raise exception 'runtime state revision conflict'; end if;
 if exists(select 1 from jsonb_array_elements(p_entities) e group by e->>'kind',e->>'id' having count(*)>1)
 then raise exception 'duplicate projection entity'; end if;
 if exists(select 1 from jsonb_array_elements(p_core_actions) a where coalesce(a->>'operation','') not in ('edit','delete','confirmed_replace') or a->>'id' is null)
 or exists(select 1 from jsonb_array_elements(p_core_actions) a group by a->>'id' having count(*)>1)
 then raise exception 'invalid core actions'; end if;
 -- Validate relationships against this user's incoming set; text IDs never confer ownership.
 for row_data in select value from jsonb_array_elements(p_entities) loop
  k:=row_data->>'kind'; eid:=row_data->>'id';
  if coalesce(k,'') not in ('audit','pa','candidate','block','session','message','record','schedule','inbox','style','event','memory','pending','feedback','grant','request','tombstone','metadata')
    or eid is null or length(eid) not between 1 and 200 or row_data->>'ordinal' is null
    or (row_data->>'ordinal')::integer<0 then raise exception 'incomplete projection entity'; end if;
  if k='memory' and (jsonb_typeof(row_data->'guard'->'pinned') is distinct from 'boolean'
    or jsonb_typeof(row_data->'guard'->'sensitive') is distinct from 'boolean'
    or jsonb_typeof(row_data->'guard'->'subjectKey') is distinct from 'string')
    then raise exception 'invalid memory guard types'; end if;
  if row_data->>'block_id' is not null and row_data->>'block_id'<>'pa'
    and not exists(select 1 from jsonb_array_elements(p_entities) b where b->>'kind'='block' and b->>'id'=row_data->>'block_id')
  then raise exception 'projection block does not exist'; end if;
  if k='message' and not exists(select 1 from jsonb_array_elements(p_entities) s where s->>'kind'='session' and s->>'id'=row_data->>'parent_id' and s->>'block_id' is not distinct from row_data->>'block_id')
  then raise exception 'projection session does not exist'; end if;
  if k='memory' and (row_data->'guard'->>'tier' not in ('core','normal','trivial') or row_data->'guard'->>'state' not in ('active','faded','archived','historical')
    or row_data->'guard'->>'tier' is null or row_data->'guard'->>'state' is null)
  then raise exception 'invalid memory guard'; end if;
 end loop;
 -- Existing core changes/removals are checked before any mutation, including snapshot removal.
 for old_row in select * from public.runtime_entities where user_id=p_user_id and kind='memory' and guard->>'tier'='core' loop
  row_data:=null; action:=null;
  select value into row_data from jsonb_array_elements(p_entities) e where e->>'kind'='memory' and e->>'id'=old_row.entity_id;
  if row_data is null or old_row.fingerprint is distinct from row_data->>'fingerprint' or old_row.guard is distinct from coalesce(row_data->'guard','{}'::jsonb) then
   select a->>'operation' into action from jsonb_array_elements(p_core_actions) a where a->>'id'=old_row.entity_id;
   if action is null then raise exception 'core projection requires controlled operation'; end if;
   if row_data is null and action<>'delete' then raise exception 'core deletion requires delete action'; end if;
   if row_data is not null and action='delete' then raise exception 'delete action cannot update core'; end if;
   if action='confirmed_replace' and row_data->'guard'->>'state'<>'historical' then raise exception 'confirmed replacement requires historical state'; end if;
   perform public.apply_controlled_projection(p_user_id,old_row.entity_id,row_data);
  end if;
 end loop;
 -- Audit payloads are strictly metadata, immutable once appended; omitted old events persist.
 for row_data in select value from jsonb_array_elements(p_entities) e where e->>'kind'='audit' loop
  audit_data:=row_data - array['kind','id','ordinal'];
  if exists(select 1 from jsonb_object_keys(audit_data) key where key not in ('action','at','field','requestId'))
    or audit_data->>'action' is null or audit_data->>'at' is null then raise exception 'invalid audit metadata'; end if;
  if exists(select 1 from public.runtime_audit_events where user_id=p_user_id and source_id=row_data->>'id' and (metadata<>audit_data or ordinal<>(row_data->>'ordinal')::integer)) then raise exception 'runtime audit is immutable'; end if;
  insert into public.runtime_audit_events(user_id,source_id,ordinal,metadata) values(p_user_id,row_data->>'id',(row_data->>'ordinal')::integer,audit_data) on conflict do nothing;
 end loop;
 delete from public.runtime_entities r where user_id=p_user_id and not exists(select 1 from jsonb_array_elements(p_entities) e where e->>'kind'=r.kind and e->>'id'=r.entity_id);
 for row_data in select value from jsonb_array_elements(p_entities) e where e->>'kind'<>'audit' loop
  insert into public.runtime_entities(user_id,kind,entity_id,ordinal,ciphertext,fingerprint,block_id,parent_id,guard)
  values(p_user_id,row_data->>'kind',row_data->>'id',(row_data->>'ordinal')::integer,row_data->>'ciphertext',row_data->>'fingerprint',row_data->>'block_id',row_data->>'parent_id',coalesce(row_data->'guard','{}'::jsonb))
  on conflict(user_id,kind,entity_id) do update set ordinal=excluded.ordinal,ciphertext=excluded.ciphertext,fingerprint=excluded.fingerprint,block_id=excluded.block_id,parent_id=excluded.parent_id,guard=excluded.guard;
 end loop;
 next_revision:=coalesce(old_revision,0)+1;
 insert into public.runtime_projection_state(user_id,wrapped_key,revision) values(p_user_id,p_wrapped_key,next_revision)
 on conflict(user_id) do update set wrapped_key=excluded.wrapped_key,revision=excluded.revision,updated_at=now();
 return next_revision;
end $$;
revoke all on function public.save_runtime_projection(uuid,text,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_runtime_projection(uuid,text,integer,jsonb,jsonb) to service_role;
