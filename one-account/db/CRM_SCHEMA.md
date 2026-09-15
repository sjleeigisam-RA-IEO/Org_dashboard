# One Account customer CRM

The CRM extends the authenticated One Account dashboard with people, their
institutional affiliations, contact details, receiving preferences, life events,
and gift plans. It is separate from financial exposures and from the shared RM
assignment history. A source list is evidence that someone was listed; it is not
proof of current employment, shipment, receipt, or cost.

## Storage and identities

All tables are in the private `one_account` schema with a `crm_` prefix. Existing
`datasets`, `current_state`, `versions`, `version_changes`, and `commit_requests`
remain the RM assignment system.

| Table | Identity and purpose |
| --- | --- |
| `crm_accounts` | Stable `account_id`; name, PISCFH classification, aliases, and existing/new flag. Existing dashboard IDs are preserved. |
| `crm_persons` | Stable `person_id`; name and identity confidence. Names are not unique identifiers. |
| `crm_affiliations` | Stable `affiliation_id` links a person to an account; department, title, employment status, start/end dates, and notes. A person may have several affiliations. |
| `crm_contact_points` | Typed mobile, phone, email, address, or postcode; person plus optional affiliation; source and verification status. |
| `crm_receiving_preferences` | Receiving intention, campaign or ongoing scope, optional effective dates, and source. |
| `crm_life_events` | Event type, date, recurring flag, solar/lunar/unknown calendar, and notes. |
| `crm_gift_campaigns` | Separate occasions and years, such as a particular holiday. |
| `crm_gift_items` | Described item and optional unit price/currency. |
| `crm_gift_recipients` | Campaign/person/affiliation association; nullable sending decision (`send_target`); proposed/listed/cancelled plan; separately recorded actual shipment, receipt, and cost. |
| `crm_sources` | Exact source filename and SHA-256, linked to its import batch. |
| `crm_source_records` | Exact source file, sheet, row number, and original cell values. |
| `crm_field_claims` | Field-level source assertions, including disagreements; entity type/ID, field, value, source row, and verification status. |
| `crm_import_batches` | Immutable batch ID, manifest hash, database-computed payload hash, actor, collection counts, and time. |
| `crm_audit` | Immutable before/after records for every accepted CRM create/update, with actor, revision, and request ID. |
| `crm_commit_requests` | Immutable idempotency results for accepted creates, updates, and no-ops. |
| `crm_identity_policy` | Operator-controlled `disabled`, `all_verified`, or `allowlist` access policy; migration 009 starts disabled. |
| `crm_identity_allowlist` | Company mailboxes explicitly enabled when policy mode is `allowlist`. |
| `crm_identity_challenges` | Distributed send reservations and one-use email verification challenges, bound to the parent session; stores digests, never plaintext codes. |
| `crm_identity_proofs` | Opaque-token digests linked to a verified mailbox, parent-session binding, absolute expiry, and revocation. |
| `crm_commit_verifications` | Immutable authentication provenance for an original committed/no-op request, linked to its change audit when a value changed. |
| `crm_identity_access_audit` | Immutable verified detail reads and commit/conflict/replay access events, including authenticated actor and time. |

`contact_account_id` is an explicit link for existing dashboard IDs that represent
the same contact institution. The anchor's ID is used to collect affiliations
when either linked account is opened. This does not merge the two dashboard
accounts, their financial relationships, or their RM assignments. Identity links
must be reviewed; matching display names alone is insufficient.

`is_placeholder = true` identifies a management bucket for unknown affiliation.
It is not a newly verified legal entity. New CRM-only institutions receive stable
IDs and do not acquire invented assets, commitments, or business exposures.

Contact points, gifts, preferences, and life events may reference an affiliation
only if that affiliation belongs to the same person. A database trigger enforces
this independently of the browser and API.

## Unknown values and history

- Employment defaults to `unknown`. A historic job title or a retirement-from-role
  note does not by itself establish that the person left the institution.
- Missing amounts stay `NULL`, including item price, planned amount, and actual
  amount. Missing amounts are not zero-cost gifts.
- `send_target` records **발송대상** for one campaign: `yes` = O, `no` = X,
  `NULL` = unknown (displayed as an empty cell). The source field `발송대상`
  represents a sending decision, separately from a recipient's willingness to
  receive (`availability`), list membership (`plan_status`), and actual shipment
  (`delivery_status`). No value is derived from those other fields. Existing
  records and older import/create payloads that omit `send_target` stay `NULL`.
  Choosing an item also does not establish that the gift was sent.
- An imported list leaves `delivery_status` and `received_status` as `unknown`;
  actual amount and delivery/receipt dates remain `NULL`. Import rejects attempts
  to infer these actuals from the list.
