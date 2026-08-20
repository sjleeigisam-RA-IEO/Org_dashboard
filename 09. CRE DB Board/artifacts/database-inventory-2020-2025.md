# Market DB inventory — 2020~2025

- 생성시각: `2026-08-16T04:51:37.975523+00:00`
- schema: `2.6.0`
- quick_check: `ok` / FK 위반: `0`

## 저장용량

- market.db: **198.05 MiB** (207,671,296 bytes)
- SQLite allocated: **198.05 MiB** / free-list: **0 pages**
- raw/: **4.51 MiB**
- artifacts/: **10.97 MiB**
- backups/: **3,167.52 MiB**

## 논리 정보량

- 논리 row(FTS shadow 제외): **207,527**
- 물리 table row(FTS 포함): **207,530**
- source document: **37,400** / version: **39,289**
- mention: **9,448** / event mention: **36,817** / claim: **63**
- organization: **70** / asset: **16** / project: **0**
- canonical event: **28** / sale process: **16**
- LP mandate: **12** / official selection: **4**

## 2020~2025 기간 필터

- document_versions_published: **39,288**
- distinct_documents_published: **37,399**
- document_versions_unknown_published_at: **0**
- event_mentions_by_event_date: **2**
- canonical_events_by_event_date: **24**
- claims_from_period_published_documents: **62**
- mentions_from_period_published_documents: **9,448**
- sale_processes_launched: **4**
- lp_mandates_vintage: **12**
- lp_official_selections: **4**

## 텍스트량

- stored_text_characters: **4,374,578 chars**
- snippet_characters: **12,291,399 chars**
- event_summary_characters: **12,302,128 chars**
- claim_raw_value_characters: **1,152 chars**

## 주의

- period counts use table-specific business dates and are not additive
- assets, organizations and projects are master rows without a single event-period meaning
- unknown published_at rows are reported separately and not assumed to be outside the period
- FTS shadow rows are excluded from logical row total but included in physical row total and file bytes
