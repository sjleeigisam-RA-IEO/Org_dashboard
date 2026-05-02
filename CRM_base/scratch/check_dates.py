import os
from dotenv import dotenv_values
from supabase import create_client

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

def check_date_range():
    res = supabase.table('t5t_form_submissions').select('submitted_at').execute()
    dates = [d['submitted_at'] for d in res.data]
    if dates:
        print(f"Min Date: {min(dates)}")
        print(f"Max Date: {max(dates)}")
        print(f"Total Count: {len(dates)}")
    else:
        print("No data found.")

if __name__ == "__main__":
    check_date_range()
