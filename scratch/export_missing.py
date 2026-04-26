import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def safe_int(val):
    try:
        if pd.isna(val): return 0
        return int(float(val))
    except:
        return 0

def extract_missing_list():
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    df_excel = pd.read_excel(excel_path, header=0)
    df_data = df_excel.iloc[1:].copy()
    
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    lenders_res = supabase.table('lender_exposures').select('fund_id').execute()
    bens_res = supabase.table('beneficiary_exposures').select('fund_id').execute()
    
    valid_ids = set([str(l['fund_id']).strip() for l in lenders_res.data] + [str(b['fund_id']).strip() for b in bens_res.data])
    
    missing_list = []
    
    for _, row in df_data.iterrows():
        f_id = str(row.iloc[0]).strip()
        if not f_id or f_id == 'nan' or '합계' in f_id: continue
        
        if f_id not in valid_ids:
            equity = safe_int(row.iloc[13])
            debt = safe_int(row.iloc[17])
            aum = safe_int(row.iloc[16])
            
            missing_list.append({
                "펀드코드": f_id,
                "펀드명": row.iloc[1],
                "약정_에쿼티": equity,
                "약정_대출액": debt,
                "AUM_합계": aum if aum > 0 else (equity + debt)
            })

    output_df = pd.DataFrame(missing_list)
    output_path = '누락_펀드_리스트_분석.csv'
    output_df.to_csv(output_path, index=False, encoding='utf-8-sig')
    
    print(f"Successfully extracted {len(missing_list)} missing funds to {output_path}")

if __name__ == "__main__":
    extract_missing_list()
