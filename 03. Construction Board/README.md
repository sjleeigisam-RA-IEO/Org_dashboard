# Construction Information Dashboard

This folder is the tracked bundle for the construction ranking/source-status dashboard.

- `index.html`: deployed static page for GitHub Pages.
- `login.html`: construction-dashboard-specific login page. It uses the shared RA auth API but returns to this dashboard instead of the portal shell.
- `data/`: latest JSON snapshots used to build the current page.
- `scripts/`: source snapshot for the collectors and HTML builder used in this refresh.
- `HANDOFF.md`: build history, source mapping, refresh procedure, and operating notes.

Operational refresh runs from the repository root with the scripts under `03. Construction Board/scripts/`. Collectors write directly to `03. Construction Board/data/`, and the builder writes the deployed `index.html` directly; no root-level output copy step is required.
The Codex thread automation now wakes this same thread every Monday 06:00 KST for the main refresh and every Tuesday 06:00 KST to verify the Monday run log and rerun if needed.

Current refresh snapshot:

- OpenDART awards: refreshed 2026-08-24 from `.env:DART_API_KEY`, 2021-08-24 to 2026-08-24, max 5 per company.
- OpenDART strategy disclosures: refreshed 2026-08-24 from `.env:DART_API_KEY`; investment, equity/capex, M&A/restructuring, financing, and related-party signals, max 5 per company. Category labels are retained only for filtering/dedupe metadata, not as visible article-title prefixes.
- Google News RSS: refreshed 2026-08-17, 365-day window, max 5 per company.
- Nara/G2B contracts: refreshed 2026-09-04 with a narrow 14-day query window because longer API windows can time out or exceed input limits. The Data.go.kr key is read from `.env:DATA_GO_KR_KEY`; key values must never be printed or written to logs.
- Credit ratings: refreshed 2026-07-15 for CAK top-30 companies, KIS/NICE public company search, OpenDART fallback disabled for this run.
- Online update marks: `data/construction_online_update_marks.json` records companies and item keys where the latest refresh added new Google News, Nara/G2B, or OpenDART items compared with the pre-refresh cache. These rows render an `UPDATE` card next to the company name, and newly added item meta lines inside the expanded award/news cards render yellow while existing item meta lines remain blue.
- Refresh run log: `data/construction_refresh_run_log.json` records manual, Monday-main, and Tuesday fallback-check/rerun executions so the weekly automation can verify whether a scheduled update actually ran.
- Dashboard rows render top-30 ranking tables and expandable company detail panels.
- Cost indicators: company detail panels keep the company-specific `공사비 단가` modal, while the separate `공사비 지표` tab summarizes verified unit-cost samples and market benchmarks. `data/construction_market_indicators_cache.json` now carries KOSIS/KICT 84-month construction cost index series, MOLIT basic construction cost notice points including the 2020 base-year unit-cost anchor, Nara/G2B monthly public-contract amount aggregates, and PPS/G2B status metadata. Indicator cards and chart bars expose their basis, interpretation, and source detail on hover.
- Comments can mark a company as a partner/collaboration company and record the related project. Until the Supabase table is migrated to dedicated fields, those values are stored in the existing comment `body` as readable metadata lines and rendered as tags in the dashboard.
- Dashboard viewing and comment writing are gated by the construction-specific login UI. New comment author fields are prefilled as `name (email)` from the RA auth session, while existing stored author names are left unchanged. This is a browser-level gate; DB-level enforcement requires moving comment writes behind a session-verifying Edge Function.
