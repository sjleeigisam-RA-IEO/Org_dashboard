# DB Migration Status - 2026-05-01

## Current Principle

Dashboards stay connected to their existing data sources until the database is stable.

- `org_dashboard`: Google Spreadsheet/WebApp remains the operating source.
- `t5t-dashboard`: current Notion JSON/cache dashboard flow remains unchanged.
- `CRM_base/portfolio-analysis`: existing Supabase CRM tables remain unchanged.

The migration is building a normalized DB foundation first. Runtime dashboard changes come later.

## Applied To Supabase

The core dashboard foundation SQL has been applied in Supabase.

Tables populated from Google Spreadsheet and local portfolio data:

| Table | Rows | Source |
|---|---:|---|
| `orgs` | 102 | Google Apps Script WebApp |
| `staff` | 323 | T5T staff master + Google org/seat supplemental people |
| `staff_org_assignments` | 305 | Google org assignments |
| `seats` | 419 | Google seat layout rows |
| `seat_layout_shapes` | 112 | local static seat geometry |
| `aum_snapshots` | 1,162 | portfolio AUM JSON/current snapshot |
| `fund_lifecycle` | 778 | current AUM snapshot |

Validation notes:

- `seats_with_staff`: 291
- `staff_with_employee_no`: 213
- `staff_with_notion_id`: 246
- Non-staff seat labels intentionally excluded from staff mapping: `공용PC`, `모션 데스크`, `모션데스크`

Source note:

- The actually applied org/seat seed used the Google Apps Script WebApp as the source of truth.
- Local JSON fallback is supported for reproducible/offline builds, but it can produce different staff/seat counts because local cached layout files include a broader or older seat set.
- Latest fallback validation succeeded after BOM-safe JSON reading. Fallback counts were `staff`: 325 and `seats`: 835, so it should not be used to overwrite the applied Google Sheet-based seed without a deliberate decision.

## Prepared But Not Yet Applied

The T5T input foundation SQL is prepared but has not yet been applied/loaded as of this commit.

Tables:

- `projects`
- `project_staff_links`
- `t5t_logs`
- `t5t_log_project_links`
- `t5t_input_drafts`
- `t5t_form_submissions`
- `t5t_form_items`

Generated local seed counts from the current T5T Notion cache:

| Dataset | Rows |
|---|---:|
| `projects` | 619 |
| `project_staff_links` | 1,942 |
| `t5t_logs` | 1,212 |
| `t5t_log_project_links` | 617 |

## Raw T5T Form CSV

File reviewed:

`t5t-dashboard/IGIS RA T-5-T Forms_Submissions_2026-05-01.csv`

This is the real T5T form export before Notion processing. It should be treated as the raw source layer, separate from processed Notion logs.

Detected structure:

- Encoding: UTF-8 with BOM
- Columns: 24
- Form-level rows: 579 submissions
- Item-level rows after splitting `T5T - 1` through `T5T - 5`: 2,894 items
- Submitted date range: 2025-08-22 to 2026-04-29
- Work date range: 2025-08-22 to 2026-04-29
- Unique email values: 39
- Unique name values: 33
- Most submissions contain all 5 T5T entries.

Field pattern:

- Submission metadata: `Submission ID`, `Respondent ID`, `Submitted at`
- Writer metadata: `이름(Name)`, `E-mail`, `직책(Position)`, `작성일(Date)`, `소속(Line)`
- Repeated item fields:
  - `T5T - 1` through `T5T - 5`
  - related project text fields
  - external stakeholder/counterparty text fields
- Attachment field: `참고자료 업로드(필요할 경우에만)`

Raw item summary:

| Measure | Count |
|---|---:|
| T5T raw items | 2,894 |
| Items with project text | 1,924 |
| Items with stakeholder/counterparty text | 1,533 |

Top line distribution:

| Line | Submissions |
|---|---:|
| A Line | 177 |
| B Line | 76 |
| E Line | 75 |
| Global A Line | 58 |
| D Line | 57 |
| C1 Line | 56 |
| C2 Line | 30 |
| Global E Line | 23 |
| R Line | 15 |
| D-TF Line | 12 |

Position distribution:

| Position | Submissions |
|---|---:|
| Director | 418 |
| Sr. Director | 134 |
| Sr. Manager | 27 |

## Target Operating Model

Future T5T input flow:

1. Dashboard server exposes staff options from `staff`.
2. Dashboard server exposes project options from `projects`.
3. User selects themselves and one or more projects.
4. Submission stores stable keys:
   - `writer_staff_id`
   - `selected_project_ids`
   - later optional `selected_fund_ids`
5. Raw input is preserved in `t5t_form_submissions` and `t5t_form_items`.
6. Processed/normalized rows can be promoted into `t5t_logs` and `t5t_log_project_links`.

## Key Policy

`staff` is the origin for people.

Priority for person identity:

1. `employee_no`
2. `notion_id`
3. company email
4. name only as a temporary matching aid

Fund manager matching is intentionally not a priority now. `funds.manager_staff_id` exists as a future connection point, while the immediate priority is staff/project/fund-aware T5T capture.
