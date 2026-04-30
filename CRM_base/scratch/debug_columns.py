import pandas as pd
import os

excel_path = r"D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx"
df = pd.read_excel(excel_path, header=1)

print("Columns sample:")
print(df.columns.tolist()[35:45])

target_col = '담당부문(운용)'
if target_col in df.columns:
    print(f"\nFound {target_col}!")
    print(df[target_col].head(5))
else:
    print(f"\nNOT FOUND: {target_col}")
    # Try searching for partial match
    for c in df.columns:
        if '부문' in str(c):
            print(f"Candidate: {c}")