- Source O/X receiving intention belongs to its source campaign. It does not
  establish permanent refusal. Import rejects `scope = ongoing`; a user may set
  an ongoing preference explicitly through a separate reviewed edit.
- Effective dates remain unknown when absent. A missing end date on a campaign
  preference does not convert it into a permanent preference.
- Several gifts or preferences can coexist. Future campaigns are distinct rows,
  so later seasons need not overwrite earlier records.
- Gift history follows the person across affiliations. Each gift response includes
  `gift_account_id` and `gift_account_name` for the affiliation attached to that
  gift; viewing another account does not relabel the earlier gift's institution.
- Affiliation edits retain before/after snapshots in `crm_audit`; a new
  affiliation can be created when a person joins a different institution. Do not
  overwrite the account of an existing affiliation to represent a job move.
- Source records and field claims are immutable. Corrections update the working
  profile while keeping original claims available for review.

## Application API

`GET /api/crm` defaults to `action=catalog`. Catalog, account, and search responses
always use the server's safe projection: basic institutions, people, affiliations,
and contact counts. Their contact values, preferences, gift details, source data,
and audit arrays remain empty even after mailbox verification. The raw database
read shape is an internal server contract, not permission to return it to a client.

| Action | Query | Response |
| --- | --- | --- |
| `catalog` | none | Safe `accounts`, `totals`; `campaigns` and `items` are empty. |
| `account` | `accountId` | Safe account/child hierarchy, affiliation/person summaries, and `contact_count`. |
| `person` | `personId` | Basic identity/affiliations and masked detail presence until verification; verified, policy-authorized access can return the full person detail described below. |
| `search` | `q`, optional `limit` 1–200 | Bounded safe name/account/department/title matches, contact counts, and `truncated`. |

Unverified person detail preserves the table structure through `masked_details`:
contacts, preferences, gifts, and life events. Supported populated values become
`*`; null, blank, and unknown values stay empty. Zero and an explicit refusal are
populated values. Contact kinds are fixed allowed labels; private values, record
IDs, campaign names, notes, and source/audit content are never copied into masks.
The original private arrays stay empty, and client flags cannot unlock them.

Verified person detail uses `contact_points`, `receiving_preferences`,
`gift_recipients`, `life_events`, `field_claims`, `source_records`, and `audit`.
It also supplies `campaigns` and global `items` for edit selectors. Gift rows retain
nullable `send_target` and original `gift_account_id`/`gift_account_name`.
Only the requested person's typed entity identities are used for its latest
100 change-audit records, including life events. Each change includes full
`before_record` and `after_record`, actor, revision, and timestamp. Its
`verification` is `{actor_email, verified_at, auth_method}` for an originally
verified mutation and null for older unverified/import/administrative records.

Writes use `POST /api/crm` with:

```json
{
  "action": "update",
  "entity": "affiliation",
  "id": "synthetic-affiliation-id",
  "expectedRevision": 1,
  "patch": { "employment_status": "unknown" },
  "requestId": "a962972e-f20b-49e5-970b-e89033ae490f"
}
```

The fixed mutable-field allowlists are in `lib/crm-db.cjs` and
`one_account._crm_entity`. Supported entities are `person`, `affiliation`,
`contact_point`, `preference`, `life_event`, and `gift_recipient`. Creation is
supported for all except `person` and uses `expectedRevision = 0`. Person creation
and account changes currently belong to the controlled import/administration
workflow, which also records their source and matching decisions.

Creation requires a `person_id`; affiliation creation also requires `account_id`,
and gift creation requires `campaign_id`. Subsequent updates cannot change primary
keys, person ownership, affiliation ownership, source references, timestamps, or
the actor. The database derives the actor from a valid mailbox-verification proof;
the browser and the parent shared-code session cannot supply or override it.

Gift create/update patches may contain `"send_target": "yes"`,
`"send_target": "no"`, or `"send_target": null`. Literal O/X, booleans, and empty
strings are rejected. An omitted field is not changed by an update.

Every record has a revision. A stale expected revision returns HTTP 409 plus the
current record. The caller must reread and reconcile; it must not silently retry
with a new revision. A network retry reuses the same request ID and identical
payload, returning its original result even if another edit has happened since.
Reusing a request ID for different contents is rejected. No-op edits do not create
a new revision. There is no delete or arbitrary-table API.

## Authentication and database privileges

The existing signed shared-code session gates every request, but it does not prove
mailbox ownership. Full person detail and all CRM writes additionally require a
valid database-backed mailbox-verification proof and a current policy grant.
Writes also require an explicit same-origin request. Browser and Vercel/CDN
responses are non-cacheable. This identity flow is separate from a customer's
`crm_persons.identity_status`, which is identity-matching confidence and grants
no application access. Shared RM assignment editing remains a separate system.

