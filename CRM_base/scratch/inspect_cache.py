import json
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

def inspect_cache():
    print("=== 캐시 파일 내부 Raw 데이터 검사 ===")
    
    with open('_archive/geocoding_cache.json', 'r', encoding='utf-8') as f:
        geo = json.load(f)
    print("\n[지오코딩 캐시 첫 번째 항목]")
    first_geo_key = list(geo.keys())[0]
    print(f"Key: {first_geo_key}")
    print(f"Value: {geo[first_geo_key]}")

    with open('_archive/building_cache.json', 'r', encoding='utf-8') as f:
        bld = json.load(f)
    print("\n[건축물대장 캐시 첫 번째 항목]")
    first_bld_key = list(bld.keys())[0]
    print(f"Key: {first_bld_key}")
    print(f"Value: {bld[first_bld_key]}")

if __name__ == "__main__":
    inspect_cache()
