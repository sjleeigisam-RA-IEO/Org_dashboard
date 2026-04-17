import json
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
MAIN_JSON = BASE / "seat-layout-data.json"
CCMM_JSON = BASE / "ccmm-seat-layout-data.json"
OUT_JSON = BASE / "seat-layout-ccmm-test-data.json"
OUT_JS = BASE / "seat-layout-ccmm-test-data.js"


def load_json(path: Path):
    with path.open("r", encoding="utf-8-sig") as file:
        return json.load(file)


def main():
    main_data = load_json(MAIN_JSON)
    ccmm_data = load_json(CCMM_JSON)

    merged_floors = []
    seen = set()
    for source in (main_data, ccmm_data):
        for floor in source.get("floors", []):
            floor_code = floor.get("floorCode")
            if floor_code in seen:
                continue
            merged_floors.append(floor)
            seen.add(floor_code)

    payload = {
        "meta": {
            "sourceWorkbook": "seat-layout-data + CCMM",
            "generatedAt": ccmm_data.get("meta", {}).get("generatedAt") or main_data.get("meta", {}).get("generatedAt"),
            "floorOrder": ["13F", "12F", "2F", "CCMM11F"],
        },
        "floors": merged_floors,
    }

    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_JS.write_text(
        "window.SEAT_LAYOUT_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(OUT_JSON)
    print(OUT_JS)


if __name__ == "__main__":
    main()
