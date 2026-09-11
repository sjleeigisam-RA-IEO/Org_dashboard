# One Account shared assignment database

`001_shared_state.sql` creates only the private `one_account` schema and three
`public.oa_*` RPC functions. Apply once using a database administrator. It does
not modify another dashboard's tables or publish company data.

All tables use RLS without client policies. `anon` and `authenticated` have no
schema, table, or function access. `service_role` may execute the three public
RPC wrappers; the Vercel server supplies the authenticated email and fixed
dataset ID. Never put the service key in browser code.

## Initial seed

Seed through an administrator in one transaction, after validating the source
HTML SHA-256 and extracting its exact baseline assignments. Never create a
public bootstrap route. The initial dataset ID is `rm-v1.7`.

1. Insert `one_account.datasets` with `dataset_id`, `snapshot_id`,
   `baseline_sha256`, `baseline_assignments`, and `catalogs`.
2. Call `one_account._normalise_assignments(catalogs, baseline_assignments)` to
   independently verify all account identities, role candidate cohorts, and
   distinct people. Keep original role timestamps in the stored baseline.
3. Insert `one_account.versions`: revision `1`, parent `NULL`, action
   `baseline`, original assignments, `actor_email = 'sjlee@igisam.com'`, a
   factual source note, and `request_id = NULL`. Use one server timestamp.
4. Insert `one_account.current_state` by selecting revision, assignments,
   created_at, and actor_email from the new baseline version.

The immutable catalog shape is:

```json
{
  "accounts": {"account-id": "Account display name"},
  "rms": {
    "person-id": {"name": "Person display name", "roles": ["primary", "backup"]}
  }
}
```

The assignment shape is an object keyed by account ID. Omitted accounts and
teams with all three roles empty have the same meaning:

```json
{
  "account-id": {
    "primaryRmId": "person-id",
    "backupRmId": "",
    "sponsorRmId": "",
    "updatedAtByRole": {"primary": "2026-09-11T00:00:00.000Z"}
  }
}
```

## RPC contract

- `oa_get_state(p_dataset_id text, p_revision bigint default null)` returns the
  current snapshot or the requested historical snapshot. `revision` describes
  the returned assignments; `current_revision` always describes the current
  database version.
- `oa_commit_state(p_dataset_id text, p_expected_revision bigint,
  p_assignments jsonb, p_actor_email text, p_request_id uuid, p_note text,
  p_restore_revision bigint default null)` performs a compare-and-set under a
  row lock. For a restore, pass `p_assignments = null` and select an existing
  revision. Restore appends a new revision; it never rewrites the old one.
- `oa_get_history(p_dataset_id text, p_limit integer,
  p_before_revision bigint default null)` returns newest-first version metadata
  and before/after role changes. `p_limit` is 1–100. The returned
  `next_before_revision` is the next cursor or `null`.

State responses include `dataset_id`, `revision`, `current_revision`,
`assignments`, `snapshot_id`, `baseline_sha256`, `updated_at`, and `actor_email`.
Commit `status` is `committed`, `noop`, `conflict`, or `replayed`; a replay also
includes `original_status`. Map `conflict` to HTTP 409. A replay returns the
original accepted revision even if another user has subsequently saved; compare
`current_revision` before replacing the UI's current state. A stale request
which was never accepted is not recorded and must be resubmitted after review
with a fresh request UUID and revision. Metadata/payload errors use SQLSTATE
`22023`; unknown datasets or revisions use `P0002`.

Client role timestamps are ignored. The server preserves unchanged roles'
existing timestamps and stamps changed roles using database time. Semantic
no-ops do not create a version, but they receive an immutable idempotency record.
An identical retry reuses that result; a reused UUID with changed actor, content,
expected revision, note, or restore target is rejected.

`versions`, `version_changes`, `commit_requests`, and the dataset baseline are
immutable through triggers and privilege restrictions. Every commit updates
`current_state` only after inserting the full version and its role changes in
the same transaction. Audit names are stored with the changes.

## Validation

`regression.sql` seeds synthetic fixture data inside a transaction, checks
validation, timestamps, optimistic conflicts, idempotency, restore, history,
and privilege boundaries, then rolls back. It has no real company records.
Execute against a disposable PostgreSQL database after the migration, or as a
database administrator against the configured project. Errors must abort the
test transaction; do not remove its final `ROLLBACK`.
