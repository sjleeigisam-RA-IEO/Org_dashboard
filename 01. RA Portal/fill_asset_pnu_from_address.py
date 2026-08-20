import argparse
import csv
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "asset_pnu_fill"


def load_env():
    env = {}
    for line in (ROOT.parent / ".env").read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def api_get_json(url, headers=None):
    req = Request(url, headers=headers or {})
    with urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def supabase_fetch_all(env, table, select):
    base = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    rows = []
    offset = 0
    while True:
        query = urlencode({"select": select, "offset": offset, "limit": 1000})
        data = api_get_json(f"{base}/rest/v1/{table}?{query}", headers)
        rows.extend(data)
        if len(data) < 1000:
            break
        offset += 1000
    return rows


def supabase_patch(env, table, row_id, payload):
    base = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    query = urlencode({"asset_id": f"eq.{row_id}"})
    req = Request(
        f"{base}/rest/v1/{table}?{query}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="PATCH",
    )
    with urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def clean(value):
    if value is None:
        return ""
    return str(value).strip()


def has_value(value):
    value = clean(value)
    return bool(value and value != "-")


def normalize_address(address):
    text = clean(address)
    text = text.replace("(", " ").replace(")", " ")
    text = re.sub(r"산(?=\d)", "산 ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.split(r"\s+(?:외|및)\s+\d*필지", text)[0].strip()
    text = re.split(r"\s+일원$", text)[0].strip()
    text = text.replace("번지", "").strip()
    return text


def hangul_tokens(text):
    text = normalize_address(text)
    return [token for token in re.split(r"[\s,]+", text) if re.search(r"[가-힣]", token)]


def lot_tokens(text):
    return re.findall(r"(?:산\s*)?\d+(?:-\d+)?", normalize_address(text))


def is_specific_domestic_address(row):
    address = clean(row.get("address_text"))
    if not address:
        return False
    if len(address) < 8:
        return False
    broad = {"대한민국", "국내", "서울", "경기", "부산", "인천", "대구", "대전", "광주", "울산", "세종"}
    if normalize_address(address) in broad:
        return False
    if re.search(r"[A-Za-z]{2,}", address) and not re.search(r"[가-힣]", address):
        return False
    return True


def vworld_search(env, address, category):
    params = {
        "service": "search",
        "request": "search",
        "version": "2.0",
        "crs": "EPSG:4326",
        "size": 5,
        "page": 1,
        "query": address,
        "type": "address",
        "category": category,
        "format": "json",
        "key": env["VWORLD_KEY"],
    }
    url = "https://api.vworld.kr/req/search?" + urlencode(params)
    last_error = None
    for _ in range(3):
        try:
            return api_get_json(url)
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    raise last_error


def candidate_from_item(item, category):
    pnu = clean(item.get("id"))
    address = item.get("address") or {}
    point = item.get("point") or {}
    parcel = clean(address.get("parcel"))
    road = clean(address.get("road"))
    return {
        "pnu": pnu if re.fullmatch(r"\d{19}", pnu) else "",
        "matched_address": parcel or road,
        "matched_road": road,
        "matched_parcel": parcel,
        "matched_full": " ".join(part for part in [parcel, road] if part),
        "longitude": clean(point.get("x")),
        "latitude": clean(point.get("y")),
        "category": category,
    }


def score_candidate(source_address, cand):
    source_tokens = hangul_tokens(source_address)
    matched_tokens = hangul_tokens(cand.get("matched_full") or cand.get("matched_address"))
    matched_text = " ".join(matched_tokens)
    score = 0
    reasons = []

    for token in source_tokens[:4]:
        if token and token in matched_text:
            score += 2
            reasons.append(f"token:{token}")

    source_lots = [lot.replace(" ", "") for lot in lot_tokens(source_address)]
    matched_lots = lot_tokens(cand.get("matched_full") or cand.get("matched_address"))
    matched_lots = [lot.replace(" ", "") for lot in matched_lots]
    common_lots = [lot for lot in source_lots if lot in matched_lots]
    if common_lots:
        score += 4
        reasons.append(f"lot:{common_lots[0]}")

    if cand.get("pnu"):
        score += 1
    if cand.get("category") == "parcel":
        score += 1
    return score, ";".join(reasons)


def find_pnu_for_address(env, address):
    normalized = normalize_address(address)
    candidates = []
    for category in ("parcel", "road"):
        try:
            data = vworld_search(env, normalized, category)
        except Exception as exc:
            return None, f"api_error:{exc}"
        response = data.get("response") or {}
        if response.get("status") != "OK":
            continue
        items = ((response.get("result") or {}).get("items") or [])
        for item in items:
            cand = candidate_from_item(item, category)
            if cand.get("pnu"):
                cand["score"], cand["match_reasons"] = score_candidate(address, cand)
                candidates.append(cand)
        time.sleep(0.03)

    if not candidates:
        return None, "not_found"
    candidates.sort(key=lambda c: (-c["score"], c["category"] != "parcel"))
    best = candidates[0]
    second = candidates[1] if len(candidates) > 1 else None
    if best["score"] < 7:
        return best, "low_confidence"
    return best, "safe"


def build_rows(env, limit=None):
    select = ",".join(
        [
            "asset_id",
            "canonical_name",
            "asset_type",
            "asset_kind",
            "is_physical",
            "address_text",
            "pnu",
            "latitude",
            "longitude",
            "geocode_source",
            "api_enrichment_status",
            "metadata",
        ]
    )
    assets = supabase_fetch_all(env, "asset_master", select)
    targets = [
        row
        for row in assets
        if has_value(row.get("address_text"))
        and not has_value(row.get("pnu"))
        and (row.get("is_physical") is True or row.get("asset_kind") == "physical_asset")
        and is_specific_domestic_address(row)
    ]
    if limit:
        targets = targets[:limit]

    output = []
    for idx, row in enumerate(targets, 1):
        candidate, status = find_pnu_for_address(env, row["address_text"])
        output.append(
            {
                "asset_id": row.get("asset_id"),
                "canonical_name": row.get("canonical_name"),
                "asset_type": row.get("asset_type"),
                "address_text": row.get("address_text"),
                "current_pnu": row.get("pnu") or "",
                "match_status": status,
                "proposed_pnu": (candidate or {}).get("pnu", ""),
                "matched_address": (candidate or {}).get("matched_address", ""),
                "matched_category": (candidate or {}).get("category", ""),
                "match_score": (candidate or {}).get("score", ""),
                "match_reasons": (candidate or {}).get("match_reasons", ""),
                "longitude": (candidate or {}).get("longitude", ""),
                "latitude": (candidate or {}).get("latitude", ""),
            }
        )
        if idx % 25 == 0:
            print(f"checked {idx}/{len(targets)}")
    return targets, output


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys()) if rows else []
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def apply_safe_updates(env, plan_rows):
    applied = []
    for row in plan_rows:
        if row.get("match_status") != "safe" or not row.get("proposed_pnu"):
            continue
        payload = {
            "pnu": row["proposed_pnu"],
            "geocode_source": "vworld_address_search",
            "api_enrichment_status": "pending",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if row.get("longitude"):
            payload["longitude"] = float(row["longitude"])
        if row.get("latitude"):
            payload["latitude"] = float(row["latitude"])
        result = supabase_patch(env, "asset_master", row["asset_id"], payload)
        applied.append({**row, "updated_rows": len(result)})
    return applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    env = load_env()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    targets, plan = build_rows(env, args.limit)
    plan_path = OUT_DIR / f"asset_pnu_fill_plan_{stamp}.csv"
    write_csv(plan_path, plan)

    summary = {
        "candidate_assets": len(targets),
        "safe": sum(1 for row in plan if row["match_status"] == "safe"),
        "low_confidence": sum(1 for row in plan if row["match_status"] == "low_confidence"),
        "ambiguous": sum(1 for row in plan if row["match_status"] == "ambiguous"),
        "not_found": sum(1 for row in plan if row["match_status"] == "not_found"),
        "api_error": sum(1 for row in plan if row["match_status"].startswith("api_error")),
        "plan_path": str(plan_path),
    }

    if args.apply:
        applied = apply_safe_updates(env, plan)
        applied_path = OUT_DIR / f"asset_pnu_fill_applied_{stamp}.csv"
        write_csv(applied_path, applied)
        summary["applied"] = len(applied)
        summary["applied_path"] = str(applied_path)

    summary_path = OUT_DIR / f"asset_pnu_fill_summary_{stamp}.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
