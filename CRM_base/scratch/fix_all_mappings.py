import os
import sys
import re
from supabase import create_client

sys.stdout.reconfigure(encoding='utf-8')

url = "https://qvegpozwrcmspdvjokiz.supabase.co"
key = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
supabase = create_client(url, key)

def is_precise_match(pattern, target):
    if not pattern or not target: return False
    if pattern not in target: return False
    p_nums = re.findall(r'(\d+)', pattern)
    t_nums = re.findall(r'(\d+)', target)
    if p_nums:
        for p_num in p_nums:
            if p_num in t_nums: return True
        return False
    return True

print("Fetching ALL master funds...")
all_funds = []
start = 0
while True:
    res = supabase.table("funds").select("*").range(start, start + 999).execute()
    if not res.data: break
    all_funds.extend(res.data)
    start += 1000
print(f"Loaded {len(all_funds)} funds total.")

print("Auditing ALL logs for re-mapping...")
all_logs = []
start = 0
while True:
    res = supabase.table("t5t_form_items").select("form_item_id, project_text, raw_text, matched_fund_id").range(start, start + 999).execute()
    if not res.data: break
    all_logs.extend(res.data)
    start += 1000
print(f"Loaded {len(all_logs)} logs total.")

updates = []
for l in all_logs:
    text_to_search = (l['project_text'] or "") + " " + (l['raw_text'] or "")
    
    new_match_id = None
    for f in all_funds:
        matched = False
        for key in ['fund_name', 'short_name', 'asset_name']:
            val = f.get(key)
            if not val: continue
            
            # "1호", "2호" 같이 너무 짧은 이름은 단독 매칭에서 제외 (과잉 매칭 방지)
            if len(val.strip()) <= 3 and val.strip().endswith("호"):
                continue

            if is_precise_match(val, text_to_search):
                matched = True
                break
        if matched:
            new_match_id = f['fund_id']
            break
            
    if new_match_id != l['matched_fund_id']:
        updates.append({
            "form_item_id": l['form_item_id'],
            "matched_fund_id": new_match_id
        })

print(f"Identified {len(updates)} more records to fix.")

if updates:
    print(f"Executing {len(updates)} updates...")
    for i in range(0, len(updates), 50):
        chunk = updates[i:i+50]
        for item in chunk:
            supabase.table("t5t_form_items").update({"matched_fund_id": item['matched_fund_id']}).eq("form_item_id", item['form_item_id']).execute()
        print(f"Progress: {min(i+50, len(updates))}/{len(updates)}")

print("COMPLETE: Every single log in the database has been audited and fixed.")
