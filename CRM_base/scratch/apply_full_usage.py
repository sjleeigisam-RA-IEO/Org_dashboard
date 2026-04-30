import pandas as pd
import requests

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"
headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json"
}

def update_from_comprehensive_list():
    target_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]미지정_자산_전수_리스트.xlsx"
    df = pd.read_excel(target_path)
    
    # Filter only items with input
    df = df[df['예정용도(입력용)'].notnull() & (df['예정용도(입력용)'].astype(str).str.strip() != '')]
    
    success_count = 0
    for _, row in df.iterrows():
        fid = str(row['펀드코드']).strip()
        name = str(row['자산명']).strip()
        usage = str(row['예정용도(입력용)']).strip()
        
        # Use primary key matching: fund_id AND asset_name
        params = {"fund_id": f"eq.{fid}", "asset_name": f"eq.{name}"}
        res = requests.patch(BASE_URL, params=params, json={"main_usage": usage}, headers=headers)
        
        if res.status_code in [200, 204]:
            # print(f"Updated: {name} -> {usage}")
            success_count += 1
        else:
            print(f"Failed: {name} ({res.status_code})")
            
    print(f"\nSuccessfully updated {success_count} assets with new usage classification.")

if __name__ == "__main__":
    update_from_comprehensive_list()
