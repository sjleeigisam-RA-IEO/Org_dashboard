from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "01. RA Portal" / "output" / "development_projects_34_20260630"
PROJECT_LEVEL_CSV = OUT_DIR / "dev_project_source_gap_candidates_20260706_project_level.csv"
EXISTING_JSON = OUT_DIR / "dev_project_34_summary_readback.json"


INCOMPLETE_CANDIDATE_NAMES = {
    "김포DC 개발사업": {
        "review_status": "미준공_추가검토유지",
        "review_note": "사용자 확인: 추가 후보 중 아직 준공 안 된 항목",
    },
    "안산 초지동 데이터센터": {
        "review_status": "미준공_추가검토유지",
        "review_note": "사용자 확인: 추가 후보 중 아직 준공 안 된 항목",
    },
    "오산세교 주거시설": {
        "review_status": "미준공_기존항목중복",
        "review_note": "사용자 확인: 기존 오산세교 주상복합 개발사업과 같은 항목",
        "duplicate_of": "오산세교 주상복합 개발사업",
    },
    "하남시풍산동9MW 데이터센터": {
        "review_status": "미준공_추가검토유지",
        "review_note": "사용자 확인: 추가 후보 중 아직 준공 안 된 항목",
    },
    "은평 시니어리빙 복합시설 개발": {
        "review_status": "미준공_추가검토유지",
        "review_note": "사용자 확인: 추가 후보 중 아직 준공 안 된 항목",
    },
    "위례Senior Living 개발사업": {
        "review_status": "미준공_추가검토유지",
        "review_note": "사용자 확인: 추가 후보 중 아직 준공 안 된 항목",
    },
}


COMPLETED_EXISTING_MATCHES = {
    "팩토리얼 성수": "사용자 확인: 준공된 항목. 바로 제외하지 않고 준공완료로 체크",
    "안성 성은 물류센터": "사용자 확인: 준공된 항목. 바로 제외하지 않고 준공완료로 체크",
    "안녕인사동": "사용자 확인: 준공된 항목. 바로 제외하지 않고 준공완료로 체크",
    "판교 제2테크노밸리 C1, C2블록 아이스퀘어 개발사업": "사용자 확인: 판교아이스퀘어. 준공된 항목. 바로 제외하지 않고 준공완료로 체크",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def md_cell(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "/").replace("\n", " ").strip()


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = [
        "| " + " | ".join(md_cell(header) for header in headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(md_cell(value) for value in row) + " |")
    return "\n".join(lines)


def main() -> None:
    candidate_rows = read_csv(PROJECT_LEVEL_CSV)
    existing_rows = json.loads(EXISTING_JSON.read_text(encoding="utf-8"))

    marked_candidates: list[dict[str, str]] = []
    for row in candidate_rows:
        name = row["project_or_asset_name"]
        mark = INCOMPLETE_CANDIDATE_NAMES.get(name)
        if not mark:
            continue
        marked = {
            "list_type": "additional_candidate",
            "project_or_asset_name": name,
            "review_status": mark["review_status"],
            "duplicate_of": mark.get("duplicate_of", ""),
            "fund_codes": row.get("fund_codes", ""),
            "short_names": row.get("short_names", ""),
            "fund_row_count": row.get("fund_row_count", ""),
            "operation_statuses": row.get("operation_statuses", ""),
            "review_note": mark["review_note"],
        }
        marked_candidates.append(marked)

    marked_existing: list[dict[str, str]] = []
    for row in existing_rows:
        project_name = row["project_name"]
        note = COMPLETED_EXISTING_MATCHES.get(project_name)
        if not note:
            continue
        marked_existing.append({
            "list_type": "existing_34",
            "project_or_asset_name": project_name,
            "review_status": "준공완료_제외검토",
            "duplicate_of": "",
            "fund_codes": " | ".join(row.get("fund_ids") or []),
            "short_names": " | ".join(row.get("short_names") or []),
            "fund_row_count": str(len(row.get("fund_ids") or [])),
            "operation_statuses": "",
            "review_note": note,
        })

    all_marks = marked_candidates + marked_existing
    csv_path = OUT_DIR / "dev_project_user_review_marks_20260706.csv"
    json_path = OUT_DIR / "dev_project_user_review_marks_20260706.json"
    md_path = OUT_DIR / "dev_project_user_review_marks_20260706.md"

    fields = [
        "list_type",
        "project_or_asset_name",
        "review_status",
        "duplicate_of",
        "fund_codes",
        "short_names",
        "fund_row_count",
        "operation_statuses",
        "review_note",
    ]
    write_csv(csv_path, all_marks, fields)
    json_path.write_text(json.dumps(all_marks, ensure_ascii=False, indent=2), encoding="utf-8")

    incomplete_keep = [row for row in marked_candidates if row["review_status"] == "미준공_추가검토유지"]
    duplicate_candidates = [row for row in marked_candidates if row["review_status"] == "미준공_기존항목중복"]

    md = f"""# 개발프로젝트 사용자 검토 체크

## 기준

- DB 반영 없음
- 기존 리스트에서 바로 제외하지 않음
- 사용자 메모 기준으로 검토 상태만 별도 체크
- 작성일: 2026-07-06

## 추가 후보 중 미준공으로 유지할 항목

{md_table(["No", "프로젝트/자산명", "펀드코드", "약칭", "펀드 row", "상태", "메모"], [
    [idx, row["project_or_asset_name"], row["fund_codes"], row["short_names"], row["fund_row_count"], row["review_status"], row["review_note"]]
    for idx, row in enumerate(incomplete_keep, start=1)
])}

## 추가 후보 중 기존 항목과 중복

{md_table(["No", "프로젝트/자산명", "기존 항목", "펀드코드", "약칭", "상태", "메모"], [
    [idx, row["project_or_asset_name"], row["duplicate_of"], row["fund_codes"], row["short_names"], row["review_status"], row["review_note"]]
    for idx, row in enumerate(duplicate_candidates, start=1)
])}

## 기존 34개 중 준공완료 체크

{md_table(["No", "프로젝트명", "펀드코드", "비히클", "상태", "메모"], [
    [idx, row["project_or_asset_name"], row["fund_codes"], row["short_names"], row["review_status"], row["review_note"]]
    for idx, row in enumerate(marked_existing, start=1)
])}
"""
    md_path.write_text(md, encoding="utf-8")

    print(json.dumps({
        "marked_candidate_count": len(marked_candidates),
        "incomplete_keep_count": len(incomplete_keep),
        "duplicate_candidate_count": len(duplicate_candidates),
        "completed_existing_count": len(marked_existing),
        "outputs": {
            "md": str(md_path),
            "csv": str(csv_path),
            "json": str(json_path),
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
