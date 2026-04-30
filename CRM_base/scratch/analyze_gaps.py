import os
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd

load_dotenv()

def analyze_data_gaps():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    # 1. Fetch all funds and their metadata (which contains the AUM benchmark)
    funds_res = supabase.table('funds').select('fund_id, short_name, metadata').execute()
    funds = funds_res.data
    
    # 2. Fetch IDs from detail tables
    lenders = set([l['fund_id'] for l in supabase.table('lender_exposures').select('fund_id').execute().data])
    bens = set([b['fund_id'] for b in supabase.table('beneficiary_exposures').select('fund_id').execute().data])
    assets = set([a['fund_id'] for a in supabase.table('fund_assets').select('fund_id').execute().data])
    
    gap_list = []
    
    for f in funds:
        f_id = f['fund_id']
        meta = f['metadata'] or {}
        aum = meta.get('benchmark_aum', 0)
        
        has_lender = f_id in lenders
        has_ben = f_id in bens
        has_asset = f_id in assets
        
        if not (has_lender and has_ben and has_asset):
            gap_list.append({
                "펀드코드": f_id,
                "펀드명": f['short_name'],
                "AUM(약정)": aum,
                "대주정보": "O" if has_lender else "X",
                "수익자정보": "O" if has_ben else "X",
                "자산정보": "O" if has_asset else "X"
            })

    # 3. Report
    df_gap = pd.DataFrame(gap_list)
    df_gap = df_gap.sort_values("AUM(약정)", ascending=False)
    
    print(f"========== DATA GAP ANALYSIS ==========")
    print(f"1. 전체 분석 대상: {len(funds)}개 펀드")
    print(f"2. 정보 누락 펀드: {len(df_gap)}개")
    print(f"   - 대주정보 누락: {len(df_gap[df_gap['대주정보']=='X'])}개")
    print(f"   - 수익자정보 누락: {len(df_gap[df_gap['수익자정보']=='X'])}개")
    print(f"   - 자산상세 누락: {len(df_gap[df_gap['자산정보']=='X'])}개")
    
    print("\n3. 주요 보완 필요 항목 (AUM 상위 10개):")
    print(df_gap.head(10).to_string(index=False))
    
    # Save to CSV for user
    df_gap.to_csv("보완_필요_데이터_리스트.csv", index=False, encoding='utf-8-sig')
    print(f"\n-> 상세 리스트가 '보완_필요_데이터_리스트.csv'로 저장되었습니다.")
    print("========================================")

if __name__ == "__main__":
    analyze_data_gaps()
