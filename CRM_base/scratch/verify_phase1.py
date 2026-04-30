import os
import sys
import io
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import re

# Force UTF-8 for console output
sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

load_dotenv()

def phase1_verify():
    print("=== Phase 1: 기준 원장(Master) 검증 ===")
    
    # 1. Load Excel
    master_path = '_archive/펀드 관리_20260424.xlsx'
    df_excel = pd.read_excel(master_path, header=0)
    
    excel_ids = set()
    for _, row in df_excel.iterrows():
        fid = str(row.iloc[0]).strip()
        if fid and fid != 'nan':
            excel_ids.add(fid)
            
    # 2. Load DB
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    res = supabase.table('funds').select('fund_id, fund_name').execute()
    db_funds = res.data
    db_ids = set([f['fund_id'] for f in db_funds])
    
    print(f"1. 펀드 개수 대조:")
    print(f"   - 마스터 엑셀: {len(excel_ids)}개")
    print(f"   - DB (funds): {len(db_ids)}개")
    
    missing_in_db = excel_ids - db_ids
    print(f"\n2. DB 누락 펀드 검사:")
    if not missing_in_db:
        print("   - 완벽 일치! 마스터 원장의 모든 펀드가 DB에 존재합니다.")
    else:
        print(f"   - 경고: {len(missing_in_db)}개의 펀드가 DB에 없습니다. (예: {list(missing_in_db)[:5]})")
        
    print(f"\n3. 인코딩 무결성 검사 (랜덤 5개):")
    import random
    sample_funds = random.sample(db_funds, min(5, len(db_funds)))
    for f in sample_funds:
        print(f"   - [{f['fund_id']}] {f['fund_name']}")
        
    garbled = [f for f in db_funds if f['fund_name'] and ('?' in f['fund_name'] or '' in f['fund_name'])]
    if garbled:
        print(f"\n   - [FAIL] 심각: {len(garbled)}개의 펀드에서 인코딩 깨짐이 발견되었습니다.")
    else:
        print("\n   - [PASS] 인코딩 무결성: 모든 펀드의 한글 명칭이 정상적으로 보존되었습니다.")

if __name__ == "__main__":
    phase1_verify()
