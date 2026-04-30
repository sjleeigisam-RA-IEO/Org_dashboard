import os
from supabase import create_client

def diag():
    url = 'https://qvegpozwrcmspdvjokiz.supabase.co'
    key = 'sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P'
    supabase = create_client(url, key)
    
    # 1. lender_exposures 전체 건수와 drawdown_date 현황
    all_lenders = supabase.table('lender_exposures').select('*').execute().data
    total = len(all_lenders)
    has_drawdown = [r for r in all_lenders if r.get('drawdown_date')]
    no_drawdown = [r for r in all_lenders if not r.get('drawdown_date')]
    
    print(f"=== lender_exposures 테이블 ===")
    print(f"전체 건수: {total}")
    print(f"drawdown_date 있음: {len(has_drawdown)} ({len(has_drawdown)/total*100:.1f}%)")
    print(f"drawdown_date 없음: {len(no_drawdown)} ({len(no_drawdown)/total*100:.1f}%)")
    
    # 2. start_date / end_date 현황도 확인
    has_start = [r for r in all_lenders if r.get('start_date')]
    has_end = [r for r in all_lenders if r.get('end_date')]
    print(f"\nstart_date 있음: {len(has_start)}")
    print(f"end_date 있음: {len(has_end)}")
    
    # 3. loan_maturity_date 현황
    has_maturity = [r for r in all_lenders if r.get('loan_maturity_date')]
    print(f"loan_maturity_date 있음: {len(has_maturity)}")
    
    # 4. drawdown_date 샘플 (있는 경우)
    print(f"\n--- drawdown_date 있는 데이터 샘플 (5건) ---")
    for r in has_drawdown[:5]:
        print(f"  fund_id={r['fund_id']}, lender={r['lender_clean']}, drawdown={r['drawdown_date']}, drawn_amt={r.get('drawn_amt',0):,}")
    
    # 5. drawdown_date 없는 데이터 샘플 (5건)
    print(f"\n--- drawdown_date 없는 데이터 샘플 (5건) ---")
    for r in no_drawdown[:5]:
        print(f"  fund_id={r['fund_id']}, lender={r['lender_clean']}, drawdown={r['drawdown_date']}, start={r.get('start_date')}")
    
    # 6. beneficiary_exposures도 확인
    all_ben = supabase.table('beneficiary_exposures').select('*').execute().data
    total_ben = len(all_ben)
    has_invested_date = [r for r in all_ben if r.get('invested_date')]
    print(f"\n=== beneficiary_exposures 테이블 ===")
    print(f"전체 건수: {total_ben}")
    print(f"invested_date 있음: {len(has_invested_date)} ({len(has_invested_date)/total_ben*100:.1f}%)")
    print(f"invested_date 없음: {total_ben - len(has_invested_date)}")

if __name__ == "__main__":
    diag()
