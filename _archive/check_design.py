import sqlite3
import pandas as pd
import os

def check_design_report():
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DB_PATH = os.path.join(BASE_DIR, "crm_local.db")
    
    if not os.path.exists(DB_PATH):
        print("로컬 DB가 존재하지 않습니다. 먼저 verify_local.py를 실행해 주세요.")
        return

    conn = sqlite3.connect(DB_PATH)
    
    print("=" * 60)
    print(" [설계 검증 리포트] ")
    print("=" * 60)

    # 1. 특정 펀드 상세 조회 (예: '112005' - 6호)
    target_fund = '112005'
    print(f"\n1. 특정 펀드({target_fund})의 부채 및 자본 구조 조회")
    print("-" * 40)
    
    fund_info = pd.read_sql(f"SELECT fund_name, asset_name FROM funds WHERE fund_id='{target_fund}'", conn)
    print(f"펀드명: {fund_info.iloc[0,0]} (자산: {fund_info.iloc[0,1]})")
    
    print("\n[대주 리스트]")
    lender_query = f"SELECT lender_clean, drawn_amt / 100000000.0 as '인출액(억)', all_in_rate FROM lender_exposures WHERE fund_id='{target_fund}'"
    print(pd.read_sql(lender_query, conn))
    
    print("\n[수익자 리스트]")
    ben_query = f"SELECT beneficiary_clean, share_ratio as '비율(%)', invested_amt / 100000000.0 as '투자액(억)' FROM beneficiary_exposures WHERE fund_id='{target_fund}'"
    print(pd.read_sql(ben_query, conn))

    # 2. 특정 투자자(대주) 기준 전체 펀드 조회
    target_lender = '하나은행'
    print(f"\n2. 특정 대주({target_lender})의 전체 익스포저 조회")
    print("-" * 40)
    
    total_query = f"""
    SELECT f.fund_name, l.drawn_amt / 100000000.0 as '인출액(억)', l.loan_maturity_date
    FROM lender_exposures l
    JOIN funds f ON l.fund_id = f.fund_id
    WHERE l.lender_clean = '{target_lender}'
    ORDER BY l.drawn_amt DESC
    """
    res = pd.read_sql(total_query, conn)
    print(res.head(10)) # 상위 10개만
    print(f"\n... 총 {len(res)}개의 펀드에 참여 중")
    print(f"총 익스포저: {res['인출액(억)'].sum():,.1f} 억원")

    conn.close()

if __name__ == "__main__":
    check_design_report()
