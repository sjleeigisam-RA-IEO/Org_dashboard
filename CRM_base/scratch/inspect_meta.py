import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def inspect_metadata():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    res = supabase.table('funds').select('fund_id, metadata').limit(100).execute()
    
    found_parents = 0
    for f in res.data:
        meta = f['metadata'] or {}
        p_id = meta.get('parent_fund_id')
        if p_id:
            found_parents += 1
            print(f"ID: {f['fund_id']} | Parent: {p_id}")
            
    print(f"\nChecked 100 rows, found {found_parents} parent references.")
    
    # If found_parents is 0, let's see all keys in metadata
    if found_parents == 0:
        print("\nMetadata Keys available in sample:")
        all_keys = set()
        for f in res.data:
            if f['metadata']:
                all_keys.update(f['metadata'].keys())
        print(list(all_keys))

if __name__ == "__main__":
    inspect_metadata()
