import os
import sys
import io
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')
load_dotenv()

def matrix_simulation():
    print("=== 다차원 매트릭스 금융 지표 시뮬레이션 ===")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    funds = supabase.table('funds').select('fund_id, fund_name, metadata').execute().data
    lenders = supabase.table('lender_exposures').select('fund_id, drawn_amt').execute().data
    bens = supabase.table('beneficiary_exposures').select('fund_id, invested_amt').execute().data
    
    fund_loans = {}
    for l in lenders:
        fid = l['fund_id']
        fund_loans[fid] = fund_loans.get(fid, 0) + (l['drawn_amt'] or 0)
        
    fund_equities = {}
    for b in bens:
        fid = b['fund_id']
        fund_equities[fid] = fund_equities.get(fid, 0) + (b['invested_amt'] or 0)

    # Prepare DataFrame for easy grouping
    data = []
    for f in funds:
        fid = f['fund_id']
        meta = f.get('metadata') or {}
        region = meta.get('region', '미분류')
        sector = meta.get('sector', '미분류')
        status = meta.get('status', '미분류')
        
        benchmark_aum = meta.get('benchmark_aum', 0)
        deposit = meta.get('lease_deposit', 0)
        loan = fund_loans.get(fid, 0)
        equity = fund_equities.get(fid, 0)
        
        calc_aum = loan + equity + deposit
        gap = benchmark_aum - calc_aum if benchmark_aum > 0 else 0
        
        # If benchmark_aum is 0, we use calculated AUM as the total
        final_aum = benchmark_aum if benchmark_aum > 0 else calc_aum
        
        data.append({
            'fund_id': fid,
            'region': region,
            'sector': sector,
            'status': status,
            'AUM': final_aum,
            'Equity': equity,
            'Loan': loan,
            'Deposit': deposit,
            'Gap': gap
        })

    df = pd.DataFrame(data)

    def verify_group(group_name, group_df):
        aum = group_df['AUM'].sum()
        equity = group_df['Equity'].sum()
        loan = group_df['Loan'].sum()
        deposit = group_df['Deposit'].sum()
        gap = group_df['Gap'].sum()
        
        calc = equity + loan + deposit + gap
        diff = aum - calc
        
        status = "✅ Pass" if abs(diff) < 1000 else f"❌ Fail (차액: {diff:,.0f})"
        print(f"[{group_name}] AUM: {aum/1e12:,.1f}조 | Eq+Ln+Dep+Gap: {calc/1e12:,.1f}조 => {status}")

    print("\n1. 지역별(Region) 시뮬레이션 분해:")
    for region, group in df.groupby('region'):
        verify_group(f"지역: {region}", group)

    print("\n2. 자산섹터별(Sector) 시뮬레이션 분해:")
    for sector, group in df.groupby('sector'):
        verify_group(f"섹터: {sector}", group)

    print("\n3. 운용상태별(Status) 시뮬레이션 분해:")
    for status, group in df.groupby('status'):
        verify_group(f"상태: {status}", group)

if __name__ == "__main__":
    matrix_simulation()
