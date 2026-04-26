import os
import sys
import io
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')
load_dotenv()

def phase3_4_verify():
    print("\n=== Phase 3: 실물 자산(Asset) 무결성 검증 ===")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    res_assets = supabase.table('fund_assets').select('asset_name, gfa').execute()
    db_assets = res_assets.data
    db_gfa_total = sum([a['gfa'] or 0 for a in db_assets])
    
    print(f"   - DB 자산 개수: {len(db_assets)}개")
    print(f"   - DB 총 연면적(GFA): {db_gfa_total:,.2f} ㎡")
    
    print("\n=== Phase 4: AUM 시점 차이(Gap) 분석 및 추가 요청 리스트 ===")
    
    res_funds = supabase.table('funds').select('fund_id, fund_name, metadata').execute()
    
    missing_aum_funds = []
    missing_rate_funds = []
    
    for f in res_funds.data:
        meta = f['metadata'] or {}
        aum = meta.get('benchmark_aum', 0)
        rate = meta.get('all_in_rate', 0)
        
        # AUM이 0이거나 없는 경우 (단, 청산된 펀드 제외)
        if (not aum or aum == 0) and meta.get('status') != '청산':
            missing_aum_funds.append(f)
            
        if (not rate or rate == 0) and meta.get('status') != '청산':
            missing_rate_funds.append(f)

    print(f"🚨 [결과] AUM(약정) 지표가 누락된 운용 펀드: {len(missing_aum_funds)}개")
    print("   (원인: 2026.01.12 이후 신규 설정되었거나 기존 AUM 장부에 누락됨)")
    for mf in missing_aum_funds[:5]:
        print(f"    - [{mf['fund_id']}] {mf['fund_name']}")
    if len(missing_aum_funds) > 5:
        print(f"    ... 외 {len(missing_aum_funds) - 5}건")

    print(f"\n🚨 [결과] 수익률(All-in Rate)이 누락된 운용 펀드: {len(missing_rate_funds)}개")
    for mf in missing_rate_funds[:5]:
        print(f"    - [{mf['fund_id']}] {mf['fund_name']}")

    # Report for Walkthrough
    with open("scratch/gap_report.txt", "w", encoding="utf-8") as f:
        f.write(f"Missing AUM Count: {len(missing_aum_funds)}\n")
        f.write(f"Missing Rate Count: {len(missing_rate_funds)}\n")

if __name__ == "__main__":
    phase3_4_verify()
