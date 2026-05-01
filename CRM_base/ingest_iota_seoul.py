import pandas as pd
import os
from dotenv import dotenv_values
from supabase import create_client
import json

# Load config
cfg = dotenv_values('.env') # Assume run from root or update to handle relative
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

DATA_PATH = 'pilot_form/datapackage/IOTA_Seoul_Master_DB_v0.9.xlsx'

def ingest_data():
    print(f"Reading {DATA_PATH}...")
    xl = pd.ExcelFile(DATA_PATH)
    
    # We only want data sheets, skip readme/map
    data_sheets = [s for s in xl.sheet_names if s not in ['00_README', '01_지도']]
    
    for sheet in data_sheets:
        print(f"Processing sheet: {sheet}")
        df = pd.read_excel(xl, sheet)
        
        # Clean NaN values
        df = df.where(pd.notnull(df), None)
        
        records = []
        for _, row in df.iterrows():
            # Project ID Mapping
            p_val = str(row.get('Project', '')).lower()
            if "427" in p_val or "427" in sheet: pid = "P00030"
            elif "816" in p_val or "816" in sheet: pid = "P00037"
            elif "421" in p_val or "421" in sheet: pid = "112614"
            else: pid = "P00030" # Default

            record = {
                "proj_id": pid,
                "ws_code": "WS_PM", # Default to PM
                "classification": str(row.get('Classification', 'General'))[:100],
                "item_name": str(row.get('Item', 'Untitled'))[:255],
                "content": str(row.get('Content', '')),
                "raw_metadata": {k: str(v) for k, v in row.to_dict().items() if v is not None}
            }
            records.append(record)
            
            if len(records) >= 50:
                supabase.table('iota_seoul_master_data').insert(records).execute()
                records = []
        
        if records:
            supabase.table('iota_seoul_master_data').insert(records).execute()

    print("Ingestion complete.")

if __name__ == "__main__":
    if os.path.exists(DATA_PATH):
        ingest_data()
    else:
        print(f"File not found: {DATA_PATH}")
