import os
import sys
import io
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')
load_dotenv()

def phase2_verify():
    print("\n=== Phase 2: 노출 자본(Exposure) 무결성 검증 ===")
    
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    res_funds = supabase.table('funds').select('fund_id').execute()
    valid_fund_ids = set([f['fund_id'] for f in res_funds.data])

    # 1. Lender Verification
    lender_path = '_archive/대주 정보 조회_20260424.xlsx'
    df_lender = pd.read_excel(lender_path, header=0)
    
    # 쉼표 제거 및 숫자 변환
    df_lender['대출인출금액(원)'] = df_lender['대출인출금액(원)'].astype(str).str.replace(',', '')
    excel_lender_total_raw = pd.to_numeric(df_lender['대출인출금액(원)'], errors='coerce').sum()
    
    # DB에 있는 펀드만 필터링한 엑셀 총계
    df_lender_filtered = df_lender[df_lender.iloc[:, 0].astype(str).isin(valid_fund_ids)]
    excel_lender_total = pd.to_numeric(df_lender_filtered['대출인출금액(원)'], errors='coerce').sum()
    
    res_lender = supabase.table('lender_exposures').select('drawn_amt').execute()
    db_lender_total = sum([x['drawn_amt'] or 0 for x in res_lender.data])
    
    print("1. 대주(Lender) 집행금액 총계 비교:")
    print(f"   - 엑셀 원장 전체(Raw):    {excel_lender_total_raw:,.0f} 원")
    print(f"   - 엑셀 원장 (유효펀드):   {excel_lender_total:,.0f} 원")
    print(f"   - DB 총계:                {db_lender_total:,.0f} 원")
    if abs(excel_lender_total - db_lender_total) < 100:
        print("   - ✅ 결과: 완벽 일치")
    else:
        diff = excel_lender_total - db_lender_total
        print(f"   - ❌ 결과: 불일치 (차액: {diff:,.0f} 원)")

    # 2. Beneficiary Verification
    ben_path = '_archive/수익자 정보 조회_20260331.xlsx'
    df_ben = pd.read_excel(ben_path, header=0)
    
    # 쉼표 제거 및 숫자 변환
    df_ben['투입금액'] = df_ben['투입금액'].astype(str).str.replace(',', '')
    excel_ben_total_raw = pd.to_numeric(df_ben['투입금액'], errors='coerce').sum()
    
    df_ben_filtered = df_ben[df_ben.iloc[:, 0].astype(str).isin(valid_fund_ids)]
    excel_ben_total = pd.to_numeric(df_ben_filtered['투입금액'], errors='coerce').sum()
    
    res_ben = supabase.table('beneficiary_exposures').select('invested_amt').execute()
    db_ben_total = sum([x['invested_amt'] or 0 for x in res_ben.data])
    
    print("\n2. 수익자(Beneficiary) 투자금액 총계 비교:")
    print(f"   - 엑셀 원장 전체(Raw):    {excel_ben_total_raw:,.0f} 원")
    print(f"   - 엑셀 원장 (유효펀드):   {excel_ben_total:,.0f} 원")
    print(f"   - DB 총계:                {db_ben_total:,.0f} 원")
    if abs(excel_ben_total - db_ben_total) < 100:
        print("   - ✅ 결과: 완벽 일치")
    else:
        diff = excel_ben_total - db_ben_total
        print(f"   - ❌ 결과: 불일치 (차액: {diff:,.0f} 원)")

if __name__ == "__main__":
    phase2_verify()
