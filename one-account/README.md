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
- Build and Install Commands: empty; no dependencies are required.
- Output Directory: `public`; Node.js 22.x functions in `api`.
- Production secrets: `ONE_ACCOUNT_CODE_SCRYPT`, `ONE_ACCOUNT_SESSION_SECRET`,
  and `ONE_ACCOUNT_DATA_KEY`. Never commit their values.
- Changing the code verifier or session secret invalidates existing sessions.
- Login failure limits are best-effort, per function instance, without shared storage.

Only the login assets are static. Authenticated functions serve the app and decrypt
`private/dashboard.enc`. Unauthenticated requests cannot retrieve the dashboard
from the current deployment. The shared code is stored only as a salted scrypt verifier.

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
