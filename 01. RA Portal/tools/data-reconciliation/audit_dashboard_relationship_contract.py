from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "01. RA Portal" / "output" / "dashboard_relationship_contract"
DEFAULT_QUERIES = [
    "이오타서울",
    "멀티플러스",
    "그린ON",
    "NPL",
    "눈스퀘어",
    "국민연금",
    "홈플러스",
    "1120",
]


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_json(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    query = urllib.parse.urlencode(params, safe="*,.:()")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    req = urllib.request.Request(f"{url}/rest/v1/{path}?{query}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.loads(response.read().decode("utf-8") or "[]")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {path} failed: HTTP {exc.code} {detail}") from exc


def fetch_count(table: str, extra: dict[str, str] | None = None, count_mode: str = "exact") -> str:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    params = {"select": "*"}
    params.update(extra or {})
    query = urllib.parse.urlencode(params, safe="*,.:()")
    req = urllib.request.Request(
        f"{url}/rest/v1/{table}?{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": f"count={count_mode}", "Range": "0-0"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        content_range = response.headers.get("Content-Range", "")
    return content_range.split("/")[-1] if "/" in content_range else content_range


def safe_fetch_count(table: str, extra: dict[str, str] | None = None, count_mode: str = "exact") -> str:
    try:
        return fetch_count(table, extra, count_mode=count_mode)
    except Exception as exc:
        return f"missing_or_error: {exc}"


def build_filter(query: str) -> str:
    terms = [term for term in re.split(r"\s+", query.strip()) if term]
    return ",".join(f"token_text.ilike.%{term}%" for term in terms)


def is_short_numeric_search(query: str) -> bool:
    return bool(re.fullmatch(r"\d{1,4}", query.strip()))


def audit_query(query: str, limit: int) -> list[dict[str, Any]]:
    params = {
        "select": "*",
        "or": f"({build_filter(query)})",
        "order": "rank_weight.desc",
        "limit": str(limit),
    }
    if is_short_numeric_search(query):
        params["entity_type"] = "in.(fund,project)"
    return request_json(
        "portfolio_search_results_canonical",
        params,
    )


def summarize_queries(queries: list[str], limit: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    detail_rows: list[dict[str, Any]] = []
    summary_rows: list[dict[str, Any]] = []
    for query in queries:
        try:
            rows = audit_query(query, limit)
        except Exception as exc:
            summary_rows.append(
                {
                    "query": query,
                    "total": 0,
                    "fund": 0,
                    "asset": 0,
                    "project": 0,
                    "lender": 0,
                    "beneficiary": 0,
                    "error": f"portfolio_search_results_canonical unavailable: {exc}",
                }
            )
            continue
        counts = Counter(row.get("entity_type") for row in rows)
        summary_rows.append(
            {
                "query": query,
                "total": len(rows),
                "fund": counts.get("fund", 0),
                "asset": counts.get("asset", 0),
                "project": counts.get("project", 0),
                "lender": counts.get("lender", 0),
                "beneficiary": counts.get("beneficiary", 0),
                "error": "",
            }
        )
        for row in rows[:limit]:
            detail_rows.append(
                {
                    "query": query,
                    "entity_type": row.get("entity_type"),
                    "entity_id": row.get("entity_id"),
                    "display_title": clean(row.get("display_title")),
                    "display_subtitle": clean(row.get("display_subtitle")),
                    "token_text": clean(row.get("token_text")),
                    "token_type": row.get("token_type"),
                    "related_asset_id": row.get("related_asset_id"),
                    "related_fund_id": row.get("related_fund_id"),
                    "related_project_id": row.get("related_project_id"),
                    "relation_type": row.get("relation_type"),
                    "source_table": row.get("source_table"),
                    "rank_weight": row.get("rank_weight"),
                }
            )
    return summary_rows, detail_rows


def relationship_contract_counts() -> dict[str, str]:
    counts = {
        "portfolio_search_results_canonical": safe_fetch_count("portfolio_search_results_canonical"),
        "portfolio_search_index": safe_fetch_count("portfolio_search_index"),
        "asset_exposure_edges": safe_fetch_count("asset_exposure_edges"),
        "relationship_index_entities": safe_fetch_count("relationship_index_entities"),
        "relationship_index_edges": safe_fetch_count("relationship_index_edges"),
        "relationship_index_tokens": "raw_view_available_not_counted",
        "relationship_index_search_results": safe_fetch_count("relationship_index_search_results"),
        "relationship_index_audit": safe_fetch_count("relationship_index_audit"),
        "dashboard_relationship_contract_audit": safe_fetch_count("dashboard_relationship_contract_audit"),
        "relationship_contract_audit_v1": safe_fetch_count("relationship_contract_audit_v1"),
        "dashboard_search_result_contract_audit": safe_fetch_count("dashboard_search_result_contract_audit"),
        "funds": safe_fetch_count("funds"),
        "asset_master": safe_fetch_count("asset_master"),
        "asset_fund_links": safe_fetch_count("asset_fund_links"),
        "asset_project_links": safe_fetch_count("asset_project_links"),
        "projects": safe_fetch_count("projects"),
        "lender_exposures": safe_fetch_count("lender_exposures"),
        "beneficiary_exposures": safe_fetch_count("beneficiary_exposures"),
    }
    for issue in [
        "asset_project_link_without_project_or_fund",
        "fund_primary_asset_without_link",
        "project_primary_asset_without_link",
    ]:
        counts[f"audit:{issue}"] = safe_fetch_count("dashboard_relationship_contract_audit", {"issue_type": f"eq.{issue}"})
    for issue in [
        "asset_project_link_unresolved_target",
        "fund_primary_asset_without_link",
        "project_primary_asset_without_link",
        "aum_allocation_review_required",
        "iota_target_unresolved",
    ]:
        counts[f"audit_v1:{issue}"] = safe_fetch_count("relationship_contract_audit_v1", {"issue_type": f"eq.{issue}"})
    counts["audit_v1:search_display_title_variants"] = "see_search_contract:display_title_variants"
    counts["search_contract:display_title_variants"] = safe_fetch_count(
        "dashboard_search_result_contract_audit", {"display_title_variants": "gt.1"}
    )
    counts["search_contract:blank_display_title"] = safe_fetch_count(
        "dashboard_search_result_contract_audit", {"has_blank_display_title": "eq.true"}
    )
    counts["exposure_edges:multi_asset_review_required"] = safe_fetch_count(
        "asset_exposure_edges", {"allocation_status": "eq.multi_asset_review_required"}
    )
    counts["relationship_index:review_required_edges"] = safe_fetch_count(
        "relationship_index_edges", {"status": "eq.review_required"}
    )
    counts["relationship_index:amount_rollup_disabled"] = safe_fetch_count(
        "relationship_index_edges", {"include_in_search": "eq.true", "include_in_amount_rollup": "eq.false"}
    )
    return counts


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_report(path: Path, counts: dict[str, str], summary_rows: list[dict[str, Any]]) -> None:
    lines = [
        "# Dashboard Relationship Contract Audit",
        "",
        "## Live Counts",
        "",
        "| surface | count |",
        "|---|---:|",
    ]
    for key, value in counts.items():
        lines.append(f"| `{key}` | {value} |")
    lines.extend(
        [
            "",
            "## Query Coverage",
            "",
            "| query | total | fund | asset | project | lender | beneficiary | error |",
            "|---|---:|---:|---:|---:|---:|---:|---|",
        ]
    )
    for row in summary_rows:
        lines.append(
            f"| {row['query']} | {row['total']} | {row['fund']} | {row['asset']} | {row['project']} | {row['lender']} | {row['beneficiary']} | {row.get('error', '')} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only audit for dashboard relationship-aware search contract.")
    parser.add_argument("--query", action="append", help="Search query to audit. Can repeat.")
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    load_env()
    queries = args.query or DEFAULT_QUERIES
    counts = relationship_contract_counts()
    summary_rows, detail_rows = summarize_queries(queries, args.limit)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(OUT_DIR / "query_summary.csv", summary_rows)
    write_csv(OUT_DIR / "query_detail.csv", detail_rows)
    (OUT_DIR / "surface_counts.json").write_text(json.dumps(counts, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(OUT_DIR / "dashboard_relationship_contract_audit.md", counts, summary_rows)
    print(json.dumps({"output_dir": str(OUT_DIR), "queries": queries, "counts": counts}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
