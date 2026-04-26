import os
from supabase import create_client, Client
from dotenv import load_dotenv
import pandas as pd

load_dotenv()

def analyze_hierarchy_v2():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    res = supabase.table('funds').select('fund_id, metadata').execute()
    data = res.data
    
    # 1. Build a clean ID set
    id_list = [str(f['fund_id']).strip() for f in data]
    id_set = set(id_list)
    
    # 2. Track Feeders
    feeders = []
    matches = 0
    
    for f in data:
        f_id = str(f['fund_id']).strip()
        meta = f['metadata'] or {}
        p_id = str(meta.get('parent_fund_id', '')).strip()
        
        if p_id and p_id != 'None' and p_id != f_id:
            # Check if parent exists in our DB
            if p_id in id_set:
                feeders.append({
                    "feeder": f_id,
                    "master": p_id
                })
                matches += 1
            else:
                # Parent specified but not in DB
                pass

    print(f"========== HIERARCHY AUDIT V2 ==========")
    print(f"Total Funds in DB: {len(id_list)}")
    print(f"Total Feeders identified: {len(feeders)}")
    
    if len(feeders) > 0:
        print("\nFound Master-Feeder Pairs (Top 10):")
        for item in feeders[:10]:
            print(f" - {item['feeder']} -> Master: {item['master']}")
            
    print(f"\nConclusion: {len(id_list) - len(feeders)} Independent/Master funds for AUM.")
    print("=========================================")

if __name__ == "__main__":
    analyze_hierarchy_v2()
