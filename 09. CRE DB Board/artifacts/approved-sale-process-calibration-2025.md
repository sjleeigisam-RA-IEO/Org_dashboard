# 2025 approved sale-process calibration

- Calibration date: 2026-08-16
- Authority DB: `data/market.db`
- Import policy: APPROVED manifest only; no title/snippet auto-promotion

## Imported calibration processes

1. `sp_hyundai_yeonji_2025` — 현대그룹 연지동 사옥
2. `sp_cheongna_logistics_2025` — 청라 로지스틱스 센터

The fixtures distinguish bidder/manager, fund or acquisition vehicle, consortium member,
equity provider, debt provider, arranger, bid-price claim, preferred-bidder decision, and
closing milestone. Unknown legal entity names and lender names remain explicitly undisclosed.
The Japanese financial institution amount in the Cheongna case is marked as a subset of the
reported mortgage facility with `DO_NOT_ADD_TO_PARENT`.

## Rejected receipt and restoration

An initial calibration draft cited OpenDART receipt `20251001000194` as if it supported the
Hyundai Yeonji sale. Direct `document.xml` retrieval proved that the receipt was actually a
large-shareholding report for ADTechnology, not a Hyundai Elevator asset-disposition filing.
The receipt, an inferred exact fund name, and an inferred NH Investment & Securities trustee
role were therefore rejected.

The live database was restored from the pre-import snapshot using SQLite's backup API:

- `backups/market-pre-approved-calibration-20260816.db`
- SHA-256: `4662549f19cc653f8b19f243b89ad1c810530f675b8550de70ceb78532f00b1a`
- bytes: `203423744`
- pre-import `quick_check=ok`; foreign-key violations `0`

No direct database-file copy was used. After restoration, the bad receipt count and canonical
sale-process count were both zero. The corrected Yeonji manifest is
`sale-2025-hyundai-yeonji-v2`; it uses an explicitly unnamed Bolt-managed acquisition fund
rather than inventing an exact fund/trustee identity.

## Final calibration verification

- First corrected imports: Yeonji `51` inserted rows; Cheongna `52`
- Immediate repeated imports: `0`, `0`
- Canonical sale processes: `2`
- Bidder participation members: `5`
- Funding components: `6`
- Bad receipt `20251001000194`: `0`
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `0` violations

## Promotion boundary

This calibration does not approve the remaining news or OpenDART candidates. They remain
review-only until a source-aware manifest is prepared, reviewed, dry-run against the live
schema, and imported after a SQLite backup-API snapshot.
