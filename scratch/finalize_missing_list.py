import requests
import pandas as pd

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def finalize_classification_list():
    # 1. Fetch all assets missing main_usage
    print("Fetching assets missing usage...")
    r = requests.get(f"{BASE_URL}/fund_assets?select=fund_id,asset_name,address,main_usage&main_usage=is.null", headers=headers)
    missing_assets = r.json()
    
    # 2. Search for 816 specifically
    print("Searching for 816...")
    r_all = requests.get(f"{BASE_URL}/fund_assets?select=fund_id,asset_name,main_usage", headers=headers)
    all_data = r_all.json()
    found_816 = [a for a in all_data if '816' in str(a['asset_name'])]
    
    print(f"Found {len(found_816)} assets with '816' in name:")
    for a in found_816:
        print(f"  - {a['asset_name']} ({a['fund_id']}): {a['main_usage']}")

    # 3. Create a COMPREHENSIVE list for the user (all ~300 missing items)
    # Get sector info for reference
    print("Fetching fund sector info...")
    f_mgmt = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\펀드 관리_20260424.xlsx"
    df_mgmt = pd.read_excel(f_mgmt, header=1)
    sector_map = df_mgmt[['펀드코드', '투자섹터']].drop_duplicates().set_index('펀드코드')['투자섹터'].to_dict()
    
    df_missing = pd.DataFrame(missing_assets)
    df_missing = df_missing.rename(columns={'fund_id': '펀드코드', 'asset_name': '자산명', 'address': '현재주소'})
    df_missing['기존 투자섹터(참고용)'] = df_missing['펀드코드'].astype(str).map(sector_map)
    df_missing['예정용도(입력용)'] = ''
    
    cols = ['펀드코드', '자산명', '기존 투자섹터(참고용)', '현재주소', '예정용도(입력용)']
    output_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]미지정_자산_전수_리스트.xlsx"
    df_missing[cols].to_excel(output_path, index=False)
    
    print(f"\nComprehensive list created at: {output_path}")
    print(f"Total items in list: {len(df_missing)}")

if __name__ == "__main__":
    finalize_classification_list()
