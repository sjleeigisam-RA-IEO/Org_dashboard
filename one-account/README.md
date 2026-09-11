# One Account

Standalone static deployment of the One Account dashboard.

## Source

- Original: `10. One Account/ONE_ACCOUNT_MAP_v1_7_RM_XLSX_260910.html`
- Published entry point: `index.html`, copied without content changes.
- SHA-256: `8ad472affaf81b4c43bfa4ef1c1cdbbc6ee56ebc5dbf3e1add1d921e9d2362c9`

## Vercel

- Create a separate project named `one-account`.
- Git repository: `sjleeigisam-RA-IEO/Org_dashboard`.
- Production branch: `main`.
- Root Directory: `one-account`.
- Framework Preset: Other.
- Build and Install Commands: empty; no build or dependency install is required.
- Output Directory: `.`.

`vercel.json` applies only to this deployment directory. Future updates replace
`index.html` with the selected dashboard file and update the source hash here.

RM changes are stored in the current browser's localStorage. Hosting the dashboard
does not add shared server-side storage.
