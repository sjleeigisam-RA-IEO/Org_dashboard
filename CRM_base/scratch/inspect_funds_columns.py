import os
from dotenv import dotenv_values
from supabase import create_client

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

def inspect():
    # Fetch 1 row to see all columns
    res = supabase.table('funds').select('*').limit(1).execute()
    if res.data:
        print("Columns in 'funds':", res.data[0].keys())
    else:
        print("No data in 'funds' table.")

    # Also check if there's a table for stakeholders/lenders
    # Maybe 'fund_entities' or something similar
    print("\nChecking for potential stakeholder tables...")
    
if __name__ == "__main__":
    inspect()
