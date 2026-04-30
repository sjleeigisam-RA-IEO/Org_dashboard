import pandas as pd
import json
import os

def export_history_json():
    file_path = '_archive/펀드 AUM 관리_20251224_all.xlsx'
    df = pd.read_excel(file_path, header=0)
    
    records = []
    for _, row in df.iloc[1:].iterrows():
        fid = str(row.iloc[0]).strip()
        if not fid or fid == 'nan' or '합계' in fid: continue
        
        # Sector Mapping
        raw_sector = str(row.iloc[3])
        sector = "기타"
        if "오피스" in raw_sector or "ǽ" in raw_sector: sector = "오피스"
        elif "물류" in raw_sector or "" in raw_sector: sector = "물류"
        elif "리테일" in raw_sector: sector = "리테일"
        elif "호텔" in raw_sector or "ȣ" in raw_sector: sector = "호텔"
        elif "인프라" in raw_sector: sector = "인프라"
        
        # Region Mapping
        raw_region = str(row.iloc[31])
        region = "국내"
        if "해외" in raw_region or "ؿ" in raw_region: region = "해외"
        
        set_date = pd.to_datetime(row.iloc[7], errors='coerce')
        cancel_date = pd.to_datetime(row.iloc[8], errors='coerce')
        aum = pd.to_numeric(row.iloc[16], errors='coerce') or 0
        
        records.append({
            "region": region,
            "sector": sector,
            "set_date": set_date,
            "cancel_date": cancel_date,
            "aum": aum
        })

    df_master = pd.DataFrame(records)
    
    history_data = []
    for year in range(2010, 2026):
        snapshot_date = pd.Timestamp(year=year, month=12, day=31)
        active = df_master[
            (df_master['set_date'] <= snapshot_date) & 
            ((df_master['cancel_date'].isna()) | (df_master['cancel_date'] > snapshot_date))
        ]
        
        if not active.empty:
            grouped = active.groupby(['region', 'sector']).agg({'aum': 'sum'}).reset_index()
            for _, g in grouped.iterrows():
                history_data.append({
                    "year": year,
                    "region": g['region'],
                    "sector": g['sector'],
                    "aum": int(g['aum'])
                })

    # Save to dashboard/data/aum_history.json
    os.makedirs('dashboard/data', exist_ok=True)
    output_path = 'dashboard/data/aum_history.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)
        
    print(f"Successfully exported {len(history_data)} historical records to {output_path}")

if __name__ == "__main__":
    export_history_json()
