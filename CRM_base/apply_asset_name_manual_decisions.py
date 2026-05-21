from __future__ import annotations

import csv
from collections import Counter, defaultdict
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
LOCATION_CSV = OUTPUT_DIR / "asset_location_building_update_candidates.csv"
DECISIONS_CSV = OUTPUT_DIR / "asset_name_manual_decisions.csv"
REMAINING_CSV = OUTPUT_DIR / "asset_name_manual_review_remaining_after_decisions.csv"
REMAINING_MD = OUTPUT_DIR / "asset_name_manual_review_remaining_after_decisions.md"


DECISIONS = {
    "ast_30efc1e2c218": {
        "final_asset_name": "경산 쿠팡물류센터",
        "decision_status": "user_confirmed",
        "asset_semantics": "underlying_asset",
        "note": "종류주는 보유 형태이고 기초자산은 경산 쿠팡물류센터",
    },
    "ast_b0956b6f4029": {
        "final_asset_name": "부산송정물류센터",
        "decision_status": "user_confirmed_inferred_from_542_successor",
        "asset_semantics": "underlying_asset",
        "note": "542호 제1종은 기존 542호 자산 승계로 판단",
    },
    "ast_808ae65372f4": {
        "final_asset_name": "오시리아타워레지던스",
        "decision_status": "user_confirmed",
        "asset_semantics": "underlying_asset",
        "note": "명칭 자체가 자산",
    },
    "ast_34e35d0dff33": {
        "final_asset_name": "분당야탑물류센터",
        "decision_status": "user_confirmed",
        "asset_semantics": "underlying_asset",
        "note": "기존 후보 채택",
    },
    "ast_4a2972f3fd4f": {
        "final_asset_name": "양산 유산동 물류센터",
        "decision_status": "user_confirmed",
        "asset_semantics": "underlying_asset",
        "note": "기존 후보 채택",
    },
    "ast_616c3d79da75": {
        "final_asset_name": "경산 쿠팡물류센터",
        "decision_status": "user_confirmed",
        "asset_semantics": "underlying_asset",
        "note": "기존 후보 채택",
    },
    "ast_428853fb1dec": {
        "final_asset_name": "Global REITs(삼성OCIO)",
        "decision_status": "user_confirmed",
        "asset_semantics": "security_or_portfolio_asset",
        "note": "글로벌 리츠는 괄호 구분 후보명 채택",
    },
    "ast_f5220c768a13": {
        "final_asset_name": "Global REITs (수협)",
        "decision_status": "user_confirmed",
        "asset_semantics": "security_or_portfolio_asset",
        "note": "글로벌 리츠는 괄호 구분 후보명 채택",
    },
    "ast_9bf678a7d2ae": {
        "final_asset_name": "Global REITs(리츠섹터SMA1호)",
        "decision_status": "user_confirmed",
        "asset_semantics": "security_or_portfolio_asset",
        "note": "글로벌 리츠는 괄호 구분 후보명 채택",
    },
    "ast_fbe13b6b1e0a": {
        "final_asset_name": "Global REITs(셀렉리츠1호)",
        "decision_status": "user_confirmed",
        "asset_semantics": "security_or_portfolio_asset",
        "note": "글로벌 리츠는 괄호 구분 후보명 채택",
    },
    "ast_b4ff0851baae": {
        "final_asset_name": "이지스용산PF재구조화일반사모1호(2종)",
        "decision_status": "provisional_adopted",
        "asset_semantics": "vehicle_or_restructured_pf_asset",
        "note": "잔여 후보도 우선 채택",
    },
    "ast_0555a6694264": {
        "final_asset_name": "이지스제572호부동산일반사모투자회사(1종)",
        "decision_status": "provisional_adopted",
        "asset_semantics": "vehicle_or_share_class_asset",
        "note": "잔여 후보도 우선 채택",
    },
    "ast_4ae20e9370ca": {
        "final_asset_name": "ARDIAN Infrastructure Fund VI",
        "decision_status": "provisional_adopted",
        "asset_semantics": "fund_interest_or_indirect_asset",
        "note": "잔여 후보도 우선 채택",
    },
    "ast_4d1430b5f175": {
        "final_asset_name": "전환사채 | 공모주 | 비상장RCPS | 상장리츠 | AA+ 회사채",
        "decision_status": "provisional_adopted",
        "asset_semantics": "security_or_portfolio_asset_list",
        "note": "잔여 후보도 우선 채택. UI에서는 목록형/포트폴리오형으로 표시",
    },
    "ast_4ffe4ac306f2": {
        "final_asset_name": "상장리츠 | 공모주 | AA+ 회사채",
        "decision_status": "provisional_adopted",
        "asset_semantics": "security_or_portfolio_asset_list",
        "note": "잔여 후보도 우선 채택. UI에서는 목록형/포트폴리오형으로 표시",
    },
    "ast_02f2fb35a743": {
        "final_asset_name": "Pantheon Viking Co-Invest LP | NMP V | PGSF VII | PSD III",
        "decision_status": "provisional_adopted",
        "asset_semantics": "fund_interest_or_indirect_asset_list",
        "note": "잔여 후보도 우선 채택. UI에서는 재간접 하위 보유목록으로 표시",
    },
    "ast_dc11f9b4f515": {
        "final_asset_name": "Pantheon Viking Co-Invest LP | NMP V | PGSF VII | PSD III",
        "decision_status": "provisional_adopted",
        "asset_semantics": "fund_interest_or_indirect_asset_list",
        "note": "잔여 후보도 우선 채택. UI에서는 재간접 하위 보유목록으로 표시",
    },
}


