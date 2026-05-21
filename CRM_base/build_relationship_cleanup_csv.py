import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from env_utils import get_required_supabase_config
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
SOURCE_CSV = OUTPUT_DIR / "ra_insight_db_asset_fund_project_relationships_all.csv"
RELATIONSHIP_CLEANUP_CSV = OUTPUT_DIR / "ra_insight_db_asset_fund_project_relationships_cleanup.csv"
ASSET_CLEANUP_CSV = OUTPUT_DIR / "ra_insight_db_asset_name_cleanup_worklist.csv"

VEHICLE_PATTERNS = (
    "투자신탁",
    "사모부동산",
    "일반사모",
    "전문투자형",
    "부동산투자회사",
    "리츠",
    "pfv",
    "피에프브이",
    "spc",
    "유동화전문",
    "수익증권",
    "종류주",
    "대출채권",
    "사채",
    "주주대여",
    "혼합자산투자신탁",
)


def clean_text(value):
    return "" if value is None else str(value).strip()


def normalize_name(value):
    value = clean_text(value).lower()
    value = re.sub(r"\([^)]*\)|\[[^\]]*\]", "", value)
    return re.sub(r"[\s\.,·ㆍ\-_/\\|]+", "", value)


def looks_vehicle_like(value):
    lowered = clean_text(value).lower()
    return any(pattern in lowered for pattern in VEHICLE_PATTERNS)


def is_candidate_name(value):
    return bool(clean_text(value) and len(normalize_name(value)) >= 3)


def is_fund_derived_asset_name(asset_name, fund_row):
    asset_key = normalize_name(asset_name)
    if not asset_key:
        return False

    fund_name_key = normalize_name(fund_row.get("fund_name"))
    if fund_name_key and (
        asset_key == fund_name_key
        or asset_key in fund_name_key
        or fund_name_key in asset_key
    ):
        return True

    short_name_key = normalize_name(fund_row.get("short_name"))
    return bool(
        len(short_name_key) >= 4
        and (asset_key == short_name_key or short_name_key in asset_key)
    )


def split_list_text(value):
    parts = re.split(r"[,;/、]+", clean_text(value))
    return [part.strip() for part in parts if is_candidate_name(part)]


def dedupe_names(values):
    seen = set()
    result = []
    for value in values:
        key = normalize_name(value)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(clean_text(value))
    return result


def fetch_all(client, table, select="*"):
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


def load_database():
    url, key = get_required_supabase_config()
    client = create_client(url, key)
    return {
        "assets": fetch_all(
            client,
            "asset_master",
            "asset_id,canonical_name,asset_type,asset_kind,review_status,representative_fund_id",
        ),
        "funds": fetch_all(
            client,
            "funds",
            "fund_id,fund_name,short_name,asset_name,project_mission_name,status,sector",
        ),
        "projects": fetch_all(
            client,
            "projects",
            "project_id,project_name,project_type,status",
        ),
        "fund_assets": fetch_all(
            client,
            "fund_assets",
            "id,fund_id,asset_id,asset_name,asset_type,address,main_usage",
        ),
        "asset_fund_links": fetch_all(
            client,
            "asset_fund_links",
            "asset_id,fund_id,source_table,source_id,relation_type,confidence",
        ),
        "asset_project_links": fetch_all(
            client,
            "asset_project_links",
            "asset_id,project_id,source_table,source_id,relation_type,confidence",
        ),
        "asset_aliases": fetch_all(
            client,
            "asset_aliases",
            "asset_id,alias_name,alias_type,source_table,source_id,confidence,is_primary",
        ),
    }


def build_indexes(db):
    indexes = {
        "asset_by_id": {
            clean_text(row.get("asset_id")): row
            for row in db["assets"]
            if clean_text(row.get("asset_id"))
        },
        "fund_by_id": {
            clean_text(row.get("fund_id")): row
            for row in db["funds"]
            if clean_text(row.get("fund_id"))
        },
        "project_by_id": {
            clean_text(row.get("project_id")): row
            for row in db["projects"]
            if clean_text(row.get("project_id"))
        },
        "fund_asset_by_id": {
            str(row.get("id")): row
            for row in db["fund_assets"]
            if row.get("id") is not None
        },
        "fund_links_by_asset": defaultdict(list),
        "project_links_by_asset": defaultdict(list),
        "fund_assets_by_fund": defaultdict(list),
        "aliases_by_asset": defaultdict(list),
    }

    for row in db["asset_fund_links"]:
        indexes["fund_links_by_asset"][clean_text(row.get("asset_id"))].append(row)
    for row in db["asset_project_links"]:
        indexes["project_links_by_asset"][clean_text(row.get("asset_id"))].append(row)
    for row in db["fund_assets"]:
        indexes["fund_assets_by_fund"][clean_text(row.get("fund_id"))].append(row)
    for row in db["asset_aliases"]:
        indexes["aliases_by_asset"][clean_text(row.get("asset_id"))].append(row)

    return indexes


