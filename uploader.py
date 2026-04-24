import os
import pandas as pd
import numpy as np
import json
from supabase import create_client, Client
from dotenv import load_dotenv
from processor import CRMProcessor

load_dotenv()

class SupabaseUploader:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("Supabase URL/Key missing in .env")
        self.supabase: Client = create_client(url, key)

    def upload_dataframe(self, df, table_name, on_conflict, int_cols=[]):
        df_clean = df.copy()
        conflict_cols = on_conflict.split(',')
        df_clean = df_clean.drop_duplicates(subset=conflict_cols)
        
        if 'fund_id' in df_clean.columns:
            df_clean = df_clean[df_clean['fund_id'].notnull() & (df_clean['fund_id'].astype(str) != '합계')]
            
        for col in df_clean.select_dtypes(include=['datetime64']).columns:
            df_clean[col] = df_clean[col].dt.strftime('%Y-%m-%d')
            
        if 'metadata' in df_clean.columns:
            df_clean['metadata'] = df_clean['metadata'].apply(lambda x: x if isinstance(x, (dict, list)) else {})
        if 'extra_info' in df_clean.columns:
            df_clean['extra_info'] = df_clean['extra_info'].apply(lambda x: x if isinstance(x, (dict, list)) else {})

        data = []
        for _, row in df_clean.iterrows():
            item = row.to_dict()
            for k, v in item.items():
                if pd.isna(v):
                    item[k] = None
                elif k in int_cols:
                    try: item[k] = int(float(v))
                    except: item[k] = 0
                elif isinstance(v, (np.int64, np.int32)): item[k] = int(v)
                elif isinstance(v, (np.float64, np.float32)): item[k] = float(v)
            data.append(item)
        
        if not data: return

        print(f"Uploading {len(data)} records to '{table_name}'...")
        try:
            chunk_size = 100
            for i in range(0, len(data), chunk_size):
                self.supabase.table(table_name).upsert(data[i:i + chunk_size], on_conflict=on_conflict).execute()
            print(f"Successfully uploaded to '{table_name}'.")
        except Exception as e:
            print(f"Error uploading to '{table_name}': {e}")

if __name__ == "__main__":
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    MAPPING_FILE = os.path.join(BASE_DIR, "mapping.json")
    
    processor = CRMProcessor(BASE_DIR, MAPPING_FILE)
    df_l = processor.process_lenders()
    df_b = processor.process_beneficiaries()
    df_a = processor.process_assets()
    df_m = processor.process_fund_management()
    df_rent_o = processor.process_market_rent('OFFICE')
    df_rent_l = processor.process_market_rent('LOGISTIC')
    
    funds = processor.extract_fund_master(df_l, df_b, df_a, df_m)
    
    if funds is not None:
        try:
            uploader = SupabaseUploader()
            # parent_fund_id를 metadata 필드에 병합 (DB 컬럼 부재 대응)
            def merge_parent(row):
                meta = row.get('metadata', {})
                if not isinstance(meta, dict): meta = {}
                if 'parent_fund_id' in row and pd.notna(row['parent_fund_id']):
                    meta['parent_fund_id'] = row['parent_fund_id']
                return meta
            funds['metadata'] = funds.apply(merge_parent, axis=1)
            
            # DB 스키마에 있는 컬럼만 선택
            db_cols = ['fund_id', 'short_name', 'fund_name', 'sector', 'asset_name', 'status', 'location', 'setup_date', 'maturity_date', 'dept', 'manager', 'metadata']
            valid_cols = [c for c in db_cols if c in funds.columns]
            uploader.upload_dataframe(funds[valid_cols], 'funds', on_conflict='fund_id')
            if df_l is not None:
                l_db = df_l.rename(columns={'펀드코드': 'fund_id', '대주_정제': 'lender_clean', '기준일자': 'base_date',
                                            '대출약정금액(원)': 'committed_amt', '대출인출금액(원)': 'drawn_amt', '대출잔여금액(원)': 'remaining_amt',
                                            '대출금리': 'interest_rate', 'All-in금리': 'all_in_rate', 
                                            '대출인출일': 'start_date', '대출만기일': 'end_date'})
                cols = ['fund_id', 'lender_clean', 'base_date', 'committed_amt', 'drawn_amt', 'remaining_amt', 'interest_rate', 'all_in_rate', 'start_date', 'end_date']
                uploader.upload_dataframe(l_db[cols], 'lender_exposures', on_conflict='fund_id,lender_clean,base_date', 
                                         int_cols=['committed_amt', 'drawn_amt', 'remaining_amt'])
            if df_b is not None:
                b_db = df_b.rename(columns={'펀드코드': 'fund_id', '수익자_정제': 'beneficiary_clean', '기준일자': 'base_date',
                                            '총약정금액': 'committed_amt', '투입금액': 'invested_amt', 
                                            '최초약정일': 'invested_date', '비율(%)': 'share_ratio'})
                cols = ['fund_id', 'beneficiary_clean', 'base_date', 'committed_amt', 'invested_amt', 'invested_date', 'share_ratio']
                uploader.upload_dataframe(b_db[cols], 'beneficiary_exposures', on_conflict='fund_id,beneficiary_clean,base_date', 
                                         int_cols=['committed_amt', 'invested_amt'])
            if df_a is not None:
                a_db = df_a.rename(columns={'펀드코드': 'fund_id', '자산(건물)명': 'asset_name', '권역': 'location_category'})
                # PNU를 metadata 필드에 병합
                def merge_pnu(row):
                    meta = row.get('metadata', {})
                    if not isinstance(meta, dict): meta = {}
                    if 'pnu' in row and pd.notna(row['pnu']):
                        meta['pnu'] = row['pnu']
                    return meta
                a_db['metadata'] = a_db.apply(merge_pnu, axis=1)

                cols = ['fund_id', 'asset_name', 'location_category', 'lat', 'lng', 'metadata',
                        'site_area', 'gfa', 'scr', 'far', 'main_usage', 'structure', 
                        'floors_up', 'floors_down', 'elevators', 'parking', 'completion_date', 'height']
                # 층수 컬럼 정수형 변환 (Nullable Int64 사용하여 .0 방지)
                for col in ['floors_up', 'floors_down']:
                    if col in a_db.columns:
                        a_db[col] = pd.to_numeric(a_db[col], errors='coerce').round().astype('Int64')
                
                uploader.upload_dataframe(a_db[cols], 'fund_assets', on_conflict='fund_id,asset_name')
            
            # Market Rent Upload (Table: market_data)
            for cat in ['OFFICE', 'LOGISTIC']:
                df_r = processor.process_market_rent(cat)
                if df_r is not None:
                    # DB 스키마에 맞춰 변환 (region, category, base_date, value, extra_info)
                    df_r['source'] = 'CRM Excel'
                    df_r['value'] = df_r['rent_monthly'].fillna(0)
                    
                    # 나머지 정보는 extra_info (JSON)으로 통합
                    def row_to_json(row):
                        return {k: v for k, v in row.to_dict().items() if k not in ['region', 'category', 'base_date', 'value', 'source']}
                    
                    df_r['extra_info'] = df_r.apply(row_to_json, axis=1)
                    upload_cols = ['region', 'category', 'base_date', 'value', 'source', 'extra_info']
                    uploader.upload_dataframe(df_r[upload_cols], 'market_data', on_conflict='region,category,base_date')
            
            print("\n--- All Data (including Market Rent) synced! ---")
        except Exception as e:
            print(f"Update failed: {e}")
