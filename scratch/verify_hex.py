import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def verify_hex():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    res = supabase.table('funds').select('fund_name').eq('fund_id', 'P00030').execute()
    name = res.data[0]['fund_name']
    
    print("Name:", name)
    print("Hex (UTF-8):", name.encode('utf-8').hex())
    # '피' in UTF-8 is ec94bc
    if "ec94bc" in name.encode('utf-8').hex():
        print("CONFIRMED: The character '피' is correctly encoded as UTF-8.")
    else:
        print("WARNING: '피' not found in hex. Actual hex:", name.encode('utf-8').hex())

if __name__ == "__main__":
    verify_hex()
