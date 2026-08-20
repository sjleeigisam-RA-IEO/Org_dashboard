from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
RELATIONSHIP_CSV = OUTPUT_DIR / "ra_insight_db_asset_fund_project_relationships_cleanup.csv"
ASSET_DECISIONS_CSV = OUTPUT_DIR / "asset_name_manual_decisions.csv"
BASIS_CSV = OUTPUT_DIR / "project_name_cleanup_basis.csv"
PROJECT_REVIEW_CSV = OUTPUT_DIR / "project_name_cleanup_review_candidates.csv"
SUMMARY_MD = OUTPUT_DIR / "project_name_cleanup_basis_summary.md"


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
    "종류주",
    "수익증권",
    "회사채",
    "사채",
)


PURPOSE_PATTERNS = (
    "개발",
    "신축",
    "리모델링",
    "브릿지",
    "대출",
    "담보",
    "매입",
    "인수",
    "운용",
    "재구조화",
    "환경개선",
    "메자닌",
    "투자",
    "리츠",
    "공모주",
    "전환사채",
    "재간접",
)


def load_env() -> dict[str, str]:
    values = {}
    for line in (PROJECT_DIR / ".env").read_text(encoding="utf-8").splitlines():
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
    text = str(value).replace("\xa0", " ").strip()
    return "" if text.lower() in {"", "none", "null", "nan", "-"} else text


def normalize(value) -> str:
    text = clean(value).lower()
    text = re.sub(r"\([^)]*\)|\[[^\]]*\]", "", text)
    return re.sub(r"[\s\.,·ㆍ\-_/\\|]+", "", text)


def looks_vehicle_like(value: str) -> bool:
    lowered = clean(value).lower()
    return any(pattern in lowered for pattern in VEHICLE_PATTERNS)


def has_purpose_word(value: str) -> bool:
    return any(pattern in clean(value) for pattern in PURPOSE_PATTERNS)


def same_name(left: str, right: str) -> bool:
    return bool(normalize(left) and normalize(left) == normalize(right))


def contains_name(container: str, item: str) -> bool:
    left = normalize(container)
    right = normalize(item)
    return bool(left and right and (right in left or left in right))


def load_asset_decisions() -> dict[str, dict[str, str]]:
    if not ASSET_DECISIONS_CSV.exists():
        return {}
    with ASSET_DECISIONS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        return {
            row["asset_id"]: row
            for row in csv.DictReader(handle)
            if clean(row.get("asset_id"))
        }


def choose_project_candidate(
    row: dict[str, str],
    final_asset_name: str,
    final_fund_name: str,
    fund: dict | None,
    project: dict | None,
    project_is_pseudo: bool,
) -> tuple[str, str, str]:
    current_project_name = clean(row.get("project_name"))
    if project:
        candidate = clean(project.get("project_name"))
        return candidate, "actual_projects.project_name", "actual_project"

    if project_is_pseudo and fund:
        mission = clean(fund.get("project_mission_name"))
        fund_asset = clean(fund.get("asset_name"))
        if mission:
            return mission, "funds.project_mission_name", "fund_context_project_label"
        if fund_asset and not same_name(fund_asset, final_asset_name):
            return fund_asset, "funds.asset_name", "fund_context_asset_label"
        if current_project_name:
            return current_project_name, "csv.project_name", "pseudo_current_label"
        return final_asset_name or final_fund_name, "derived.asset_or_fund_name", "pseudo_derived_label"

    if current_project_name:
        return current_project_name, "csv.project_name", "unlinked_current_label"
    if final_asset_name and final_fund_name:
        return f"{final_asset_name} / {final_fund_name}", "derived.asset_fund_pair", "missing_project_derived_pair"
    return final_asset_name or final_fund_name, "derived.available_name", "missing_project_available_name"


def classify_project_display(
    candidate: str,
    final_asset_name: str,
    final_fund_name: str,
    project: dict | None,
    project_is_pseudo: bool,
    project_id: str,
) -> str:
    if project:
        if looks_vehicle_like(candidate):
            return "actual_project_vehicle_like_review"
        return "actual_project_keep"
    if not project_id:
        return "missing_project_relationship"
    if project_is_pseudo:
        if same_name(candidate, final_fund_name) or looks_vehicle_like(candidate):
            return "pseudo_project_vehicle_or_fund_context"
        if same_name(candidate, final_asset_name):
            return "pseudo_project_same_as_asset"
        if has_purpose_word(candidate):
            return "pseudo_project_business_label"
        return "pseudo_project_display_label"
    return "project_id_unresolved"


