import os
import sys
import re
from supabase import create_client

sys.stdout.reconfigure(encoding='utf-8')

url = "https://qvegpozwrcmspdvjokiz.supabase.co"
key = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
supabase = create_client(url, key)

print("Starting Full Mapping Audit...")
# 한번에 5000건 정도 가져오도록 설정
res = supabase.table("t5t_form_items").select("project_text, funds(fund_name)").range(0, 5000).execute()

discrepancies = []
for item in res.data:
    if not item['funds'] or not item['project_text']: continue
    
    asset_text = item['project_text']
    fund_name = item['funds']['fund_name']
    
    asset_nums = re.findall(r'(\d+)호', asset_text)
    fund_nums = re.findall(r'(\d+)호', fund_name)
    
    if asset_nums and fund_nums:
        if not any(num in fund_nums for num in asset_nums):
            discrepancies.append({
                "asset": asset_text,
                "wrong_fund": fund_name,
                "expected_num": asset_nums[0]
            })

print(f"\nAudit Result: Found {len(discrepancies)} suspected mapping errors.")
if discrepancies:
    print("\n--- Detailed Mismatches ---")
    seen_mismatches = set()
    for d in discrepancies:
        pair = f"{d['asset']} -> {d['wrong_fund']}"
        if pair not in seen_mismatches:
            print(f"Mismatch: [{d['asset']}] incorrectly matched to [{d['wrong_fund']}]")
            seen_mismatches.add(pair)
            if len(seen_mismatches) > 100: break
