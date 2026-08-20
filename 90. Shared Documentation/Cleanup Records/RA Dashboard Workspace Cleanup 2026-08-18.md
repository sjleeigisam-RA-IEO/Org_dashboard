# RA Dashboard Workspace Cleanup — 2026-08-18

## Scope

Top-level test/prototype folders, disposable outputs, one-off scratch/QA artifacts, shared documentation, and project-dependent folders were reviewed and reorganized.

## Reorganized

- `t5t-input` → `02. T5T Board/input-form`
- `automation_runtime` → `02. T5T Board/automation_runtime`
- `tools/data_reconciliation` → `01. RA Portal/tools/data-reconciliation`
- reusable admin access verification → `shared/tests/verify_admin_access_contract.js`
- IOTA Seoul data package → `51. IOTA_platform/Reference Data/IOTA Seoul Data Package v0.9`
- IOTA platform/FCM documents → `51. IOTA_platform/Documents`
- shared technical documents → `90. Shared Documentation/Technical Notes`
- DB schema → `90. Shared Documentation/Database Schema`
- repository/architecture documents → `90. Shared Documentation/Architecture`
- selected integrated analysis workbooks → `00. Raw Data/Processed Analysis Archive`

## Removed

- obsolete `rent-map-test` prototype
- obsolete `pilot_form` UI and package duplicate
- root `scratch`, generated caches, QA screenshots, build dependencies, execution logs, and temporary attachments
- duplicate root Construction tools
- obsolete T5T standalone input test page
- RentMap prototype archive and visual QA screenshots
- project-local one-off `01. RA Portal/scratch`

Primary cleanup: 9,364 files / 651,049,453 bytes.
Additional cleanup: 73 files / 23,609,289 bytes.

## Preserved Exception

`outputs/equity_investor_ranking_20260813` remained in place because an Excel lock file and active Excel processes showed that the workbook was open during cleanup. No file in that folder was changed or deleted.

## Runtime Path Updates

- Portal/T5T/Org navigation now points to `02. T5T Board/input-form`.
- T5T automation package roots were updated for the new nested location.
- Construction collectors now write directly to `03. Construction Board/data`, and the builder writes `03. Construction Board/index.html` directly.
- Org roster sync output now remains under `05. Org Board/outputs`.
- legacy numbered-project filesystem paths were updated in executable/configuration files.
- `.gitignore` now recognizes `90. Shared Documentation` and the reorganized runtime paths.

## Verification

- Python syntax: 105 files, 0 errors
- JavaScript syntax: passed for shared security, T5T input, and admin access verification
- PowerShell parser: passed for T5T automation launcher
- Admin access contract: passed (`sjlee` accepted; 7 non-admin identities rejected)
- Local HTML references: 208 checked, 0 missing
- HTTP smoke: 11 Portal/Board/Input/assets returned HTTP 200
- Legacy executable filesystem path references: 0
- Task Scheduler legacy T5T path references: 0
- Cleanup manifest residual files: 0

## Audit Manifests

Detailed pre-delete, exact-delete, post-delete, additional-delete, and path-update manifests are stored outside the repository under:

`C:\Users\10137\AppData\Local\hermes\cleanup-manifests\`