def main() -> None:
    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])
    funds = fetch_all(
        client,
        "funds",
        "fund_id,fund_name,short_name,asset_name,project_mission_name,status,sector",
    )
    projects = fetch_all(
        client,
        "projects",
        "project_id,project_name,project_type,status",
    )
    funds_by_id = {clean(row.get("fund_id")): row for row in funds if clean(row.get("fund_id"))}
    projects_by_id = {clean(row.get("project_id")): row for row in projects if clean(row.get("project_id"))}
    asset_decisions = load_asset_decisions()

    with RELATIONSHIP_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    basis_rows = []
    for row in rows:
        asset_id = clean(row.get("asset_id"))
        fund_id = clean(row.get("fund_id"))
        project_id = clean(row.get("project_id"))
        fund = funds_by_id.get(fund_id)
        project = projects_by_id.get(project_id)
        project_is_pseudo = bool(project_id and project_id in funds_by_id and project_id not in projects_by_id)
        pseudo_fund = funds_by_id.get(project_id) if project_is_pseudo else None

        decision = asset_decisions.get(asset_id, {})
        final_asset_name = clean(decision.get("final_asset_name")) or clean(row.get("proposed_asset_name")) or clean(row.get("asset_name"))
        asset_semantics = clean(decision.get("asset_semantics")) or clean(row.get("asset_kind"))
        final_fund_name = clean(fund.get("fund_name") if fund else "") or clean(row.get("fund_name"))
        final_fund_short_name = clean(fund.get("short_name") if fund else "") or clean(row.get("fund_short_name"))
        fund_name_status = "missing_fund_relationship" if not fund_id else ("fund_id_not_found" if not fund else "fund_name_verified")

        project_candidate, project_source, project_kind = choose_project_candidate(
            row,
            final_asset_name,
            final_fund_name,
            pseudo_fund or fund,
            project,
            project_is_pseudo,
        )
        project_display_class = classify_project_display(
            project_candidate,
            final_asset_name,
            final_fund_name,
            project,
            project_is_pseudo,
            project_id,
        )

        basis_rows.append(
            {
                **row,
                "final_asset_name": final_asset_name,
                "asset_semantics": asset_semantics,
                "asset_name_decision_status": clean(decision.get("decision_status")),
                "final_fund_name": final_fund_name,
                "final_fund_short_name": final_fund_short_name,
                "fund_name_status": fund_name_status,
                "project_display_name_candidate": project_candidate,
                "project_display_name_source": project_source,
                "project_display_kind": project_kind,
                "project_display_class": project_display_class,
                "project_id_is_actual_project": "true" if project else "false",
                "project_id_is_pseudo_fund_context": "true" if project_is_pseudo else "false",
                "project_name_contains_asset": "true" if contains_name(project_candidate, final_asset_name) else "false",
                "project_name_contains_fund": "true" if contains_name(project_candidate, final_fund_name) else "false",
                "project_name_has_purpose_word": "true" if has_purpose_word(project_candidate) else "false",
                "project_name_vehicle_like": "true" if looks_vehicle_like(project_candidate) else "false",
            }
        )

    fieldnames = list(basis_rows[0].keys()) if basis_rows else []
    with BASIS_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(basis_rows)

    review_keys = set()
    review_rows = []
    for row in basis_rows:
        display_class = row["project_display_class"]
        if display_class in {"actual_project_keep", "pseudo_project_business_label", "pseudo_project_same_as_asset"}:
            continue
        key = (
            row.get("asset_id"),
            row.get("fund_id"),
            row.get("project_id"),
            row.get("project_display_name_candidate"),
            display_class,
        )
        if key in review_keys:
            continue
        review_keys.add(key)
        review_rows.append(
            {
                "project_display_class": display_class,
                "asset_id": row.get("asset_id", ""),
                "final_asset_name": row.get("final_asset_name", ""),
                "asset_semantics": row.get("asset_semantics", ""),
                "fund_id": row.get("fund_id", ""),
                "final_fund_name": row.get("final_fund_name", ""),
                "fund_name_status": row.get("fund_name_status", ""),
                "project_id": row.get("project_id", ""),
                "current_project_name": row.get("project_name", ""),
                "project_display_name_candidate": row.get("project_display_name_candidate", ""),
                "project_display_name_source": row.get("project_display_name_source", ""),
                "project_display_kind": row.get("project_display_kind", ""),
                "project_id_is_actual_project": row.get("project_id_is_actual_project", ""),
                "project_id_is_pseudo_fund_context": row.get("project_id_is_pseudo_fund_context", ""),
                "project_name_contains_asset": row.get("project_name_contains_asset", ""),
                "project_name_contains_fund": row.get("project_name_contains_fund", ""),
                "project_name_has_purpose_word": row.get("project_name_has_purpose_word", ""),
                "project_name_vehicle_like": row.get("project_name_vehicle_like", ""),
                "suggested_display_behavior": suggested_behavior(display_class),
            }
        )

    review_fieldnames = list(review_rows[0].keys()) if review_rows else []
    with PROJECT_REVIEW_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=review_fieldnames)
        writer.writeheader()
        writer.writerows(review_rows)

    class_counts = Counter(row["project_display_class"] for row in basis_rows)
    fund_status_counts = Counter(row["fund_name_status"] for row in basis_rows)
    summary_lines = [
        "# 프로젝트명 정리 기준 CSV",
        "",
        f"- 기준 관계 행: {len(basis_rows)}행",
        f"- 출력: `{BASIS_CSV.name}`",
        f"- 프로젝트 검토 후보: `{PROJECT_REVIEW_CSV.name}` ({len(review_rows)}행)",
        "",
        "## 펀드명 상태",
        "",
        "| status | row count |",
        "|---|---:|",
    ]
    for status, count in fund_status_counts.most_common():
        summary_lines.append(f"| `{status}` | {count} |")
    summary_lines.extend(["", "## 프로젝트 표시 분류", "", "| class | row count |", "|---|---:|"])
    for item, count in class_counts.most_common():
        summary_lines.append(f"| `{item}` | {count} |")
    summary_lines.extend(
        [
            "",
            "## 작업 원칙",
            "",
            "- 펀드명은 `fund_id`가 있는 행에서 DB 기준으로 검증되었으므로 `final_fund_name`을 기준으로 사용합니다.",
            "- 자산명은 수동 판단까지 반영한 `final_asset_name`을 기준으로 사용합니다.",
            "- 프로젝트명은 실제 프로젝트, pseudo fund context, 누락 관계를 분리합니다.",
            "- `pseudo_project_*`는 실제 프로젝트 row로 간주하지 않고 drawer의 fund context 또는 business label로 표시합니다.",
            "- `missing_project_relationship`은 이름을 억지 생성하기보다 프로젝트 관계 발굴 대상으로 둡니다.",
        ]
    )
    SUMMARY_MD.write_text("\n".join(summary_lines), encoding="utf-8")

    print(
        json.dumps(
            {
                "basis_rows": len(basis_rows),
                "review_rows": len(review_rows),
                "fund_status_counts": fund_status_counts,
                "project_display_class_counts": class_counts,
            },
            ensure_ascii=False,
            indent=2,
            default=dict,
        )
    )
    print(str(BASIS_CSV))
    print(str(PROJECT_REVIEW_CSV))
    print(str(SUMMARY_MD))


def suggested_behavior(display_class: str) -> str:
    return {
        "missing_project_relationship": "프로젝트 없음/관계 발굴 대상. 자산+펀드 drawer에서는 프로젝트 미연결로 표시",
        "pseudo_project_vehicle_or_fund_context": "프로젝트가 아니라 펀드/비히클 컨텍스트명으로 표시",
        "pseudo_project_display_label": "프로젝트 확정 전 임시 표시명. drawer에서 fund context badge 필요",
        "actual_project_vehicle_like_review": "실제 프로젝트 테이블 값이나 비히클성 명칭이므로 표시명 검토",
        "project_id_unresolved": "project_id가 projects/funds 어디에도 없음. 관계키 검토",
        "pseudo_project_business_label": "프로젝트-like 업무명으로 표시 가능하나 실제 project row와 구분",
        "pseudo_project_same_as_asset": "자산명과 같은 업무 라벨. 프로젝트 badge 없이 자산 컨텍스트로 표시",
    }.get(display_class, "검토")


if __name__ == "__main__":
    main()
