import pandas as pd
import glob
import os

files = glob.glob(r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\**\*.xlsx", recursive=True)

for f in files:
    if "~$" in f: continue
    try:
        print(f"Searching in {os.path.basename(f)}...")
        df = pd.read_excel(f, header=None)
        # Check if '190001' and '오피스복합' are in the same row
        matches = df[df.apply(lambda row: row.astype(str).str.contains('190001').any() and row.astype(str).str.contains('오피스복합').any(), axis=1)]
        if not matches.empty:
            print(f"FOUND MATCH in {f}:")
            for i, row in matches.iterrows():
                print(f"Row {i}: {row.tolist()}")
    except Exception as e:
        print(f"Could not read {f}: {e}")
