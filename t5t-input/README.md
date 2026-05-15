# T5T Input Prototype

This folder is a local-first prototype for replacing the Tally-first T5T input flow.

Current purpose:

- Read staff, official project, review project, fund, asset, and counterparty masters from Supabase.
- Let users compose 1-5 T5T work items with DB-backed selections or a fallback type (`New`, `General`, `Mission`).
- Preview the exact payload that a future Supabase Edge Function should accept.
- Save a local browser draft only. It does not write to Supabase or Notion yet.

Target flow after this UX is confirmed:

```text
T5T input form
-> Supabase Edge Function submit_t5t
-> Supabase t5t_form_submissions / t5t_form_items / relation tables
-> Notion backup page
-> Dashboard
```

Local URL:

```text
http://localhost:8085/t5t-input/index.html
```
