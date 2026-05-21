from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
INPUT_CSV = OUTPUT_DIR / "asset_location_building_update_candidates.csv"
PLAN_CSV = OUTPUT_DIR / "asset_location_merge_plan.csv"
SUMMARY_MD = OUTPUT_DIR / "asset_location_merge_plan_summary.md"


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"", "none", "null", "nan", "-"} else text


def is_true(value) -> bool:
    return str(value).strip().lower() == "true"


def choose_merge_action(row: dict[str, str]) -> tuple[str, str, str]:
    recommended = clean(row.get("recommended_db_action"))
    safe_update = is_true(row.get("safe_to_update_existing_asset_master"))
    has_pnu = bool(clean(row.get("proposed_pnu")))
    has_location = is_true(row.get("has_proposed_location"))
    needs_ledger_fetch = is_true(row.get("needs_building_ledger_fetch_by_pnu"))
    same_asset_ledger = is_true(row.get("has_current_ledger_for_proposed_pnu"))
    any_ledger = is_true(row.get("has_any_ledger_for_proposed_pnu"))
    action_source = clean(row.get("adoption_source"))

    if safe_update and has_location:
        if needs_ledger_fetch:
            return (
                "update_asset_master_then_fetch_ledger",
                "safe existing asset update with new/different location; ledger missing for asset+pnu",
                "asset_master, asset_building_ledger",
            )
        return (
            "update_asset_master_location",
            "safe existing asset update; ledger already present for asset+pnu",
            "asset_master",
        )

    if safe_update and not has_location:
        return (
            "update_asset_name_only",
            "safe existing asset name update but no address/pnu/xy candidate",
            "asset_master",
        )

    if recommended == "create_or_link_underlying_asset_with_location":
        if same_asset_ledger:
            return (
                "link_existing_underlying_asset_same_asset_pnu",
                "candidate pnu already exists for same asset_id; create/link relationship only after review",
                "asset_fund_links, fund_assets",
            )
        if any_ledger:
            return (
                "link_existing_underlying_asset_by_pnu",
                "same pnu exists elsewhere in DB; prefer linking/merging existing asset before creating",
                "asset_master, asset_fund_links, fund_assets",
            )
        if has_pnu:
            return (
                "create_underlying_asset_then_fetch_ledger",
                "multi-underlying candidate with new pnu; create asset then fetch/insert ledger",
                "asset_master, asset_fund_links, asset_building_ledger, fund_assets",
            )
        return (
            "create_underlying_asset_location_review",
            "multi-underlying candidate has location text but no pnu",
            "asset_master, asset_fund_links",
        )

    if recommended == "create_or_link_underlying_asset_name_only":
        return (
            "create_or_link_underlying_asset_name_only",
            "candidate has no location; keep searchable/linkable but no pnu update",
            "asset_master, asset_fund_links",
        )

    if recommended in {
        "review_name_match_then_update_or_link_location",
        "adopt_name_only_pending_location",
    }:
        if has_location and any_ledger:
            return (
                "review_name_match_link_by_pnu",
                "name matched loosely and pnu exists in DB; manual review before linking",
                "asset_master, asset_fund_links",
            )
        if has_location:
            return (
                "review_name_match_then_fetch_ledger",
                "name matched loosely with new location; review before creating/updating",
                "asset_master, asset_building_ledger",
            )
        return (
            "hold_name_only_no_location",
            "adopted name has no location candidate",
            "search_alias_or_asset_name",
        )

    if action_source == "worklist_proposed_name_unmatched":
        return (
            "hold_name_only_no_location",
            "proposal adopted but no location/source match",
            "search_alias_or_asset_name",
        )

    return (
        "manual_review",
        "unclassified candidate action",
        "",
    )


def risk_level(merge_action: str) -> str:
    if merge_action in {"update_asset_master_location", "update_asset_name_only"}:
        return "low"
    if merge_action in {"update_asset_master_then_fetch_ledger", "link_existing_underlying_asset_by_pnu"}:
        return "medium"
    if merge_action.startswith("create_underlying_asset") or merge_action.startswith("review_"):
        return "medium"
    if merge_action.startswith("hold"):
        return "hold"
    return "review"


