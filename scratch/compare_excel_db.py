import pandas as pd
import os
from supabase import create_client
import json

# Configuration
excel_path = r"D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx"
url = 'https://qvegpozwrcmspdvjokiz.supabase.co'
key = 'sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P'

def compare_data():
    print(f"Reading Excel: {os.path.basename(excel_path)}")
    # Try with default header first
    df_excel = pd.read_excel(excel_path)
    
    # Check if first row is actually data or header
    # If the first column is '펀드코드', then header=0 is correct.
    if '펀드코드' not in df_excel.columns and df_excel.shape[1] > 0:
        # Check if it's in the first row
        if '펀드코드' in df_excel.iloc[0].values:
            df_excel = pd.read_excel(excel_path, header=1)
            print("Detected header at row 2")

    # Find columns by position if name search fails due to encoding
    # 0: Fund ID, 5: Vehicle
    fund_id_col = df_excel.columns[0]
    vehicle_col = df_excel.columns[5] if df_excel.shape[1] > 5 else None
    
    print(f"Found columns: {df_excel.columns.tolist()[:10]}")
    print(f"Using Fund ID column: {fund_id_col}")
    
    excel_fund_ids = set(df_excel[fund_id_col].dropna().astype(str).unique())
    # Remove '합계' or other non-numeric IDs if any
    excel_fund_ids = {x for x in excel_fund_ids if x.isdigit()}
    
    print(f"Funds in Excel: {len(excel_fund_ids)}")

    print("Fetching Funds from Supabase...")
    supabase = create_client(url, key)
    res = supabase.from_('funds').select('fund_id').execute()
    db_fund_ids = set(str(f['fund_id']) for f in (res.data or []))
    print(f"Funds in DB: {len(db_fund_ids)}")

    # Comparison
    missing_in_db = excel_fund_ids - db_fund_ids
    extra_in_db = db_fund_ids - excel_fund_ids
    intersection = excel_fund_ids & db_fund_ids

    print("\n--- Comparison Results ---")
    print(f"Match (Both): {len(intersection)}")
    print(f"Missing in DB (Only in Excel): {len(missing_in_db)}")
    print(f"Extra in DB (Not in this Excel): {len(extra_in_db)}")

    if vehicle_col:
        print(f"Checking '{vehicle_col}' (Index 5)...")
        non_null_vehicle_excel = set(df_excel[df_excel[vehicle_col].notnull()][fund_id_col].dropna().astype(str).unique())
        non_null_vehicle_excel = {x for x in non_null_vehicle_excel if x.isdigit()}
        print(f"Funds with data in index 5 in Excel: {len(non_null_vehicle_excel)}")
        
        # Metadata check
        sample_ids = list(intersection)[:200]
        res_meta = supabase.from_('funds').select('fund_id, metadata').in_('fund_id', sample_ids).execute()
        
        has_vehicle_in_meta = 0
        for f in (res_meta.data or []):
            meta = f.get('metadata')
            if isinstance(meta, dict) and any(k for k in meta if 'vehicle' in k.lower()):
                has_vehicle_in_meta += 1
        
        print(f"DB Metadata Check (Sample {len(res_meta.data or [])}):")
        print(f" -> Funds with Vehicle class in metadata: {has_vehicle_in_meta}")

if __name__ == "__main__":
    compare_data()