Every CRM table has RLS enabled with no client policies. `anon`, `authenticated`,
and `service_role` have no direct table access. Only `service_role` can execute
these public security-definer wrappers:

- `oa_crm_read(text,text,text,integer)`
- `oa_crm_import(jsonb,text)`
- `oa_crm_identity(text,jsonb)`
- `oa_crm_verified_read(text,text,text,integer,text,text)`
- `oa_crm_verified_commit(text,text,text,bigint,jsonb,uuid,text,text)`

Migration 009 removes `service_role` execute permission from the old
`oa_crm_commit(text,text,text,bigint,jsonb,text,uuid)`. It remains the internal
atomic revision/replay/audit primitive called by the verified wrapper and by
explicit administrator workflows. There is no HTTP import, policy-edit, or
allowlist-edit endpoint. An operator configures the private policy independently
of deployment; `disabled` permits no verified access, `all_verified` permits
verified `@igisam.com` mailboxes, and `allowlist` also requires an enabled entry.

### Mailbox verification contract

`oa_crm_identity(p_action text, p_args jsonb)` accepts only the following keys:

| Action | Arguments | Result states |
| --- | --- | --- |
| `start` | `challenge_id`, `email`, `session_binding`, `ip_digest`, `code_digest`, `parent_expires_at` | `pending` with challenge ID/expiry, `duplicate`, `denied`, or `rate_limited` with `retry_after` seconds. |
| `mark_sent`, `cancel` | `challenge_id`, `session_binding` | `sent` / `cancelled`, or an inactive/invalid/expired state. |
| `verify` | `challenge_id`, `session_binding`, `code_digest`, `proof_digest` | `verified`, `invalid_code`, `locked`, `inactive`, `invalid`, `expired`, or `denied`. |
| `status`, `revoke` | `proof_digest`, `session_binding` | `verified` or `unverified`; revoke always returns `unverified`. |

All arguments are server-derived strings: challenge UUID; normalized company
email; 64-character lowercase hex digests; and the parent session's absolute
timestamp. The server computes the code digest with a secret HMAC and independently
generates a random opaque proof token, sending only its SHA-256 digest to the DB.
Verified responses expose only `status`, `email`, `expires_at`, and
`auth_method: email_otp`. Digests and codes are never response fields.

The DB reserves before SMTP under a distributed transaction lock. Reservations
enforce a 60-second email cooldown, 5/email/hour, 5/session-binding/hour, and
25/IP-digest/hour. Failed, cancelled, superseded, and consumed sends still count.
A duplicate challenge ID does not authorize another send. A new reservation
cancels previous active challenges for the same binding. The server marks sent
only after SMTP acceptance, which is not a claim of inbox delivery. Cancellation
does not undo the rate-limit reservation.

Challenges expire at the earlier of 10 minutes and the parent session expiry.
Only sent challenges can verify. Wrong codes increment a row-locked counter and
return a state without raising, so failed attempts persist; the fifth failure
locks the challenge. A successful code is consumed once. Proofs expire at the
earlier of 8 hours after verification and the original parent expiry. Status
checks do not renew this duration. A new proof revokes prior proofs for that
binding. Expiry, revocation, binding, and current policy are checked inside each
verified read/mutation transaction; revocation and policy changes are serialized
against active operations.

`oa_crm_verified_read(p_action, p_id, p_query, p_limit, p_proof_digest,
p_session_binding)` accepts only `person` with a null query and a bounded limit.
It logs the successful read in the same transaction before returning detail.
`oa_crm_verified_commit(p_action, p_entity, p_id, p_expected_revision, p_patch,
p_request_id, p_proof_digest, p_session_binding)` derives the actor from the proof,
then reuses the existing atomic mutation checks. It stamps verification provenance
on original commits/no-ops and logs each returned commit/no-op/replay/conflict as
an access event. A verified replay of an old request does not retroactively label
the original unverified change as verified. Both verification and access history
reject updates and deletes. Missing proof/policy grants raise SQLSTATE `42501`;
malformed requests raise `22023`. No new-person creation or merging is introduced.

All functions fix their search path. Dynamic table/column identifiers are derived
from server allowlists or checked table columns and are identifier-quoted. Raw
provider errors are not sent to the browser. Source contents, credentials, and
personal data are not placed in public HTML, browser bundles, repository files,
or diagnostic logs. The source/detail records are read from the authenticated API.

## RM compatibility

Migration `002_contact_crm.sql` leaves the immutable RM dataset and all prior
versions intact. `_effective_catalogs` overlays CRM accounts only in the local
catalog copy used by `oa_commit_state` for dataset `rm-v1.7`. Baseline account names
win on collisions. Existing RM candidate lists, role checks, optimistic revisions,
and history rules remain unchanged. Thus a new CRM account can receive an RM
assignment without editing a baseline or rewriting old history. The server's
assignment-count cap is aligned with the existing SQL limit of 5,000 accounts.

