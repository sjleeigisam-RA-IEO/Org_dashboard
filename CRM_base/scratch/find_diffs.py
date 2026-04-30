import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def find_major_diffs():
    # 1. Load Excel (The new 'Actual' source)
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    df_excel = pd.read_excel(excel_path, header=0)
    
    # 2. Load DB Exposures (Yesterday's source)
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    lenders = supabase.table('lender_exposures').select('fund_id, drawn_amt').execute().data
    bens = supabase.table('beneficiary_exposures').select('fund_id, invested_amt').execute().data
    
    db_sums = {}
    for l in lenders:
        fid = str(l['fund_id']).strip()
        db_sums[fid] = db_sums.get(fid, 0) + (l['drawn_amt'] or 0)
    for b in bens:
        fid = str(b['fund_id']).strip()
        db_sums[fid] = db_sums.get(fid, 0) + (b['invested_amt'] or 0)

    # 3. Compare with Excel Actual (Column 20)
    diff_list = []
    for _, row in df_excel.iloc[1:].iterrows():
        fid = str(row.iloc[0]).strip()
        if not fid or fid == 'nan' or '합계' in fid: continue
        
        excel_actual = pd.to_numeric(row.iloc[20], errors='coerce') or 0
        db_actual = db_sums.get(fid, 0)
        
        diff = excel_actual - db_actual
        if diff > 100000000000: # 1,000억 이상 차이나는 것들만
            diff_list.append({
                "펀드코드": fid,
                "펀드명": row.iloc[1],
                "엑셀_실행액": excel_actual,
                "DB_집계액": db_actual,
                "차이(증가분)": diff
            })

    # 4. Sort and Report
    df_diff = pd.DataFrame(diff_list).sort_values("차이(증가분)", ascending=False)
    
    print(f"--- Major Contributors to the 14T Gap ---")
    print(df_diff.head(10).to_string(index=False))
    
    total_increase = df_diff["차이(증가분)"].sum()
    print(f"\nTotal Identified Increase (Top): {total_increase:,.0f}")

if __name__ == "__main__":
    find_major_diffs()
