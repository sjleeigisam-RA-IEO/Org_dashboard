## Google Apps Script Setup (Split DB)

### 1) Create / Update Web App
1. Open `https://script.google.com/`
2. Paste `apps_script/Code.gs` into `Code.gs`
3. Save
4. Deploy -> New deployment -> Type: `Web app`
5. Execute as: `Me`
6. Who has access: `Anyone with the link` (or your org scope)
7. Deploy and copy `Web app URL`

## Split Sheet Schema

- `ORG_CURRENT`
- `ORG_FUTURE`
- `PERSON`
- `PERSON_ORG_CURRENT`
- `PERSON_ORG_FUTURE`

All other sheets can be deleted by calling `resetSchema`.

## Endpoints

- Health:
  - `GET {WEB_APP_URL}?action=health`
- Schema (headers):
  - `GET {WEB_APP_URL}?action=schema`
- Read one sheet:
  - `GET {WEB_APP_URL}?action=read&sheet=ORG_CURRENT`
- Read all sheets:
  - `GET {WEB_APP_URL}?action=bundle`

## Write APIs (POST)

### Reset schema (drop non-allowed sheets and reset headers)
```json
{
  "action": "resetSchema",
  "purgeOtherSheets": true
}
```

### Replace a sheet
```json
{
  "action": "replace",
  "sheet": "ORG_CURRENT",
  "rows": [
    {
      "org_code": "RAA0101",
      "division_code": "RA",
      "line_code": "A",
      "line_label": "A",
      "group_code": "01",
      "unit_code": "01",
      "division_name": "리얼에셋부문",
      "group_name": "전략투자그룹",
      "unit_name": "전략투자1파트",
      "org_full_name": "전략투자그룹/전략투자1파트",
      "source_type": "current",
      "note": ""
    }
  ]
}
```

### Write all split sheets
```json
{
  "action": "writeBundle",
  "mode": "replace",
  "data": {
    "ORG_CURRENT": [],
    "ORG_FUTURE": [],
    "PERSON": [],
    "PERSON_ORG_CURRENT": [],
    "PERSON_ORG_FUTURE": []
  }
}
```

## Local Scripts

- Build split workbook from current source + change input:
  - `python scripts/build_split_org_people_db.py --change org_change_input_template_v1.xlsx`
- Upload split workbook to web app with schema reset:
  - `python scripts/upload_split_bundle_to_webapp.py org_people_db_split.xlsx`

## Notes
- Spreadsheet ID is fixed in code:
  - `1CMSH_lIbNSn_2R8xsVtwXUdzKJIajNCPatEFwA-vwXs`
- Allowed sheets and primary keys are in `apps_script/Code.gs`.
