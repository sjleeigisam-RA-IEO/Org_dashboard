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

Encryption preserves the original HTML bytes after decryption. RM changes still use
browser localStorage and are not shared between users. This login does not remove
copies from the earlier public Git commit, old deployments, or previous downloads.

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