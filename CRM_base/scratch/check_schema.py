import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def check_schema():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    res = supabase.table('fund_assets').select('*').limit(1).execute()
    if res.data:
        print(list(res.data[0].keys()))
    else:
        print("Table is empty.")

if __name__ == "__main__":
    check_schema()
