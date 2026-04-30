import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_KEY')
supabase = create_client(url, key)

print("--- Final Org Diagnostic ---")
res = supabase.from_('funds').select('fund_name, status, setup_date, metadata').limit(5).execute()

for f in res.data:
    name = f.get('fund_name')
    meta = f.get('metadata', {})
    div = meta.get('division')
    dept = meta.get('department')
    print(f"[{name}]")
    print(f"  Division: {div}")
    print(f"  Dept:     {dept}")
    print("-" * 20)
