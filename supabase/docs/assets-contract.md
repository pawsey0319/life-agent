# Private encrypted assets and account deletion fence

`20261110030000_assets.sql` creates private bucket `life-agent-assets`, 20MiB limit, only application/octet-stream. Objects must contain application ciphertext, not plaintext image bytes. No browser Storage policy is added; use trusted server upload/download and owner-authorized endpoints. Never expose a service key or public URL. Existing broad Storage policies elsewhere must be independently audited before deployment.

## RPCs (service only)

- `reserve_runtime_asset(p_user_id uuid,p_job_id uuid default null,p_lease_token uuid default null)` returns one `{id,path,reservation_token}` row. Path is server-generated `user_uuid/asset_uuid.bin`. For job-bound writes, the job must belong to the user and hold a matching unexpired running lease. The transaction writes both asset metadata and persistent cleanup ledger **before any network upload**.
- `finalize_runtime_asset(p_user_id uuid,p_asset_id uuid,p_reservation_token uuid) -> boolean`: marks reserved asset ready only while owner exists and is unfenced; job-bound assets also require the original job lease still running/current/unexpired.
- `begin_runtime_account_deletion(p_user_id uuid) -> void`: after Runtime verifies fresh reauthentication, obtains Auth parent lock, persists a deletion fence, removes user's job queue envelopes, and makes cleanup immediately due. Idempotent, including after Auth deletion. It does not claim to cancel provider side effects.
- `list_runtime_asset_cleanup(p_limit integer default 100) -> TABLE(path text,user_id uuid)`: returns due paths for fenced/missing owners or abandoned non-ready reservations older than 15 minutes. Also includes ready job-bound assets older than 15 minutes when their job failed/cancelled or its lease changed and the job is not succeeded. Succeeded jobs are preserved even if completion acknowledgment was lost. Limit clamped 1–1000.
- `record_runtime_asset_sweep(p_path text) -> void`: after successful Storage remove, records sweep and makes the path due again in five minutes. It **never removes the ledger**.

Tables are service-readable only. `runtime_assets` fields: id,user_id,job_id,job_lease_token,path,reservation_token,status(reserved|ready),created_at,finalized_at. Metadata cascades with Auth/job deletion. `runtime_account_fences` and `runtime_asset_cleanup` intentionally have no Auth FK: both survive account deletion to catch uncertain late uploads. Do not manually discard those rows unless a separate proven retention policy replaces periodic cleanup.

## Upload and deletion protocol

1. Reserve in DB before sending any bytes. Encrypt and upload to the returned exact path with upsert=false, MIME application/octet-stream.
2. Finalize after upload. If finalize returns false or throws, remove the uploaded object; do not publish it or save its ID into PA state. The retained ledger covers failures in this cleanup.
3. Read endpoint validates owner, fence absence and status=ready before downloading/decrypting. A race with fence activation cannot retract bytes already sent; do not claim it can.
4. Account DELETE verifies recent authentication, calls begin fence, pages **all** cleanup ledger paths for that owner (not only due list), removes known objects, then calls Auth admin deletion. Cleanup failures must leave a retryable deletion state, not report full success.
5. Worker repeatedly calls due cleanup list, Storage remove, then records successful sweep. Repeated deletion catches network uploads that complete after an earlier sweep. Missing objects count as successful removal; network/permission failures do not advance sweep.

Fence triggers deny INSERT/UPDATE to active projection entities/state, legacy snapshot, jobs and asset reservations. Deletes/cascades remain allowed. Runtime loads and downloads must separately check fences; deletion retry may intentionally load with an allowDeleting option solely for the account deletion route. Queue claims already in flight fail commit after fencing; pending envelopes are removed by the fence transaction.

## Honest guarantees and testing

Storage, model providers, Auth and PostgreSQL are not one distributed transaction. A reservation may be in flight indefinitely after a network timeout. Therefore immediate physical zero-orphan deletion is **not guaranteed**; permanent tombstones plus recurring deletion provide eventual cleanup while the cleanup Worker runs. Service outages/disabled Workers delay cleanup. Externally generated backups/provider data follow their own retention rules. No new browser policies are a default-deny design, not an executed penetration test.

Run `supabase/scripts/verify_assets.sql` on disposable local Supabase after migrations for DB-level reservation/fence/cascade/ledger/ACL checks. Actual Storage uploads, deletion-vs-upload races, multiple Runtime processes, queue locking, and repeated cleanup require configured integration tests. No real SQL/Storage execution is claimed in the tool-limited development environment.
