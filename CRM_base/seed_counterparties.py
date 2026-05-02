import pandas as pd
import os
from dotenv import dotenv_values
from supabase import create_client

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

def seed_counterparties():
    print("--- Seeding Counterparties Master ---")
    
    # 1. 기존 익스포저 테이블에서 유니크 명칭 가져오기
    lenders = supabase.table('lender_exposures').select('lender_clean').execute()
    beneficiaries = supabase.table('beneficiary_exposures').select('beneficiary_clean').execute()
    
    l_names = set([r['lender_clean'] for r in lenders.data if r['lender_clean']])
    b_names = set([r['beneficiary_clean'] for r in beneficiaries.data if r['beneficiary_clean']])
    
    # 2. 통합 리스트 및 카테고리 구성
    all_names = sorted(list(l_names | b_names))
    records = []
    
    for i, name in enumerate(all_names):
        cat = []
        if name in l_names: cat.append('Lender')
        if name in b_names: cat.append('LP')
        
        records.append({
            'counterparty_id': f'CP-{str(i+1).zfill(4)}',
            'name': name,
            'category': ', '.join(cat),
            'metadata': {'source': 'exposure_tables'}
        })
    
    # 3. DB 적재 (Upsert)
    print(f"Upserting {len(records)} counterparties...")
    for j in range(0, len(records), 100): # 100개씩 분할 적재
        batch = records[j:j+100]
        supabase.table('counterparties').upsert(batch).execute()
    
    print("Seeding complete!")

if __name__ == "__main__":
    seed_counterparties()