def main() -> None:
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        input_rows = list(csv.DictReader(handle))

    plan_rows = []
    for row in input_rows:
        merge_action, reason, target_tables = choose_merge_action(row)
        plan_rows.append(
            {
                "merge_action": merge_action,
                "risk_level": risk_level(merge_action),
                "merge_reason": reason,
                "target_tables": target_tables,
                "asset_id": row.get("asset_id", ""),
                "current_asset_name": row.get("current_asset_name", ""),
                "db_asset_master_name": row.get("db_asset_master_name", ""),
                "accepted_asset_name": row.get("accepted_asset_name", ""),
                "asset_name_action": row.get("asset_name_action", ""),
                "asset_semantics_hint": "",
                "adoption_source": row.get("adoption_source", ""),
                "recommended_db_action": row.get("recommended_db_action", ""),
                "safe_to_update_existing_asset_master": row.get("safe_to_update_existing_asset_master", ""),
                "linked_fund_ids": row.get("linked_fund_ids", ""),
                "source_fund_code": row.get("source_fund_code", ""),
                "source_fund_name": row.get("source_fund_name", ""),
                "source_seq": row.get("source_seq", ""),
                "source_asset_category": row.get("source_asset_category", ""),
                "source_investment_asset_type": row.get("source_investment_asset_type", ""),
                "proposed_address": row.get("proposed_address", ""),
                "db_address_text": row.get("db_address_text", ""),
                "address_compare": row.get("address_compare", ""),
                "proposed_pnu": row.get("proposed_pnu", ""),
                "db_pnu": row.get("db_pnu", ""),
                "pnu_compare": row.get("pnu_compare", ""),
                "proposed_longitude": row.get("proposed_longitude", ""),
                "db_longitude": row.get("db_longitude", ""),
                "longitude_compare": row.get("longitude_compare", ""),
                "proposed_latitude": row.get("proposed_latitude", ""),
                "db_latitude": row.get("db_latitude", ""),
                "latitude_compare": row.get("latitude_compare", ""),
                "has_proposed_location": row.get("has_proposed_location", ""),
                "has_current_asset_master_location": row.get("has_current_asset_master_location", ""),
                "has_current_ledger_for_asset": row.get("has_current_ledger_for_asset", ""),
                "has_current_ledger_for_proposed_pnu": row.get("has_current_ledger_for_proposed_pnu", ""),
                "has_any_ledger_for_proposed_pnu": row.get("has_any_ledger_for_proposed_pnu", ""),
                "needs_asset_master_location_update": row.get("needs_asset_master_location_update", ""),
                "needs_building_ledger_fetch_by_pnu": row.get("needs_building_ledger_fetch_by_pnu", ""),
                "fund_assets_id": row.get("fund_assets_id", ""),
                "fund_assets_pnu": row.get("fund_assets_pnu", ""),
                "fund_assets_address": row.get("fund_assets_address", ""),
                "fund_assets_longitude": row.get("fund_assets_longitude", ""),
                "fund_assets_latitude": row.get("fund_assets_latitude", ""),
                "fund_assets_has_building_ledger_metadata": row.get("fund_assets_has_building_ledger_metadata", ""),
            }
        )

    fieldnames = list(plan_rows[0].keys()) if plan_rows else []
    with PLAN_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(plan_rows)

    action_counts = Counter(row["merge_action"] for row in plan_rows)
    risk_counts = Counter(row["risk_level"] for row in plan_rows)
    table_counts = Counter()
    for row in plan_rows:
        for table in [item.strip() for item in row["target_tables"].split(",") if item.strip()]:
            table_counts[table] += 1

    lines = [
        "# 자산 위치/PNU/건축물대장 병합 계획",
        "",
        f"- 입력 대조표: `{INPUT_CSV.name}`",
        f"- 출력 병합 계획: `{PLAN_CSV.name}`",
        f"- 전체 후보 행: {len(plan_rows)}행",
        "",
        "## 액션별 건수",
        "",
        "| merge_action | count |",
        "|---|---:|",
    ]
    for action, count in action_counts.most_common():
        lines.append(f"| `{action}` | {count} |")

    lines.extend(["", "## 위험도", "", "| risk_level | count |", "|---|---:|"])
    for level, count in risk_counts.most_common():
        lines.append(f"| `{level}` | {count} |")

    lines.extend(["", "## 대상 테이블 기준 후보 수", "", "| table | candidate rows |", "|---|---:|"])
    for table, count in table_counts.most_common():
        lines.append(f"| `{table}` | {count} |")

    lines.extend(
        [
            "",
            "## 병합 순서 제안",
            "",
            "1. `update_asset_name_only`, `update_asset_master_location`부터 반영합니다.",
            "2. `update_asset_master_then_fetch_ledger`는 asset_master 갱신 후 PNU 기준 건축물대장 재조회 큐에 넣습니다.",
            "3. `link_existing_underlying_asset_by_pnu`는 같은 PNU의 기존 asset/ledger를 먼저 확인하고 관계만 연결합니다.",
            "4. `create_underlying_asset_then_fetch_ledger`는 다자산 펀드 하위자산으로 신규 asset을 만들고 fund link 후 ledger를 조회합니다.",
            "5. `hold_name_only_no_location`은 검색 별칭/표시명만 반영하고 위치/PNU 업데이트에서는 제외합니다.",
            "",
            "## 주의",
            "",
            "- `create_or_link_underlying_*` 계열은 기존 대표 asset_id에 PNU를 덮어쓰면 안 됩니다.",
            "- 같은 PNU가 이미 DB에 있는 행은 신규 생성보다 기존 asset/ledger 재사용을 우선 검토합니다.",
            "- 이 파일은 실행 계획표이며, 아직 Supabase 업데이트를 수행하지 않습니다.",
        ]
    )
    SUMMARY_MD.write_text("\n".join(lines), encoding="utf-8")

    print(
        json.dumps(
            {
                "rows": len(plan_rows),
                "merge_action_counts": action_counts,
                "risk_counts": risk_counts,
                "table_counts": table_counts,
            },
            ensure_ascii=False,
            indent=2,
            default=dict,
        )
    )
    print(str(PLAN_CSV))
    print(str(SUMMARY_MD))


if __name__ == "__main__":
    main()
