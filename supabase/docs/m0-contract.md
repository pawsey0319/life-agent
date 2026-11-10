# M0 Supabase contract

`20261110000000_m0_core.sql` creates the normalized ownership model and security boundary. Every user-owned table carries `user_id`; child relations also use composite foreign keys `(child_id, user_id)` to prevent cross-namespace association. Browser roles receive only owner-scoped `SELECT`; writes to normalized tables are Runtime/RPC responsibilities.

## Runtime snapshot CAS

`runtime_state` is an encrypted aggregate snapshot for the configured runtime adapter:

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `ciphertext text`, `wrapped_key text`, `revision integer >= 0`, `updated_at`
- `save_runtime_state(p_user_id, p_ciphertext, p_wrapped_key, p_revision) returns integer`
- only `service_role` can execute it; the RPC locks an existing row with `FOR UPDATE`
- absent state accepts expected revision `0` and inserts revision `1`; existing state requires exact expected revision and increments by one; mismatch raises `runtime state revision conflict`

Backend must treat this as compare-and-swap and retry by rereading the current state. It must not expose a generic SQL endpoint or arbitrary `set_config` control to clients. Snapshot contents are encrypted, but the snapshot is **not** protected by normalized-table foreign keys, core-memory trigger semantics, or per-entity RLS. Therefore configured mode is not a production safety milestone until the backend integrates normalized writes/reads and security tests; snapshot persistence is a temporary adapter contract, not permission to bypass the model.

## Controlled writes

The core-memory trigger rejects all meaningful changes to core rows except activation/access bookkeeping. Authority is the NOLOGIN `life_memory_writer` database role, never a caller-set GUC. Only typed service-role RPCs `controlled_memory_edit(uuid,uuid,text,text,text,boolean)` and `controlled_memory_delete(uuid,uuid)` run as that role. Browser table writes and RPC execution are denied. Audit is append-only. During privileged account deletion, core and audit DELETE triggers permit cascading removal only after the referenced `public.users` row is absent; the existing Auth admin delete path therefore needs no preparatory RPC or transaction marker. Inbox rows cascade on block uninstall. Audit block IDs deliberately remain immutable historical IDs rather than live block FKs.

## Verification

Run `supabase db reset`, then execute `supabase/scripts/verify_m0.sql` in a real local Supabase database with pgTAP available. The repository environment did not have Docker/psql/Supabase, so integration execution remains pending; do not report this SQL-only inspection as passing integration.
