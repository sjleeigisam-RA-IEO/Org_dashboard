from __future__ import annotations

import csv
import html
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "00. Raw Data"
OUTPUT_DIR = ROOT / "01. RA Portal" / "output" / "development_projects_34_20260630"
EXISTING_PATH = OUTPUT_DIR / "dev_project_34_summary_readback.json"


DEVELOPMENT_TERMS = (
    "개발",
    "재개발",
    "복합개발",
    "도시개발",
    "PFV",
    "피에프브이",
)


TEXT_COLUMNS = (
    "펀드코드",
    "약칭",
    "펀드명",
    "자산명",
    "Vehicle구분",
    "법적형태",
    "펀드분류",
    "투자섹터",
    "펀드유형",
    "투자전략",
    "운용상태",
    "설정일",
    "만기일",
)


def norm(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.casefold()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[()\[\]{}<>〈〉「」『』,./·ㆍ_\-–—:;|+]", "", text)
    text = text.replace("주식회사", "").replace("(주)", "").replace("㈜", "")
    text = text.replace("프로젝트금융투자", "pfv")
    text = text.replace("피에프브이", "pfv")
    return text.strip()


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def row_is_blank(values: tuple[Any, ...]) -> bool:
    return not any(text(value) for value in values)


def load_rows(path: Path) -> list[list[Any]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    if hasattr(ws, "reset_dimensions"):
        ws.reset_dimensions()
    rows: list[list[Any]] = []
    for row in ws.iter_rows(values_only=True):
        if row_is_blank(row):
            continue
        values = list(row)
        while values and text(values[-1]) == "":
            values.pop()
        rows.append(values)
    return rows


def header_index(headers: list[Any]) -> dict[str, int]:
    result: dict[str, int] = {}
    for idx, value in enumerate(headers):
        key = text(value)
        if key and key not in result:
            result[key] = idx
    return result


def get_value(row: list[Any], hmap: dict[str, int], key: str) -> str:
    idx = hmap.get(key)
    if idx is None or idx >= len(row):
        return ""
    return text(row[idx])


def filename_kind(path: Path) -> str:
    name = path.name
    if "펀드 관리" in name:
        return "fund_master"
    if "펀드 AUM 관리" in name:
        return "fund_aum"
    if "투자 자산 조회" in name:
        return "fund_asset_lookup"
    if "투자 자산 관리" in name:
        return "asset_master"
    return "other"


def source_month(path: Path) -> str:
    match = re.search(r"(20\d{6})", path.name)
    if match:
        return match.group(1)
    match = re.search(r"(20\d{4})", path.name)
    return match.group(1) if match else ""


@dataclass
class ExistingIndex:
    projects: list[dict[str, Any]]
    fund_ids: set[str] = field(default_factory=set)
    names: set[str] = field(default_factory=set)
    rows_by_name: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))


def add_name(index: ExistingIndex, label: Any, project_name: str) -> None:
    key = norm(label)
    if len(key) < 2:
        return
    index.names.add(key)
    index.rows_by_name[key].append(project_name)


def load_existing_index() -> ExistingIndex:
    projects = json.loads(EXISTING_PATH.read_text(encoding="utf-8"))
    index = ExistingIndex(projects=projects)
    for row in projects:
        project_name = text(row.get("project_name"))
        add_name(index, project_name, project_name)
        add_name(index, row.get("vehicle_text"), project_name)
        for key in ("fund_ids", "short_names", "asset_names", "project_ids"):
            values = row.get(key) or []
            for item in values:
                if key == "fund_ids":
                    index.fund_ids.add(text(item))
                add_name(index, item, project_name)
    return index


def is_development_candidate(record: dict[str, str]) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    fund_type = record.get("펀드유형", "")
    strategy = record.get("투자전략", "")
    vehicle = record.get("Vehicle구분", "")
    combined = " | ".join(record.values())

    if "개발" in fund_type:
        reasons.append("펀드유형=개발")
    if "개발" in strategy or "development" in strategy.casefold():
        reasons.append("투자전략=개발")
    if "PFV" in vehicle.upper() or "피에프브이" in vehicle:
        reasons.append("Vehicle=PFV")
    for term in DEVELOPMENT_TERMS:
        if term in combined and term not in ("개발", "PFV"):
            reasons.append(f"명칭키워드={term}")
            break

    return bool(reasons), sorted(set(reasons))


