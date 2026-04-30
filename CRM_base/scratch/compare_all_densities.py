import pandas as pd
import os

files = [
    (r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 관리_20260428.xlsx", 4), # Path, Addr_Col
    (r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx", 15),
    (r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\투자 자산 조회_20260427.xlsx", 13)
]

for f_path, addr_idx in files:
    if os.path.exists(f_path):
        try:
            df = pd.read_excel(f_path, header=None)
            # Filter rows that look like data (avoid headers if possible, or just count non-empty IDs)
            # Usually column 0 or 1 is an ID
            id_idx = 1 if '관리' in f_path else 0
            data_rows = df[df[id_idx].astype(str).str.strip().replace('nan', '') != ''].copy()
            
            filled_addr = data_rows[data_rows[addr_idx].astype(str).str.strip().replace('nan', '') != '']
            
            print(f"File: {os.path.basename(f_path)}")
            print(f"  - Total Data Rows: {len(data_rows)}")
            print(f"  - Rows with Address: {len(filled_addr)}")
            print(f"  - Missing Address: {len(data_rows) - len(filled_addr)}")
        except Exception as e:
            print(f"Error reading {os.path.basename(f_path)}: {e}")
    else:
        print(f"File not found: {os.path.basename(f_path)}")
