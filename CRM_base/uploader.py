import os
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import json
from processor import CRMProcessor

class SupabaseUploader:
    def __init__(self):
        load_dotenv()
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        self.supabase: Client = create_client(url, key)

    def upload_dataframe(self, df, table_name, on_conflict=None, int_cols=None):
        # Convert NaN to None for JSON compliance
        df = df.where(pd.notnull(df), None)
        
        # Ensure int columns are correct
        if int_cols:
            for col in int_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0).astype(int)

        data = df.to_dict(orient='records')
        
        # Split into chunks of 1000
        chunk_size = 1000
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i + chunk_size]
            try:
                if on_conflict:
                    self.supabase.table(table_name).upsert(chunk, on_conflict=on_conflict).execute()
                else:
                    self.supabase.table(table_name).insert(chunk).execute()
                print(f"Uploaded {len(chunk)} records to '{table_name}'.")
            except Exception as e:
                print(f"Error uploading chunk {i//chunk_size} to {table_name}: {e}")

    def sync_all(self):
        processor = CRMProcessor(".", "mapping.json")
        uploader = self
        
        try:
            # 1. 원본 데이터 로드
            funds = processor.process_fund_management()
            df_l = processor.process_lenders()
            df_b = processor.process_beneficiaries()
            df_a = processor.process_assets()
            
            # DB 컬럼 리스트 정의
            db_cols = ['fund_id', 'short_name', 'fund_name', 'sector', 'asset_name', 'status', 'location', 'setup_date', 'maturity_date', 'dept', 'manager', 'metadata']
            
            def merge_extra_to_metadata(row):
                meta = row.get('metadata', {})
                if not isinstance(meta, dict): meta = {}
                # 속성들을 metadata에 깔끔한 이름으로 저장
                attrs = ['division', 'vehicle_type', 'recruitment_type', 'parent_child_type', 
                         'legal_form', 'fund_class', 'location_type', 'primary_region', 
                         'fund_type', 'investment_strategy', 'benchmark_aum', 'equity_won', 
                         'loan_won', 'deposit_won']
                numeric_cols = ['benchmark_aum', 'equity_won', 'loan_won', 'deposit_won']
                for attr in attrs:
                    if attr in row.index and pd.notna(row[attr]):
                        val = row[attr]
                        if attr in numeric_cols:
                            try: val = float(str(val).replace(',', ''))
                            except: val = 0
                        meta[attr] = val
                return meta

            # 2. 데이터 매핑 (사용자 요청 반영: dept=부서, manager=담당자)
            if 'department' in funds.columns:
                funds['dept'] = funds['department']
            # manager, sector 등은 이미 processor에서 올바른 이름으로 추출됨
            
            # 3. 메타데이터 병합
            funds['metadata'] = funds.apply(merge_extra_to_metadata, axis=1)
            
            # 4. DB 업로드 (funds)
            funds_to_upload = funds.copy()
            valid_cols = [c for c in db_cols if c in funds_to_upload.columns]
            uploader.upload_dataframe(funds_to_upload[valid_cols], 'funds', on_conflict='fund_id')

            # 5. 기타 연관 데이터 업로드 (Exposures, Assets 등)
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
                a_db = df_a.copy()
                rename_map = {'펀드코드': 'fund_id', '자산(건물)명': 'asset_name', '권역': 'location_category'}
                a_db = a_db.rename(columns={k: v for k, v in rename_map.items() if k in a_db.columns})
                target_cols = ['fund_id', 'asset_name', 'location_category', 'lat', 'lng', 'metadata',
                               'site_area', 'gfa', 'scr', 'far', 'main_usage', 'structure', 
                               'floors_up', 'floors_down', 'elevators', 'parking', 'completion_date', 'height']
                for col in target_cols:
                    if col not in a_db.columns: a_db[col] = None
                a_db = a_db.replace({pd.NA: None, float('nan'): None})
                uploader.upload_dataframe(a_db[target_cols], 'fund_assets', on_conflict='fund_id,asset_name')
            
            # Market Rent
            for cat in ['OFFICE', 'LOGISTIC']:
                df_r = processor.process_market_rent(cat)
                if df_r is not None:
                    df_r['source'] = 'CRM Excel'
                    df_r['value'] = df_r['rent_monthly'].fillna(0)
                    df_r['extra_info'] = df_r.apply(lambda row: {k: v for k, v in row.to_dict().items() if k not in ['region', 'category', 'base_date', 'value', 'source']}, axis=1)
                    upload_cols = ['region', 'category', 'base_date', 'value', 'source', 'extra_info']
                    uploader.upload_dataframe(df_r[upload_cols], 'market_data', on_conflict='region,category,base_date')
            
            print("\n--- All Data synced with cleaned English columns! ---")
        except Exception as e:
            print(f"Update failed: {e}")

if __name__ == "__main__":
    uploader = SupabaseUploader()
    uploader.sync_all()
