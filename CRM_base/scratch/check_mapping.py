import os
import sys
from supabase import create_client

sys.stdout.reconfigure(encoding='utf-8')

url = "https://qvegpozwrcmspdvjokiz.supabase.co"
key = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
supabase = create_client(url, key)

print("--- Inspecting Fund 1 Logs ---")
# 1호 펀드 ID 찾기
fund = supabase.table("funds").select("fund_id").ilike("fund_name", "%전문투자형사모부동산투자신탁1호%").execute()
if fund.data:
    fid = fund.data[0]['fund_id']
    res = supabase.table("t5t_form_items").select("project_text, raw_text, work_date").eq("matched_fund_id", fid).order("work_date", desc=True).limit(60).execute()
    
    for i, item in enumerate(res.data):
        print(f"[{i+1}] {item['work_date']} | {item['project_text']} | {item['raw_text'][:50]}...")
else:
    print("Fund 1 not found in master data.")
