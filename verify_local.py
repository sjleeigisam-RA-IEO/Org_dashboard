import sqlite3
import pandas as pd
import os
from processor import CRMProcessor

def verify_locally():
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    MAPPING_FILE = os.path.join(BASE_DIR, "mapping.json")
    DB_PATH = os.path.join(BASE_DIR, "crm_local.db")
    
    # 1. 엑셀 데이터 정제
    print("--- 1. 데이터 정제 시작 ---")
    processor = CRMProcessor(BASE_DIR, MAPPING_FILE)
    df_l = processor.process_lenders()
    df_b = processor.process_beneficiaries()
    
    if df_l is None or df_b is None:
        print("데이터 파일을 찾을 수 없습니다.")
        return

    # 2. 로컬 SQLite DB 연결 및 테이블 생성
    print("\n--- 2. 로컬 DB 구축 시작 ---")
    conn = sqlite3.connect(DB_PATH)
    
    # 테이블 생성 (SQLITE 문법)
    conn.execute("DROP TABLE IF EXISTS funds")
    conn.execute("DROP TABLE IF EXISTS lender_exposures")
    conn.execute("DROP TABLE IF EXISTS beneficiary_exposures")
    
    conn.execute("""
    CREATE TABLE funds (
        fund_id TEXT PRIMARY KEY,
        short_name TEXT,
        fund_name TEXT,
        sector TEXT,
        asset_name TEXT,
        status TEXT,
        location TEXT,
        setup_date TEXT,
        maturity_date TEXT,
        dept TEXT,
        manager TEXT
    )""")
    
    conn.execute("""
    CREATE TABLE lender_exposures (
        fund_id TEXT,
        lender_raw TEXT,
        lender_clean TEXT,
        committed_amt REAL,
        drawn_amt REAL,
        remaining_amt REAL,
        drawdown_date TEXT,
        loan_maturity_date TEXT,
        trench TEXT,
        interest_type TEXT,
        base_rate REAL,
        spread_rate REAL,
        all_in_rate REAL,
        remarks TEXT,
        base_date TEXT
    )""")
    
    conn.execute("""
    CREATE TABLE beneficiary_exposures (
        fund_id TEXT,
        beneficiary_raw TEXT,
        beneficiary_clean TEXT,
        beneficiary_type TEXT,
        beneficiary_cat TEXT,
        committed_amt REAL,
        invested_amt REAL,
        remaining_amt REAL,
        share_ratio REAL,
        setup_units REAL,
        setup_amt REAL,
        remarks TEXT,
        base_date TEXT
    )""")
    
    # 3. 데이터 삽입
    funds = processor.extract_fund_master(df_l, df_b)
    
    # 컬럼명 매핑
    funds_db = funds.rename(columns={
        '펀드코드': 'fund_id', '약칭': 'short_name', '펀드명': 'fund_name',
        '투자섹터': 'sector', '자산': 'asset_name', '운용상태': 'status',
        '국내해외구분': 'location', '펀드설정일': 'setup_date', '펀드만기일': 'maturity_date',
        '담당부서': 'dept', '담당자': 'manager'
    })
    
    lender_db = df_l.rename(columns={
        '펀드코드': 'fund_id', '대주': 'lender_raw', '대주_정제': 'lender_clean',
        '대출약정금액(원)': 'committed_amt', '대출인출금액(원)': 'drawn_amt', '대출잔여금액(원)': 'remaining_amt',
        '대출인출일': 'drawdown_date', '대출만기일': 'loan_maturity_date', '트렌치': 'trench',
        '이자유형': 'interest_type', '기준금리': 'base_rate', '가산금리': 'spread_rate',
        'All-in금리': 'all_in_rate', '비고': 'remarks', '기준일자': 'base_date'
    })[['fund_id', 'lender_raw', 'lender_clean', 'committed_amt', 'drawn_amt', 'remaining_amt', 
        'drawdown_date', 'loan_maturity_date', 'trench', 'interest_type', 'base_rate', 
        'spread_rate', 'all_in_rate', 'remarks', 'base_date']]
        
    beneficiary_db = df_b.rename(columns={
        '펀드코드': 'fund_id', '수익자': 'beneficiary_raw', '수익자_정제': 'beneficiary_clean',
        '수익자구분': 'beneficiary_type', '수익자분류': 'beneficiary_cat', '총약정금액': 'committed_amt',
        '투입금액': 'invested_amt', '잔여약정금액': 'remaining_amt', '비율(%)': 'share_ratio',
        '설정해지좌수': 'setup_units', '설정해지금액': 'setup_amt', '비고': 'remarks', '기준일자': 'base_date'
    })[['fund_id', 'beneficiary_raw', 'beneficiary_clean', 'beneficiary_type', 'beneficiary_cat',
        'committed_amt', 'invested_amt', 'remaining_amt', 'share_ratio', 'setup_units', 
        'setup_amt', 'remarks', 'base_date']]
    
    # 저장
    funds_db.to_sql('funds', conn, if_exists='append', index=False)
    lender_db.to_sql('lender_exposures', conn, if_exists='append', index=False)
    beneficiary_db.to_sql('beneficiary_exposures', conn, if_exists='append', index=False)
    
    print("\n--- 3. 로컬 데이터 검증 쿼리 결과 ---")
    
    # 검증 1: 대주별 총 대출 잔액(Drawn Amount) Top 5
    print("\n[대주별 총 대출 잔액 Top 5]")
    query1 = """
    SELECT lender_clean, SUM(drawn_amt) / 100000000.0 as '총인출액(억원)'
    FROM lender_exposures
    GROUP BY lender_clean
    ORDER BY SUM(drawn_amt) DESC
    LIMIT 5
    """
    print(pd.read_sql(query1, conn))
    
    # 검증 2: 수익자별 총 투자액(Invested Amount) Top 5
    print("\n[수익자별 총 투자액 Top 5]")
    query2 = """
    SELECT beneficiary_clean, SUM(invested_amt) / 100000000.0 as '총투자액(억원)'
    FROM beneficiary_exposures
    GROUP BY beneficiary_clean
    ORDER BY SUM(invested_amt) DESC
    LIMIT 5
    """
    print(pd.read_sql(query2, conn))
    
    # 검증 3: 펀드 수 확인
    print("\n[마스터 테이블 요약]")
    print(f"총 펀드 수: {pd.read_sql('SELECT COUNT(*) FROM funds', conn).iloc[0,0]}")
    
    conn.close()
    print("\n--- 검증 완료 (crm_local.db 파일이 생성되었습니다) ---")

if __name__ == "__main__":
    verify_locally()
