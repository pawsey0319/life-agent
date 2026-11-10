# Encrypted pgmq image jobs

Migration `20261110020000_jobs.sql` creates `life_image_jobs` and `runtime_jobs`. It provisions an implementable queue boundary, not proof an HTTP API or Worker already consumes it. Queue messages contain only `{user_id,job_id}`. Prompts/results use encrypted task columns, never queue JSON, error metadata, or logs.

## Service-only RPC contract

- `enqueue_runtime_job(p_user_id uuid,p_idempotency_key text,p_payload_ciphertext text) -> uuid`: creates a durable image task and sends its queue envelope in the same transaction. An existing per-user idempotency key returns its original job, including terminal jobs; use a new key for an intentional retry after failure/cancellation.
- `claim_runtime_job() -> SETOF runtime_jobs`: returns zero or one row with encrypted payload and fresh lease token. Visibility/lease is 90 seconds; at most three claimed attempts. A bounded scan skips stale envelopes and delayed/live leases. Workers must decrypt only after receiving a lease and must not expose service credentials to a model.
- `complete_runtime_job(p_user_id uuid,p_job_id uuid,p_lease_token uuid,p_result_ciphertext text) -> boolean`: commits encrypted result only for a current unexpired running lease, then deletes its queue envelope.
- `fail_runtime_job(p_user_id uuid,p_job_id uuid,p_lease_token uuid,p_retry boolean default true) -> boolean`: current lease only. Retry schedules a fresh envelope after 30 seconds, unless three attempts were used; otherwise terminal failed. No free-form provider error or prompt is retained.
- `cancel_runtime_job(p_user_id uuid,p_job_id uuid) -> boolean`: cancels nonterminal job, deletes its envelope, clears encrypted payload/result and lease. Terminal jobs return false.

Service role SELECTs `runtime_jobs` for authenticated owner polling. Browser roles have no table access/RPC execution. Direct service table mutations are revoked. Runtime must derive user_id from verified authentication and bind job polling/cancellation to that identity. Job status enum is queued/running/retry/succeeded/failed/cancelled.

## Recovery and deletion

A crashed Worker's envelope becomes visible after 90 seconds; the next claim replaces the expired lease and increments attempts. Old worker acknowledgments cannot overwrite new work. Long image calls that exceed the lease may create duplicate provider side effects: use provider idempotency if supported; this implementation deliberately does not promise exactly-once external image generation. Set provider timeout below the lease, or add a separately validated lease-extension RPC before raising timeouts. Three crashed attempts make the job failed.

Auth account deletion cascades encrypted task rows; remaining identifier-only queue envelopes are discarded when claimed. A stale worker cannot recreate a missing task. Deleting an account cannot cancel provider work already sent; do not promise remote erasure. Cancellation similarly invalidates future result commits but cannot undo provider side effects.

The enqueue transaction is atomic for task+queue; it is **not** atomic with an independent Runtime projection save. Use the idempotency key to reconcile response/retry failures; integration must establish ordering and cannot report PA state+job as one transaction without a composed RPC.

## Verification

`supabase/scripts/verify_jobs.sql` runs fixture checks for idempotency, lease ownership, stale acknowledgment denial, retry, cancellation payload clearing, account cascade and ACL. Run as postgres on a disposable local Supabase with an empty image queue; fixture writes roll back. Actual pgmq API compatibility, concurrent workers, delayed retry/lease expiry and Runtime integration must be exercised on real Supabase. No such execution is claimed when local Docker/PostgreSQL/Supabase tools are unavailable.
