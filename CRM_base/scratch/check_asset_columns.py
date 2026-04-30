import pandas as pd
import json

files = {
    'invest_asset': r"D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx",
    'manage_asset': r"D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 관리_20260428.xlsx"
}

results = {}
for name, path in files.items():
    df = pd.read_excel(path, nrows=1)
    results[name] = df.columns.tolist()

print(json.dumps(results, indent=2, ensure_ascii=False))
