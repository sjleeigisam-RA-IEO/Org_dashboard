import argparse
import json
import math
import os
import re
import sys
import hashlib
from pathlib import Path
from datetime import datetime

import pandas as pd
from supabase import create_client

# Add CRM_base to path for env_utils
sys.path.append(r'd:\Project\00. 2025 RA 기획추진\RA dashboard\CRM_base')
from env_utils import get_required_supabase_config

SOURCE_DIR = Path(r'd:\Project\00. 2025 RA 기획추진\RA dashboard\DB sources')

def clean_value(value):
    if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value):
        return None
    if isinstance(value, str):
        text = value.replace("\xa0", " ").strip()
        if text.lower() in {"nan", "none", "nat", "null", "undefined"}:
            return None
        return text or None
    return value

def clean_str(value):
    v = clean_value(value)
    return str(v) if v is not None else None

def clean_date(value):
    v = clean_value(value)
    if v is None: return None
    try:
        dt = pd.to_datetime(v, errors="coerce")
        return dt.strftime("%Y-%m-%d") if not pd.isna(dt) else None
    except: return None

def clean_num(value):
    v = clean_value(value)
    if v is None: return None
    if isinstance(v, str):
        v = v.replace(",", "").replace("%", "").strip()
    try:
        num = pd.to_numeric(v, errors="coerce")
        return float(num) if not pd.isna(num) else None
    except: return None

def clean_int(value):
    v = clean_num(value)
    if v is None: return None
    try:
        return int(round(v))
    except: return None

def get_client():
    url, key = get_required_supabase_config()
    return create_client(url, key)

def delete_table(client, table, key_col, batch_size=500):
    total = 0
    while True:
        res = client.table(table).select(key_col).limit(batch_size).execute()
        keys = [row[key_col] for row in (res.data or []) if row.get(key_col) is not None]
        if not keys: break
        client.table(table).delete().in_(key_col, keys).execute()
        total += len(keys)
    return total

def upsert_records(client, table, records, on_conflict, batch_size=200):
    total = 0
    for start in range(0, len(records), batch_size):
        chunk = records[start : start + batch_size]
        if not chunk: continue
        client.table(table).upsert(chunk, on_conflict=on_conflict).execute()
        total += len(chunk)
        print(f"Upserted {total}/{len(records)} into {table}...")
    return total

def insert_records(client, table, records, batch_size=500):
    total = 0
    for start in range(0, len(records), batch_size):
        chunk = records[start : start + batch_size]
        if not chunk: continue
        client.table(table).insert(chunk).execute()
        total += len(chunk)
        print(f"Inserted {total}/{len(records)} into {table}...")
    return total

