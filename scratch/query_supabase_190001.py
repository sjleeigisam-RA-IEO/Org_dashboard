import requests
import json

URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/funds?fund_id=eq.190001&select=*"
KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}"
}

response = requests.get(URL, headers=headers)
if response.status_code == 200:
    data = response.json()
    if data:
        print(json.dumps(data[0], indent=2, ensure_ascii=False))
    else:
        print("Fund 190001 not found in Supabase.")
else:
    print(f"Error: {response.status_code}")
    print(response.text)
