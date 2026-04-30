import pandas as pd
import os

f_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx"

if os.path.exists(f_path):
    df = pd.read_excel(f_path, header=None)
    # Column 15 is address
    filled = df[df[15].astype(str).str.strip().replace('nan', '') != ''].copy()
    print(f"File: {os.path.basename(f_path)}")
    print(f"Total Rows: {len(df)}")
    print(f"Rows with Address: {len(filled)}")
    
    # Check column 6 (Asset Name)
    filled_names = df[df[6].astype(str).str.strip().replace('nan', '') != ''].copy()
    print(f"Rows with Asset Name: {len(filled_names)}")
else:
    print("File not found.")
