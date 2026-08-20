from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import reconcile_20260608_excel_vs_supabase as base  # noqa: E402


OUT_DIR = ROOT / "01. RA Portal" / "output" / "reconciliation_20260608_relationship_focus"


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        fieldnames = []
        for row in rows:
            for key in row:
                if key not in fieldnames:
                    fieldnames.append(key)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def source_frames() -> tuple[dict[str, tuple[Path, int]], dict[str, pd.DataFrame]]:
    files = base.source_files()
    frames = {key: base.read_excel(path, header) for key, (path, header) in files.items()}
    return files, frames


def supabase_snapshot() -> dict[str, list[dict[str, Any]]]:
    base.load_env()
    return {
        "funds": base.fetch_all("funds"),
        "asset_master": base.fetch_all("asset_master"),
        "asset_fund_links": base.fetch_all("asset_fund_links"),
        "lender_exposures": base.fetch_all("lender_exposures"),
        "beneficiary_exposures": base.fetch_all("beneficiary_exposures"),
        "asset_building_ledger": base.fetch_all("asset_building_ledger"),
    }


def relevant_issue(row: dict[str, Any]) -> bool:
    issue = row.get("issue_type", "")
    severity = row.get("severity", "")
    if severity == "info":
        return False
    if issue.startswith("supabase_"):
        return False
    return True


