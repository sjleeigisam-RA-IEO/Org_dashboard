import urllib.request
import json

TALLY_API_KEY = "tly-wY7OTYsDWwDCcKtxodlP8dwx4njHQPOz"

def check_tally():
    # 내 워크스페이스의 모든 폼 리스트 조회
    url = "https://api.tally.so/v1/forms"
    headers = {
        "Authorization": f"Bearer {TALLY_API_KEY}",
        "User-Agent": "Mozilla/5.0"
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print("Workspace Access: SUCCESS!")
            forms = data.get("results", [])
            print(f"Found {len(forms)} forms.")
            for f in forms:
                print(f"- {f.get('name')} (ID: {f.get('id')})")
    except Exception as e:
        print(f"Workspace Access: FAILED ({e})")

if __name__ == "__main__":
    check_tally()
