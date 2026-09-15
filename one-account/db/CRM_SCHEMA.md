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

`GET /api/crm` defaults to `action=catalog` and returns account metadata, contact
counts, campaigns, and items. It does not include contact values in the catalog.

| Action | Query | Response |
| --- | --- | --- |
| `catalog` | none | `accounts`, `campaigns`, `items`, `totals` |
| `account` | `accountId` | `account`, affiliation/person summaries with contact points, preferences, and gift records |
| `person` | `personId` | person, affiliations, contacts, preferences, events, gifts, field claims, source references, and recent audit metadata |
| `search` | `q`, optional `limit` 1–200 | bounded name/account/department/title matches, affiliation-scoped contacts/preferences, person-wide gift history, and `truncated` flag |

Account and search `people` rows expose `contact_points`,
`receiving_preferences`, and `gift_recipients`. Person detail uses those same
array names. Gift rows include nullable `send_target`; each gift retains its
original `gift_account_id` and `gift_account_name`. Search enriches only the
bounded matches and uses the same contact/preference affiliation rules as
account detail. Search still excludes raw source cells and field claims.

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
the actor. The session supplies the actor on the server.

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

The existing signed One Account company-email session gates every read and write.
Writes also require an explicit same-origin request. Responses set browser and
Vercel/CDN no-store headers. This preserves the current authenticated audience;
finer per-account or per-field authorization can be added later.

Every CRM table has RLS enabled with no client policies. `anon`, `authenticated`,
and `service_role` have no direct table access. Only `service_role` can execute
the three public security-definer wrappers:

- `oa_crm_read(text,text,text,integer)`
- `oa_crm_commit(text,text,text,bigint,jsonb,text,uuid)`
- `oa_crm_import(jsonb,text)`

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
