# Construction Source Status Dashboard

This folder is the tracked bundle for the construction ranking/source-status dashboard.

- `index.html`: deployed static page for GitHub Pages.
- `login.html`: construction-dashboard-specific login page. It uses the shared RA auth API but returns to this dashboard instead of the portal shell.
- `data/`: latest JSON snapshots used to build the current page.
- `scripts/`: source snapshot for the collectors and HTML builder used in this refresh.
- `HANDOFF.md`: build history, source mapping, refresh procedure, and operating notes.

Operational refresh normally runs from the repository root with the scripts under `construction_source_status/scripts/`, then copies the refreshed `outputs/` artifacts back into this folder before committing.

Current refresh snapshot:

- OpenDART awards: 2021-07-03 to 2026-07-03, max 5 per company.
- OpenDART strategy disclosures: investment, equity/capex, M&A/restructuring, financing, and related-party signals, max 5 per company. Category labels are retained only for filtering/dedupe metadata, not as visible article-title prefixes.
- 2026-07-15 OpenDART refresh attempt was blocked at API-key validation, so the previous OpenDART award/strategy caches were retained.
- Google News RSS: refreshed 2026-07-15, 365-day window, max 5 per company.
- Nara/G2B contracts: refreshed 2026-07-15 with a narrow July 2026 query window because longer API windows can time out or exceed input limits.
- Credit ratings: refreshed 2026-07-15 for CAK top-30 companies, KIS/NICE public company search, OpenDART fallback disabled for this run.
- Online update marks: `data/construction_online_update_marks.json` records companies and item keys where the latest refresh added new Google News, Nara/G2B, or OpenDART items compared with the pre-refresh cache. These rows render an `UPDATE` card next to the company name, and newly added item meta lines inside the expanded award/news cards render yellow while existing item meta lines remain blue.
- Dashboard rows render top-30 ranking tables and expandable company detail panels.
- Comments can mark a company as a partner/collaboration company and record the related project. Until the Supabase table is migrated to dedicated fields, those values are stored in the existing comment `body` as readable metadata lines and rendered as tags in the dashboard.
- Dashboard viewing and comment writing are gated by the construction-specific login UI. New comment author fields are prefilled as `name (email)` from the RA auth session, while existing stored author names are left unchanged. This is a browser-level gate; DB-level enforcement requires moving comment writes behind a session-verifying Edge Function.
