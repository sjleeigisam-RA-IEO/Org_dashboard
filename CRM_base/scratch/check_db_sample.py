from supabase import create_client
import json

url = 'https://qvegpozwrcmspdvjokiz.supabase.co'
key = 'sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P'
supabase = create_client(url, key)

res = supabase.from_('funds').select('*').limit(5).execute()
print(json.dumps(res.data, indent=2, ensure_ascii=False))
