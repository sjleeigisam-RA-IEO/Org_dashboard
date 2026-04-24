import pandas as pd
import os
import glob
import json
import numpy as np

class CRMProcessor:
    def __init__(self, data_dir, mapping_file):
        self.data_dir = data_dir
        with open(mapping_file, 'r', encoding='utf-8') as f:
            self.mapping = json.load(f)
            
    def get_latest_file(self, pattern):
        files = glob.glob(os.path.join(self.data_dir, pattern))
        if not files:
            return None
        return max(files, key=os.path.getctime)

    def clean_name(self, name, category):
        if pd.isna(name):
            return "Unknown"
        name = str(name).strip()
        # Apply mapping if exists
        return self.mapping.get(category, {}).get(name, name)

    def process_lenders(self):
        file_path = self.get_latest_file("대주 정보 조회_*.xlsx")
        if not file_path:
            print("Lender file not found.")
            return None
        
        print(f"Processing Lender file: {file_path}")
        df = pd.read_excel(file_path)
        
        # Standardize Names
        df['대주_정제'] = df['대주'].apply(lambda x: self.clean_name(x, 'lenders'))
        
        # Clean numeric columns
        num_cols = ['대출약정금액(원)', '대출인출금액(원)', '대출잔여금액(원)', '대출금리', 'All-in금리']
        for col in num_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
        # Clean dates
        date_cols = ['기준일자', '펀드설정일', '펀드만기일', '대출인출일', '대출만기일']
        for col in date_cols:
            df[col] = pd.to_datetime(df[col], errors='coerce')
            
        return df

    def process_beneficiaries(self):
        file_path = self.get_latest_file("수익자 정보 조회_*.xlsx")
        if not file_path:
            print("Beneficiary file not found.")
            return None
        
        print(f"Processing Beneficiary file: {file_path}")
        df = pd.read_excel(file_path)
        
        # Standardize Names
        df['수익자_정제'] = df['수익자'].apply(lambda x: self.clean_name(x, 'beneficiaries'))
        
        # Clean numeric columns
        num_cols = ['총약정금액', '투입금액', '잔여약정금액', '비율(%)']
        for col in num_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
        # Clean dates
        date_cols = ['기준일자', '펀드설정일', '펀드만기일', '최초약정일']
        for col in date_cols:
            df[col] = pd.to_datetime(df[col], errors='coerce')
            
        return df

    def extract_fund_master(self, df_lender, df_beneficiary):
        # Combine unique funds from both files
        f1 = df_lender[['펀드코드', '약칭', '펀드명', '투자섹터', '자산', '운용상태', '국내해외구분', '펀드설정일', '펀드만기일', '담당부서', '담당자']].drop_duplicates()
        f2 = df_beneficiary[['펀드코드', '약칭', '펀드명', '투자섹터', '자산', '운용상태', '국내해외구분', '펀드설정일', '펀드만기일', '담당부서', '담당자']].drop_duplicates()
        
        fund_master = pd.concat([f1, f2]).drop_duplicates(subset=['펀드코드'])
        return fund_master

if __name__ == "__main__":
    # Current script directory
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    MAPPING_FILE = os.path.join(BASE_DIR, "mapping.json")
    
    processor = CRMProcessor(BASE_DIR, MAPPING_FILE)
    
    df_l = processor.process_lenders()
    df_b = processor.process_beneficiaries()
    
    if df_l is not None and df_b is not None:
        funds = processor.extract_fund_master(df_l, df_b)
        print(f"\nExtracted {len(funds)} unique funds.")
        print(f"Processed {len(df_l)} lender records.")
        print(f"Processed {len(df_b)} beneficiary records.")
        
        # Save processed data for verification
        funds.to_csv(os.path.join(BASE_DIR, "funds_master.csv"), index=False, encoding='utf-8-sig')
        df_l.to_csv(os.path.join(BASE_DIR, "lender_exposures.csv"), index=False, encoding='utf-8-sig')
        df_b.to_csv(os.path.join(BASE_DIR, "beneficiary_exposures.csv"), index=False, encoding='utf-8-sig')
        print(f"Processed data saved to {BASE_DIR}")
