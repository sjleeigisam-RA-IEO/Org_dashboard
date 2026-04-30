import requests

URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets?select=*&limit=1"
KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}"
}

response = requests.get(URL, headers=headers)
if response.status_code == 200:
    data = response.json()
    if data:
        print("Columns in 'fund_assets' table:")
        for col in data[0].keys():
            print(f"- {col}")
    else:
        print("Table 'fund_assets' is empty.")
else:
    print(f"Error: {response.status_code}")
    print(response.text)
