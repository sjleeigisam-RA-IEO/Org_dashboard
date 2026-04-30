import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_KEY')
supabase = create_client(url, key)

print("--- DB Diagnostic Start ---")
res = supabase.from_('funds').select('*').limit(10).execute()

for f in res.data:
    name = f.get('fund_name')
    status = f.get('status')
    setup = f.get('setup_date')
    meta = f.get('metadata', {})
    aum = meta.get('benchmark_aum')
    equity = meta.get('equity_won')
    loan = meta.get('loan_won')
    
    print(f"[{name}]")
    print(f"  Status: {status}")
    print(f"  Setup:  {setup}")
    print(f"  AUM:    {aum}")
    print(f"  Equity: {equity}")
    print(f"  Loan:   {loan}")
    print("-" * 20)
