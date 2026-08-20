import argparse
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import requests


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "asset_specs_hub_fill"
HUB_URL = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo"

SPEC_FIELDS = [
    "site_area",
    "gross_floor_area",
    "scr",
    "far",
    "main_usage",
    "structure",
    "floors_up",
    "floors_down",
    "elevators",
    "parking",
    "height",
    "completion_date",
]


def load_env():
    env_path = ROOT.parent / ".env"
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def clean(value):
    if value is None:
        return ""
    return str(value).strip()


def has_value(value):
    value = clean(value)
    return bool(value and value != "-")


def number(value):
    value = clean(value)
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def integer(value):
    value = clean(value)
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def yyyymmdd(value):
    value = clean(value)
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:]}"
    return None


def api_json(url, headers=None, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urlopen(req, timeout=30) as res:
            body = res.read().decode("utf-8")
            return json.loads(body) if body else None
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def supabase_headers(env, write=False):
    headers = {
        "apikey": env["SUPABASE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_KEY']}",
    }
    if write:
        headers.update({"Content-Type": "application/json", "Prefer": "return=representation"})
    return headers


def fetch_all(env, table, select):
    base = env["SUPABASE_URL"].rstrip("/")
    rows = []
    offset = 0
    while True:
        query = urlencode({"select": select, "offset": offset, "limit": 1000})
        data = api_json(f"{base}/rest/v1/{table}?{query}", supabase_headers(env))
        rows.extend(data)
        if len(data) < 1000:
            break
        offset += 1000
    return rows


def patch_asset(env, asset_id, payload):
    base = env["SUPABASE_URL"].rstrip("/")
    query = urlencode({"asset_id": f"eq.{asset_id}"})
    return api_json(
        f"{base}/rest/v1/asset_master?{query}",
        supabase_headers(env, write=True),
        method="PATCH",
        payload=payload,
    )


def upsert_ledger(env, payload):
    base = env["SUPABASE_URL"].rstrip("/")
    query = urlencode({"on_conflict": "asset_id"})
    return api_json(
        f"{base}/rest/v1/asset_building_ledger?{query}",
        {**supabase_headers(env, write=True), "Prefer": "resolution=merge-duplicates,return=representation"},
        method="POST",
        payload=[payload],
    )


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)
    if not fieldnames:
        fieldnames = ["empty"]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def pnu_params(pnu):
    pnu = clean(pnu)
    if len(pnu) < 19 or not pnu[:19].isdigit():
        return None
    plat_code = pnu[10]
    return {
        "sigunguCd": pnu[:5],
        "bjdongCd": pnu[5:10],
        "platGbCd": "1" if plat_code == "2" else "0",
        "bun": pnu[11:15],
        "ji": pnu[15:19],
        "numOfRows": "100",
        "pageNo": "1",
        "_type": "json",
    }


def normalize_items(items):
    if not items:
        return []
    item = items.get("item") if isinstance(items, dict) else items
    if item is None:
        return []
    return item if isinstance(item, list) else [item]


def item_score(item):
    main_bonus = 1_000_000 if clean(item.get("mainAtchGbCd")) == "0" or clean(item.get("mainAtchGbCdNm")) == "주건축물" else 0
    title_bonus = 10_000 if clean(item.get("regstrKindCd")) == "2" or "표제부" in clean(item.get("regstrKindCdNm")) else 0
    area = number(item.get("totArea")) or 0
    return main_bonus + title_bonus + area


def choose_item(items):
    if not items:
        return None
    return sorted(items, key=item_score, reverse=True)[0]


def parking_text(item):
    indoor = sum(integer(item.get(field)) or 0 for field in ["indrMechUtcnt", "indrAutoUtcnt"])
    outdoor = sum(integer(item.get(field)) or 0 for field in ["oudrMechUtcnt", "oudrAutoUtcnt"])
    if indoor or outdoor:
        return f"옥내 {indoor} / 옥외 {outdoor}"
    return None


def parse_hub_item(item):
    elevators = (integer(item.get("rideUseElvtCnt")) or 0) + (integer(item.get("emgenUseElvtCnt")) or 0)
    parsed = {
        "site_area": number(item.get("platArea")),
        "gross_floor_area": number(item.get("totArea")),
        "scr": number(item.get("bcRat")),
        "far": number(item.get("vlRat")),
        "main_usage": clean(item.get("mainPurpsCdNm")) or clean(item.get("etcPurps")) or None,
        "structure": clean(item.get("strctCdNm")) or clean(item.get("etcStrct")) or None,
        "floors_up": integer(item.get("grndFlrCnt")),
        "floors_down": integer(item.get("ugrndFlrCnt")),
        "elevators": elevators or None,
        "parking": parking_text(item),
        "height": number(item.get("heit")),
        "completion_date": yyyymmdd(item.get("useAprDay")) or yyyymmdd(item.get("stcnsDay")) or yyyymmdd(item.get("pmsDay")),
    }
    return {key: value for key, value in parsed.items() if has_value(value)}


def fetch_hub_by_pnu(service_key, pnu):
    params = pnu_params(pnu)
    if not params:
        return {"status": "invalid_pnu", "items": [], "selected": None, "parsed": {}, "raw": None}
    params["serviceKey"] = service_key
    response = requests.get(HUB_URL, params=params, timeout=30)
    if response.status_code != 200:
        return {
            "status": f"http_{response.status_code}",
            "items": [],
            "selected": None,
            "parsed": {},
            "raw": {"text": response.text[:1000]},
        }
    try:
        data = response.json()
    except ValueError:
        return {"status": "invalid_json", "items": [], "selected": None, "parsed": {}, "raw": {"text": response.text[:1000]}}
    header = ((data.get("response") or {}).get("header") or {})
    result_code = clean(header.get("resultCode"))
    body = (data.get("response") or {}).get("body") or {}
    items = normalize_items(body.get("items"))
    selected = choose_item(items)
    parsed = parse_hub_item(selected) if selected else {}
    status = "found" if result_code == "00" and selected else ("not_found" if result_code == "00" else f"api_{result_code or 'unknown'}")
    return {"status": status, "items": items, "selected": selected, "parsed": parsed, "raw": data}


def build_targets(assets, limit=None):
    targets = []
    for asset in assets:
        if not has_value(asset.get("pnu")):
            continue
        missing = [field for field in SPEC_FIELDS if not has_value(asset.get(field))]
        if missing:
            targets.append({**asset, "_missing_fields": missing})
        if limit and len(targets) >= limit:
            break
    return targets


def build_ledger_payload(asset, result):
    selected = result["selected"] or {}
    parsed = result["parsed"]
    now = datetime.now(timezone.utc).isoformat()
    return {
        **{field: parsed.get(field) for field in SPEC_FIELDS},
        "asset_id": asset["asset_id"],
        "pnu": asset.get("pnu"),
        "raw_ledger": {
            "provider": "data.go.kr",
            "service": "BldRgstHubService",
            "endpoint": "getBrTitleInfo",
            "selected_item": selected,
            "item_count": len(result["items"]),
            "fetched_at": now,
        },
        "source_table": "BldRgstHubService.getBrTitleInfo",
        "source_id": clean(selected.get("mgmBldrgstPk")) or clean(asset.get("pnu")),
        "confidence": 0.95,
        "updated_at": now,
    }


def build_asset_payload(asset, parsed):
    payload = {}
    for field in SPEC_FIELDS:
        if not has_value(asset.get(field)) and has_value(parsed.get(field)):
            payload[field] = parsed[field]
    if payload:
        payload["building_ledger_source"] = "BldRgstHubService.getBrTitleInfo"
        payload["api_enrichment_status"] = "found"
        payload["last_api_enriched_at"] = datetime.now(timezone.utc).isoformat()
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sleep", type=float, default=0.03)
    args = parser.parse_args()

    env = load_env()
    if not env.get("DATA_GO_KR_KEY"):
        raise RuntimeError("DATA_GO_KR_KEY must be set in .env")

    asset_select = ",".join(["asset_id", "canonical_name", "pnu", "api_enrichment_status", "building_ledger_source"] + SPEC_FIELDS)
    assets = fetch_all(env, "asset_master", asset_select)
    targets = build_targets(assets, args.limit)

    pnu_cache = {}
    plan = []
    applied = []
    errors = []

    for index, asset in enumerate(targets, 1):
        pnu = clean(asset.get("pnu"))
        if pnu not in pnu_cache:
            try:
                pnu_cache[pnu] = fetch_hub_by_pnu(env["DATA_GO_KR_KEY"], pnu)
            except Exception as exc:
                pnu_cache[pnu] = {"status": "exception", "items": [], "selected": None, "parsed": {}, "raw": {"error": str(exc)}}
            if args.sleep:
                time.sleep(args.sleep)

        result = pnu_cache[pnu]
        parsed = result["parsed"]
        payload = build_asset_payload(asset, parsed)
        row = {
            "asset_id": asset.get("asset_id"),
            "canonical_name": asset.get("canonical_name") or "",
            "pnu": pnu,
            "status": result["status"],
            "missing_fields": ",".join(asset["_missing_fields"]),
            "fill_fields": ",".join(payload.keys()),
            "item_count": len(result["items"]),
            "selected_mgm_bldrgst_pk": clean((result["selected"] or {}).get("mgmBldrgstPk")),
            **{f"new_{field}": payload.get(field) for field in SPEC_FIELDS if field in payload},
        }
        plan.append(row)

        if args.apply and payload:
            try:
                upsert_ledger(env, build_ledger_payload(asset, result))
                patch_asset(env, asset["asset_id"], payload)
                applied.append({**row, "applied": True})
            except Exception as exc:
                errors.append({**row, "error": str(exc)})

        if index % 50 == 0:
            print(f"processed {index}/{len(targets)}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    plan_path = OUT_DIR / f"asset_specs_hub_plan_{stamp}.csv"
    write_csv(plan_path, plan)

    summary = {
        "asset_rows": len(assets),
        "target_assets_with_pnu_and_missing_specs": len(targets),
        "unique_pnu_queried": len(pnu_cache),
        "found_assets": sum(1 for row in plan if row["status"] == "found"),
        "planned_assets_with_fills": sum(1 for row in plan if has_value(row["fill_fields"])),
        "planned_field_fills": sum(len([field for field in row["fill_fields"].split(",") if field]) for row in plan),
        "plan_path": str(plan_path),
        "status_counts": {},
    }
    for row in plan:
        summary["status_counts"][row["status"]] = summary["status_counts"].get(row["status"], 0) + 1

    if args.apply:
        applied_path = OUT_DIR / f"asset_specs_hub_applied_{stamp}.csv"
        error_path = OUT_DIR / f"asset_specs_hub_errors_{stamp}.csv"
        write_csv(applied_path, applied)
        write_csv(error_path, errors)
        summary.update(
            {
                "applied_assets": len(applied),
                "errors": len(errors),
                "applied_path": str(applied_path),
                "error_path": str(error_path),
            }
        )

    summary_path = OUT_DIR / f"asset_specs_hub_summary_{stamp}.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
