import pandas as pd
import os
from dotenv import dotenv_values
from supabase import create_client
import json

# Load config
cfg = dotenv_values('CRM_base/.env')
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

DATA_PATH = 'pilot_form/datapackage/IOTA_Seoul_Master_DB_v0.9.xlsx'

# Mapping Strategy: Sheet -> Workspace Code
MAPPING = {
    '73_TB_KPI_METRICS': 'WS_PM',
    '86_TOP10_RISKS': 'WS_PM',
    '23_TB_PROJECT_MILESTONE': 'WS_PM',
    '31_TB_FINANCIAL_METRICS': 'WS_FIN',
    '61_TB_OP_FUNDING_PIPELINE': 'WS_FIN',
    '22_TB_ASSET_SPEC': 'WS_CON',
    '70_TB_PROJECT_WORKSTREAM': 'WS_CON',
    '60_TB_OP_OFFICE_LEASING': 'WS_MKT',
    '50_TB_OP_BRAND_PRODUCT': 'WS_DIG',
    '71_TB_GOVERNANCE_LOG': 'WS_IPR'
}

def clean_row(row):
    """Filter out None values and convert to string for metadata"""
    return {str(k): str(v) for k, v in row.items() if pd.notnull(v)}

def ingest_v2():
    print(f"Reading {DATA_PATH}...")
    xl = pd.ExcelFile(DATA_PATH)
    
    # Clear existing master data for fresh start
    supabase.table('iota_seoul_master_data').delete().neq('item_name', '---').execute()
    
    for sheet, ws_code in MAPPING.items():
        if sheet not in xl.sheet_names: continue
        print(f"Inhaling {sheet} to {ws_code}...")
        
        # Read with auto-header detection (skip top 1-2 empty/title rows)
        df = pd.read_excel(xl, sheet, header=None)
        
        # Find the first row that looks like a header (has multiple non-nulls)
        header_idx = 0
        for i, row in df.iterrows():
            if row.count() > 2:
                header_idx = i
                break
        
        # Re-read with correct header
        df = pd.read_excel(xl, sheet, skiprows=header_idx)
        df = df.where(pd.notnull(df), None)
        
        records = []
        for _, row in df.iterrows():
            # Extract meaningful name
            cols = df.columns.tolist()
            item_name = str(row.get(cols[0], 'Untitled'))
            if len(cols) > 1:
                item_name = str(row.get(cols[1], item_name)) # Try 2nd col for name
            
            # Content: combine first 3 meaningful columns
            content = " | ".join([f"{c}: {row[c]}" for c in cols[:3] if pd.notnull(row[c])])
            
            # Project detection
            p_val = str(row.to_dict()).lower()
            if "427" in p_val: pid = "P00030"
            elif "816" in p_val: pid = "P00037"
            elif "421" in p_val: pid = "112614"
            else: pid = "P00030"

            records.append({
                "proj_id": pid,
                "ws_code": ws_code,
                "classification": sheet.split('_')[-1],
                "item_name": item_name[:255],
                "content": content,
                "raw_metadata": clean_row(row.to_dict())
            })
            
            if len(records) >= 50:
                supabase.table('iota_seoul_master_data').insert(records).execute()
                records = []
        
        if records:
            supabase.table('iota_seoul_master_data').insert(records).execute()

    print("Strategic Ingestion complete.")

if __name__ == "__main__":
    ingest_v2()
