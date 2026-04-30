import os
import json
from supabase import create_client

# Load environment variables (mocking since I don't have direct access to .env in python environment usually, but I'll try to read it)
def get_env():
    env = {}
    try:
        with open('d:\\Project\\00. 2025 RA 기획추진\\03. 부문 내 업무\\00. 부문데이터\\업무시스템\\raw\\CRM_base\\.env', 'r') as f:
            for line in f:
                if '=' in line:
                    key, val = line.strip().split('=', 1)
                    env[key] = val
    except:
        pass
    return env

env = get_env()
url = env.get('SUPABASE_URL')
key = env.get('SUPABASE_KEY')

if not url or not key:
    print("Supabase credentials not found.")
    exit()

supabase = create_client(url, key)

cols = [
    'notion_vehicle_class',
    'sector',
    'notion_investment_strategy_class',
    'notion_business_stage_class',
    'notion_asset_nature_class'
]

def analyze_nulls():
    # Fetch all funds with relevant metadata
    res = supabase.from_('funds').select('fund_id, fund_name, metadata').execute()
    funds = res.data or []
    
    total_count = len(funds)
    print(f"Total Funds: {total_count}")
    
    results = {}
    
    for col in cols:
        null_count = 0
        total_aum_null = 0
        
        for f in funds:
            val = f.get(col) or f.get('metadata', {}).get(col)
            if not val or str(val).strip() == '' or val == '미분류':
                null_count += 1
                # Try to get AUM
                aum = f.get('metadata', {}).get('benchmark_aum')
                if aum:
                    try:
                        # Convert string amount to number if needed (handling typical IGIS format)
                        amt = float(str(aum).replace(',', ''))
                        if abs(amt) < 10000000: # Assuming it might be in 100M units if small
                            amt *= 100000000
                        total_aum_null += amt
                    except:
                        pass
        
        results[col] = {
            "null_count": null_count,
            "null_aum_estimate": total_aum_null / 1e12 # In Jo (trillion)
        }

    print(json.dumps(results, indent=2, ensure_ascii=False))

analyze_nulls()
