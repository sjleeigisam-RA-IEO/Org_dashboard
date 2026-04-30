import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def extract_db_only_list():
    # 1. Load Excel (Benchmark)
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    df_excel = pd.read_excel(excel_path, header=0)
    excel_ids = set([str(val).strip() for val in df_excel.iloc[1:, 0] if pd.notna(val)])
    
    # 2. Get DB Funds
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    funds_res = supabase.table('funds').select('fund_id, short_name, fund_name, sector').execute()
    
    db_only_list = []
    for f in funds_res.data:
        f_id = str(f['fund_id']).strip()
        if f_id not in excel_ids:
            db_only_list.append({
                "펀드코드": f_id,
                "약칭": f.get('short_name', ''),
                "펀드명": f.get('fund_name', ''),
                "섹터": f.get('sector', '')
            })

    # 3. Save to CSV
    output_df = pd.DataFrame(db_only_list)
    output_path = 'DB_전용_펀드_리스트.csv'
    output_df.to_csv(output_path, index=False, encoding='utf-8-sig')
    
    print(f"Successfully extracted {len(db_only_list)} DB-only funds to {output_path}")

if __name__ == "__main__":
    extract_db_only_list()
