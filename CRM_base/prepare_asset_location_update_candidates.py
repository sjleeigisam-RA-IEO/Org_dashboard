from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
ADOPTION_CSV = OUTPUT_DIR / "asset_name_recovery_adoption_candidates.csv"
UPDATE_CSV = OUTPUT_DIR / "asset_location_building_update_candidates.csv"
SUMMARY_MD = OUTPUT_DIR / "asset_location_building_update_candidates_summary.md"


def load_env() -> dict[str, str]:
    values = {}
    env_path = PROJECT_DIR / ".env"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


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


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value).strip().replace("\xa0", " ")
    if text.lower() in {"", "none", "null", "nan"}:
        return ""
    return text


def norm(value) -> str:
    return "".join(clean(value).lower().split())


def floatish(value):
    text = clean(value)
    if not text:
        return None
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def changed_text(old, new) -> str:
    old_text = clean(old)
    new_text = clean(new)
    if not new_text:
        return "no_proposed_value"
    if not old_text:
        return "fill_blank"
    return "same" if old_text == new_text else "different"


def changed_coord(old, new) -> str:
    old_num = floatish(old)
    new_num = floatish(new)
    if new_num is None:
        return "no_proposed_value"
    if old_num is None:
        return "fill_blank"
    return "same" if abs(old_num - new_num) < 0.000001 else "different"


def raw_ledger_summary(value) -> str:
    if not value:
        return ""
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return clean(value)


def first_ledger_for_asset(ledgers_by_asset, asset_id: str):
    rows = ledgers_by_asset.get(asset_id, [])
    return rows[0] if rows else {}


def ledger_for_asset_pnu(ledgers_by_asset_pnu, asset_id: str, pnu: str):
    rows = ledgers_by_asset_pnu.get((asset_id, pnu), [])
    return rows[0] if rows else {}


def choose_recommended_action(row: dict) -> str:
    action = row.get("asset_name_action", "")
    source = row.get("adoption_source", "")
    has_pnu = bool(clean(row.get("pnu")))
    if action == "update_asset_name":
        return "update_existing_asset_master_location" if has_pnu else "update_name_only_pending_location"
    if action == "split_or_drawer_list":
        return "create_or_link_underlying_asset_with_location" if has_pnu else "create_or_link_underlying_asset_name_only"
    if source.endswith("matched_domestic_excel_by_name") and has_pnu:
        return "review_name_match_then_update_or_link_location"
    return "adopt_name_only_pending_location"


def is_safe_existing_asset_update(recommended_action: str) -> bool:
    return recommended_action in {
        "update_existing_asset_master_location",
        "update_name_only_pending_location",
    }


