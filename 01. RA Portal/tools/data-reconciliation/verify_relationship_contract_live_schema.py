from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "01. RA Portal" / "output" / "relationship_contract_20260608"

REQUIRED_SURFACES: dict[str, list[str]] = {
    "asset_project_links": [
        "asset_id",
        "project_id",
        "relation_type",
        "source_table",
        "source_id",
        "confidence",
        "metadata",
    ],
    "asset_fund_links": [
        "asset_id",
        "fund_id",
        "relation_type",
        "include_in_asset_aum",
        "allocation_status",
        "allocation_ratio",
        "needs_allocation_review",
    ],
    "asset_master": [
        "asset_id",
        "canonical_name",
        "address_text",
        "latitude",
        "longitude",
        "pnu",
        "asset_code",
        "review_status",
        "main_usage",
        "asset_type",
        "portfolio_region",
        "business_stage",
        "asset_kind",
        "gross_floor_area",
        "site_area",
        "metadata",
    ],
    "funds": [
        "fund_id",
        "fund_name",
        "short_name",
        "primary_asset_id",
        "benchmark_aum",
    ],
    "projects": [
        "project_id",
        "project_name",
        "project_code",
        "parent_project_id",
        "primary_asset_id",
        "project_type",
        "status",
    ],
    "lender_exposures": [
        "id",
        "asset_id",
        "fund_id",
        "lender_clean",
        "lender_raw",
        "committed_amt",
        "drawn_amt",
    ],
    "beneficiary_exposures": [
        "id",
        "asset_id",
        "fund_id",
        "beneficiary_clean",
        "beneficiary_raw",
        "committed_amt",
        "invested_amt",
    ],
    "iota_seoul_log_links": [
        "link_id",
        "log_id",
        "proj_id",
        "relation_type",
        "asset_id",
        "created_at",
    ],
    "v_funds_enriched": [
        "fund_id",
        "fund_name",
        "short_name",
        "status",
        "sector",
        "project_mission_name",
        "asset_name",
        "fund_type",
        "division",
        "primary_region",
    ],
    "asset_aliases": [
        "asset_id",
        "alias_name",
        "alias_type",
        "confidence",
    ],
}

MIGRATION_ADDED_COLUMNS: dict[str, list[str]] = {
    "funds": ["primary_asset_ids"],
    "projects": ["primary_asset_ids"],
    "iota_seoul_log_links": ["metadata"],
    "asset_project_links": [
        "target_code",
        "target_type",
        "resolved_project_id",
        "resolved_fund_id",
        "resolution_status",
        "resolution_note",
    ],
}

EXPECTED_NEW_SURFACES = [
    "portfolio_search_results_canonical",
    "portfolio_search_index",
    "asset_project_link_resolution",
    "asset_exposure_edges",
    "relationship_index_entities",
    "relationship_index_edges",
    "relationship_index_tokens",
    "relationship_index_search_results",
    "relationship_index_audit",
    "relationship_contract_audit_v1",
    "dashboard_search_result_contract_audit",
]


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def headers() -> dict[str, str]:
    key = os.environ["SUPABASE_KEY"]
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def request(table: str, params: dict[str, str]) -> tuple[bool, str, Any]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    query = urllib.parse.urlencode(params, safe="*,.:()")
    req = urllib.request.Request(f"{base}/rest/v1/{table}?{query}", headers=headers())
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read().decode("utf-8") or "[]"
        return True, "", json.loads(body)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return False, f"HTTP {exc.code} {detail}", None
    except Exception as exc:  # pragma: no cover - operational diagnostics
        return False, str(exc), None


def verify_required_surfaces() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table, columns in REQUIRED_SURFACES.items():
        ok, error, data = request(table, {"select": ",".join(columns), "limit": "1"})
        rows.append(
            {
                "surface": table,
                "surface_type": "required_existing",
                "status": "ok" if ok else "error",
                "column_count": len(columns),
                "error": error,
                "sample_rows": len(data or []) if ok else 0,
            }
        )
    return rows


def verify_expected_new_surfaces() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in EXPECTED_NEW_SURFACES:
        ok, error, data = request(table, {"select": "*", "limit": "1"})
        rows.append(
            {
                "surface": table,
                "surface_type": "expected_after_sql_apply",
                "status": "available" if ok else "missing_or_not_applied",
                "column_count": "",
                "error": error,
                "sample_rows": len(data or []) if ok else 0,
            }
        )
    return rows


def verify_migration_added_columns() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table, columns in MIGRATION_ADDED_COLUMNS.items():
        ok, error, data = request(table, {"select": ",".join(columns), "limit": "1"})
        rows.append(
            {
                "surface": table,
                "surface_type": "created_by_relationship_contract_v1",
                "status": "already_available" if ok else "will_be_added_by_sql",
                "column_count": len(columns),
                "error": error,
                "sample_rows": len(data or []) if ok else 0,
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields: list[str] = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    import csv

    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_report(path: Path, rows: list[dict[str, Any]]) -> None:
    required = [row for row in rows if row["surface_type"] == "required_existing"]
    added = [row for row in rows if row["surface_type"] == "created_by_relationship_contract_v1"]
    expected = [row for row in rows if row["surface_type"] == "expected_after_sql_apply"]
    lines = [
        "# Relationship Contract Live Schema Verification",
        "",
        "## Required Existing Surfaces",
        "",
        "| surface | status | columns | sample rows |",
        "|---|---|---:|---:|",
    ]
    for row in required:
        lines.append(f"| `{row['surface']}` | {row['status']} | {row['column_count']} | {row['sample_rows']} |")
    lines.extend(["", "## Columns Created By Migration", "", "| surface | status | columns | note |", "|---|---|---:|---|"])
    for row in added:
        note = "already present" if row["status"] == "already_available" else "relationship_contract_v1.sql adds this column set"
        lines.append(f"| `{row['surface']}` | {row['status']} | {row['column_count']} | {note} |")
    lines.extend(["", "## Expected After SQL Apply", "", "| surface | status | note |", "|---|---|---|"])
    for row in expected:
        note = "already available" if row["status"] == "available" else "not available until SQL Editor migration is applied"
        lines.append(f"| `{row['surface']}` | {row['status']} | {note} |")
    errors = [row for row in rows if row.get("error")]
    if errors:
        lines.extend(["", "## Errors", "", "| surface | error |", "|---|---|"])
        for row in errors:
            lines.append(f"| `{row['surface']}` | {str(row['error']).replace('|', '/')} |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    load_env()
    rows = verify_required_surfaces() + verify_migration_added_columns() + verify_expected_new_surfaces()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(OUT_DIR / "live_schema_verification.csv", rows)
    write_report(OUT_DIR / "live_schema_verification.md", rows)
    print(json.dumps({"output_dir": str(OUT_DIR), "rows": rows}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