def md_cell(value: object) -> str:
    return str(value or "").replace("|", "<br>").replace("\n", " ")


def unique_names(rows: list[dict[str, str]]) -> list[str]:
    names = []
    for row in rows:
        name = row.get("accepted_asset_name", "")
        if name and name not in names:
            names.append(name)
    return names


def classify_remaining(asset_id: str, rows: list[dict[str, str]]) -> dict[str, object] | None:
    if asset_id in DECISIONS:
        return None

    sources = {row["adoption_source"] for row in rows}
    action = rows[0]["asset_name_action"]
    current_name = rows[0]["current_asset_name"]
    accepted_names = unique_names(rows)
    joined = f"{current_name} {' | '.join(accepted_names)}"
    policy_words = [
        "공모주",
        "상장리츠",
        "전환사채",
        "RCPS",
        "회사채",
        "Pantheon",
        "NMP V",
        "PGSF",
        "PSD III",
    ]
    is_policy = any(word.lower() in joined.lower() for word in policy_words)
    all_unmatched = sources == {"worklist_proposed_name_unmatched"}
    has_name_excel = "worklist_proposed_name_matched_domestic_excel_by_name" in sources

    if not (all_unmatched or (has_name_excel and is_policy)):
        return None

    if is_policy and action == "split_or_drawer_list":
        bucket = "policy_review_security_or_portfolio"
        reason = "실물 위치/PNU보다 증권/포트폴리오/재간접 자산 분류 정책 확인 필요"
    elif action == "manual_review":
        bucket = "manual_review_vehicle_or_security_name"
        reason = "제안 후보가 비히클/종류주/리츠성 명칭이라 기초자산명 확정 전 확인 필요"
    elif action == "update_asset_name":
        bucket = "manual_source_check_single_candidate"
        reason = "단일 후보는 있으나 국내 완료 원장 펀드코드 매칭 근거가 없어 출처 확인 필요"
    else:
        bucket = "manual_source_check_drawer_candidate"
        reason = "다중 후보는 있으나 국내 완료 원장 펀드코드 매칭 근거가 없어 후보 목록 확인 필요"

    has_location = any(
        row.get("proposed_pnu")
        or row.get("proposed_latitude")
        or row.get("proposed_longitude")
        or row.get("proposed_address")
        for row in rows
    )
    has_pnu = any(row.get("proposed_pnu") for row in rows)
    has_xy = any(
        row.get("proposed_latitude") and row.get("proposed_longitude")
        for row in rows
    )

    return {
        "review_bucket": bucket,
        "asset_id": asset_id,
        "current_asset_name": current_name,
        "asset_name_action": action,
        "accepted_asset_names": " | ".join(accepted_names),
        "candidate_count": len(accepted_names),
        "adoption_sources": " | ".join(sorted(sources)),
        "linked_fund_ids": rows[0].get("linked_fund_ids", ""),
        "has_location_candidate": "true" if has_location else "false",
        "has_pnu_candidate": "true" if has_pnu else "false",
        "has_xy_candidate": "true" if has_xy else "false",
        "recommended_db_actions": " | ".join(
            sorted({row["recommended_db_action"] for row in rows})
        ),
        "review_reason": reason,
    }


