import os
from supabase import create_client

def diag():
    url = 'https://qvegpozwrcmspdvjokiz.supabase.co'
    key = 'sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P'
    supabase = create_client(url, key)
    
    # "신한은행" 정확한 매칭을 위해 ilike 사용
    res = supabase.table('lender_exposures').select('*').ilike('lender_clean', '신한은행').execute()
    data = res.data
    
    print(f"총 건수: {len(data)}")
    total_amt = sum(r.get('drawn_amt', 0) or 0 for r in data)
    print(f"총 금액: {total_amt:,}원")
    
    fund_ids = [r['fund_id'] for r in data]
    print(f"포함된 Fund ID들: {fund_ids}")
    
    if 'P00005' in fund_ids:
        print("P00005가 포함되어 있습니다.")
        p5_data = [r for r in data if r['fund_id'] == 'P00005'][0]
        print(f"P00005 상세: {p5_data}")
    else:
        print("P00005가 포함되어 있지 않습니다.")

if __name__ == "__main__":
    diag()
