import os
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def update_classifications():
    print("=== [Project & Mission 2.csv] 기반 분류 업데이트 시작 (인덱스 방식) ===")
    
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    # 1. Load CSV
    csv_path = '_archive/Project & Mission 2.csv'
    df = pd.read_csv(csv_path, encoding='utf-8-sig')
    
    # Identify columns by index or partial name
    # 15: Sector, 17: Region, 21: Vehicle
    col_sector = df.columns[15]
    col_region = df.columns[17]
    col_vehicle = df.columns[21]
    
    print(f"매핑 컬럼 식별: Key={col_vehicle}, Sector={col_sector}, Region={col_region}")
    
    mapping_data = []
    for _, row in df.iterrows():
        short_name = str(row[col_vehicle]).strip() if pd.notnull(row[col_vehicle]) else None
        if not short_name or short_name == 'nan':
            continue
            
        sector = str(row[col_sector]).strip() if pd.notnull(row[col_sector]) else '미분류'
        region = str(row[col_region]).strip() if pd.notnull(row[col_region]) else '미분류'
        
        mapping_data.append({
            'short_name': short_name,
            'sector': sector,
            'region': region
        })

    print(f"매핑 대상 데이터: {len(mapping_data)}건 추출 완료")

    # 2. Update Supabase
    updated_count = 0
    # Fetch all funds to avoid multiple queries
    funds_res = supabase.table('funds').select('fund_id, short_name, metadata').execute()
    funds_dict = {}
    for f in funds_res.data:
        sn = f['short_name']
        if sn:
            if sn not in funds_dict:
                funds_dict[sn] = []
            funds_dict[sn].append(f)

    for item in mapping_data:
        sn = item['short_name']
        if sn in funds_dict:
            for fund in funds_dict[sn]:
                fund_id = fund['fund_id']
                meta = fund.get('metadata') or {}
                
                # Update metadata
                meta['sector'] = item['sector']
                meta['region'] = item['region']
                
                # Push update
                supabase.table('funds').update({'metadata': meta}).eq('fund_id', fund_id).execute()
                updated_count += 1

    print(f"✅ 총 {updated_count}개의 펀드 메타데이터가 업데이트되었습니다.")

if __name__ == "__main__":
    update_classifications()