def main() -> None:
    with LOCATION_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        location_rows = list(csv.DictReader(handle))

    by_asset: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in location_rows:
        by_asset[row["asset_id"]].append(row)

    decision_rows = []
    for asset_id, decision in DECISIONS.items():
        rows = by_asset.get(asset_id, [])
        decision_rows.append(
            {
                "asset_id": asset_id,
                "current_asset_name": rows[0]["current_asset_name"] if rows else "",
                "previous_candidate_names": " | ".join(unique_names(rows)),
                "final_asset_name": decision["final_asset_name"],
                "decision_status": decision["decision_status"],
                "asset_semantics": decision["asset_semantics"],
                "linked_fund_ids": rows[0].get("linked_fund_ids", "") if rows else "",
                "note": decision["note"],
            }
        )

    with DECISIONS_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        fieldnames = list(decision_rows[0].keys())
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(decision_rows)

    remaining_rows = []
    for asset_id, rows in by_asset.items():
        item = classify_remaining(asset_id, rows)
        if item:
            remaining_rows.append(item)
    remaining_rows.sort(
        key=lambda row: (
            row["review_bucket"],
            row["current_asset_name"],
            row["asset_id"],
        )
    )

    remaining_fieldnames = [
        "review_bucket",
        "asset_id",
        "current_asset_name",
        "asset_name_action",
        "accepted_asset_names",
        "candidate_count",
        "adoption_sources",
        "linked_fund_ids",
        "has_location_candidate",
        "has_pnu_candidate",
        "has_xy_candidate",
        "recommended_db_actions",
        "review_reason",
    ]
    with REMAINING_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=remaining_fieldnames)
        writer.writeheader()
        writer.writerows(remaining_rows)

    lines = [
        "# 자산명 수동 판단 반영 후 잔여 대상",
        "",
        f"- 반영된 사용자 판단: {len(decision_rows)}개 asset_id",
        f"- 잔여 확인 대상: {len(remaining_rows)}개 asset_id",
        "",
        "## 반영된 판단",
        "",
        "| asset_id | 기존명 | 최종 자산명 | 성격 | 메모 |",
        "|---|---|---|---|---|",
    ]
    for row in decision_rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{row['asset_id']}`",
                    md_cell(row["current_asset_name"]),
                    md_cell(row["final_asset_name"]),
                    md_cell(row["asset_semantics"]),
                    md_cell(row["note"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## 잔여 요약",
            "",
            "| review_bucket | 건수 |",
            "|---|---:|",
        ]
    )
    for bucket, count in Counter(row["review_bucket"] for row in remaining_rows).most_common():
        lines.append(f"| `{bucket}` | {count} |")

    lines.extend(
        [
            "",
            "## 잔여 상세",
            "",
            "| bucket | asset_id | 현재 자산명 | 채택 후보 | 후보 수 | 위치/PNU/좌표 | 확인 이유 |",
            "|---|---|---|---|---:|---|---|",
        ]
    )
    for row in remaining_rows:
        loc = (
            f"위치:{row['has_location_candidate']} / "
            f"PNU:{row['has_pnu_candidate']} / "
            f"XY:{row['has_xy_candidate']}"
        )
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{row['review_bucket']}`",
                    f"`{row['asset_id']}`",
                    md_cell(row["current_asset_name"]),
                    md_cell(row["accepted_asset_names"]),
                    str(row["candidate_count"]),
                    loc,
                    md_cell(row["review_reason"]),
                ]
            )
            + " |"
        )

    REMAINING_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"wrote {DECISIONS_CSV}")
    print(f"wrote {REMAINING_CSV}")
    print(f"wrote {REMAINING_MD}")
    print(f"decisions {len(decision_rows)} remaining {len(remaining_rows)}")


if __name__ == "__main__":
    main()
