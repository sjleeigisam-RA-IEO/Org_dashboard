from __future__ import annotations

import csv
from collections import Counter, defaultdict
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
LOCATION_CSV = OUTPUT_DIR / "asset_location_building_update_candidates.csv"
REVIEW_CSV = OUTPUT_DIR / "asset_name_manual_review_remaining.csv"
REVIEW_MD = OUTPUT_DIR / "asset_name_manual_review_remaining.md"


def md_cell(value: object) -> str:
    return str(value or "").replace("|", "<br>").replace("\n", " ")


def main() -> None:
    with LOCATION_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        location_rows = list(csv.DictReader(handle))

    by_asset: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in location_rows:
        by_asset[row["asset_id"]].append(row)

    review_rows = []
    for asset_id, rows in by_asset.items():
        sources = {row["adoption_source"] for row in rows}
        action = rows[0]["asset_name_action"]
        current_name = rows[0]["current_asset_name"]

        accepted_names = []
        for row in rows:
            name = row["accepted_asset_name"]
            if name and name not in accepted_names:
                accepted_names.append(name)

        all_unmatched = sources == {"worklist_proposed_name_unmatched"}
        has_name_excel = "worklist_proposed_name_matched_domestic_excel_by_name" in sources
        joined = f"{current_name} {' | '.join(accepted_names)}"
        policy_words = [
            "공모주",
            "상장리츠",
            "전환사채",
            "RCPS",
            "회사채",
            "Global REITs",
            "Pantheon",
            "NMP V",
            "PGSF",
            "PSD III",
        ]
        is_policy = any(word.lower() in joined.lower() for word in policy_words)

        if not (all_unmatched or (has_name_excel and is_policy)):
            continue

        if is_policy and action == "split_or_drawer_list":
            bucket = "policy_review_security_or_portfolio"
            reason = "실물 단일 자산보다 증권/포트폴리오/재간접 성격이라 자산 분류 정책 확인 필요"
            decision = "비실물/포트폴리오 자산으로 둘지, 하위 보유자산 리스트로 둘지 정책 결정"
        elif action == "manual_review":
            bucket = "manual_review_vehicle_or_security_name"
            reason = "제안 후보가 비히클/종류주/리츠성 명칭이라 기초자산명으로 확정 전 확인 필요"
            decision = "후보명을 그대로 둘지, 실제 기초자산명을 추가 탐색할지 확인"
        elif action == "update_asset_name":
            bucket = "manual_source_check_single_candidate"
            reason = "단일 후보는 있으나 국내 완료 원장 펀드코드 매칭 근거가 없어 출처 확인 필요"
            decision = "후보명 채택 가능성이 높지만 원천 확인 후 확정"
        else:
            bucket = "manual_source_check_drawer_candidate"
            reason = "다중 후보는 있으나 국내 완료 원장 펀드코드 매칭 근거가 없어 후보 목록 확인 필요"
            decision = "drawer/list 후보로 채택하되 목록 출처 확인"

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

        source_fund_codes = []
        for row in rows:
            code = row.get("source_fund_code", "")
            if code and code not in source_fund_codes:
                source_fund_codes.append(code)

        review_rows.append(
            {
                "review_bucket": bucket,
                "asset_id": asset_id,
                "current_asset_name": current_name,
                "asset_name_action": action,
                "accepted_asset_names": " | ".join(accepted_names),
                "candidate_count": len(accepted_names),
                "adoption_sources": " | ".join(sorted(sources)),
                "linked_fund_ids": rows[0].get("linked_fund_ids", ""),
                "source_fund_codes": " | ".join(source_fund_codes),
                "has_location_candidate": "true" if has_location else "false",
                "has_pnu_candidate": "true" if has_pnu else "false",
                "has_xy_candidate": "true" if has_xy else "false",
                "recommended_db_actions": " | ".join(
                    sorted({row["recommended_db_action"] for row in rows})
                ),
                "review_reason": reason,
                "suggested_decision": decision,
            }
        )

    review_rows.sort(
        key=lambda row: (
            row["review_bucket"],
            row["current_asset_name"],
            row["asset_id"],
        )
    )

    fieldnames = list(review_rows[0].keys()) if review_rows else []
    with REVIEW_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(review_rows)

    lines = [
        "# 자산명 수동 확인 잔여 대상",
        "",
        "- 기준: `asset_name_recovery_adoption_candidates.csv`, `asset_location_building_update_candidates.csv`",
        f"- 잔여 확인 대상: {len(review_rows)}개 asset_id",
        "",
        "## 요약",
        "",
        "| review_bucket | 건수 |",
        "|---|---:|",
    ]
    for bucket, count in Counter(row["review_bucket"] for row in review_rows).most_common():
        lines.append(f"| `{bucket}` | {count} |")

    lines.extend(
        [
            "",
            "## 상세",
            "",
            "| bucket | asset_id | 현재 자산명 | 채택 후보 | 후보 수 | 위치/PNU/좌표 | 확인 이유 |",
            "|---|---|---|---|---:|---|---|",
        ]
    )
    for row in review_rows:
        location_flags = (
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
                    location_flags,
                    md_cell(row["review_reason"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## 판단 메모",
            "",
            "- `manual_source_check_single_candidate`: 단일 후보라 채택 가능성이 높지만 국내 완료 원장 펀드코드로는 확인되지 않은 항목입니다.",
            "- `manual_review_vehicle_or_security_name`: 후보가 아직 비히클/종류주/리츠 명칭이라 실제 기초자산명으로 바꿀지, 비실물 자산으로 둘지 판단해야 합니다.",
            "- `policy_review_security_or_portfolio`: 공모주/상장리츠/회사채/재간접 등은 위치/PNU보다 자산 분류 정책이 먼저입니다.",
        ]
    )
    REVIEW_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"wrote {REVIEW_CSV}")
    print(f"wrote {REVIEW_MD}")
    print(f"count {len(review_rows)}")


if __name__ == "__main__":
    main()
