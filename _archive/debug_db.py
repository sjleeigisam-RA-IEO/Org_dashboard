import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def debug_supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    
    print(f"Connecting to: {url}")
    supabase = create_client(url, key)
    
    tables = ['funds', 'lender_exposures', 'beneficiary_exposures']
    
    for table in tables:
        try:
            print(f"\nChecking table: {table}...")
            # Try to select 1 row
            res = supabase.table(table).select("*").limit(1).execute()
            print(f"Result for {table}: Success (Table exists)")
        except Exception as e:
            print(f"Result for {table}: Failed - {e}")

if __name__ == "__main__":
    debug_supabase()
