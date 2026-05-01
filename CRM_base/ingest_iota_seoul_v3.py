import pandas as pd
import os
from dotenv import dotenv_values
from supabase import create_client
import json

cfg = dotenv_values('.env')
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

DATA_PATH = 'pilot_form/datapackage/IOTA_Seoul_Master_DB_v0.9.xlsx'

def clean_val(val):
    if pd.isna(val) or str(val).lower() in ['none', 'nan', 'null', '▶', '물리명', '식별자']: return None
    return str(val).strip()

def ingest_v3():
    xl = pd.ExcelFile(DATA_PATH)
    supabase.table('iota_seoul_master_data').delete().neq('item_name', '---').execute()
    
    records = []

    # 1. Process Risks (Sheet 86)
    if '86_TOP10_RISKS' in xl.sheet_names:
        df = pd.read_excel(xl, '86_TOP10_RISKS', skiprows=2)
        for _, row in df.iterrows():
            name = clean_val(row.get('Unnamed: 1'))
            dept = clean_val(row.get('Unnamed: 2'))
            status = clean_val(row.get('Unnamed: 5'))
            if name and name != '리스크':
                records.append({
                    "proj_id": "P00030", "ws_code": "WS_PM", "classification": "TOP-RISK",
                    "item_name": name, "content": f"담당: {dept} | 상태: {status}",
                    "raw_metadata": {"status": status}
                })

    # 2. Process Financials (Sheet 31) - Extract logic names and examples as proxy for pilot
    if '31_TB_FINANCIAL_METRICS' in xl.sheet_names:
        df = pd.read_excel(xl, '31_TB_FINANCIAL_METRICS', skiprows=2)
        for _, row in df.iterrows():
            metric = clean_val(row.get('Unnamed: 1'))
            desc = clean_val(row.get('Unnamed: 3'))
            if metric and metric not in ['논리명', '지표 종류']:
                records.append({
                    "proj_id": "P00030", "ws_code": "WS_FIN", "classification": "FINANCE",
                    "item_name": metric, "content": desc or "관리 중",
                    "raw_metadata": {}
                })

    # 3. Process KPI (Sheet 73)
    if '73_TB_KPI_METRICS' in xl.sheet_names:
        df = pd.read_excel(xl, '73_TB_KPI_METRICS', skiprows=2)
        for _, row in df.iterrows():
            kpi = clean_val(row.get('Unnamed: 1'))
            val = clean_val(row.get('Unnamed: 3'))
            if kpi and kpi not in ['논리명', '항목']:
                records.append({
                    "proj_id": "P00030", "ws_code": "WS_PM", "classification": "KPI",
                    "item_name": kpi, "content": val or "추적 중",
                    "raw_metadata": {}
                })

    # 4. Process Leasing (Sheet 60)
    if '60_TB_OP_OFFICE_LEASING' in xl.sheet_names:
        df = pd.read_excel(xl, '60_TB_OP_OFFICE_LEASING', skiprows=2)
        for _, row in df.iterrows():
            item = clean_val(row.get('Unnamed: 1'))
            status = clean_val(row.get('Unnamed: 3'))
            if item and item not in ['논리명']:
                records.append({
                    "proj_id": "P00030", "ws_code": "WS_MKT", "classification": "LEASING",
                    "item_name": item, "content": status or "진행 중",
                    "raw_metadata": {}
                })

    if records:
        supabase.table('iota_seoul_master_data').insert(records).execute()
        print(f"Insightful Ingestion complete: {len(records)} records.")

if __name__ == "__main__":
    ingest_v3()
