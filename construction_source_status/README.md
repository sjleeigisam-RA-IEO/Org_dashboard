# Construction Source Status Dashboard

This folder is the tracked bundle for the construction ranking/source-status dashboard.

- `index.html`: deployed static page for GitHub Pages.
- `data/`: latest JSON snapshots used to build the current page.
- `scripts/`: source snapshot for the collectors and HTML builder used in this refresh.
- `HANDOFF.md`: build history, source mapping, refresh procedure, and operating notes.

Operational refresh normally runs from the repository root with the scripts under `construction_source_status/scripts/`, then copies the refreshed `outputs/` artifacts back into this folder before committing.

Current refresh snapshot:

- OpenDART awards: 2021-07-03 to 2026-07-03, max 5 per company.
- OpenDART strategy disclosures: investment, equity/capex, M&A/restructuring, financing, and related-party signals, max 5 per company. Category labels are retained only for filtering/dedupe metadata, not as visible article-title prefixes.
- Google News RSS: 730-day window, max 5 per company.
- Credit ratings: CAK top-30 companies, KIS/NICE public company search first, OpenDART bond/debt securities rating fields as fallback, 2021-07-06 to 2026-07-06.
- Dashboard rows render top-30 ranking tables and expandable company detail panels.
- Comments can mark a company as a partner/collaboration company and record the related project. Until the Supabase table is migrated to dedicated fields, those values are stored in the existing comment `body` as readable metadata lines and rendered as tags in the dashboard.
