import pandas as pd
import os

files = [
    r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 관리_20260428.xlsx",
    r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx",
    r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\투자 자산 조회_20260427.xlsx"
]

def check_headers():
    for f in files:
        if os.path.exists(f):
            print(f"File: {os.path.basename(f)}")
            try:
                df = pd.read_excel(f, nrows=5)
                print(f"Columns: {df.columns.tolist()}")
                # Also check row 0 if columns are just numbers
                print(f"Row 0: {df.iloc[0].tolist()}")
                print("-" * 30)
            except Exception as e:
                print(f"Error reading {f}: {e}")
        else:
            print(f"File NOT FOUND: {f}")

check_headers()
