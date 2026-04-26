import os
from supabase import create_client, Client
from dotenv import load_dotenv
import re

load_dotenv()

def fix_garbled_names():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    funds = supabase.table('funds').select('fund_id, fund_name, short_name').execute().data
    
    print("--- Checking for Garbled Characters ---")
    garbled_count = 0
    for f in funds:
        fname = f['fund_name'] or ''
        sname = f['short_name'] or ''
        
        # Detect '' or weird ASCII patterns
        if '' in fname or '' in sname or re.search(r'[^\x00-\x7F\uAC00-\uD7A3\s\(\)\[\]\.\,\-\_\/\&\:\;\!]', fname):
            garbled_count += 1
            print(f"ID: {f['fund_id']} | NAME: {fname} | SHORT: {sname}")
            
            # Simple fix: if name is garbled but short name is clean, or vice versa
            # But here we just report to be safe, unless it's obvious
            
    print(f"\nFound {garbled_count} potentially garbled fund names.")

if __name__ == "__main__":
    fix_garbled_names()
