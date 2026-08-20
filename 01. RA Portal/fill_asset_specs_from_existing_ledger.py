import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output" / "asset_specs_fill"

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


def choose_ledger_by_pnu(ledgers):
    by_pnu = {}
    for row in ledgers:
        pnu = clean(row.get("pnu"))
        if not pnu:
            continue
        current = by_pnu.get(pnu)
        score = sum(1 for field in SPEC_FIELDS if has_value(row.get(field)))
        if not current or score > current[0]:
            by_pnu[pnu] = (score, row)
    return {pnu: item[1] for pnu, item in by_pnu.items()}


def build_plan(assets, ledgers):
    ledger_by_asset = {row.get("asset_id"): row for row in ledgers if row.get("asset_id")}
    ledger_by_pnu = choose_ledger_by_pnu(ledgers)
    plan = []
    for asset in assets:
        asset_id = asset.get("asset_id")
        pnu = clean(asset.get("pnu"))
        if not pnu:
            continue
        if asset_id in ledger_by_asset:
            source = ledger_by_asset[asset_id]
            source_kind = "same_asset_ledger"
        else:
            source = ledger_by_pnu.get(pnu)
            source_kind = "same_pnu_ledger"
        if not source:
            continue
        fill_fields = [field for field in SPEC_FIELDS if not has_value(asset.get(field)) and has_value(source.get(field))]
        if not fill_fields and asset_id in ledger_by_asset:
            continue
        plan.append(
            {
                "asset_id": asset_id,
                "canonical_name": asset.get("canonical_name") or "",
                "pnu": pnu,
                "source_asset_id": source.get("asset_id") or "",
                "source_kind": source_kind,
                "fill_fields": ",".join(fill_fields),
                "fill_count": len(fill_fields),
                **{f"new_{field}": source.get(field) for field in SPEC_FIELDS if field in fill_fields},
            }
        )
    return plan


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def build_ledger_payload(asset_id, source):
    payload = {field: source.get(field) for field in SPEC_FIELDS}
    raw = source.get("raw_ledger") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = {"raw": raw}
    raw = {
        **(raw if isinstance(raw, dict) else {"raw": raw}),
        "copied_from_asset_id": source.get("asset_id"),
        "copied_at": datetime.now(timezone.utc).isoformat(),
    }
    payload.update(
        {
            "asset_id": asset_id,
            "pnu": source.get("pnu"),
            "raw_ledger": raw,
            "source_table": source.get("source_table") or "asset_building_ledger",
            "source_id": source.get("source_id") or source.get("asset_id"),
            "confidence": source.get("confidence") or 0.9,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    return payload


def apply_plan(env, plan, assets, ledgers):
    asset_by_id = {row["asset_id"]: row for row in assets}
    source_by_asset = {row.get("asset_id"): row for row in ledgers}
    source_by_pnu = choose_ledger_by_pnu(ledgers)
    applied = []
    for item in plan:
        asset_id = item["asset_id"]
        asset = asset_by_id[asset_id]
        if item["source_kind"] == "same_asset_ledger":
            source = source_by_asset[item["source_asset_id"]]
        else:
            source = source_by_pnu[item["pnu"]]
            upsert_ledger(env, build_ledger_payload(asset_id, source))

        payload = {}
        for field in SPEC_FIELDS:
            if not has_value(asset.get(field)) and has_value(source.get(field)):
                payload[field] = source.get(field)
        if payload:
            payload["building_ledger_source"] = item["source_kind"]
            payload["last_api_enriched_at"] = datetime.now(timezone.utc).isoformat()
            payload["updated_at"] = datetime.now(timezone.utc).isoformat()
            patch_asset(env, asset_id, payload)
        applied.append({**item, "applied_fields": ",".join(payload.keys())})
    return applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    env = load_env()
    asset_select = ",".join(["asset_id", "canonical_name", "pnu", "building_ledger_source", "api_enrichment_status"] + SPEC_FIELDS)
    assets = fetch_all(env, "asset_master", asset_select)
    ledgers = fetch_all(env, "asset_building_ledger", "*")
    plan = build_plan(assets, ledgers)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    plan_path = OUT_DIR / f"asset_specs_fill_plan_{stamp}.csv"
    write_csv(plan_path, plan)

    summary = {
        "assets_with_pnu": sum(1 for row in assets if has_value(row.get("pnu"))),
        "existing_ledger_rows": len(ledgers),
        "planned_assets": len(plan),
        "planned_field_fills": sum(int(row["fill_count"]) for row in plan),
        "same_asset_ledger": sum(1 for row in plan if row["source_kind"] == "same_asset_ledger"),
        "same_pnu_ledger": sum(1 for row in plan if row["source_kind"] == "same_pnu_ledger"),
        "plan_path": str(plan_path),
    }

    if args.apply:
        applied = apply_plan(env, plan, assets, ledgers)
        applied_path = OUT_DIR / f"asset_specs_fill_applied_{stamp}.csv"
        write_csv(applied_path, applied)
        summary["applied_assets"] = len(applied)
        summary["applied_path"] = str(applied_path)

    summary_path = OUT_DIR / f"asset_specs_fill_summary_{stamp}.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
