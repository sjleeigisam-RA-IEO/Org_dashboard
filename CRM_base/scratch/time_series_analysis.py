import pandas as pd
import datetime

def analyze_time_series():
    # 1. Load both files
    file_25 = '_archive/펀드 AUM 관리_20251224_all.xlsx'
    file_26 = '_archive/펀드 AUM 관리_20260112.xlsx'
    
    df25 = pd.read_excel(file_25, header=0)
    df26 = pd.read_excel(file_26, header=0)
    
    # 2. Combine and extract key lifecycle data
    # Columns: [0] ID, [1] Name, [7] SetDate, [8] CancelDate, [16] AUM
    def extract_lifecycle(df):
        records = []
        for _, row in df.iloc[1:].iterrows():
            fid = str(row.iloc[0]).strip()
            if not fid or fid == 'nan' or '합계' in fid: continue
            
            set_date = pd.to_datetime(row.iloc[7], errors='coerce')
            cancel_date = pd.to_datetime(row.iloc[8], errors='coerce')
            aum = pd.to_numeric(row.iloc[16], errors='coerce') or 0
            
            records.append({
                "id": fid,
                "name": row.iloc[1],
                "set_date": set_date,
                "cancel_date": cancel_date,
                "aum": aum
            })
        return records

    all_records = extract_lifecycle(df25) + extract_lifecycle(df26)
    df_master = pd.DataFrame(all_records).drop_duplicates(subset=['id'], keep='last')
    
    # 3. Yearly Snapshot (Year-End)
    years = [2020, 2021, 2022, 2023, 2024, 2025]
    results = []
    
    for year in years:
        snapshot_date = pd.Timestamp(year=year, month=12, day=31)
        
        # Active funds on this date
        active = df_master[
            (df_master['set_date'] <= snapshot_date) & 
            ((df_master['cancel_date'].isna()) | (df_master['cancel_date'] > snapshot_date))
        ]
        
        total_aum = active['aum'].sum()
        count = len(active)
        
        results.append({
            "Year": year,
            "AUM(Trillion KRW)": round(total_aum / 1e12, 2),
            "FundCount": count
        })

    # 4. Report
    df_result = pd.DataFrame(results)
    print("========== YEARLY AUM TIME-SERIES ==========")
    print(df_result.to_string(index=False))
    print("\n* 2025년 데이터는 최신 업데이트가 반영된 2026년 초 수치를 기준으로 추정한 결과입니다.")
    print("=============================================")

if __name__ == "__main__":
    analyze_time_series()
