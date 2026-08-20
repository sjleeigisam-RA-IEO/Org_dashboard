from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = ROOT / "01. RA Portal" / "output" / "dashboard_operational_contract_20260610"
DEFAULT_QUERIES = [
    "이오타서울",
    "눈스퀘어",
    "국민연금",
    "홈플러스",
    "분당",
    "1120",
    "멀티플러스",
    "그린ON",
    "NPL",
]
ENTITY_TYPES = ["fund", "asset", "project", "lender", "beneficiary"]
HYDRATION_LIMIT = 500
INDEX_LIMIT_DEFAULT = 300
INDEX_LIMIT_SHORT_NUMERIC = 200
PAGE_SIZE = 1000
ALIASES = {
    "nps": ["국민연금", "nps"],
    "국민연금": ["국민연금", "nps"],
    "kic": ["한국투자공사", "kic"],
    "신한": ["신한", "shinhan"],
    "kb": ["국민", "kb"],
    "하나": ["하나", "hana"],
    "우리": ["우리", "woori"],
}


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def normalize(value: Any) -> str:
    return clean(value).lower()


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def load_env() -> None:
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

    config_path = ROOT / "01. RA Portal" / "portfolio-analysis" / "config.js"
    if not config_path.exists():
        return
    config_text = config_path.read_text(encoding="utf-8", errors="ignore")
    for key in ["SUPABASE_URL", "SUPABASE_KEY"]:
        match = re.search(rf"var\s+{key}\s*=\s*['\"]([^'\"]+)['\"]", config_text)
        if match:
            os.environ.setdefault(key, match.group(1))


def require_supabase_env() -> None:
    missing = [key for key in ["SUPABASE_URL", "SUPABASE_KEY"] if not os.environ.get(key)]
    if missing:
        raise RuntimeError(f"Missing Supabase environment values: {', '.join(missing)}")


