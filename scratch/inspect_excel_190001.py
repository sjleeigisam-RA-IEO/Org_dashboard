import pandas as pd
import os

file_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx"

if os.path.exists(file_path):
    # Load without header to see raw indices
    df = pd.read_excel(file_path, header=None)
    
    # Find row with fund_id 190001
    # fund_id is in column 0
    row = df[df[0].astype(str) == '190001']
    
    if not row.empty:
        print(f"Found record for Fund 190001:")
        record = row.iloc[0]
        for i, val in enumerate(record):
            print(f"Index {i}: {val}")
    else:
        print("Fund 190001 not found in the file.")
else:
    print(f"File not found: {file_path}")
