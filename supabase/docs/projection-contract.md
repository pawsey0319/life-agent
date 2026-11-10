# Authoritative runtime projection contract

Migration `20261110010000_runtime_projection.sql` is the configured persistence boundary. It does not claim the original domain tables are now populated. Instead, runtime arrays are normalized into individually encrypted entity rows with owner identity, namespace/session links, stable fingerprints, and database-visible memory guards.

## API

`save_runtime_projection(p_user_id uuid, p_wrapped_key text, p_revision integer, p_entities jsonb, p_core_actions jsonb default '[]') -> integer` is service-only. Absent state accepts revision 0 and returns 1. Existing saves require the exact revision. Auth parent-row locking also serializes concurrent first saves. Every check and write occurs in one transaction; any core, ownership, audit, or CAS failure rolls everything back.

Entities: `{kind,id,ordinal,ciphertext,fingerprint,block_id?,parent_id?,guard?}`. Memory guards: `{tier,state,pinned,sensitive,subjectKey}`; subjectKey is a per-user keyed hash, never raw subject text. Audit entries instead use `{kind:"audit",id,ordinal,action,at,field?,requestId?}` with no ciphertext or arbitrary payload. Audit entries append to `runtime_audit_events` keyed by original source ID; old entries cannot mutate or be erased by omission.

Read `runtime_projection_state` for revision/wrapped key, `runtime_entities` for individually encrypted values ordered by kind/ordinal, and `runtime_audit_events` for metadata. **Never restore configured state from legacy runtime_state aggregate ciphertext.** The reader must recompute each entity's keyed fingerprint and guard after decrypting, validate entity identity/relationships, and fail closed on mismatch. Pagination and a consistent revision check around multi-request reads are required to avoid truncation or torn reads.

## Core guard authority

A memory's stable fingerprint covers content, subject, category, tier, state, pinned, reason, sensitive, source and createdAt. It excludes access time, embedding bookkeeping and repeated-session evidence. AES-GCM ciphertext randomization alone must not change the stable fingerprint.

Changing/deleting an existing core requires a matching action `{id,operation:"edit"|"delete"|"confirmed_replace"}`. Confirmed replacement requires the new old-memory state to be historical. Actions are injected only by authenticated owner operations, never parsed from model/user supplied JSON or inferred by a Worker. Worker saves always pass an empty action array. Normal-to-core promotion remains allowed. Source-deletion changes to core fingerprints also require explicit owner uninstall authority; they are not silently exempted.

The transaction uses a private helper owned by a NOLOGIN role for validated core actions. A caller-set GUC has no authority. Browser roles cannot read or write these tables or execute the RPC; Runtime service_role can read but cannot directly mutate the projection tables. Account Auth deletion cascades records and permits audit deletion only when the referenced Auth account no longer exists.

## Limits and verification

This closes the active aggregate bypass only when the Runtime uses entity reconstruction and verifies fingerprints/guards. The trusted Runtime still decides which user action is legitimate; service-role compromise is outside this boundary. Stable fingerprints are not proof PostgreSQL can decrypt ciphertext. Embeddings/subject hashes remain potentially sensitive derived data. Original domain grants/field-registry restrictions and pgmq worker integration are distinct unfinished work, not implied by these projection tables.

Run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/verify_projection.sql` against disposable local Supabase after migrations. The script behaviorally checks CAS, core historical/deletion denial, GUC resistance, ownership references, immutable audit, controlled deletion, account cleanup and ACLs, then rolls fixtures back. It has not been run where Docker/PostgreSQL/Supabase are unavailable. Separate concurrent-process CAS tests and real configured smoke tests remain required.