def supabase_request(table: str, params: dict[str, str], range_header: str | None = None, count: bool = False) -> tuple[list[dict[str, Any]], str]:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    query = urllib.parse.urlencode(params, safe="*,.:()[]")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if range_header:
        headers["Range"] = range_header
    if count:
        headers["Prefer"] = "count=exact"
    req = urllib.request.Request(f"{url}/rest/v1/{table}?{query}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read().decode("utf-8") or "[]"
            return json.loads(body), response.headers.get("Content-Range", "")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {table} failed: HTTP {exc.code} {detail}") from exc


def fetch_all(table: str, select: str = "*", params: dict[str, str] | None = None, page_size: int = PAGE_SIZE) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page_params = {"select": select}
        page_params.update(params or {})
        page_rows, _ = supabase_request(table, page_params, range_header=f"{offset}-{offset + page_size - 1}")
        rows.extend(page_rows)
        if len(page_rows) < page_size:
            break
        offset += page_size
    return rows


def safe_fetch_all(table: str, select: str = "*", params: dict[str, str] | None = None) -> tuple[list[dict[str, Any]], str]:
    try:
        return fetch_all(table, select=select, params=params), ""
    except Exception as exc:
        return [], str(exc)


def fetch_count(table: str, params: dict[str, str] | None = None) -> tuple[int | None, str]:
    count_params = {"select": "*"}
    count_params.update(params or {})
    try:
        _, content_range = supabase_request(table, count_params, range_header="0-0", count=True)
    except Exception as exc:
        return None, str(exc)
    if "/" not in content_range:
        return None, f"missing content-range: {content_range}"
    raw_count = content_range.split("/")[-1]
    if raw_count == "*":
        return None, "count unavailable"
    return int(raw_count), ""


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    if not fieldnames:
        fieldnames = ["status"]
        rows = [{"status": "no_rows"}]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def merge_rows_by_key(primary_rows: list[dict[str, Any]], secondary_rows: list[dict[str, Any]], key_name: str) -> list[dict[str, Any]]:
    rows_by_key: dict[str, dict[str, Any]] = {}
    for row in (secondary_rows or []) + (primary_rows or []):
        key = clean(row.get(key_name))
        if not key:
            continue
        merged = dict(rows_by_key.get(key, {}))
        for field, value in row.items():
            if value is None:
                continue
            if isinstance(value, str) and value.strip() == "":
                continue
            merged[field] = value
        rows_by_key[key] = merged
    return list(rows_by_key.values())


def search_terms(query: str) -> list[str]:
    parts = [part for part in re.split(r"\s+", query.lower().strip()) if part]
    expanded: list[str] = []
    for part in parts:
        expanded.extend(ALIASES.get(part, [part]))
    return list(dict.fromkeys(expanded))


def is_short_numeric_search(query: str) -> bool:
    return bool(re.fullmatch(r"\d{1,4}", query.strip()))


def build_universal_filter(columns: list[str], terms: list[str]) -> str:
    return ",".join(f"{column}.ilike.%{term}%" for column in columns for term in terms if term)


def text_matches_any_term(text: Any, terms: list[str]) -> bool:
    haystack = normalize(text)
    return any(term and term in haystack for term in terms)


def app_index_params(query: str) -> tuple[dict[str, str], int, list[str]]:
    terms = search_terms(query)
    params = {
        "select": "*",
        "or": f"({build_universal_filter(['token_text'], terms)})",
        "order": "rank_weight.desc",
        "limit": str(INDEX_LIMIT_DEFAULT),
    }
    limit = INDEX_LIMIT_DEFAULT
    if is_short_numeric_search(query):
        params["entity_type"] = "in.(fund,project)"
        params["limit"] = str(INDEX_LIMIT_SHORT_NUMERIC)
        limit = INDEX_LIMIT_SHORT_NUMERIC
    return params, limit, terms


def fetch_index_rows(query: str) -> tuple[list[dict[str, Any]], int, list[str], str]:
    params, limit, terms = app_index_params(query)
    rows, error = safe_fetch_all("portfolio_search_results_canonical", select=params.pop("select"), params=params)
    if error:
        return [], limit, terms, error
    return rows[:limit], limit, terms, ""


def count_index_rows(query: str) -> tuple[int | None, str]:
    params, _, _ = app_index_params(query)
    params.pop("limit", None)
    params.pop("order", None)
    return fetch_count("portfolio_search_results_canonical", params=params)


def canonical_fund_title(row: dict[str, Any]) -> str:
    short_name = clean(row.get("short_name"))
    fund_name = clean(row.get("fund_name"))
    fund_id = clean(row.get("fund_id"))
    if short_name and fund_name and short_name != fund_name:
        return f"[{short_name}] {fund_name}"
    return fund_name or short_name or fund_id


def canonical_asset_title(row: dict[str, Any]) -> str:
    physical = clean(row.get("physical_asset_name"))
    if physical:
        return physical
    cleanup_action = clean(row.get("asset_name_cleanup_action"))
    if cleanup_action.startswith("suppress"):
        return clean(row.get("non_physical_asset_label")) or clean(row.get("asset_code")) or clean(row.get("asset_id"))
    return (
        clean(row.get("canonical_name"))
        or clean(row.get("asset_name"))
        or clean(row.get("asset_code"))
        or clean(row.get("asset_id"))
    )


def canonical_project_title(row: dict[str, Any]) -> str:
    return clean(row.get("project_name")) or clean(row.get("project_mission_name")) or clean(row.get("project_id"))


def display_parity_audit() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    summary: dict[str, Any] = {"checked": 0, "mismatch": 0, "missing_hydration_row": 0, "errors": {}}

    canonical_rows: list[dict[str, Any]] = []
    for entity_type in ["fund", "asset", "project"]:
        fetched, error = safe_fetch_all(
            "portfolio_search_results_canonical",
            select="entity_type,entity_id,display_title,display_subtitle,source_table,rank_weight,token_row_count",
            params={"entity_type": f"eq.{entity_type}"},
        )
        if error:
            summary["errors"][f"canonical:{entity_type}"] = error
        canonical_rows.extend(fetched)

    funds, fund_error = safe_fetch_all("v_funds_enriched", select="fund_id,short_name,fund_name,status,sector,primary_region")
    assets, asset_error = safe_fetch_all(
        "asset_relationship_summary",
        select="asset_id,canonical_name,physical_asset_name,non_physical_asset_label,asset_code,asset_name_cleanup_action",
    )
    if asset_error:
        assets, asset_error = safe_fetch_all("asset_relationship_summary", select="*")
    asset_master_rows, asset_master_error = safe_fetch_all(
        "asset_master",
        select="asset_id,canonical_name,physical_asset_name,non_physical_asset_label,asset_code,asset_name_cleanup_action,asset_name",
    )
    if asset_master_error:
        asset_master_rows, asset_master_error = safe_fetch_all("asset_master", select="*")
    assets = merge_rows_by_key(assets, asset_master_rows, "asset_id")

    projects, project_error = safe_fetch_all(
        "projects",
        select="project_id,project_name,project_mission_name,project_code,project_type,status,parent_project_id",
    )
    if project_error:
        projects, project_error = safe_fetch_all("projects", select="*")

    for label, error in [
        ("v_funds_enriched", fund_error),
        ("asset_relationship_summary", asset_error),
        ("asset_master", asset_master_error),
        ("projects", project_error),
    ]:
        if error:
            summary["errors"][label] = error

    fund_by_id = {clean(row.get("fund_id")): row for row in funds}
    asset_by_id = {clean(row.get("asset_id")): row for row in assets}
    project_by_id = {clean(row.get("project_id")): row for row in projects}

    expected_by_type = {
        "fund": (fund_by_id, canonical_fund_title),
        "asset": (asset_by_id, canonical_asset_title),
        "project": (project_by_id, canonical_project_title),
    }

    for canonical_row in canonical_rows:
        entity_type = clean(canonical_row.get("entity_type"))
        entity_id = clean(canonical_row.get("entity_id"))
        if entity_type not in expected_by_type:
            continue
        target_map, title_fn = expected_by_type[entity_type]
        target = target_map.get(entity_id)
        summary["checked"] += 1
        if not target:
            summary["missing_hydration_row"] += 1
            rows.append(
                {
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "status": "missing_hydration_row",
                    "search_display_title": clean(canonical_row.get("display_title")),
                    "hydrated_display_title": "",
                    "source_table": canonical_row.get("source_table"),
                    "token_row_count": canonical_row.get("token_row_count"),
                }
            )
            continue
        search_title = clean(canonical_row.get("display_title"))
        hydrated_title = title_fn(target)
        if normalize(search_title) != normalize(hydrated_title):
            summary["mismatch"] += 1
            rows.append(
                {
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "status": "display_title_mismatch",
                    "search_display_title": search_title,
                    "hydrated_display_title": hydrated_title,
                    "source_table": canonical_row.get("source_table"),
                    "token_row_count": canonical_row.get("token_row_count"),
                }
            )
    return rows, summary


def should_expand_related_ids(row: dict[str, Any], terms: list[str]) -> bool:
    entity_type = row.get("entity_type")
    if entity_type not in {"lender", "beneficiary"}:
        return True
    return text_matches_any_term(row.get("display_title"), terms)


def index_display_terms(index_rows: list[dict[str, Any]], entity_type: str, terms: list[str]) -> list[str]:
    values: list[str] = []
    for row in index_rows:
        if row.get("entity_type") != entity_type:
            continue
        value = clean(row.get("display_title") or row.get("token_text"))
        if not value or value.isdigit():
            continue
        if not text_matches_any_term(value, terms):
            continue
        if value not in values:
            values.append(value)
    return values


def unique_nonblank(values: list[Any]) -> list[str]:
    seen: dict[str, None] = {}
    for value in values:
        cleaned = clean(value)
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


def hydration_targets(index_rows: list[dict[str, Any]], terms: list[str], include_related_assets: bool) -> dict[str, Any]:
    related_rows = [row for row in index_rows if should_expand_related_ids(row, terms)]
    fund_ids = unique_nonblank(
        [row.get("entity_id") for row in index_rows if row.get("entity_type") == "fund"]
        + [row.get("related_fund_id") for row in related_rows]
    )
    asset_sources = [row.get("entity_id") for row in index_rows if row.get("entity_type") == "asset"]
    if include_related_assets:
        asset_sources.extend(row.get("related_asset_id") for row in related_rows)
    asset_ids = unique_nonblank(asset_sources)
    project_ids = unique_nonblank(
        [row.get("entity_id") for row in index_rows if row.get("entity_type") == "project"]
        + [row.get("related_project_id") for row in related_rows]
    )
    lender_ids = [value for value in unique_nonblank([row.get("entity_id") for row in index_rows if row.get("entity_type") == "lender"]) if value.isdigit()]
    beneficiary_ids = [
        value for value in unique_nonblank([row.get("entity_id") for row in index_rows if row.get("entity_type") == "beneficiary"]) if value.isdigit()
    ]
    return {
        "fund_ids": fund_ids,
        "asset_ids": asset_ids,
        "project_ids": project_ids,
        "lender_ids": lender_ids,
        "beneficiary_ids": beneficiary_ids,
        "lender_display_terms": index_display_terms(index_rows, "lender", terms),
        "beneficiary_display_terms": index_display_terms(index_rows, "beneficiary", terms),
    }


def count_party_exposures(party_type: str, display_terms: list[str]) -> tuple[int | None, str]:
    if not display_terms:
        return 0, ""
    if party_type == "lender":
        table = "lender_exposures"
        columns = ["lender_clean", "lender_raw"]
    else:
        table = "beneficiary_exposures"
        columns = ["beneficiary_clean", "beneficiary_raw"]
    safe_terms = [term for term in display_terms if "," not in term]
    if not safe_terms:
        return None, "display term contains comma; REST or-filter count skipped"
    return fetch_count(table, params={"or": f"({build_universal_filter(columns, safe_terms)})"})


def hydration_and_party_audit(queries: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    hydration_rows: list[dict[str, Any]] = []
    party_rows: list[dict[str, Any]] = []
    explain_rows: list[dict[str, Any]] = []
    summary = {
        "queries": len(queries),
        "index_limit_warnings": 0,
        "hydration_limit_warnings": 0,
        "party_limit_warnings": 0,
        "explainability_warnings": 0,
    }

    for query in queries:
        index_rows, app_limit, terms, error = fetch_index_rows(query)
        total_count, count_error = count_index_rows(query)
        short_numeric = is_short_numeric_search(query)
        include_related_assets = not short_numeric
        type_counts = Counter(row.get("entity_type") for row in index_rows)
        if total_count is not None and total_count > app_limit:
            summary["index_limit_warnings"] += 1
        hydration_rows.append(
            {
                "query": query,
                "target": "search_index",
                "rows_returned": len(index_rows),
                "rows_total": total_count if total_count is not None else "",
                "cap": app_limit,
                "status": "limit_warning" if total_count is not None and total_count > app_limit else "ok",
                "fund_rows": type_counts.get("fund", 0),
                "asset_rows": type_counts.get("asset", 0),
                "project_rows": type_counts.get("project", 0),
                "lender_rows": type_counts.get("lender", 0),
                "beneficiary_rows": type_counts.get("beneficiary", 0),
                "error": error or count_error,
            }
        )
        if error:
            continue

        targets = hydration_targets(index_rows, terms, include_related_assets=include_related_assets)
        target_counts = {
            "fund_ids": len(targets["fund_ids"]),
            "asset_ids": len(targets["asset_ids"]),
            "project_ids": len(targets["project_ids"]),
            "lender_ids": len(targets["lender_ids"]),
            "beneficiary_ids": len(targets["beneficiary_ids"]),
        }
        for target, count in target_counts.items():
            status = "limit_warning" if count > HYDRATION_LIMIT else "ok"
            if status != "ok":
                summary["hydration_limit_warnings"] += 1
            hydration_rows.append(
                {
                    "query": query,
                    "target": target,
                    "rows_returned": count,
                    "rows_total": count,
                    "cap": HYDRATION_LIMIT,
                    "status": status,
                    "fund_rows": "",
                    "asset_rows": "",
                    "project_rows": "",
                    "lender_rows": "",
                    "beneficiary_rows": "",
                    "error": "",
                }
            )

        for party_type, terms_key in [("lender", "lender_display_terms"), ("beneficiary", "beneficiary_display_terms")]:
            display_terms = targets[terms_key]
            exposure_count, exposure_error = count_party_exposures(party_type, display_terms)
            status = "ok"
            if exposure_error:
                status = "count_error"
            elif exposure_count is not None and exposure_count > HYDRATION_LIMIT:
                status = "limit_warning"
                summary["party_limit_warnings"] += 1
            party_rows.append(
                {
                    "query": query,
                    "party_type": party_type,
                    "display_terms": " | ".join(display_terms),
                    "index_party_rows": type_counts.get(party_type, 0),
                    "exposure_count_by_display_name": exposure_count if exposure_count is not None else "",
                    "hydrate_cap": HYDRATION_LIMIT,
                    "status": status,
                    "error": exposure_error,
                }
            )

        for row in index_rows:
            relation_paths = parse_relation_paths(row.get("relation_paths"))
            relation_path_preview = relation_path_preview_text(relation_paths)
            token_row_count = row.get("token_row_count")
            status = "ok"
            if not relation_paths or not token_row_count:
                status = "weak_explainability"
                summary["explainability_warnings"] += 1
            explain_rows.append(
                {
                    "query": query,
                    "entity_type": row.get("entity_type"),
                    "entity_id": row.get("entity_id"),
                    "display_title": clean(row.get("display_title")),
                    "relation_type": row.get("relation_type"),
                    "related_asset_id": row.get("related_asset_id"),
                    "related_fund_id": row.get("related_fund_id"),
                    "related_project_id": row.get("related_project_id"),
                    "source_table": row.get("source_table"),
                    "rank_weight": row.get("rank_weight"),
                    "token_row_count": token_row_count,
                    "relation_paths_count": len(relation_paths),
                    "relation_paths_preview": relation_path_preview,
                    "status": status,
                }
            )
    return hydration_rows, party_rows, explain_rows, summary


def parse_relation_paths(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    return []


def relation_path_preview_text(paths: list[dict[str, Any]], limit: int = 4) -> str:
    values: list[str] = []
    for item in paths:
        value = clean(item.get("relation_path")) or clean(item.get("relation_type")) or clean(item.get("token_type"))
        if value and value not in values:
            values.append(value)
        if len(values) >= limit:
            break
    return " / ".join(values)


def cache_refresh_status() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    surfaces = [
        "portfolio_search_results_canonical",
        "relationship_index_search_results",
        "relationship_index_search_results_cache",
        "relationship_index_audit",
        "relationship_index_audit_cache",
        "relationship_index_entities",
        "relationship_index_edges",
    ]
    rows: list[dict[str, Any]] = []
    summary = {"checked": 0, "errors": 0, "manual_refresh_required": True}
    counts: dict[str, int | None] = {}
    for surface in surfaces:
        count, error = fetch_count(surface)
        summary["checked"] += 1
        if error:
            summary["errors"] += 1
        counts[surface] = count
        rows.append(
            {
                "surface": surface,
                "count": count if count is not None else "",
                "status": "count_error" if error else "count_ok",
                "error": error,
                "note": "REST count only; refresh staleness must be controlled by runbook after DB writes.",
            }
        )

    canonical_count = counts.get("portfolio_search_results_canonical")
    cache_count = counts.get("relationship_index_search_results_cache")
    rows.append(
        {
            "surface": "cache_vs_api_view",
            "count": "",
            "status": "ok" if canonical_count is not None and canonical_count == cache_count else "review",
            "error": "",
            "note": f"portfolio_search_results_canonical={canonical_count}, relationship_index_search_results_cache={cache_count}",
        }
    )
    return rows, summary


def summarize_status(display_summary: dict[str, Any], cache_summary: dict[str, Any], hydration_summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "display_parity_status": "ok" if display_summary["mismatch"] == 0 and display_summary["missing_hydration_row"] == 0 else "review",
        "cache_refresh_status": "prepared_runbook" if cache_summary["manual_refresh_required"] else "ok",
        "hydration_limit_status": "ok" if hydration_summary["index_limit_warnings"] == 0 and hydration_summary["hydration_limit_warnings"] == 0 else "review",
        "party_coverage_status": "ok" if hydration_summary["party_limit_warnings"] == 0 else "review",
        "cluster_explainability_status": "ok" if hydration_summary["explainability_warnings"] == 0 else "review",
    }


def write_report(
    path: Path,
    generated_at: str,
    queries: list[str],
    display_summary: dict[str, Any],
    cache_summary: dict[str, Any],
    hydration_summary: dict[str, Any],
    status_summary: dict[str, Any],
) -> None:
    lines = [
        "# Dashboard Operational Contract Audit",
        "",
        f"- Generated: {generated_at}",
        f"- Queries: {', '.join(queries)}",
        "- Scope: read-only Supabase REST checks plus local artifacts",
        "",
        "## 5-Goal Result",
        "",
        "| goal | status | evidence |",
        "|---|---|---|",
        f"| Search vs bulk display parity | {status_summary['display_parity_status']} | checked {display_summary['checked']}, mismatches {display_summary['mismatch']}, missing hydrate rows {display_summary['missing_hydration_row']} |",
        f"| Cache/materialized refresh contract | {status_summary['cache_refresh_status']} | checked {cache_summary['checked']} surfaces, count errors {cache_summary['errors']}; refresh staleness controlled by runbook |",
        f"| Hydration limit risk | {status_summary['hydration_limit_status']} | index warnings {hydration_summary['index_limit_warnings']}, hydration warnings {hydration_summary['hydration_limit_warnings']} |",
        f"| Party drawer coverage | {status_summary['party_coverage_status']} | party exposure limit warnings {hydration_summary['party_limit_warnings']} |",
        f"| Cluster explainability | {status_summary['cluster_explainability_status']} | weak explainability rows {hydration_summary['explainability_warnings']} |",
        "",
        "## Output Files",
        "",
        "- `display_parity.csv`: search display title vs hydrated dashboard title.",
        "- `cache_refresh_status.csv`: REST count checks for cache/API surfaces.",
        "- `hydration_risk.csv`: search-index and hydrate target counts vs app caps.",
        "- `party_coverage.csv`: lender/beneficiary display-name expansion coverage.",
        "- `cluster_explainability.csv`: relation path/token provenance per query result.",
        "- `summary.json`: machine-readable rollup.",
        "",
        "## Interpretation",
        "",
        "- `ok` means the current live data satisfies the audit rule.",
        "- `review` means the dashboard can still work, but the contract has drift/risk to inspect.",
        "- `prepared_runbook` means the cache refresh operation is intentionally not executed by this read-only audit; use the refresh runbook after DB writes.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only operational audit for RA dashboard search and relationship contract.")
    parser.add_argument("--query", action="append", help="Search query to audit. Can repeat.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Output directory.")
    args = parser.parse_args()

    load_env()
    require_supabase_env()
    queries = args.query or DEFAULT_QUERIES
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    generated_at = now_iso()
    display_rows, display_summary = display_parity_audit()
    cache_rows, cache_summary = cache_refresh_status()
    hydration_rows, party_rows, explain_rows, hydration_summary = hydration_and_party_audit(queries)
    status_summary = summarize_status(display_summary, cache_summary, hydration_summary)

    write_csv(out_dir / "display_parity.csv", display_rows)
    write_csv(out_dir / "cache_refresh_status.csv", cache_rows)
    write_csv(out_dir / "hydration_risk.csv", hydration_rows)
    write_csv(out_dir / "party_coverage.csv", party_rows)
    write_csv(out_dir / "cluster_explainability.csv", explain_rows)

    summary = {
        "generated_at": generated_at,
        "queries": queries,
        "status_summary": status_summary,
        "display_parity": display_summary,
        "cache_refresh": cache_summary,
        "hydration_party_explainability": hydration_summary,
        "output_dir": str(out_dir),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(
        out_dir / "dashboard_operational_contract_audit.md",
        generated_at,
        queries,
        display_summary,
        cache_summary,
        hydration_summary,
        status_summary,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