def best_name_match(index: ExistingIndex, record: dict[str, str]) -> tuple[str, str]:
    candidates = [
        record.get("약칭", ""),
        record.get("펀드명", ""),
        record.get("자산명", ""),
    ]
    candidate_norms = [(value, norm(value)) for value in candidates if norm(value)]

    for raw, key in candidate_norms:
        if key in index.names:
            return "exact_name", "; ".join(sorted(set(index.rows_by_name[key])))

    for raw, key in candidate_norms:
        if len(key) < 4:
            continue
        for known in index.names:
            if len(known) < 4:
                continue
            if key in known or known in key:
                return "partial_name", "; ".join(sorted(set(index.rows_by_name[known])))

    return "", ""


def audit() -> dict[str, Any]:
    index = load_existing_index()
    source_files = sorted(SOURCE_DIR.rglob("*.xlsx"))
    profiles: list[dict[str, Any]] = []
    fund_records: list[dict[str, str]] = []

    for path in source_files:
        kind = filename_kind(path)
        rows = load_rows(path)
        profile = {
            "file": str(path.relative_to(ROOT)),
            "kind": kind,
            "month": source_month(path),
            "nonblank_rows": len(rows),
            "header": [text(value) for value in rows[0][:20]] if rows else [],
        }
        profiles.append(profile)

        if kind != "fund_master" or not rows:
            continue

        hmap = header_index(rows[0])
        for line_no, row in enumerate(rows[1:], start=2):
            record = {key: get_value(row, hmap, key) for key in TEXT_COLUMNS}
            record["source_file"] = str(path.relative_to(ROOT))
            record["source_month"] = source_month(path)
            record["source_line"] = str(line_no)
            if not record.get("펀드코드") and not record.get("펀드명"):
                continue
            fund_records.append(record)

    latest_month = max((r["source_month"] for r in fund_records if r["source_month"]), default="")
    latest_records = [r for r in fund_records if r["source_month"] == latest_month]

    candidates: list[dict[str, Any]] = []
    for record in latest_records:
        is_candidate, reasons = is_development_candidate(record)
        if not is_candidate:
            continue

        fund_code = record.get("펀드코드", "")
        match_type = ""
        matched_existing = ""
        if fund_code and fund_code in index.fund_ids:
            match_type = "existing_fund_code"
            matched_existing = "기존 34개 fund_ids"
        else:
            match_type, matched_existing = best_name_match(index, record)

        status = "existing_or_likely_existing" if match_type else "candidate_not_in_34"
        if match_type == "partial_name":
            status = "needs_manual_review"

        candidates.append({
            "status": status,
            "fund_code": fund_code,
            "short_name": record.get("약칭", ""),
            "fund_name": record.get("펀드명", ""),
            "asset_name": record.get("자산명", ""),
            "vehicle_type": record.get("Vehicle구분", ""),
            "legal_form": record.get("법적형태", ""),
            "fund_type": record.get("펀드유형", ""),
            "strategy": record.get("투자전략", ""),
            "sector": record.get("투자섹터", ""),
            "operation_status": record.get("운용상태", ""),
            "setup_date": record.get("설정일", ""),
            "maturity_date": record.get("만기일", ""),
            "source_file": record.get("source_file", ""),
            "source_line": record.get("source_line", ""),
            "candidate_reason": " | ".join(reasons),
            "match_type": match_type,
            "matched_existing": matched_existing,
        })

    by_status = Counter(item["status"] for item in candidates)
    by_reason = Counter(reason for item in candidates for reason in item["candidate_reason"].split(" | ") if reason)

    return {
        "existing_count": len(index.projects),
        "existing_fund_id_count": len(index.fund_ids),
        "source_file_count": len(source_files),
        "source_profiles": profiles,
        "latest_fund_master_month": latest_month,
        "latest_fund_master_rows": len(latest_records),
        "candidate_count": len(candidates),
        "candidate_status_counts": dict(by_status),
        "candidate_reason_counts": dict(by_reason),
        "candidates": candidates,
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "status",
        "fund_code",
        "short_name",
        "fund_name",
        "asset_name",
        "vehicle_type",
        "legal_form",
        "fund_type",
        "strategy",
        "sector",
        "operation_status",
        "setup_date",
        "maturity_date",
        "candidate_reason",
        "match_type",
        "matched_existing",
        "source_file",
        "source_line",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def group_active_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row["operation_status"] == "청산":
            continue
        key = norm(row.get("asset_name"))
        if not key:
            continue
        groups[key].append(row)

    grouped: list[dict[str, Any]] = []
    for items in groups.values():
        status_counts = Counter(item["status"] for item in items)
        if status_counts["candidate_not_in_34"] == len(items):
            status = "candidate_not_in_34"
        elif status_counts["existing_or_likely_existing"] == len(items):
            status = "existing_or_likely_existing"
        else:
            status = "needs_manual_review"

        def unique_join(field: str) -> str:
            values = []
            seen = set()
            for item in items:
                value = item.get(field, "")
                if not value:
                    continue
                if value in seen:
                    continue
                seen.add(value)
                values.append(value)
            return " | ".join(values)

        grouped.append({
            "status": status,
            "project_or_asset_name": items[0].get("asset_name") or items[0].get("fund_name") or items[0].get("short_name"),
            "fund_row_count": len(items),
            "fund_codes": unique_join("fund_code"),
            "short_names": unique_join("short_name"),
            "fund_names": unique_join("fund_name"),
            "vehicle_types": unique_join("vehicle_type"),
            "fund_types": unique_join("fund_type"),
            "strategies": unique_join("strategy"),
            "operation_statuses": unique_join("operation_status"),
            "setup_dates": unique_join("setup_date"),
            "maturity_dates": unique_join("maturity_date"),
            "candidate_reasons": unique_join("candidate_reason"),
            "match_types": unique_join("match_type"),
            "matched_existing": unique_join("matched_existing"),
            "source_files": unique_join("source_file"),
            "source_lines": unique_join("source_line"),
        })

    rank = {
        "candidate_not_in_34": 0,
        "needs_manual_review": 1,
        "existing_or_likely_existing": 2,
    }
    return sorted(grouped, key=lambda item: (rank.get(item["status"], 99), item["project_or_asset_name"]))


def write_grouped_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "status",
        "project_or_asset_name",
        "fund_row_count",
        "fund_codes",
        "short_names",
        "fund_names",
        "vehicle_types",
        "fund_types",
        "strategies",
        "operation_statuses",
        "setup_dates",
        "maturity_dates",
        "candidate_reasons",
        "match_types",
        "matched_existing",
        "source_files",
        "source_lines",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_grouped_html(path: Path, result: dict[str, Any], grouped_rows: list[dict[str, Any]]) -> None:
    new_rows = [row for row in grouped_rows if row["status"] == "candidate_not_in_34"]
    review_rows = [row for row in grouped_rows if row["status"] == "needs_manual_review"]
    existing_rows = [row for row in grouped_rows if row["status"] == "existing_or_likely_existing"]

    def table(items: list[dict[str, Any]]) -> str:
        cols = [
            ("status", "판정"),
            ("project_or_asset_name", "프로젝트/자산명"),
            ("fund_row_count", "펀드 row"),
            ("fund_codes", "펀드코드"),
            ("short_names", "약칭"),
            ("fund_names", "펀드명"),
            ("vehicle_types", "Vehicle"),
            ("fund_types", "펀드유형"),
            ("operation_statuses", "운용상태"),
            ("setup_dates", "설정일"),
            ("candidate_reasons", "후보 사유"),
            ("match_types", "매칭"),
            ("matched_existing", "기존 매칭"),
            ("source_files", "소스"),
            ("source_lines", "행"),
        ]
        if not items:
            return "<p class=\"empty\">해당 항목 없음</p>"
        head = "".join(f"<th>{html.escape(label)}</th>" for _, label in cols)
        body = []
        for item in items:
            body.append("<tr>" + "".join(
                f"<td>{html.escape(str(item.get(key, '')))}</td>" for key, _ in cols
            ) + "</tr>")
        return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"

    profile_rows = "".join(
        "<tr>"
        f"<td>{html.escape(item['file'])}</td>"
        f"<td>{html.escape(item['kind'])}</td>"
        f"<td>{html.escape(item['month'])}</td>"
        f"<td>{item['nonblank_rows']}</td>"
        f"<td>{html.escape(' | '.join(item['header'][:10]))}</td>"
        "</tr>"
        for item in result["source_profiles"]
    )

    document = f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>개발프로젝트 추가 후보 대조 - 프로젝트 단위</title>
  <style>
    body {{ margin: 28px; font-family: "Segoe UI", "Malgun Gothic", Arial, sans-serif; color: #17202a; background: #f6f7f9; }}
    h1 {{ margin: 0 0 8px; font-size: 24px; }}
    h2 {{ margin: 28px 0 10px; font-size: 17px; }}
    p {{ margin: 6px 0; color: #4b5563; }}
    .summary {{ display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 10px; margin: 18px 0; }}
    .metric {{ padding: 12px; border: 1px solid #d8dde6; border-radius: 8px; background: #fff; }}
    .metric span {{ display: block; font-size: 12px; color: #667085; }}
    .metric strong {{ display: block; margin-top: 5px; font-size: 22px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff; font-size: 12px; }}
    th, td {{ border: 1px solid #d8dde6; padding: 7px 8px; text-align: left; vertical-align: top; }}
    th {{ position: sticky; top: 0; background: #e9edf2; z-index: 1; }}
    td {{ max-width: 420px; overflow-wrap: anywhere; }}
    .section {{ max-height: 540px; overflow: auto; border: 1px solid #d8dde6; background: #fff; }}
    .empty {{ padding: 14px; border: 1px solid #d8dde6; background: #fff; }}
    .note {{ color: #667085; font-size: 13px; }}
  </style>
</head>
<body>
  <h1>개발프로젝트 추가 후보 대조 - 프로젝트/자산명 단위</h1>
  <p class="note">기준: 00. Raw Data 최신 펀드 관리 파일({result['latest_fund_master_month']})의 개발 후보 중 청산 항목 제외. DB에는 추가 적재하지 않음.</p>
  <div class="summary">
    <div class="metric"><span>기존 리스트</span><strong>{result['existing_count']}</strong></div>
    <div class="metric"><span>청산 제외 고유 후보</span><strong>{len(grouped_rows)}</strong></div>
    <div class="metric"><span>기존 외 후보</span><strong>{len(new_rows)}</strong></div>
    <div class="metric"><span>수동 검토</span><strong>{len(review_rows)}</strong></div>
    <div class="metric"><span>기존 매칭</span><strong>{len(existing_rows)}</strong></div>
  </div>
  <h2>기존 34개 외 추가 후보</h2>
  <div class="section">{table(new_rows)}</div>
  <h2>수동 검토 후보</h2>
  <div class="section">{table(review_rows)}</div>
  <h2>기존 또는 기존으로 추정된 항목</h2>
  <div class="section">{table(existing_rows)}</div>
  <h2>참고한 소스 파일</h2>
  <div class="section">
    <table>
      <thead><tr><th>파일</th><th>유형</th><th>월</th><th>비공백 행</th><th>헤더 샘플</th></tr></thead>
      <tbody>{profile_rows}</tbody>
    </table>
  </div>
</body>
</html>
"""
    path.write_text(document, encoding="utf-8")


def md_cell(value: Any) -> str:
    text_value = "" if value is None else str(value)
    text_value = re.sub(r"\s*\|\s*", " / ", text_value)
    text_value = text_value.replace("\\", "\\\\").replace("|", "\\|")
    text_value = re.sub(r"\s+", " ", text_value).strip()
    return text_value


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = [
        "| " + " | ".join(md_cell(header) for header in headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(md_cell(value) for value in row) + " |")
    return "\n".join(lines)


def write_markdown(path: Path, result: dict[str, Any], grouped_rows: list[dict[str, Any]]) -> None:
    existing_rows = result["source_profiles"]
    projects = json.loads(EXISTING_PATH.read_text(encoding="utf-8"))
    new_rows = [row for row in grouped_rows if row["status"] == "candidate_not_in_34"]
    review_rows = [row for row in grouped_rows if row["status"] == "needs_manual_review"]
    matched_rows = [row for row in grouped_rows if row["status"] == "existing_or_likely_existing"]

    existing_table_rows = [
        [
            row.get("list_no", ""),
            row.get("project_name", ""),
            row.get("vehicle_text", ""),
            " / ".join(row.get("fund_ids") or []),
            " / ".join(row.get("asset_names") or []),
        ]
        for row in sorted(projects, key=lambda item: int(item.get("list_no") or 0))
    ]

    candidate_table_rows = [
        [
            idx,
            row["project_or_asset_name"],
            row["fund_row_count"],
            row["fund_codes"],
            row["short_names"],
            row["operation_statuses"],
            row["candidate_reasons"],
        ]
        for idx, row in enumerate(new_rows, start=1)
    ]

    review_table_rows = [
        [
            idx,
            row["project_or_asset_name"],
            row["fund_codes"],
            row["short_names"],
            row["match_types"],
            row["matched_existing"],
        ]
        for idx, row in enumerate(review_rows, start=1)
    ]

    matched_table_rows = [
        [
            idx,
            row["project_or_asset_name"],
            row["fund_codes"],
            row["short_names"],
            row["matched_existing"],
        ]
        for idx, row in enumerate(matched_rows, start=1)
    ]

    source_table_rows = [
        [
            item["file"],
            item["kind"],
            item["month"],
            item["nonblank_rows"],
        ]
        for item in existing_rows
    ]

    document = f"""# 개발프로젝트 리스트 비교

## 기준

- 기존 리스트: `34개`
- 비교 원천: `00. Raw Data` 폴더 내 엑셀 `14개`
- 최신 펀드 관리 기준: `{result['latest_fund_master_month']}`
- 최신 펀드 관리 row: `{result['latest_fund_master_rows']:,}개`
- 개발 후보 fund row: `{result['candidate_count']}개`
- 청산 제외 + 자산/프로젝트명 기준 고유 후보: `{len(grouped_rows)}개`
- 기존 34개와 매칭: `{len(matched_rows)}개`
- 기존 외 추가 후보: `{len(new_rows)}개`
- 수동 검토 필요: `{len(review_rows)}개`

> 주의: 이 문서는 판단용 비교표이며 DB에는 추가 적재하지 않았다.

## 기존 34개 리스트

{md_table(["No", "프로젝트명", "비히클", "펀드코드", "자산명"], existing_table_rows)}

## 기존 34개 외 추가 후보

{md_table(["No", "프로젝트/자산명", "펀드 row", "펀드코드", "약칭", "운용상태", "후보 사유"], candidate_table_rows)}

## 수동 검토 후보

{md_table(["No", "프로젝트/자산명", "펀드코드", "약칭", "매칭 방식", "기존 매칭 후보"], review_table_rows)}

## 기존 매칭으로 분류된 후보

{md_table(["No", "프로젝트/자산명", "펀드코드", "약칭", "기존 매칭"], matched_table_rows)}

## 참고 소스 파일

{md_table(["파일", "유형", "월", "비공백 행"], source_table_rows)}
"""
    path.write_text(document, encoding="utf-8")


def write_html(path: Path, result: dict[str, Any]) -> None:
    rows = result["candidates"]
    new_rows = [row for row in rows if row["status"] == "candidate_not_in_34"]
    review_rows = [row for row in rows if row["status"] == "needs_manual_review"]
    existing_rows = [row for row in rows if row["status"] == "existing_or_likely_existing"]

    def table(items: list[dict[str, Any]]) -> str:
        cols = [
            ("status", "판정"),
            ("fund_code", "펀드코드"),
            ("short_name", "약칭"),
            ("fund_name", "펀드명"),
            ("asset_name", "자산명"),
            ("vehicle_type", "Vehicle"),
            ("fund_type", "펀드유형"),
            ("strategy", "투자전략"),
            ("operation_status", "운용상태"),
            ("setup_date", "설정일"),
            ("candidate_reason", "후보 사유"),
            ("match_type", "매칭"),
            ("matched_existing", "기존 매칭"),
            ("source_file", "소스"),
            ("source_line", "행"),
        ]
        if not items:
            return "<p class=\"empty\">해당 항목 없음</p>"
        head = "".join(f"<th>{html.escape(label)}</th>" for _, label in cols)
        body = []
        for item in items:
            body.append("<tr>" + "".join(
                f"<td>{html.escape(str(item.get(key, '')))}</td>" for key, _ in cols
            ) + "</tr>")
        return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"

    profile_rows = "".join(
        "<tr>"
        f"<td>{html.escape(item['file'])}</td>"
        f"<td>{html.escape(item['kind'])}</td>"
        f"<td>{html.escape(item['month'])}</td>"
        f"<td>{item['nonblank_rows']}</td>"
        f"<td>{html.escape(' | '.join(item['header'][:10]))}</td>"
        "</tr>"
        for item in result["source_profiles"]
    )

    document = f"""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>개발프로젝트 추가 후보 대조</title>
  <style>
    body {{ margin: 28px; font-family: "Segoe UI", "Malgun Gothic", Arial, sans-serif; color: #17202a; background: #f6f7f9; }}
    h1 {{ margin: 0 0 8px; font-size: 24px; }}
    h2 {{ margin: 28px 0 10px; font-size: 17px; }}
    p {{ margin: 6px 0; color: #4b5563; }}
    .summary {{ display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 10px; margin: 18px 0; }}
    .metric {{ padding: 12px; border: 1px solid #d8dde6; border-radius: 8px; background: #fff; }}
    .metric span {{ display: block; font-size: 12px; color: #667085; }}
    .metric strong {{ display: block; margin-top: 5px; font-size: 22px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff; font-size: 12px; }}
    th, td {{ border: 1px solid #d8dde6; padding: 7px 8px; text-align: left; vertical-align: top; }}
    th {{ position: sticky; top: 0; background: #e9edf2; z-index: 1; }}
    td {{ max-width: 360px; overflow-wrap: anywhere; }}
    .section {{ max-height: 520px; overflow: auto; border: 1px solid #d8dde6; background: #fff; }}
    .empty {{ padding: 14px; border: 1px solid #d8dde6; background: #fff; }}
    .note {{ color: #667085; font-size: 13px; }}
  </style>
</head>
<body>
  <h1>개발프로젝트 추가 후보 대조</h1>
  <p class="note">기준: 기존 34개 리스트와 00. Raw Data 최신 펀드 관리 파일을 대조. DB에는 추가 적재하지 않음.</p>
  <div class="summary">
    <div class="metric"><span>기존 리스트</span><strong>{result['existing_count']}</strong></div>
    <div class="metric"><span>원천 파일</span><strong>{result['source_file_count']}</strong></div>
    <div class="metric"><span>최신 펀드관리 행</span><strong>{result['latest_fund_master_rows']}</strong></div>
    <div class="metric"><span>개발 후보 전체</span><strong>{result['candidate_count']}</strong></div>
    <div class="metric"><span>기존 외 후보</span><strong>{len(new_rows)}</strong></div>
  </div>
  <h2>기존 34개 외 추가 후보</h2>
  <div class="section">{table(new_rows)}</div>
  <h2>수동 검토 후보</h2>
  <div class="section">{table(review_rows)}</div>
  <h2>기존 또는 기존으로 추정된 항목</h2>
  <div class="section">{table(existing_rows)}</div>
  <h2>참고한 소스 파일</h2>
  <div class="section">
    <table>
      <thead><tr><th>파일</th><th>유형</th><th>월</th><th>비공백 행</th><th>헤더 샘플</th></tr></thead>
      <tbody>{profile_rows}</tbody>
    </table>
  </div>
</body>
</html>
"""
    path.write_text(document, encoding="utf-8")


def main() -> None:
    result = audit()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stem = "dev_project_source_gap_candidates_20260706"
    json_path = OUTPUT_DIR / f"{stem}.json"
    csv_path = OUTPUT_DIR / f"{stem}.csv"
    html_path = OUTPUT_DIR / f"{stem}.html"
    grouped_rows = group_active_candidates(result["candidates"])
    grouped_csv_path = OUTPUT_DIR / f"{stem}_project_level.csv"
    grouped_html_path = OUTPUT_DIR / f"{stem}_project_level.html"
    markdown_path = OUTPUT_DIR / f"{stem}_list_comparison.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(csv_path, result["candidates"])
    write_html(html_path, result)
    write_grouped_csv(grouped_csv_path, grouped_rows)
    write_grouped_html(grouped_html_path, result, grouped_rows)
    write_markdown(markdown_path, result, grouped_rows)
    grouped_counts = Counter(item["status"] for item in grouped_rows)
    print(json.dumps({
        "existing_count": result["existing_count"],
        "source_file_count": result["source_file_count"],
        "latest_fund_master_month": result["latest_fund_master_month"],
        "latest_fund_master_rows": result["latest_fund_master_rows"],
        "candidate_count": result["candidate_count"],
        "candidate_status_counts": result["candidate_status_counts"],
        "candidate_reason_counts": result["candidate_reason_counts"],
        "project_level_active_count": len(grouped_rows),
        "project_level_status_counts": dict(grouped_counts),
        "outputs": {
            "json": str(json_path),
            "csv": str(csv_path),
            "html": str(html_path),
            "project_level_csv": str(grouped_csv_path),
            "project_level_html": str(grouped_html_path),
            "markdown": str(markdown_path),
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