def main() -> None:
    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])

    asset_master = fetch_all(
        client,
        "asset_master",
        "asset_id,canonical_name,address_text,latitude,longitude,pnu,site_area,gross_floor_area,scr,far,main_usage,structure,floors_up,floors_down,elevators,parking,height,completion_date,geocode_source,building_ledger_source,api_enrichment_status,last_api_enriched_at,data_completeness,manual_input_required,is_physical,is_synthetic,asset_kind,metadata",
    )
    building_ledgers = fetch_all(client, "asset_building_ledger", "*")
    fund_assets = fetch_all(
        client,
        "fund_assets",
        "id,fund_id,asset_id,asset_name,address,lat,lng,site_area,gross_floor_area,gfa,scr,far,main_usage,structure,floors_up,floors_down,elevators,parking,height,completion_date,metadata",
    )

    assets_by_id = {row["asset_id"]: row for row in asset_master if row.get("asset_id")}

    ledgers_by_asset = defaultdict(list)
    ledgers_by_asset_pnu = defaultdict(list)
    ledgers_by_pnu = defaultdict(list)
    for row in building_ledgers:
        asset_id = clean(row.get("asset_id"))
        pnu = clean(row.get("pnu"))
        if asset_id:
            ledgers_by_asset[asset_id].append(row)
        if asset_id and pnu:
            ledgers_by_asset_pnu[(asset_id, pnu)].append(row)
        if pnu:
            ledgers_by_pnu[pnu].append(row)

    fund_assets_by_key = defaultdict(list)
    for row in fund_assets:
        key = (clean(row.get("fund_id")), norm(row.get("asset_name")))
        if key[0] and key[1]:
            fund_assets_by_key[key].append(row)

    with ADOPTION_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        adoption_rows = list(csv.DictReader(handle))

    output_rows = []
    for idx, row in enumerate(adoption_rows, start=1):
        asset_id = row["asset_id"]
        asset = assets_by_id.get(asset_id, {})
        proposed_name = clean(row.get("accepted_asset_name"))
        proposed_address = clean(row.get("modified_address") or row.get("address"))
        proposed_pnu = clean(row.get("pnu"))
        proposed_lng = clean(row.get("x_code"))
        proposed_lat = clean(row.get("y_code"))
        fund_code = clean(row.get("fund_code"))
        name_key = norm(row.get("excel_asset_name") or proposed_name)
        fund_asset = (fund_assets_by_key.get((fund_code, name_key)) or [{}])[0]

        ledger_same_asset_pnu = ledger_for_asset_pnu(
            ledgers_by_asset_pnu, asset_id, proposed_pnu
        )
        ledger_same_asset = first_ledger_for_asset(ledgers_by_asset, asset_id)
        ledger_same_pnu_any_asset = (ledgers_by_pnu.get(proposed_pnu) or [{}])[0]

        current_ledger = ledger_same_asset_pnu or ledger_same_asset
        current_pnu = clean(asset.get("pnu"))
        if not current_pnu:
            metadata = asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {}
            current_pnu = clean(metadata.get("pnu"))
        if not current_pnu:
            current_pnu = clean(current_ledger.get("pnu"))

        current_lat = clean(asset.get("latitude"))
        current_lng = clean(asset.get("longitude"))
        current_address = clean(asset.get("address_text"))
        current_name = clean(asset.get("canonical_name"))

        has_current_ledger_for_proposed_pnu = bool(ledger_same_asset_pnu)
        has_any_ledger_for_proposed_pnu = bool(ledger_same_pnu_any_asset)
        has_proposed_location = bool(proposed_pnu or proposed_lat or proposed_lng or proposed_address)

        recommended_action = choose_recommended_action(row)
        output_rows.append(
            {
                "candidate_row_id": idx,
                "asset_id": asset_id,
                "current_asset_name": row.get("current_asset_name", ""),
                "db_asset_master_name": current_name,
                "accepted_asset_name": proposed_name,
                "asset_name_action": row.get("asset_name_action", ""),
                "adoption_source": row.get("adoption_source", ""),
                "recommended_db_action": recommended_action,
                "safe_to_update_existing_asset_master": is_safe_existing_asset_update(
                    recommended_action
                ),
                "linked_fund_ids": row.get("linked_fund_ids", ""),
                "source_fund_code": fund_code,
                "source_fund_name": row.get("fund_name", ""),
                "source_seq": row.get("seq", ""),
                "source_asset_category": row.get("asset_category", ""),
                "source_investment_asset_type": row.get("investment_asset_type", ""),
                "source_operation_status": row.get("operation_status", ""),
                "proposed_address": proposed_address,
                "proposed_pnu": proposed_pnu,
                "proposed_longitude": proposed_lng,
                "proposed_latitude": proposed_lat,
                "db_address_text": current_address,
                "db_pnu": current_pnu,
                "db_longitude": current_lng,
                "db_latitude": current_lat,
                "db_geocode_source": asset.get("geocode_source") or "",
                "db_building_ledger_source": asset.get("building_ledger_source") or "",
                "db_api_enrichment_status": asset.get("api_enrichment_status") or "",
                "db_last_api_enriched_at": asset.get("last_api_enriched_at") or "",
                "db_data_completeness": asset.get("data_completeness") or "",
                "db_manual_input_required": asset.get("manual_input_required") or "",
                "address_compare": changed_text(current_address, proposed_address),
                "pnu_compare": changed_text(current_pnu, proposed_pnu),
                "longitude_compare": changed_coord(current_lng, proposed_lng),
                "latitude_compare": changed_coord(current_lat, proposed_lat),
                "has_proposed_location": has_proposed_location,
                "has_current_asset_master_location": bool(current_pnu and current_lat and current_lng),
                "has_current_ledger_for_asset": bool(ledger_same_asset),
                "has_current_ledger_for_proposed_pnu": has_current_ledger_for_proposed_pnu,
                "has_any_ledger_for_proposed_pnu": has_any_ledger_for_proposed_pnu,
                "needs_asset_master_location_update": bool(
                    has_proposed_location
                    and (
                        changed_text(current_pnu, proposed_pnu) in {"fill_blank", "different"}
                        or changed_coord(current_lng, proposed_lng) in {"fill_blank", "different"}
                        or changed_coord(current_lat, proposed_lat) in {"fill_blank", "different"}
                        or changed_text(current_address, proposed_address) in {"fill_blank", "different"}
                    )
                ),
                "needs_building_ledger_fetch_by_pnu": bool(
                    proposed_pnu and not has_current_ledger_for_proposed_pnu
                ),
                "db_asset_site_area": asset.get("site_area") or "",
                "db_asset_gross_floor_area": asset.get("gross_floor_area") or "",
                "db_asset_main_usage": asset.get("main_usage") or "",
                "db_asset_completion_date": asset.get("completion_date") or "",
                "ledger_pnu": current_ledger.get("pnu") or "",
                "ledger_site_area": current_ledger.get("site_area") or "",
                "ledger_gross_floor_area": current_ledger.get("gross_floor_area") or "",
                "ledger_main_usage": current_ledger.get("main_usage") or "",
                "ledger_completion_date": current_ledger.get("completion_date") or "",
                "fund_assets_id": fund_asset.get("id") or "",
                "fund_assets_pnu": (
                    fund_asset.get("metadata", {}).get("pnu")
                    if isinstance(fund_asset.get("metadata"), dict)
                    else ""
                ),
                "fund_assets_address": fund_asset.get("address") or "",
                "fund_assets_longitude": fund_asset.get("lng") or "",
                "fund_assets_latitude": fund_asset.get("lat") or "",
                "fund_assets_has_building_ledger_metadata": bool(
                    isinstance(fund_asset.get("metadata"), dict)
                    and fund_asset.get("metadata", {}).get("building_ledger")
                ),
                "raw_ledger_preview": raw_ledger_summary(current_ledger.get("raw_ledger"))[:1000],
            }
        )

    fieldnames = list(output_rows[0].keys()) if output_rows else []
    with UPDATE_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)

    summary = {
        "rows": len(output_rows),
        "actions": Counter(row["recommended_db_action"] for row in output_rows),
        "adoption_sources": Counter(row["adoption_source"] for row in output_rows),
        "has_proposed_location": sum(row["has_proposed_location"] for row in output_rows),
        "has_current_asset_master_location": sum(
            row["has_current_asset_master_location"] for row in output_rows
        ),
        "needs_asset_master_location_update": sum(
            row["needs_asset_master_location_update"] for row in output_rows
        ),
        "needs_building_ledger_fetch_by_pnu": sum(
            row["needs_building_ledger_fetch_by_pnu"] for row in output_rows
        ),
        "has_current_ledger_for_proposed_pnu": sum(
            row["has_current_ledger_for_proposed_pnu"] for row in output_rows
        ),
        "has_any_ledger_for_proposed_pnu": sum(
            row["has_any_ledger_for_proposed_pnu"] for row in output_rows
        ),
    }

    lines = [
        "# 자산 위치/PNU/건축물대장 업데이트 후보 비교",
        "",
        f"- 입력 후보: `{ADOPTION_CSV.name}`",
        f"- 출력 CSV: `{UPDATE_CSV.name}`",
        f"- 전체 후보 행: {summary['rows']}행",
        f"- 제안 위치값 보유: {summary['has_proposed_location']}행",
        f"- 기존 asset_master 위치값 보유(PNU+좌표): {summary['has_current_asset_master_location']}행",
        f"- asset_master 위치 갱신 필요 후보: {summary['needs_asset_master_location_update']}행",
        f"- 제안 PNU 기준 건축물대장 재조회/연결 필요 후보: {summary['needs_building_ledger_fetch_by_pnu']}행",
        f"- 같은 asset_id+PNU의 기존 ledger 존재: {summary['has_current_ledger_for_proposed_pnu']}행",
        f"- 같은 PNU의 ledger가 다른 asset_id 등에 존재: {summary['has_any_ledger_for_proposed_pnu']}행",
        "",
        "## 권장 DB 작업 유형",
        "",
        "| recommended_db_action | 행 수 |",
        "|---|---:|",
    ]
    for action, count in summary["actions"].most_common():
        lines.append(f"| `{action}` | {count} |")

    lines.extend(
        [
            "",
            "## 후보 출처",
            "",
            "| adoption_source | 행 수 |",
            "|---|---:|",
        ]
    )
    for source, count in summary["adoption_sources"].most_common():
        lines.append(f"| `{source}` | {count} |")

    lines.extend(
        [
            "",
            "## 주의",
            "",
            "- `split_or_drawer_list` 행은 같은 `asset_id`에 여러 PNU를 덮어쓰는 용도가 아닙니다. 별도 underlying asset 생성 또는 기존 underlying asset 연결 후보로 봐야 합니다.",
            "- `needs_building_ledger_fetch_by_pnu=true`인 행은 제안 PNU는 있으나 같은 `asset_id+pnu` ledger가 없어 건축물대장 재조회 또는 ledger row 연결 검토가 필요합니다.",
            "- `has_any_ledger_for_proposed_pnu=true`인데 같은 asset_id ledger가 없는 행은 동일 PNU 정보가 DB 어딘가에 이미 있으므로 중복 생성 전에 병합 가능성을 봐야 합니다.",
        ]
    )
    SUMMARY_MD.write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2, default=dict))
    print(str(UPDATE_CSV))
    print(str(SUMMARY_MD))


if __name__ == "__main__":
    main()
