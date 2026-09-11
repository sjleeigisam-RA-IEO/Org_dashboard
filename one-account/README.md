# One Account

Production: https://one-account-nine.vercel.app/

Company email (`@igisam.com`) and a shared deployment code open the dashboard.
This checks the email format and shared code; it does not verify mailbox ownership.
The optional auto-login cookie expires 30 days after login, without renewal on visits.
Normal login uses a browser-session cookie and an eight-hour server expiry.
Cookies are signed, Secure, HttpOnly, and SameSite=Lax. Logout clears this browser's cookie.

## Vercel configuration

- Repository: `sjleeigisam-RA-IEO/Org_dashboard`; production branch: `main`.
- Project / Root Directory: `one-account`; Framework Preset: Other.
- Build Command: empty. Install Command: `npm ci --ignore-scripts --no-audit --no-fund`.
- Output Directory: `public`; Node.js 22.x functions in `api`.
- Production secrets: `ONE_ACCOUNT_CODE_SCRYPT`, `ONE_ACCOUNT_SESSION_SECRET`,
  and `ONE_ACCOUNT_DATA_KEY`. Never commit their values.
- Changing the code verifier or session secret invalidates existing sessions.
- Login failure limits are best-effort, per function instance, without shared storage.

Only the login assets are static. Authenticated functions serve the app and decrypt
`private/dashboard.enc`. Unauthenticated requests cannot retrieve the dashboard
from the current deployment. Login uses a salted scrypt verifier. Email delivery additionally needs the shared code in a Vercel Secret, never in browser assets or Git.

## Dashboard updates

- Original: `10. One Account/ONE_ACCOUNT_MAP_v1_7_RM_XLSX_260910.html`
- Original SHA-256: `8ad472affaf81b4c43bfa4ef1c1cdbbc6ee56ebc5dbf3e1add1d921e9d2362c9`
- Encrypt with the production data key: `node scripts/encrypt-dashboard.cjs <source.html>`.
- Commit `private/dashboard.enc` and the updated source hash, then push to `main`.
- Do not put a plaintext copy inside `public` or elsewhere in this deployment folder.
- Run `npm test`. For local preview, load the secrets into the environment and run `npm run dev`.

The encrypted original remains unchanged. With shared storage enabled, the server
injects the shared assignment adapter after decryption. This login does not remove
copies from the earlier public Git commit, old deployments, or previous downloads.

## Shared assignments and versions

Supabase private schema `one_account` stores dataset `rm-v1.7`: 575 Account IDs,
38 RM candidates, and the source HTML's 75 assigned Accounts as revision 1.
Other business/reference data still comes from the encrypted source snapshot.
The database accepts only known Account/RM identities and eligible role cohorts.

- `공용 저장` reviews and commits a complete assignment snapshot with the expected revision.
- `변경 이력` shows server timestamps, login email, and each role's before/after change.
- Restoring a historical snapshot creates a new revision; old versions remain immutable.
- A stale revision returns a conflict instead of overwriting another editor's work.
- Loading/reloading reads the common version. Other open tabs refresh with `최신 공용본 불러오기`.
- Edits remain per-email browser drafts until explicitly saved. Existing localStorage is
  preserved and can be compared/imported with `브라우저 수정본`; it is never auto-uploaded.
- Exported HTML includes the displayed assignments and removes the online adapter;
  it is an independent offline snapshot.

Recorded authors are login emails, not verified mailbox owners, under the current
shared-code login. Source code versions remain in Git; assignment versions live in DB.

Production Secret variables: `ONE_ACCOUNT_SHARED_ENABLED=true`,
`ONE_ACCOUNT_SUPABASE_URL`, `ONE_ACCOUNT_SUPABASE_SECRET_KEY`.
Only authenticated Vercel functions call `oa_get_state`, `oa_commit_state`, and
`oa_get_history`. Browser requests cannot choose a dataset or actor email.
No anonymous table/RPC access is granted. Do not expose the server key in static assets.

Schema, seed contract, and rollback-only SQL regression tests are in `db/`.
`scripts/extract-shared-baseline.cjs` extracts a locally held source HTML into a
private temporary seed file. `scripts/db-admin.cjs` applies operator-provided SQL
using the existing workspace Supabase Management configuration; never commit that
configuration or a real seed file. New source catalogs require an explicit dataset
migration; deploying new HTML alone does not overwrite existing assignments/history.

## Email delivery

The optional code-request button sends the existing shared code, not a one-time code.
Sender: `기획추진센터 <sjlee.igisam@gmail.com>`. Gmail SMTP uses TLS on port 465.
Set these Production Secret variables before enabling the button:

- `ONE_ACCOUNT_MAIL_ENABLED=true`
- `ONE_ACCOUNT_GMAIL_APP_PASSWORD`: the sender's Google app password (not the normal Google password)
- `ONE_ACCOUNT_DELIVERY_CODE`: the existing deployment code; it must match `ONE_ACCOUNT_CODE_SCRYPT`

The button stays hidden when configuration is incomplete or the code verifier differs.
`POST /api/send-code` accepts a single `email` and restricts recipients to `@igisam.com`.
It does not change sessions or return the code. SMTP acceptance is not proof of inbox delivery.
Code rotation must update the delivery code and login verifier together.

Best-effort limits apply per function instance: one request/minute per email,
five/hour per email, 25/hour per IP, and 100/day total. These are not distributed
limits and reset when a function instance restarts; Gmail also applies its account
sending limits. SMTP debug logging is disabled. No automatic send retries are made.
