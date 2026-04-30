import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_KEY')
supabase = create_client(url, key)

res = supabase.from_('funds').select('fund_name, status, metadata').limit(50).execute()

with open('scratch/db_check_result.txt', 'w', encoding='utf-8') as f:
    f.write("--- Supabase Data Check ---\n")
    for row in res.data:
        name = row.get('fund_name')
        status = row.get('status')
        meta = row.get('metadata', {})
        div = meta.get('division')
        f.write(f"Fund: {name} | Status: {status} | Division: {div}\n")
