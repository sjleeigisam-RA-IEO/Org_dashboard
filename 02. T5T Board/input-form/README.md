# T5T Input Form

This folder is the active T5T work input module used by the T5T Board and portal navigation.

Current purpose:

- Read staff, official project, review project, fund, asset, and counterparty masters from Supabase.
- Let users compose 1-5 T5T work items with DB-backed selections or a fallback type (`New`, `General`, `Mission`).
- Submit work items through the deployed `t5t-submit` Supabase Edge Function.
- Save and load server drafts, load last-week items, and retain a local browser fallback draft.

Current flow:

```text
T5T input form
-> Supabase Edge Function submit_t5t
-> Supabase t5t_form_submissions / t5t_form_items / relation tables
-> Notion backup page
-> Dashboard
```

Local URL:

```text
http://localhost:8085/02.%20T5T%20Board/input-form/index.html
```
