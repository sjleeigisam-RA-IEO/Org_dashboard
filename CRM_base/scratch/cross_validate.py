import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def cross_validate():
    files = {
        '펀드관리': '_archive/펀드 관리_20260424.xlsx',
        '대주조회': '_archive/대주 정보 조회_20260424.xlsx',
        '수익자조회': '_archive/수익자 정보 조회_20260331.xlsx',
        '자산조회': '_archive/투자 자산 조회_20260424.xlsx'
    }
    
    excel_sets = {}
    all_excel_ids = set()
    
    for name, path in files.items():
        try:
            df = pd.read_excel(path)
            # 펀드코드 컬럼 찾기 (한글 인코딩 대응)
            f_col = None
            for c in df.columns:
                if '펀드코드' in str(c):
                    f_col = c
                    break
            if not f_col: f_col = df.columns[0]
            
            ids = set(df[f_col].astype(str).str.strip().unique())
            # 'nan', '합계', 'None' 등 제거
            ids = {i for i in ids if i.lower() not in ['nan', 'none', '합계', 'total'] and len(i) > 2}
            excel_sets[name] = ids
            all_excel_ids.update(ids)
            print(f"File [{name}]: {len(ids)} unique funds found.")
        except Exception as e:
            print(f"Error reading {name}: {e}")

    # 2. Get DB Funds
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    funds_res = supabase.table('funds').select('fund_id').execute()
    db_ids = set([str(f['fund_id']).strip() for f in funds_res.data])
    
    print(f"\n--- Global Summary ---")
    print(f"Total Unique Funds across ALL Excels: {len(all_excel_ids)}")
    print(f"Total Funds currently in DB: {len(db_ids)}")
    
    # 3. Investigation
    db_only = db_ids - all_excel_ids
    print(f"Funds only in DB (Stale?): {len(db_only)}")
    
    if len(db_only) > 0:
        print("\nSample of Funds only in DB:")
        sample = list(db_only)[:10]
        for s in sample:
            print(f" - {s}")

if __name__ == "__main__":
    cross_validate()