def aggregate_source_fund_assets(frame: pd.DataFrame) -> dict[str, set[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    for _, row in frame.iterrows():
        fund_id = base.norm_id(row.get("펀드코드"))
        asset_name = base.clean(row.get("자산(건물)명"))
        if base.valid_fund_id(fund_id) and asset_name:
            result[fund_id].add(asset_name)
    return result


def db_fund_asset_names(db: dict[str, list[dict[str, Any]]]) -> dict[str, set[str]]:
    assets = {base.clean(row.get("asset_id")): row for row in db["asset_master"]}
    result: dict[str, set[str]] = defaultdict(set)
    for link in db["asset_fund_links"]:
        fund_id = base.norm_id(link.get("fund_id"))
        asset = assets.get(base.clean(link.get("asset_id")), {})
        name = base.clean(asset.get("canonical_name"))
        if fund_id and name:
            result[fund_id].add(name)
    return result


def new_fund_relationship_summary(
    frames: dict[str, pd.DataFrame], db: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    db_funds = {base.norm_id(row.get("fund_id")) for row in db["funds"]}
    fund_master = base.by_key(frames["fund_master"], "펀드코드")
    aum = base.by_key(frames["fund_aum"], "펀드코드")
    source_assets = aggregate_source_fund_assets(frames["fund_asset_source"])
    lender = base.aggregate_lender(frames["lender_source"])
    beneficiary = base.aggregate_beneficiary(frames["beneficiary_source"])
    rows = []
    for fund_id, row in sorted(fund_master.items()):
        if fund_id in db_funds:
            continue
        rows.append(
            {
                "fund_id": fund_id,
                "fund_name": base.clean(row.get("펀드명")),
                "has_aum_source": fund_id in aum,
                "source_asset_count": len(source_assets.get(fund_id, set())),
                "source_assets": " | ".join(sorted(source_assets.get(fund_id, set()))),
                "lender_source_rows": lender.get(fund_id, {}).get("rows", 0),
                "beneficiary_source_rows": beneficiary.get(fund_id, {}).get("rows", 0),
                "relationship_update_meaning": "New fund row candidate; create fund first, then attach AUM/assets/exposure only if source relationships are confirmed.",
            }
        )
    return rows


def fund_aum_exposure_relationship_checks(
    frames: dict[str, pd.DataFrame], db: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    db_funds = {base.norm_id(row.get("fund_id")): row for row in db["funds"]}
    aum = base.by_key(frames["fund_aum"], "펀드코드")
    lender = base.aggregate_lender(frames["lender_source"])
    beneficiary = base.aggregate_beneficiary(frames["beneficiary_source"])
    rows = []
    for fund_id, row in sorted(aum.items()):
        benchmark = base.num(row.get("AUM(원)")) or 0
        invested = base.num(row.get("AUM(원).1")) or 0
        lender_committed = lender.get(fund_id, {}).get("committed", 0)
        beneficiary_committed = beneficiary.get(fund_id, {}).get("committed", 0)
        beneficiary_invested = beneficiary.get(fund_id, {}).get("invested", 0)
        flags = []
        if fund_id not in db_funds:
            flags.append("aum_fund_missing_in_supabase")
        if lender_committed and benchmark and lender_committed > benchmark * 1.25:
            flags.append("lender_committed_gt_125pct_benchmark_aum")
        if beneficiary_committed and benchmark and beneficiary_committed > benchmark * 1.25:
            flags.append("beneficiary_committed_gt_125pct_benchmark_aum")
        if beneficiary_invested and invested and beneficiary_invested > invested * 1.25:
            flags.append("beneficiary_invested_gt_125pct_invested_aum")
        if benchmark == 0 and (lender_committed or beneficiary_committed):
            flags.append("exposure_exists_but_benchmark_aum_zero")
        if flags:
            rows.append(
                {
                    "fund_id": fund_id,
                    "fund_name": base.clean(row.get("펀드명")),
                    "benchmark_aum_source": benchmark,
                    "invested_aum_source": invested,
                    "lender_committed_source_sum": lender_committed,
                    "beneficiary_committed_source_sum": beneficiary_committed,
                    "beneficiary_invested_source_sum": beneficiary_invested,
                    "flags": " | ".join(flags),
                    "review_note": "Relationship check only; not an automatic error because AUM and exposure are different concepts.",
                }
            )
    return rows


def asset_source_provenance_candidates(
    asset_issues: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    direct_fields = {"business_stage", "portfolio_region", "asset_type", "canonical_name", "address_text"}
    api_sensitive_fields = {"site_area", "gross_floor_area", "completion_date", "parking"}
    direct_rows = []
    api_rows = []
    for row in asset_issues:
        field = row.get("field")
        if field in direct_fields:
            direct_rows.append({**row, "provenance_bucket": "source_direct_or_canonical_mapping"})
        elif field in api_sensitive_fields:
            api_rows.append({**row, "provenance_bucket": "api_sensitive_do_not_overwrite_without_review"})
    return direct_rows, api_rows


def write_report(summary: dict[str, Any]) -> None:
    lines = [
        "# 2026-06-08 관계 중심 업데이트 후보 보고서",
        "",
        f"- 작성일: {datetime.now().isoformat(timespec='seconds')}",
        "- 원칙: 오늘 원본에서 줄어든 row는 삭제/축소 후보로 보지 않는다.",
        "- 초점: 신규 row, 기존 row의 컬럼 업데이트, 펀드-자산-AUM-exposure 관계 정합성.",
        "- Supabase 수정 없음. 읽기 전용 비교만 수행.",
        "",
        "## 핵심 숫자",
        "",
    ]
    for key, value in summary.items():
        if key == "files":
            continue
        lines.append(f"- {key}: {value}")
    lines.extend(
        [
            "",
            "## 산출물",
            "",
            "- `relationship_focused_update_candidates.csv`: 감소/삭제성 후보를 뺀 신규/변경 후보",
            "- `new_fund_relationship_summary.csv`: 신규 fund 후보와 AUM/자산/exposure 연결 여부",
            "- `fund_aum_exposure_relationship_checks.csv`: AUM과 exposure 사이의 관계상 이상 후보",
            "- `source_direct_asset_field_candidates.csv`: 원본 직접값/canonical 매핑 후보",
            "- `api_sensitive_asset_field_candidates.csv`: API 보강값을 덮어쓸 수 있는 위험 후보",
            "- `relationship_focus_summary.json`: 요약 JSON",
            "",
            "## 판단 기준",
            "",
            "1. source에 없어진 DB row는 이번 검토에서 제외한다.",
            "2. 신규 fund는 `funds` 생성 여부를 먼저 확정하고 AUM/자산/exposure를 뒤따라 붙인다.",
            "3. AUM은 DB가 2026-04-30, 오늘 source가 2026-05-31이라 차이가 나는 것이 정상 업데이트 후보일 수 있다.",
            "4. fund-asset exact mismatch는 canonical/inferred/synthetic 관계를 먼저 분류한다.",
            "5. asset physical/API 필드는 `building_ledger_source`와 `api_enrichment_status` 확인 전 덮어쓰지 않는다.",
        ]
    )
    (OUT_DIR / "relationship_focused_report.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files, frames = source_frames()
    db = supabase_snapshot()

    fund_issues = base.compare_funds(frames["fund_master"], db["funds"])
    aum_issues = base.compare_aum(frames["fund_aum"], db["funds"])
    asset_issues = base.compare_assets(frames["asset_master_source"], db["asset_master"])
    fund_asset_issues = base.compare_fund_asset_pairs(frames["fund_asset_source"], db["asset_fund_links"], db["asset_master"])
    exposure_issues = base.compare_exposures(
        frames["lender_source"],
        frames["beneficiary_source"],
        db["lender_exposures"],
        db["beneficiary_exposures"],
    )
    focused = [
        row
        for row in fund_issues + aum_issues + asset_issues + fund_asset_issues + exposure_issues
        if relevant_issue(row)
    ]
    direct_asset, api_asset = asset_source_provenance_candidates(asset_issues)
    new_fund_rows = new_fund_relationship_summary(frames, db)
    relation_checks = fund_aum_exposure_relationship_checks(frames, db)

    write_csv(OUT_DIR / "relationship_focused_update_candidates.csv", focused)
    write_csv(OUT_DIR / "new_fund_relationship_summary.csv", new_fund_rows)
    write_csv(OUT_DIR / "fund_aum_exposure_relationship_checks.csv", relation_checks)
    write_csv(OUT_DIR / "source_direct_asset_field_candidates.csv", direct_asset)
    write_csv(OUT_DIR / "api_sensitive_asset_field_candidates.csv", api_asset)

    summary = {
        "focused_update_candidates": len(focused),
        "new_fund_candidates": len(new_fund_rows),
        "relationship_checks": len(relation_checks),
        "source_direct_asset_field_candidates": len(direct_asset),
        "api_sensitive_asset_field_candidates": len(api_asset),
        "files": {key: path.name for key, (path, _) in files.items()},
    }
    (OUT_DIR / "relationship_focus_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(summary)
    print(json.dumps({"output_dir": str(OUT_DIR), **summary}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
