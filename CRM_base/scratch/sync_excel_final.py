import pandas as pd
import requests

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def sync_excel():
    # 1. Get current DB data
    r = requests.get(f"{BASE_URL}?select=fund_id,asset_name,address", headers=headers)
    db_data = { (str(a['fund_id']), str(a['asset_name'])): a['address'] for a in r.json() }
    
    # 2. Load Excel
    excel_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]주소_보완_대상_리스트.xlsx"
    df = pd.read_excel(excel_path)
    
    # 3. Update
    def update_addr(row):
        fid = str(row['펀드코드']).strip()
        name = str(row['자산명']).strip()
        return db_data.get((fid, name), row['주소(보완용)'])
    
    df['주소(보완용)'] = df.apply(update_addr, axis=1)
    
    # 4. Save
    df.to_excel(excel_path, index=False)
    print("Excel Synced Successfully.")

if __name__ == "__main__":
    sync_excel()
