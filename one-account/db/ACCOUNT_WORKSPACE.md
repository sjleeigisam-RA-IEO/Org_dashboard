# Account workspace (migration 010)

Apply `010_account_workspace.sql` after 009. The migration contains schema and functions only. `workspace-regression.sql` contains synthetic fixtures and ends with `ROLLBACK`; to validate an unapplied migration, combine both interiors in one outer `BEGIN` / `ROLLBACK`. A successful check returns `WORKSPACE_REGRESSION_PASS`.

## API contract

All routes require the existing signed session and return non-cacheable JSON. POST requires the same HTTPS origin. Unknown input fields are rejected. The server fixes the dataset to `rm-v1.7`.

| Request | Body / result |
| --- | --- |
| GET `/api/account?action=team&accountId=…` | `accountId`, `accountRevision`, `currentRevision`, normalized `team`, `candidates`, last 30 account RM versions |
| POST `save-team` | `accountId`, `expectedRevision` (the account revision), `patch`, `requestId`, optional `note` |
| GET `/api/account?action=metadata&accountId=…` | `account`, last 50 typed account-scope CRM audit summaries, `privacy` |
| POST `update-account` | `accountId`, `expectedRevision` (account record revision), `patch`, `requestId` |
| POST `create-person` | `accountId`, `patch: {name, department?, title?}`, `requestId`; returns `personId`, `affiliationId`, `person`, `affiliation` |

Team patches allow only `primaryRmId`, `backupRmId`, and `sponsorRmId`; `""` clears a role. Candidate entries are `{rmId, name, roles}`. A team always returns all three fields plus `updatedAtByRole`.

Account metadata is `{accountId, name, piscfh, aliases, notes, notesMasked, revision, profileRevision, isExisting, isPlaceholder, accountKind}`. Account patches allow only `name`, `piscfh`, `notes`; supported new classifications are `P/I/S/C/F/H/미Account`. Legacy classification values remain readable.

POST results use `committed`, `noop`, `replayed` or `conflict`; conflicts return HTTP 409 with the current record. A replay returns the original result, including original revision, plus `originalStatus`. Clients preserve their input on conflicts and reuse the exact `requestId` only for uncertain retries of the same body.

## Revision and history preservation

`accountRevision` is `max(version_changes.revision)` for the dataset/account, falling back to 1. It survives removal of the final assigned role. Existing global saves and restores write the same change ledger and therefore participate in account conflicts.

`oa_account_save_team` locks `current_state`, checks `account_team_requests` against the original command hash, compares the account revision, merges the patch with the latest full state and calls the existing `oa_commit_state`. It preserves other accounts and existing role timestamps. The separate immutable command ledger prevents replay hashes from changing after another account is saved. This ledger includes accepted no-ops.

`crm_accounts.revision` remains the metadata/classification/hierarchy record clock. New `profile_revision` starts at 0 and increments only for a changed workspace metadata command. Catalog clients can use a positive value to adopt the current canonical name while retaining previous baseline-name behavior for untouched rows. Renames append the previous name to aliases, retaining structured legacy aliases. Metadata edits preserve account IDs, `is_existing`, placeholders, hierarchy and contact anchors. Manual classification changes record `account-workspace-v1` with `review_required=true`; before/after audit rows preserve prior classification evidence. Immutable baseline catalogs are preserved; effective live labels prefer current CRM names.

## Identity and private text

RM updates retain existing signed-session authorization and derive the actor email on the server. Metadata mutation, person creation and plaintext account notes require the 009 mailbox proof; each RPC rechecks proof binding, expiry, revocation and current policy in the transaction. Locked metadata contains empty `notes` and only `notesMasked: "*"` when a note exists. Verified metadata reads add an immutable `account_read` access event.

Account history returns only audit ID, typed entity ID, revision, timestamp, actor, action and changed field names. It never includes before/after records or personal text. Existing person-level private details remain under the CRM verified read contract.

## Atomic person creation

The command creates one person and one real organization affiliation in a single transaction. Stable IDs are `PERSON-{requestId}` and `AFF-{requestId}`. Groups and placeholder employers are rejected. A missing department/title stays an empty schema default; status is `unknown`, identity is `unverified` and dates are NULL. No contact, source claim, employment date, gift fact or inferred value is created.

Both audit rows share the command request ID. `account_workspace_verifications` links each audit row to the original proof. The existing verified person-history RPC includes these verification records alongside legacy CRM proofs. Replay access is recorded separately from original mutation provenance. All new tables have RLS, no client/service direct table access and immutable history triggers. Only approved public RPCs have service-role execute grants.
