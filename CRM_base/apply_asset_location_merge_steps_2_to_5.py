from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
PLAN_CSV = OUTPUT_DIR / "asset_location_merge_plan.csv"
BACKUP_DIR = OUTPUT_DIR / "merge_backups"

STEP_ACTIONS = {
    2: {"update_asset_master_then_fetch_ledger"},
    3: {"link_existing_underlying_asset_by_pnu", "link_existing_underlying_asset_same_asset_pnu"},
    4: {"create_underlying_asset_then_fetch_ledger"},
    5: {"create_or_link_underlying_asset_name_only", "hold_name_only_no_location"},
}


def load_env() -> dict[str, str]:
    values = {}
    for line in (PROJECT_DIR / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"", "none", "null", "nan", "-"} else text


def as_float(value):
    text = clean(value)
    if not text:
        return None
    return float(text.replace(",", ""))


def split_ids(value) -> list[str]:
    ids = [clean(part) for part in clean(value).split("|")]
    return [part for part in ids if part]


def make_asset_id(group_key: str) -> str:
    digest = hashlib.sha1(group_key.encode("utf-8")).hexdigest()[:12]
    return f"ast_{digest}"


def fetch_all(client, table: str, select: str = "*") -> list[dict]:
    rows = []
    start = 0
    size = 1000
    while True:
        batch = (
            client.table(table)
            .select(select)
            .range(start, start + size - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def row_key(row: dict) -> str:
    return clean(row.get("fund_assets_id")) or ":".join(
        [
            clean(row.get("source_fund_code")),
            clean(row.get("source_seq")),
            clean(row.get("accepted_asset_name")),
        ]
    )


def best_name(rows: list[dict]) -> str:
    names = [clean(row.get("accepted_asset_name")) for row in rows if clean(row.get("accepted_asset_name"))]
    if not names:
        return "Unnamed Asset"
    counts = Counter(names)
    return sorted(counts, key=lambda name: (-counts[name], -len(name), name))[0]


def source_fund_ids(row: dict) -> list[str]:
    ids = []
    source = clean(row.get("source_fund_code"))
    if source:
        ids.append(source)
    ids.extend(split_ids(row.get("linked_fund_ids")))
    return list(dict.fromkeys(ids))


def location_payload(row: dict, include_status: bool = False) -> dict:
    payload = {}
    name = clean(row.get("accepted_asset_name"))
    address = clean(row.get("proposed_address"))
    pnu = clean(row.get("proposed_pnu"))
    lat = as_float(row.get("proposed_latitude"))
    lng = as_float(row.get("proposed_longitude"))
    if name:
        payload["canonical_name"] = name
    if address:
        payload["address_text"] = address
    if pnu:
        payload["pnu"] = pnu
    if lat is not None:
        payload["latitude"] = lat
    if lng is not None:
        payload["longitude"] = lng
    if lat is not None and lng is not None:
        payload["geocode_source"] = "deal_board_domestic_completed_20240812"
    if include_status and pnu:
        payload["api_enrichment_status"] = "needs_building_ledger_fetch"
    return payload


def asset_master_insert(asset_id: str, rows: list[dict], name_only: bool = False) -> dict:
    first = rows[0]
    lat = None if name_only else as_float(first.get("proposed_latitude"))
    lng = None if name_only else as_float(first.get("proposed_longitude"))
    pnu = "" if name_only else clean(first.get("proposed_pnu"))
    metadata = {
        "created_by": "asset_location_merge_steps_2_to_5",
        "source_merge_actions": sorted({clean(row.get("merge_action")) for row in rows if clean(row.get("merge_action"))}),
        "source_row_keys": [row_key(row) for row in rows],
        "source_asset_ids": sorted({clean(row.get("asset_id")) for row in rows if clean(row.get("asset_id"))}),
        "source_fund_codes": sorted({clean(row.get("source_fund_code")) for row in rows if clean(row.get("source_fund_code"))}),
        "built_at": datetime.now(timezone.utc).isoformat(),
    }
    return {
        "asset_id": asset_id,
        "canonical_name": best_name(rows),
        "asset_type": clean(first.get("source_investment_asset_type")) or clean(first.get("source_asset_category")) or None,
        "country_code": "KR" if pnu or clean(first.get("proposed_address")) else None,
        "address_text": None if name_only else clean(first.get("proposed_address")) or None,
        "latitude": lat,
        "longitude": lng,
        "pnu": pnu or None,
        "source_confidence": 0.9 if pnu else 0.55,
        "review_status": "auto_created" if pnu else "needs_review",
        "representative_source": "asset_location_merge_plan",
        "representative_fund_id": clean(first.get("source_fund_code")) or None,
        "metadata": metadata,
        "geocode_source": None if name_only else "deal_board_domestic_completed_20240812",
        "api_enrichment_status": "needs_building_ledger_fetch" if pnu else "name_only_no_location",
        "is_physical": bool(pnu or clean(first.get("proposed_address"))),
        "is_synthetic": False,
        "asset_kind": "underlying_asset",
        "manual_input_required": not bool(pnu),
        "data_completeness": "location_pending" if name_only else "ledger_pending",
    }


def ledger_from_fund_asset(fund_asset: dict, target_asset_id: str, source_id: str) -> dict | None:
    metadata = fund_asset.get("metadata") if isinstance(fund_asset.get("metadata"), dict) else {}
    ledger = metadata.get("building_ledger") if isinstance(metadata.get("building_ledger"), dict) else {}
    pnu = clean(metadata.get("pnu") or ledger.get("pnu"))
    if not ledger or not pnu:
        return None
    return {
        "asset_id": target_asset_id,
        "pnu": pnu,
        "site_area": fund_asset.get("site_area") or ledger.get("site_area"),
        "gross_floor_area": fund_asset.get("gross_floor_area") or fund_asset.get("gfa") or ledger.get("gfa"),
        "scr": fund_asset.get("scr") or ledger.get("scr"),
        "far": fund_asset.get("far") or ledger.get("far"),
        "main_usage": fund_asset.get("main_usage") or ledger.get("main_usage"),
        "structure": fund_asset.get("structure") or ledger.get("structure"),
        "floors_up": fund_asset.get("floors_up") or ledger.get("floors_up"),
        "floors_down": fund_asset.get("floors_down") or ledger.get("floors_down"),
        "elevators": fund_asset.get("elevators") or ledger.get("elevators"),
        "parking": fund_asset.get("parking") or ledger.get("parking"),
        "height": fund_asset.get("height") or ledger.get("height"),
        "completion_date": fund_asset.get("completion_date") or ledger.get("completion_date"),
        "raw_ledger": ledger,
        "source_table": "fund_assets",
        "source_id": source_id,
        "confidence": 0.95,
    }


def link_payload(asset_id: str, fund_id: str, row: dict, relation_type: str = "underlying_asset") -> dict:
    return {
        "asset_id": asset_id,
        "fund_id": fund_id,
        "relation_type": relation_type,
        "source_table": "asset_location_merge_plan",
        "source_id": row_key(row),
        "confidence": 0.9,
        "metadata": {
            "merge_action": clean(row.get("merge_action")),
            "source_asset_id": clean(row.get("asset_id")),
            "accepted_asset_name": clean(row.get("accepted_asset_name")),
            "proposed_pnu": clean(row.get("proposed_pnu")),
        },
        "exposure_role": "underlying",
        "directness": "direct",
        "allocation_status": "needs_review",
        "include_in_asset_aum": True,
        "needs_allocation_review": True,
    }


def existing_link(links: set[tuple[str, str]], asset_id: str, fund_id: str) -> bool:
    return (asset_id, fund_id) in links


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", default="2,3,4,5", help="Comma-separated step numbers. Default: 2,3,4,5")
    parser.add_argument("--apply", action="store_true", help="Apply updates to Supabase. Defaults to dry-run.")
    args = parser.parse_args()

    requested_steps = {int(part.strip()) for part in args.steps.split(",") if part.strip()}
    actions = set().union(*(STEP_ACTIONS[step] for step in requested_steps))

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])

    with PLAN_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        plan_rows = [row for row in csv.DictReader(handle) if row.get("merge_action") in actions]

    asset_master = fetch_all(client, "asset_master", "asset_id,canonical_name,address_text,pnu,latitude,longitude,metadata")
    asset_by_id = {row["asset_id"]: row for row in asset_master if row.get("asset_id")}
    assets_by_pnu = defaultdict(list)
    for row in asset_master:
        pnu = clean(row.get("pnu"))
        if pnu:
            assets_by_pnu[pnu].append(row)

    fund_assets = fetch_all(client, "fund_assets", "id,fund_id,asset_id,asset_name,address,lat,lng,metadata,site_area,gross_floor_area,gfa,scr,far,main_usage,structure,floors_up,floors_down,elevators,parking,height,completion_date")
    fund_asset_by_id = {str(row["id"]): row for row in fund_assets if row.get("id") is not None}
    existing_fund_links = {
        (row.get("asset_id"), row.get("fund_id"))
        for row in fetch_all(client, "asset_fund_links", "asset_id,fund_id")
        if row.get("asset_id") and row.get("fund_id")
    }
    existing_ledgers = {
        (row.get("asset_id"), row.get("pnu"))
        for row in fetch_all(client, "asset_building_ledger", "asset_id,pnu")
        if row.get("asset_id") and row.get("pnu")
    }

    asset_updates = []
    asset_inserts_by_id = {}
    ledger_inserts_by_key = {}
    fund_link_inserts_by_key = {}
    fund_asset_updates = {}
    hold_rows = []
    plan_details = []

    for row in plan_rows:
        action = row["merge_action"]
        source_asset_id = clean(row.get("asset_id"))
        proposed_pnu = clean(row.get("proposed_pnu"))

        if action == "update_asset_master_then_fetch_ledger":
            payload = location_payload(row, include_status=True)
            asset_updates.append({"asset_id": source_asset_id, "payload": payload})
            fund_asset = fund_asset_by_id.get(clean(row.get("fund_assets_id")))
            ledger = ledger_from_fund_asset(fund_asset or {}, source_asset_id, clean(row.get("fund_assets_id")))
            if ledger and (source_asset_id, ledger["pnu"]) not in existing_ledgers:
                ledger_inserts_by_key[(source_asset_id, ledger["pnu"])] = ledger
            plan_details.append({**row, "target_asset_id": source_asset_id, "planned_operation": "update_asset_master"})
            continue

        if action in {"link_existing_underlying_asset_by_pnu", "link_existing_underlying_asset_same_asset_pnu"}:
            target_asset_id = source_asset_id
            if action == "link_existing_underlying_asset_by_pnu":
                matches = assets_by_pnu.get(proposed_pnu, [])
                target_asset_id = clean(matches[0].get("asset_id")) if matches else ""
            if not target_asset_id:
                plan_details.append({**row, "target_asset_id": "", "planned_operation": "skip_no_existing_pnu_asset"})
                continue
            for fund_id in source_fund_ids(row):
                if not existing_link(existing_fund_links, target_asset_id, fund_id):
                    fund_link_inserts_by_key[(target_asset_id, fund_id)] = link_payload(target_asset_id, fund_id, row)
            fund_asset_id = clean(row.get("fund_assets_id"))
            if fund_asset_id and fund_asset_by_id.get(fund_asset_id, {}).get("asset_id") != target_asset_id:
                fund_asset_updates[fund_asset_id] = {"id": fund_asset_id, "asset_id": target_asset_id}
            plan_details.append({**row, "target_asset_id": target_asset_id, "planned_operation": "link_existing_asset"})
            continue

        if action == "create_underlying_asset_then_fetch_ledger":
            if not proposed_pnu:
                plan_details.append({**row, "target_asset_id": "", "planned_operation": "skip_missing_pnu"})
                continue
            target_asset_id = make_asset_id(f"pnu:{proposed_pnu}")
            plan_details.append({**row, "target_asset_id": target_asset_id, "planned_operation": "create_or_reuse_pnu_asset"})
            continue

        if action == "create_or_link_underlying_asset_name_only":
            target_asset_id = make_asset_id(f"name_only:{source_asset_id}:{clean(row.get('accepted_asset_name'))}")
            plan_details.append({**row, "target_asset_id": target_asset_id, "planned_operation": "create_or_reuse_name_only_asset"})
            continue

        if action == "hold_name_only_no_location":
            hold_rows.append(row)
            plan_details.append({**row, "target_asset_id": source_asset_id, "planned_operation": "hold_no_db_write"})

    grouped_create_pnu = defaultdict(list)
    grouped_create_name = defaultdict(list)
    for detail in plan_details:
        if detail.get("planned_operation") == "create_or_reuse_pnu_asset":
            grouped_create_pnu[detail["target_asset_id"]].append(detail)
        elif detail.get("planned_operation") == "create_or_reuse_name_only_asset":
            grouped_create_name[detail["target_asset_id"]].append(detail)

    for target_asset_id, rows in grouped_create_pnu.items():
        if target_asset_id not in asset_by_id:
            asset_inserts_by_id[target_asset_id] = asset_master_insert(target_asset_id, rows)
        for row in rows:
            for fund_id in source_fund_ids(row):
                if not existing_link(existing_fund_links, target_asset_id, fund_id):
                    fund_link_inserts_by_key[(target_asset_id, fund_id)] = link_payload(target_asset_id, fund_id, row)
            fund_asset_id = clean(row.get("fund_assets_id"))
            if fund_asset_id and fund_asset_by_id.get(fund_asset_id, {}).get("asset_id") != target_asset_id:
                fund_asset_updates[fund_asset_id] = {"id": fund_asset_id, "asset_id": target_asset_id}
            fund_asset = fund_asset_by_id.get(fund_asset_id)
            ledger = ledger_from_fund_asset(fund_asset or {}, target_asset_id, fund_asset_id)
            if ledger and (target_asset_id, ledger["pnu"]) not in existing_ledgers:
                ledger_inserts_by_key[(target_asset_id, ledger["pnu"])] = ledger

    for target_asset_id, rows in grouped_create_name.items():
        if target_asset_id not in asset_by_id:
            asset_inserts_by_id[target_asset_id] = asset_master_insert(target_asset_id, rows, name_only=True)
        for row in rows:
            for fund_id in source_fund_ids(row):
                if not existing_link(existing_fund_links, target_asset_id, fund_id):
                    fund_link_inserts_by_key[(target_asset_id, fund_id)] = link_payload(
                        target_asset_id, fund_id, row, relation_type="name_only_underlying_asset"
                    )
            fund_asset_id = clean(row.get("fund_assets_id"))
            if fund_asset_id and fund_asset_by_id.get(fund_asset_id, {}).get("asset_id") != target_asset_id:
                fund_asset_updates[fund_asset_id] = {"id": fund_asset_id, "asset_id": target_asset_id}

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    details_csv = BACKUP_DIR / f"steps_2_to_5_plan_{timestamp}.csv"
    summary_json = BACKUP_DIR / f"steps_2_to_5_summary_{timestamp}.json"
    write_csv(details_csv, plan_details)

    summary = {
        "mode": "apply" if args.apply else "dry_run",
        "requested_steps": sorted(requested_steps),
        "candidate_rows": len(plan_rows),
        "plan_details_csv": str(details_csv),
        "asset_updates": len(asset_updates),
        "asset_inserts": len(asset_inserts_by_id),
        "ledger_inserts": len(ledger_inserts_by_key),
        "fund_link_inserts": len(fund_link_inserts_by_key),
        "fund_asset_updates": len(fund_asset_updates),
        "hold_rows_no_db_write": len(hold_rows),
        "planned_operations": Counter(row["planned_operation"] for row in plan_details),
        "actions": Counter(row["merge_action"] for row in plan_rows),
    }

    if args.apply:
        for update in asset_updates:
            if update["payload"]:
                client.table("asset_master").update(update["payload"]).eq("asset_id", update["asset_id"]).execute()
        if asset_inserts_by_id:
            client.table("asset_master").upsert(list(asset_inserts_by_id.values()), on_conflict="asset_id").execute()
        if ledger_inserts_by_key:
            client.table("asset_building_ledger").upsert(
                list(ledger_inserts_by_key.values()), on_conflict="asset_id,pnu"
            ).execute()
        for link in fund_link_inserts_by_key.values():
            client.table("asset_fund_links").insert(link).execute()
        for update in fund_asset_updates.values():
            client.table("fund_assets").update({"asset_id": update["asset_id"]}).eq("id", update["id"]).execute()

    summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=dict), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=dict))
    print(str(summary_json))


if __name__ == "__main__":
    main()
