import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv
import json

load_dotenv()

def compare_data():
    # 1. Load Excel Data
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    # Use header=1 or similar if there are merged cells, but let's try reading and inspecting
    df_excel = pd.read_excel(excel_path)
    
    # 컬럼 매핑 (깨진 글자 대응을 위한 위치 기반 또는 키워드 기반 매칭)
    # 실제 컬럼명을 확인하기 위해 상위 2줄 출력
    print("--- Excel Columns found ---")
    cols = list(df_excel.columns)
    for i, c in enumerate(cols):
        print(f"[{i}] {c}")
        
    # 사용자 요청에 따른 컬럼 추정 (AUM, 에쿼티, 대출)
    # AUM 입력, 에쿼티, 대출 등의 키워드가 포함된 컬럼을 찾음
    # [12] AUM\n입력 (추정)
    # [13] 계 약정액 계 (추정)
    
    # 2. Load Supabase Data
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    # Fetch Funds
    funds_res = supabase.table('funds').select('fund_id, short_name, metadata').execute()
    funds_db = pd.DataFrame(funds_res.data)
    
    # Fetch Lenders (Debt)
    lenders_res = supabase.table('lender_exposures').select('fund_id, drawn_amt').execute()
    lenders_db = pd.DataFrame(lenders_res.data)
    lenders_sum = lenders_db.groupby('fund_id')['drawn_amt'].sum().reset_index()
    
    # Fetch Beneficiaries (Equity)
    bens_res = supabase.table('beneficiary_exposures').select('fund_id, invested_amt').execute()
    bens_db = pd.DataFrame(bens_res.data)
    bens_sum = bens_db.groupby('fund_id')['invested_amt'].sum().reset_index()
    
    # Merge DB Data
    db_summary = pd.merge(funds_db, bens_sum, on='fund_id', how='left').fillna(0)
    db_summary = pd.merge(db_summary, lenders_sum, on='fund_id', how='left').fillna(0)
    db_summary['total_aum'] = db_summary['invested_amt'] + db_summary['drawn_amt']
    
    # 3. Compare (Matching by fund_id or short_name)
    # Excel에서 펀드코드로 추정되는 컬럼 찾기 (예: [9] 운용부서 펀드)
    # 실제 데이터 확인이 필요하므로 상위 데이터 출력
    print("\n--- Excel Sample Data ---")
    print(df_excel.head(3))
    
    # (이후 실제 비교 로직 수행 예정)

if __name__ == "__main__":
    compare_data()
