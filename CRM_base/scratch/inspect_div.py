import pandas as pd
import sys

f = r'D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx'
df = pd.read_excel(f, header=None)
col37 = df.iloc[:, 37].dropna().unique()
for v in col37:
    try:
        h = v.encode('utf-8').hex()
        print(f"raw: {v}, hex: {h}")
    except:
        print(f"raw: {v}, hex: (failed)")
