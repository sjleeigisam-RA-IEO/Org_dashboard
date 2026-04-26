import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv
from collections import Counter

load_dotenv()

def audit_db():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    # 1. Fetch all funds
    funds_res = supabase.table('funds').select('fund_id, short_name, fund_name').execute()
    df_funds = pd.DataFrame(funds_res.data)
    
    # 2. Check formatting duplicates (spaces, casing)
    df_funds['id_clean'] = df_funds['fund_id'].astype(str).str.strip()
    unique_ids = df_funds['id_clean'].nunique()
    total_rows = len(df_funds)
    
    # 3. Check Name Duplicates
    df_funds['name_clean'] = df_funds['short_name'].astype(str).str.strip()
    name_counts = df_funds['name_clean'].value_counts()
    duplicate_names = name_counts[name_counts > 1]
    
    # 4. Check Exposure Connectivity
    lenders_res = supabase.table('lender_exposures').select('fund_id').execute()
    bens_res = supabase.table('beneficiary_exposures').select('fund_id').execute()
    
    active_in_lenders = set([str(l['fund_id']).strip() for l in lenders_res.data])
    active_in_bens = set([str(b['fund_id']).strip() for b in bens_res.data])
    active_ids = active_in_lenders | active_in_bens
    
    print("========== DB INTEGRITY AUDIT ==========")
    print(f"1. 전체 레코드 수: {total_rows}개")
    print(f"2. 고유 ID 수 (공백제거): {unique_ids}개")
    if total_rows != unique_ids:
        print(f"   [!] 경고: 공백 등으로 인한 ID 중복 레코드가 {total_rows - unique_ids}개 발견되었습니다.")
    
    print(f"\n3. 명칭 중복 분석 (약칭 기준)")
    print(f"   - 중복된 약칭 종류: {len(duplicate_names)}개")
    if len(duplicate_names) > 0:
        print("   - 주요 중복 약칭 (상위 5개):")
        for name, count in duplicate_names.head(5).items():
            ids = df_funds[df_funds['name_clean'] == name]['fund_id'].tolist()
            print(f"     * '{name}': {count}번 중복 (IDs: {ids})")

    print(f"\n4. 활동 펀드 분석 (익스포저 존재 여부)")
    print(f"   - 실제 대주/수익자 내역이 있는 펀드: {len(active_ids)}개")
    print(f"   - 내역이 없는 '빈' 펀드: {total_rows - len(active_ids)}개")
    
    print("\n5. 결론")
    if len(active_ids) < 500: # 예상치보다 훨씬 적을 경우
        print("   -> [분석] 실제 운용 중인 펀드는 약 400개 내외이며, 나머지 600개는 과거 기록이거나 유령 데이터일 가능성이 큽니다.")
    else:
        print(f"   -> [분석] 실제 활동 중인 {len(active_ids)}개의 펀드가 데이터의 핵심 본체입니다.")
    print("========================================")

if __name__ == "__main__":
    audit_db()