def process_updates():
    client = get_client()
    
    print("Reading Excel files...")
    df_fund = pd.read_excel(SOURCE_DIR / "펀드 관리_20260515.xlsx")
    df_aum = pd.read_excel(SOURCE_DIR / "펀드 AUM 관리_20260515.xlsx")
    df_asset_manage = pd.read_excel(SOURCE_DIR / "투자 자산 관리_20260515.xlsx")
    df_lender = pd.read_excel(SOURCE_DIR / "펀드별 대주 정보 조회_20260515.xlsx")
    df_beneficiary = pd.read_excel(SOURCE_DIR / "펀드별 수익자 정보 조회_20260515.xlsx")

    # 1. Map AUM Data
    aum_headers = df_aum.columns.tolist()
    aum_map = {}
    for i in range(1, len(df_aum)):
        row = df_aum.iloc[i]
        fid = clean_str(row[aum_headers.index('펀드정보')])
        if fid:
            aum_map[fid] = {
                'benchmark_aum': clean_int(row[aum_headers.index('약정 금액 기준13')]),
                'invested_aum': clean_int(row[aum_headers.index('투입 금액 기준16')]),
                'base_price': clean_num(row[aum_headers.index('사무수탁사 펀드데이터(결산전)')]),
                'net_asset_value': clean_int(row[aum_headers.index('사무수탁사 펀드데이터(결산전)10')]),
                'aum_base_date': clean_date(row[aum_headers.index('사무수탁사 펀드정보')]),
                'aum_input_date': clean_date(row[aum_headers.index('AUM\n입력일자')]),
                'equity_won': clean_int(row[aum_headers.index('약정 금액 기준')]),
                'loan_won': clean_int(row[aum_headers.index('약정 금액 기준11')]),
                'deposit_won': clean_int(row[aum_headers.index('약정 금액 기준12')]),
                'invested_equity_won': clean_int(row[aum_headers.index('투입 금액 기준')]),
                'invested_loan_won': clean_int(row[aum_headers.index('투입 금액 기준14')]),
                'invested_deposit_won': clean_int(row[aum_headers.index('투입 금액 기준15')]),
                'aum_status': clean_str(row[aum_headers.index('펀드정보6')])
            }

    # 2. Build Fund Records (Full Normalization - No Metadata)
    print("Building Fund records (Fully Normalized)...")
    fund_records = []
    for _, row in df_fund.iterrows():
        fid = clean_str(row['펀드코드'])
        if not fid: continue
        aum = aum_map.get(fid, {})
        
        # Mapping EVERYTHING to first-class columns
        record = {
            'fund_id': fid,
            'short_name': clean_str(row.get('약칭')),
            'fund_name': clean_str(row.get('펀드명')),
            'sector': clean_str(row.get('투자섹터')),
            'asset_name': clean_str(row.get('자산명')),
            'status': clean_str(row.get('운용상태')),
            'location': clean_str(row.get('국내/해외')),
            'setup_date': clean_date(row.get('최초 설정일')),
            'maturity_date': clean_date(row.get('만기일')),
            'dept': clean_str(row.get('부서(운용)')),
            'manager': clean_str(row.get('담당자(운용)')),
            
            # New Normalized Columns
            'division': clean_str(row.get('담당부문(운용)')),
            'recruitment_type': clean_str(row.get('모집형태')),
            'legal_form': clean_str(row.get('법적형태')),
            'fund_class': clean_str(row.get('펀드분류')),
            'fund_type': clean_str(row.get('펀드유형')),
            'primary_region': clean_str(row.get('주요투자지역')),
            'is_development': clean_str(row.get('개발여부')),
            'is_delegated': clean_str(row.get('위탁운용여부')),
            
            # Notion Mapping (Legacy Sync)
            'notion_vehicle_class': clean_str(row.get('Vehicle구분')),
            'notion_holding_type_class': clean_str(row.get('모자구분')),
            'notion_investment_strategy_class': clean_str(row.get('투자전략')),
            'notion_base_asset_class': clean_str(row.get('투자섹터')),
            'notion_asset_nature_class': clean_str(row.get('자산성격')),
            'notion_business_stage_class': clean_str(row.get('개발여부')),
            
            # AUM fields
            'benchmark_aum': aum.get('benchmark_aum'),
            'invested_aum': aum.get('invested_aum'),
            'base_price': aum.get('base_price'),
            'net_asset_value': aum.get('net_asset_value'),
            'aum_base_date': aum.get('aum_base_date'),
            'aum_input_date': aum.get('aum_input_date'),
            'equity_won': aum.get('equity_won'),
            'loan_won': aum.get('loan_won'),
            'deposit_won': aum.get('deposit_won'),
            'invested_equity_won': aum.get('invested_equity_won'),
            'invested_loan_won': aum.get('invested_loan_won'),
            'invested_deposit_won': aum.get('invested_deposit_won'),
            'aum_status': aum.get('aum_status'),
            'aum_source': '펀드 AUM 관리_20260515.xlsx',
            'metadata': None # CLEARING METADATA to force column usage
        }
        fund_records.append(record)

    # 3. Build Asset Master Records
    print("Building Asset Master records...")
    asset_records = []
    for _, row in df_asset_manage.iterrows():
        acode = clean_str(row.get('자산코드'))
        if not acode: continue
        aid = f"ast_{hashlib.sha1(acode.encode()).hexdigest()[:12]}"
        asset_records.append({
            'asset_id': aid, 'asset_code': acode,
            'canonical_name': clean_str(row.get('자산(건물)명')),
            'address_text': clean_str(row.get('전체주소(시/도, 구/군 포함)')),
            'asset_type': clean_str(row.get('기초자산')),
            'gross_floor_area': clean_num(row.get('연면적(m²)')),
            'completion_date': clean_date(row.get('준공(예정)일')),
            'review_status': 'verified',
            'metadata': {'source': '투자 자산 관리_20260515.xlsx'}
        })

    # 4. Build and Aggregating Exposure Records
    print("Building and Aggregating Exposure records...")
    lender_agg = {}
    for _, row in df_lender.iterrows():
        fid = clean_str(row.get('펀드코드'))
        lender = clean_str(row.get('대주'))
        bdate = clean_date(row.get('기준일자'))
        if not (fid and lender and bdate): continue
        key = (fid, lender, bdate)
        if key not in lender_agg:
            lender_agg[key] = {
                'fund_id': fid, 'lender_raw': lender, 'lender_clean': lender, 'base_date': bdate,
                'committed_amt': 0, 'drawn_amt': 0, 'remaining_amt': 0, 'remarks': []
            }
        lender_agg[key]['committed_amt'] += (clean_int(row.get('대출약정금액(원)')) or 0)
        lender_agg[key]['drawn_amt'] += (clean_int(row.get('대출인출금액(원)')) or 0)
        lender_agg[key]['remaining_amt'] += (clean_int(row.get('대출잔여금액(원)')) or 0)
        trench = clean_str(row.get('트렌치'))
        if trench: lender_agg[key]['remarks'].append(trench)

    lender_records = [v for v in lender_agg.values()]
    for v in lender_records: v['remarks'] = ", ".join(set(v['remarks'])) if v['remarks'] else None

    beneficiary_agg = {}
    for _, row in df_beneficiary.iterrows():
        fid = clean_str(row.get('펀드코드'))
        bene = clean_str(row.get('수익자'))
        bdate = clean_date(row.get('기준일자'))
        if not (fid and bene and bdate): continue
        key = (fid, bene, bdate)
        if key not in beneficiary_agg:
            beneficiary_agg[key] = {
                'fund_id': fid, 'beneficiary_raw': bene, 'beneficiary_clean': bene, 'base_date': bdate,
                'committed_amt': 0, 'invested_amt': 0, 'remaining_amt': 0, 'remarks': []
            }
        beneficiary_agg[key]['committed_amt'] += (clean_int(row.get('총약정금액')) or 0)
        beneficiary_agg[key]['invested_amt'] += (clean_int(row.get('투입금액')) or 0)
        beneficiary_agg[key]['remaining_amt'] += (clean_int(row.get('잔여약정금액')) or 0)
        rem = clean_str(row.get('비고'))
        if rem: beneficiary_agg[key]['remarks'].append(rem)

    beneficiary_records = [v for v in beneficiary_agg.values()]
    for v in beneficiary_records: v['remarks'] = ", ".join(set(v['remarks'])) if v['remarks'] else None

    # Execution
    print("\nExecuting Database Operations (Full Normalization Re-ingest)...")
    print("Clearing old exposures...")
    delete_table(client, "lender_exposures", "id")
    delete_table(client, "beneficiary_exposures", "id")
    
    print("Upserting Funds and Assets (Normalized Columns Only)...")
    upsert_records(client, "funds", fund_records, on_conflict="fund_id")
    upsert_records(client, "asset_master", asset_records, on_conflict="asset_id")
    
    print("Inserting new exposures...")
    insert_records(client, "lender_exposures", lender_records)
    insert_records(client, "beneficiary_exposures", beneficiary_records)

    print("\n[SUCCESS] Full Normalization DB Update Completed.")

if __name__ == "__main__":
    process_updates()
