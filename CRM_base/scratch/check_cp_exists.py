import os
from dotenv import dotenv_values
from supabase import create_client

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

def check_counterparties_table():
    try:
        res = supabase.table('counterparties').select('count', count='exact').limit(1).execute()
        print(f"Table 'counterparties' exists. Count: {res.count}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_counterparties_table()