## Migration, import, and verification

1. Record existing RM baseline hash, current revision, assignment count, and
   history count. Read the deployed schema before applying a migration.
2. In one transaction, run the migration contents and `crm-regression.sql`, then
   roll back. Strip their outer transaction statements when combining them. The
   regression uses only synthetic fixtures and checks source preservation,
   unknown defaults, canonical contact links, revisions, replay, conflict,
   affiliation ownership, immutability, RLS, and baseline preservation.
3. Apply `002_contact_crm.sql`, `003_contact_history_views.sql`, then
   `004_contact_import_validation.sql`, once each as
   database administrator. They intentionally fail if their expected prior
   function definitions are not present. The third migration adds person-wide
   gift views with original affiliation and includes life events in audit lookup.
   The fourth migration preserves the same import-field validation while caching
   each table's allowed columns once per bulk collection.
4. Build and verify the private import payload against the exact input hashes.
   Keep raw workbooks, payloads, and detailed reconciliation outside tracked files.
   Use `schema_version: 1`, a stable `batch_id`, and a 64-digit `manifest_sha256`.
   See the data-preparation script for the field-level matching and lineage rules.
5. Call `oa_crm_import` using the server credential or an administrator. There is
   no application import endpoint. The maximum JSON payload is 50 MB. Collections
   are bulk inserted in dependency order: sources, source records, accounts,
   persons, affiliations, contacts, campaigns, items, gift recipients, preferences,
   events, and claims. Optional empty collections may be omitted.
6. A repeated identical batch returns `replayed`; a changed payload with the same
   batch ID fails. Stable row IDs use insert-only conflict handling, preserving
   prior working-profile edits. A subsequent corrected source needs new source
   identity/claims plus an explicit working-profile reconciliation; import is not
   a bulk overwrite mechanism. The returned `*_inserted` counts are present on the
   initial import; replay returns the immutable input collection counts.
7. Read back counts, source coverage, contact links, representative profiles, and
   unresolved identities. Confirm actual shipment/receipt/cost remain unknown.
   Recheck that the original RM baseline and assignments are unchanged.
8. Run `node --test tests/*.test.cjs`, verify unauthenticated requests fail, inspect
   authenticated account/person screens, and deploy the reviewed application.

The production source transfer uses a staged administrative import because a
single large payload exceeded the Management API transport limit and the REST
statement timeout. Each chunk is at most 750 KB, uses its own deterministic batch
ID and the same parent-manifest hash, and is independently transactional and
retryable. This is not one transaction covering the entire source collection.

The chunk order is sources, source records, accounts, persons, affiliations,
contacts, campaigns/items, gift recipients, preferences, and claims. Account rows
remain together so deferred canonical-contact self-references resolve before that
chunk commits. Within other collections a chunk never splits an individual row.
Stable entity IDs and immutable batch hashes prevent retry duplication.

After every chunk is acknowledged, the administrator reads back the complete
expected entity counts, source coverage, references, unknown actual-delivery
fields, and unchanged RM baseline. Only then is a parent-manifest completion
marker recorded and the CRM-enabled UI released. A partially completed transfer
must be resumed and verified; HTTP success for one chunk is not completion of the
overall source import. Preserve private manifest/progress files for deterministic
retries and never discard unresolved matching evidence to fit a request.

Migration `008_gift_send_target.sql` follows the hierarchy read wrapper introduced
by migration 006. It adds the nullable checked column, patches only the gift
mutable-field allowlist, and enriches the bounded search output through a private
helper. Account/person gift reads already serialize the whole gift row and
therefore expose the field automatically. Function-definition guards fail on an
unexpected schema. Existing wrapper grants, RLS, import actual-delivery guards,
and source history remain unchanged. Source workbook reconciliation is performed
separately, with source claims and revision-checked working-record edits; this
migration performs no sending decisions or actual shipment updates.

Migration `009_crm_identity.sql` creates the private identity policy, challenges,
proofs, and immutable access/verification audit relations. Validate it together
with `identity-regression.sql` inside one outer `BEGIN`/`ROLLBACK`, stripping both
files' transaction wrappers. Its synthetic regression covers one-use codes,
attempt persistence, distributed send thresholds, parent/proof expiry, policy
withdrawal, revocation, mutation replay/conflicts, typed before/after audit scope,
ACL/RLS, and unchanged source/RM state. Apply the migration once, leave its policy
disabled while validating the application, and activate the intended operator
policy separately. Application releases must use the verified commit wrapper
after the old service-role commit grant is removed.
