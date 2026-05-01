import os
from dotenv import dotenv_values
from supabase import create_client

# Try to load .env from current or parent directory
env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)

if 'SUPABASE_URL' not in cfg:
    print(f"Error: SUPABASE_URL not found in {os.path.abspath(env_path)}")
    exit(1)

supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

def check_db_status():
    try:
        # Check if table exists and get count
        res = supabase.table('aum_snapshots').select('count', count='exact').limit(1).execute()
        print(f"Table 'aum_snapshots' exists. Current record count: {res.count}")
        
        # Get sample record
        sample = supabase.table('aum_snapshots').select('*').limit(1).execute()
        if sample.data:
            print(f"Sample record: {sample.data[0]}")
        else:
            print("Table is empty.")
            
    except Exception as e:
        print(f"Error checking table: {e}")

if __name__ == "__main__":
    check_db_status()
