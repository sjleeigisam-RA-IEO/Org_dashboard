import os
from supabase import create_client

def diag():
    url = 'https://qvegpozwrcmspdvjokiz.supabase.co'
    key = 'sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P'
    supabase = create_client(url, key)
    
    lender = '신한캐피탈'
    print(f"--- {lender} DB 진단 ---")
    
    # 1. 대주 노출 내역 조회
    exposures = supabase.table('lender_exposures').select('*').eq('lender_clean', lender).execute().data
    print(f"대주 노출 내역(lender_exposures) 건수: {len(exposures)}")
    
    fund_ids = [e['fund_id'] for e in exposures]
    
    # 2. 펀드 마스터 정보 조회
    funds = supabase.table('funds').select('fund_id, fund_name, setup_date, maturity_date').in_('fund_id', fund_ids).execute().data
    fund_map = {f['fund_id']: f for f in funds}
    
    matched_count = 0
    missing_ids = []
    null_name_ids = []
    null_date_ids = []
    
    for fid in fund_ids:
        if fid in fund_map:
            matched_count += 1
            f = fund_map[fid]
            if not f.get('fund_name'):
                null_name_ids.append(fid)
            if not f.get('setup_date'):
                null_date_ids.append(fid)
        else:
            missing_ids.append(fid)
            
    print(f"funds 테이블 매칭 성공: {matched_count}건")
    print(f"funds 테이블 매칭 실패(ID 없음): {len(missing_ids)}건")
    print(f"명칭(fund_name) 누락: {len(null_name_ids)}건")
    print(f"날짜(setup_date) 누락: {len(null_date_ids)}건")
    
    if missing_ids:
        print(f"미존재 fund_id 예시: {missing_ids[:5]}")
    
    if null_name_ids:
        print(f"명칭 누락 fund_id 예시: {null_name_ids[:5]}")

if __name__ == "__main__":
    diag()
