import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv
import numpy as np

load_dotenv()

def run_final_comparison():
    # 1. Load Excel
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    # Row 0 is often sub-header, let's read properly
    df_excel = pd.read_excel(excel_path, header=0)
    # Rename columns for clarity based on inspection
    df_excel.columns = [f"col_{i}" for i in range(len(df_excel.columns))]
    
    # Filter rows that have valid fund codes (numeric-like strings)
    # Start from row 1 since row 0 had headers like '펀드코드'
    df_excel = df_excel.iloc[1:].copy()
    df_excel['fund_id'] = df_excel['col_0'].astype(str).str.strip()
    df_excel['excel_short_name'] = df_excel['col_1'].astype(str).str.strip()
    df_excel['excel_aum'] = pd.to_numeric(df_excel['col_12'], errors='coerce').fillna(0)
    df_excel['excel_equity'] = pd.to_numeric(df_excel['col_13'], errors='coerce').fillna(0)
    df_excel['excel_debt'] = pd.to_numeric(df_excel['col_17'], errors='coerce').fillna(0)
    
    # 2. Load DB Data
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    funds = pd.DataFrame(supabase.table('funds').select('fund_id, short_name').execute().data)
    lenders = pd.DataFrame(supabase.table('lender_exposures').select('fund_id, drawn_amt').execute().data)
    bens = pd.DataFrame(supabase.table('beneficiary_exposures').select('fund_id, invested_amt').execute().data)
    
    lenders_sum = lenders.groupby('fund_id')['drawn_amt'].sum().reset_index()
    bens_sum = bens.groupby('fund_id')['invested_amt'].sum().reset_index()
    
    db_summary = pd.merge(funds, bens_sum, on='fund_id', how='left').fillna(0)
    db_summary = pd.merge(db_summary, lenders_sum, on='fund_id', how='left').fillna(0)
    db_summary['db_aum'] = db_summary['invested_amt'] + db_summary['drawn_amt']
    db_summary['fund_id'] = db_summary['fund_id'].astype(str).str.strip()
    
    # 3. Analysis
    # 3-1. Count comparison
    excel_fund_ids = set(df_excel['fund_id'].unique())
    db_fund_ids = set(db_summary['fund_id'].unique())
    
    missing_in_db = excel_fund_ids - db_fund_ids
    extra_in_db = db_fund_ids - excel_fund_ids
    
    # 3-2. Missing Value Analysis
    missing_df = df_excel[df_excel['fund_id'].isin(missing_in_db)]
    missing_aum_total = missing_df['excel_aum'].sum()
    
    # 3-3. Value Difference Analysis (for mutual funds)
    merged = pd.merge(df_excel, db_summary, on='fund_id', how='inner')
    merged['diff_aum'] = merged['excel_aum'] - merged['db_aum']
    merged['diff_equity'] = merged['excel_equity'] - merged['invested_amt']
    merged['diff_debt'] = merged['excel_debt'] - merged['drawn_amt']
    
    # Report Output
    print("========== AUM GAP ANALYSIS REPORT ==========")
    print(f"1. 펀드/프로젝트 리스트 갯수 비교")
    print(f"   - 엑셀 총 항목 수: {len(excel_fund_ids)}개")
    print(f"   - DB 총 항목 수: {len(db_fund_ids)}개")
    print(f"   - DB 누락 펀드: {len(missing_in_db)}개")
    print(f"   - DB 초과 펀드: {len(extra_in_db)}개 (엑셀에 없는 신규 등)")
    
    print(f"\n2-1. DB 누락 항목 상세 (금액 규모)")
    print(f"   - 누락 펀드 합산 AUM: {missing_aum_total:,.0f}원")
    if len(missing_in_db) > 0:
        print("   - 주요 누락 리스트 (상위 5개):")
        top_missing = missing_df.sort_values('excel_aum', ascending=False).head(5)
        for _, r in top_missing.iterrows():
            print(f"     * [{r['fund_id']}] {r['excel_short_name']}: {r['excel_aum']:,.0f}원")

    print(f"\n2-2. 양쪽 공통 항목 수치 비교 (Excel - DB)")
    significant_diff = merged[merged['diff_aum'].abs() > 1000000] # 100만원 이상 차이
    print(f"   - 수치 차이 발생 펀드 수: {len(significant_diff)}개")
    print(f"   - 총 AUM 차이 합계: {merged['diff_aum'].sum():,.0f}원")
    print(f"   - 에쿼티 차이 합계: {merged['diff_equity'].sum():,.0f}원")
    print(f"   - 대출액 차이 합계: {merged['diff_debt'].sum():,.0f}원")
    
    if len(significant_diff) > 0:
        print("\n   - 주요 차이 발생 항목 (상위 5개):")
        top_diff = significant_diff.assign(abs_diff=significant_diff['diff_aum'].abs()).sort_values('abs_diff', ascending=False).head(5)
        for _, r in top_diff.iterrows():
            print(f"     * [{r['fund_id']}] {r['short_name']}")
            print(f"       Excel: AUM {r['excel_aum']:,.0f} / Eq {r['excel_equity']:,.0f} / Debt {r['excel_debt']:,.0f}")
            print(f"       DB   : AUM {r['db_aum']:,.0f} / Eq {r['invested_amt']:,.0f} / Debt {r['drawn_amt']:,.0f}")
            print(f"       Gap  : AUM {r['diff_aum']:,.0f}")

    print("\n3. 차이(갭) 해결을 위한 제언")
    print("   - [데이터 소스] DB 누락 펀드는 최신 '대주/수익자 정보 조회' 엑셀을 입수하여 업데이트 필요")
    print("   - [수치 불일치] 특정 펀드들의 에쿼티/대출 합계가 엑셀과 다른 경우, 기초 데이터의 '인출금액' 및 '약정액' 컬럼 재검토 필요")
    print("   - [정의 일치] 대시보드 AUM 계산식(Equity+Debt)이 엑셀의 'AUM' 컬럼 산식과 동일한지 확인 필요")
    print("=============================================")

if __name__ == "__main__":
    run_final_comparison()
