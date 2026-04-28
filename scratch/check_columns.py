import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(url, key)

res = supabase.table('fund_assets').select('*').limit(1).execute()
if res.data:
    print("Columns:", res.data[0].keys())
else:
    print("No data in fund_assets")
