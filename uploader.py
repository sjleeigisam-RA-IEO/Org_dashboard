import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from processor import CRMProcessor

# .env 파일 로드
load_dotenv()

class SupabaseUploader:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key or "YOUR_" in url:
            raise ValueError("Supabase URL 또는 Key가 .env 파일에 올바르게 설정되지 않았습니다.")
        self.supabase: Client = create_client(url, key)

    def upload_dataframe(self, df, table_name, int_cols=[]):
        # 1. Deep Copy
        df_clean = df.copy()
        
        # 2. Filter out rows where Fund ID is missing (like 'Total' rows)
        if 'fund_id' in df_clean.columns:
            df_clean = df_clean[df_clean['fund_id'].notnull() & (df_clean['fund_id'].astype(str) != '합계')]
            
        # 3. Convert Timestamps to string
        for col in df_clean.select_dtypes(include=['datetime64']).columns:
            df_clean[col] = df_clean[col].dt.strftime('%Y-%m-%d')
            
        # 4. Force Integer conversion for BIGINT columns (Important!)
        for col in int_cols:
            if col in df_clean.columns:
                df_clean[col] = pd.to_numeric(df_clean[col], errors='coerce').fillna(0).astype(int)
        
        # 5. Handle Infinity and NaN
        df_clean = df_clean.replace([np.inf, -np.inf], np.nan)
        df_clean = df_clean.astype(object).where(pd.notnull(df_clean), None)
        
        data = df_clean.to_dict(orient='records')
        
        if not data:
            print(f"No data to upload for '{table_name}'.")
            return

        print(f"Uploading {len(data)} records to '{table_name}'...")
        
        try:
            chunk_size = 100
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i + chunk_size]
                self.supabase.table(table_name).upsert(chunk).execute()
            print(f"Successfully uploaded to '{table_name}'.")
        except Exception as e:
            print(f"Error uploading to '{table_name}': {e}")

if __name__ == "__main__":
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    MAPPING_FILE = os.path.join(BASE_DIR, "mapping.json")
    
    processor = CRMProcessor(BASE_DIR, MAPPING_FILE)
    df_l = processor.process_lenders()
    df_b = processor.process_beneficiaries()
    
    if df_l is not None and df_b is not None:
        funds = processor.extract_fund_master(df_l, df_b)
        
        try:
            uploader = SupabaseUploader()
            
            # 1. Funds
            funds_db = funds.rename(columns={
                '펀드코드': 'fund_id', '약칭': 'short_name', '펀드명': 'fund_name',
                '투자섹터': 'sector', '자산': 'asset_name', '운용상태': 'status',
                '국내해외구분': 'location', '펀드설정일': 'setup_date', '펀드만기일': 'maturity_date',
                '담당부서': 'dept', '담당자': 'manager'
            })
            uploader.upload_dataframe(funds_db, 'funds')
            
            # 2. Lenders
            lender_db = df_l.rename(columns={
                '펀드코드': 'fund_id', '대주': 'lender_raw', '대주_정제': 'lender_clean',
                '대출약정금액(원)': 'committed_amt', '대출인출금액(원)': 'drawn_amt', '대출잔여금액(원)': 'remaining_amt',
                '대출인출일': 'drawdown_date', '대출만기일': 'loan_maturity_date', '트렌치': 'trench',
                '이자유형': 'interest_type', '기준금리': 'base_rate', '가산금리': 'spread_rate',
                'All-in금리': 'all_in_rate', '비고': 'remarks', '기준일자': 'base_date'
            })[['fund_id', 'lender_raw', 'lender_clean', 'committed_amt', 'drawn_amt', 'remaining_amt', 
                'drawdown_date', 'loan_maturity_date', 'trench', 'interest_type', 'base_rate', 
                'spread_rate', 'all_in_rate', 'remarks', 'base_date']]
            
            l_int_cols = ['committed_amt', 'drawn_amt', 'remaining_amt']
            uploader.upload_dataframe(lender_db, 'lender_exposures', int_cols=l_int_cols)
            
            # 3. Beneficiaries
            beneficiary_db = df_b.rename(columns={
                '펀드코드': 'fund_id', '수익자': 'beneficiary_raw', '수익자_정제': 'beneficiary_clean',
                '수익자구분': 'beneficiary_type', '수익자분류': 'beneficiary_cat', '총약정금액': 'committed_amt',
                '투입금액': 'invested_amt', '잔여약정금액': 'remaining_amt', '비율(%)': 'share_ratio',
                '설정해지좌수': 'setup_units', '설정해지금액': 'setup_amt', '비고': 'remarks', '기준일자': 'base_date'
            })[['fund_id', 'beneficiary_raw', 'beneficiary_clean', 'beneficiary_type', 'beneficiary_cat',
                'committed_amt', 'invested_amt', 'remaining_amt', 'share_ratio', 'setup_units', 
                'setup_amt', 'remarks', 'base_date']]
            
            b_int_cols = ['committed_amt', 'invested_amt', 'remaining_amt', 'setup_amt']
            uploader.upload_dataframe(beneficiary_db, 'beneficiary_exposures', int_cols=b_int_cols)
            
            print("\n--- All updates completed successfully! ---")
            
        except Exception as e:
            print(f"Update failed: {e}")
