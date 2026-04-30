# DB Data Integrity Verification Report (20260427)

## 1. Funds Comparison (펀드 AUM 관리)
- Excel Total Unique Funds: 825
- DB Total Unique Funds: 580
- **Missing in DB: 295 funds**
  - (Of these missing, **258** are Liquidated/청산)
  - Missing Examples: ['112025', '112317', '112301', '112185', '112226', '112353', '120014', '300004', '112722', '112112']
Error comparing assets: {'message': 'column fund_assets.asset_code does not exist', 'code': '42703', 'hint': 'Perhaps you meant to reference the column "fund_assets.asset_name" or the column "fund_assets.asset_type".', 'details': None}