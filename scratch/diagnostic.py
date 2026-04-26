import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def diagnostic():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    test_id = 'P00030'
    test_name = '피와이디427프로젝트금융투자'
    
    print(f"Attempting to write: {test_name}")
    supabase.table('funds').update({"fund_name": test_name}).eq('fund_id', test_id).execute()
    
    res = supabase.table('funds').select('fund_name').eq('fund_id', test_id).execute()
    db_val = res.data[0]['fund_name']
    
    print(f"Read back from DB: {db_val}")
    
    if db_val == test_name:
        print("SUCCESS: Encoding is correct in DB.")
    else:
        print("FAILURE: Encoding mismatch in DB.")

if __name__ == "__main__":
    diagnostic()