def build_candidate_payload(asset_id, indexes):
    asset = indexes["asset_by_id"].get(asset_id, {})
    current_name = clean_text(asset.get("canonical_name"))
    fund_links = indexes["fund_links_by_asset"].get(asset_id, [])
    project_links = indexes["project_links_by_asset"].get(asset_id, [])

    linked_funds = [
        indexes["fund_by_id"].get(clean_text(link.get("fund_id")))
        for link in fund_links
    ]
    linked_funds = [row for row in linked_funds if row]
    is_fallback = any(is_fund_derived_asset_name(current_name, fund) for fund in linked_funds)

    direct_fund_asset_names = []
    direct_fund_asset_details = []
    same_fund_asset_names = []
    fund_asset_field_names = []
    project_names = []
    alias_names = []

    for link in fund_links:
        fund_id = clean_text(link.get("fund_id"))
        if clean_text(link.get("source_table")) == "fund_assets":
            source_row = indexes["fund_asset_by_id"].get(str(link.get("source_id")))
            if source_row and is_candidate_name(source_row.get("asset_name")):
                direct_fund_asset_names.append(source_row.get("asset_name"))
                direct_fund_asset_details.append(
                    {
                        "name": clean_text(source_row.get("asset_name")),
                        "address": clean_text(source_row.get("address")),
                        "type": clean_text(source_row.get("asset_type")),
                    }
                )

        fund = indexes["fund_by_id"].get(fund_id)
        if fund:
            fund_asset_field_names.extend(split_list_text(fund.get("asset_name")))

        for fund_asset in indexes["fund_assets_by_fund"].get(fund_id, []):
            if is_candidate_name(fund_asset.get("asset_name")):
                same_fund_asset_names.append(fund_asset.get("asset_name"))

    for link in project_links:
        project_id = clean_text(link.get("project_id"))
        project = indexes["project_by_id"].get(project_id)
        if project and is_candidate_name(project.get("project_name")):
            project_names.append(project.get("project_name"))
        else:
            fund = indexes["fund_by_id"].get(project_id)
            if fund and is_candidate_name(fund.get("project_mission_name")):
                project_names.append(fund.get("project_mission_name"))

    for alias in indexes["aliases_by_asset"].get(asset_id, []):
        alias_type = clean_text(alias.get("alias_type"))
        alias_name = clean_text(alias.get("alias_name"))
        if alias_type in {"fund_name", "fund_short_name", "inferred_fund_name", "inferred_fund_short_name", "address"}:
            continue
        if is_candidate_name(alias_name):
            alias_names.append(alias_name)

    direct_fund_asset_names = dedupe_names(direct_fund_asset_names)
    same_fund_asset_names = dedupe_names(same_fund_asset_names)
    fund_asset_field_names = dedupe_names(fund_asset_field_names)
    project_names = dedupe_names(project_names)
    alias_names = dedupe_names(alias_names)

    proposed_name = current_name
    resolution_status = "current_asset_name_ok"
    action = "keep"

    if is_fallback:
        if len(direct_fund_asset_names) == 1 and len(same_fund_asset_names) <= 1:
            proposed_name = direct_fund_asset_names[0]
            if looks_vehicle_like(proposed_name):
                resolution_status = "review_single_vehicle_or_security_candidate"
                action = "manual_review"
            else:
                resolution_status = "auto_single_underlying_candidate"
                action = "update_asset_name"
        elif len(same_fund_asset_names) > 1:
            proposed_name = " | ".join(same_fund_asset_names)
            resolution_status = "review_multi_underlying_split"
            action = "split_or_drawer_list"
        elif direct_fund_asset_names:
            proposed_name = " | ".join(direct_fund_asset_names)
            resolution_status = "review_direct_underlying_candidates"
            action = "manual_review"
        elif fund_asset_field_names:
            proposed_name = " | ".join(fund_asset_field_names)
            resolution_status = "review_fund_asset_field_candidates"
            action = "manual_review"
        else:
            resolution_status = "fallback_no_candidate_found"
            action = "manual_review"

    linked_fund_ids = sorted(
        {
            clean_text(link.get("fund_id"))
            for link in fund_links
            if clean_text(link.get("fund_id"))
        }
    )
    linked_project_ids = sorted(
        {
            clean_text(link.get("project_id"))
            for link in project_links
            if clean_text(link.get("project_id"))
        }
    )

    return {
        "asset_id": asset_id,
        "current_asset_name": current_name,
        "proposed_asset_name": proposed_name,
        "asset_name_resolution_status": resolution_status,
        "asset_name_action": action,
        "is_fund_or_vehicle_fallback_asset": "true" if is_fallback else "false",
        "direct_fund_asset_candidates": " | ".join(direct_fund_asset_names),
        "same_fund_underlying_candidates": " | ".join(same_fund_asset_names),
        "fund_asset_field_candidates": " | ".join(fund_asset_field_names),
        "project_name_candidates": " | ".join(project_names),
        "alias_name_candidates": " | ".join(alias_names),
        "direct_fund_asset_details_json": json.dumps(
            direct_fund_asset_details,
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "linked_fund_ids": " | ".join(linked_fund_ids),
        "linked_project_ids": " | ".join(linked_project_ids),
        "linked_fund_count": len(linked_fund_ids),
        "linked_project_count": len(linked_project_ids),
        "drawer_behavior_hint": drawer_behavior_hint(
            len(linked_fund_ids),
            len(linked_project_ids),
            resolution_status,
        ),
    }


def drawer_behavior_hint(fund_count, project_count, resolution_status):
    if resolution_status == "review_multi_underlying_split":
        return "fund_click_opens_underlying_asset_list"
    if fund_count > 1 and project_count > 1:
        return "entity_click_opens_asset_fund_project_picker"
    if fund_count > 1:
        return "asset_click_opens_fund_list"
    if project_count > 1:
        return "asset_click_opens_project_list"
    return "entity_click_opens_detail"


def read_source_rows():
    if not SOURCE_CSV.exists():
        raise FileNotFoundError(f"Missing source CSV: {SOURCE_CSV}")
    with SOURCE_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    source_rows = read_source_rows()
    db = load_database()
    indexes = build_indexes(db)

    asset_ids = sorted(
        {
            clean_text(row.get("asset_id"))
            for row in source_rows
            if clean_text(row.get("asset_id"))
        }
    )
    asset_payloads = {
        asset_id: build_candidate_payload(asset_id, indexes)
        for asset_id in asset_ids
    }

    relationship_rows = []
    appended_fields = [
        "current_asset_name",
        "proposed_asset_name",
        "asset_name_resolution_status",
        "asset_name_action",
        "is_fund_or_vehicle_fallback_asset",
        "direct_fund_asset_candidates",
        "same_fund_underlying_candidates",
        "fund_asset_field_candidates",
        "project_name_candidates",
        "alias_name_candidates",
        "drawer_behavior_hint",
    ]

    for row in source_rows:
        asset_payload = asset_payloads.get(clean_text(row.get("asset_id")), {})
        relationship_rows.append({**row, **{field: asset_payload.get(field, "") for field in appended_fields}})

    source_fields = list(source_rows[0].keys()) if source_rows else []
    write_csv(
        RELATIONSHIP_CLEANUP_CSV,
        relationship_rows,
        source_fields + appended_fields,
    )

    asset_rows = list(asset_payloads.values())
    asset_fields = [
        "asset_id",
        "current_asset_name",
        "proposed_asset_name",
        "asset_name_resolution_status",
        "asset_name_action",
        "is_fund_or_vehicle_fallback_asset",
        "direct_fund_asset_candidates",
        "same_fund_underlying_candidates",
        "fund_asset_field_candidates",
        "project_name_candidates",
        "alias_name_candidates",
        "direct_fund_asset_details_json",
        "linked_fund_ids",
        "linked_project_ids",
        "linked_fund_count",
        "linked_project_count",
        "drawer_behavior_hint",
    ]
    write_csv(ASSET_CLEANUP_CSV, asset_rows, asset_fields)

    summary = {
        "source_rows": len(source_rows),
        "relationship_cleanup_csv": str(RELATIONSHIP_CLEANUP_CSV),
        "asset_cleanup_csv": str(ASSET_CLEANUP_CSV),
        "asset_rows": len(asset_rows),
        "resolution_status_counts": Counter(
            row["asset_name_resolution_status"] for row in asset_rows
        ),
        "action_counts": Counter(row["asset_name_action"] for row in asset_rows),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=dict))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
