from pathlib import Path
import json
import os

import pandas as pd
import requests
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[1]
ARCHIVE_DIR = BASE_DIR / "_archive"
OUTPUT_JSON = BASE_DIR / "scratch" / "db_fund_source_reconciliation.json"
OUTPUT_MD = BASE_DIR / "scratch" / "db_fund_source_reconciliation.md"

SOURCE_FILES = {
    "fund_management_20260424": ARCHIVE_DIR / "펀드 관리_20260424.xlsx",
    "aum_all_20251224": ARCHIVE_DIR / "펀드 AUM 관리_20251224_all.xlsx",
    "aum_active_20260112": ARCHIVE_DIR / "펀드 AUM 관리_20260112.xlsx",
}

COLS = {
    "fund_id": "펀드코드",
    "short_name": "약칭",
    "fund_name": "펀드명",
    "status": "운용상태",
    "setup_date": "설정일",
    "maturity_date": "만기일",
    "termination_date": "해지일",
    "aum_include": "AUM합산대상여부",
    "aum_input_date": "AUM\n입력일자",
    "aum": "AUM(원)",
}


def read_source(path):
    df = pd.read_excel(path, header=1)
    out = pd.DataFrame()
    for key, label in COLS.items():
        if key == "aum":
            matches = [c for c in df.columns if str(c).startswith(label)]
        else:
            matches = [c for c in df.columns if str(c) == label]
        if matches:
            out[key] = df[matches[0]]

    out["fund_id"] = out["fund_id"].astype(str).str.strip()
    out = out[out["fund_id"].notna() & (out["fund_id"] != "nan") & (out["fund_id"] != "")]
    for col in ["setup_date", "maturity_date", "termination_date", "aum_input_date"]:
        if col in out:
            out[col] = pd.to_datetime(out[col], errors="coerce")
    if "aum" in out:
        out["aum_num"] = pd.to_numeric(out["aum"], errors="coerce")
    return out


def fetch_supabase_table(table_name):
    load_dotenv(dotenv_path=BASE_DIR / ".env")
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_KEY is missing from .env")

    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    rows = []
    start = 0
    chunk = 1000
    total = None

    while True:
        h = headers.copy()
        h["Range"] = f"{start}-{start + chunk - 1}"
        h["Prefer"] = "count=exact"
        response = requests.get(
            f"{url}/rest/v1/{table_name}",
            params={"select": "*"},
            headers=h,
            timeout=60,
        )
        response.raise_for_status()
        if total is None:
            content_range = response.headers.get("content-range", "")
            if "/" in content_range:
                total = int(content_range.split("/")[-1])
        page = response.json()
        rows.extend(page)
        if not page or len(page) < chunk or (total is not None and len(rows) >= total):
            break
        start += chunk

    return pd.DataFrame(rows)


def extract_db_aum(metadata):
    if isinstance(metadata, dict):
        value = metadata.get("benchmark_aum")
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None
    return None


def to_json_safe(value):
    if isinstance(value, dict):
        return {str(k): to_json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_json_safe(v) for v in value]
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def summarize_ids(left_ids, right_ids):
    return {
        "intersection": len(left_ids & right_ids),
        "only_left": len(left_ids - right_ids),
        "only_right": len(right_ids - left_ids),
        "sample_only_left": sorted(left_ids - right_ids)[:20],
        "sample_only_right": sorted(right_ids - left_ids)[:20],
    }


def main():
    sources = {name: read_source(path) for name, path in SOURCE_FILES.items()}
    db = fetch_supabase_table("funds")
    db["fund_id"] = db["fund_id"].astype(str).str.strip()
    db["db_aum"] = db["metadata"].apply(extract_db_aum)

    result = {
        "db": {
            "rows": len(db),
            "unique_funds": int(db["fund_id"].nunique()),
            "status_counts": db["status"].fillna("(blank)").astype(str).value_counts().to_dict()
            if "status" in db
            else {},
            "db_aum_nonnull": int(db["db_aum"].notna().sum()),
            "db_aum_positive": int((db["db_aum"].fillna(0) > 0).sum()),
            "db_aum_sum": int(db["db_aum"].fillna(0).sum()),
            "notion_project_nonnull": int(db["project_mission_name"].notna().sum())
            if "project_mission_name" in db
            else 0,
        },
        "sources": {},
        "db_vs_sources": {},
        "status_mismatches": {},
        "aum_reconciliation": {},
    }

    db_ids = set(db["fund_id"])
    for name, source in sources.items():
        source_ids = set(source["fund_id"])
        result["sources"][name] = {
            "rows": len(source),
            "unique_funds": int(source["fund_id"].nunique()),
            "status_counts": source["status"].fillna("(blank)").astype(str).value_counts().to_dict()
            if "status" in source
            else {},
            "aum_nonnull": int(source["aum_num"].notna().sum()) if "aum_num" in source else 0,
            "aum_positive": int((source["aum_num"].fillna(0) > 0).sum()) if "aum_num" in source else 0,
            "aum_sum": int(source["aum_num"].fillna(0).sum()) if "aum_num" in source else 0,
        }
        result["db_vs_sources"][name] = summarize_ids(db_ids, source_ids)

        if "status" in source and "status" in db:
            merged = (
                db[["fund_id", "status"]]
                .drop_duplicates("fund_id")
                .merge(
                    source[["fund_id", "status"]].drop_duplicates("fund_id"),
                    on="fund_id",
                    suffixes=("_db", f"_{name}"),
                )
            )
            diff = merged[merged["status_db"].astype(str) != merged[f"status_{name}"].astype(str)]
            result["status_mismatches"][name] = {
                "overlap": len(merged),
                "diff_count": len(diff),
                "sample": diff.head(30).to_dict("records"),
            }

        if "aum_num" in source:
            merged_aum = (
                db[["fund_id", "db_aum"]]
                .drop_duplicates("fund_id")
                .merge(
                    source[["fund_id", "aum_num"]].drop_duplicates("fund_id"),
                    on="fund_id",
                    how="inner",
                )
            )
            merged_aum["diff"] = merged_aum["db_aum"].fillna(0) - merged_aum["aum_num"].fillna(0)
            exact = (merged_aum["diff"].abs() < 1).sum()
            result["aum_reconciliation"][name] = {
                "overlap": len(merged_aum),
                "db_aum_nonnull_in_overlap": int(merged_aum["db_aum"].notna().sum()),
                "source_aum_nonnull_in_overlap": int(merged_aum["aum_num"].notna().sum()),
                "exact_match_count": int(exact),
                "total_abs_diff": int(merged_aum["diff"].abs().sum()),
                "sample_large_diff": merged_aum.reindex(
                    merged_aum["diff"].abs().sort_values(ascending=False).index
                )
                .head(20)
                .to_dict("records"),
            }

    OUTPUT_JSON.write_text(json.dumps(to_json_safe(result), ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# DB-Fund Source Reconciliation",
        "",
        "## DB funds Summary",
        "",
        f"- rows: {result['db']['rows']:,}",
        f"- unique funds: {result['db']['unique_funds']:,}",
        f"- status counts: {result['db']['status_counts']}",
        f"- DB metadata benchmark_aum non-null: {result['db']['db_aum_nonnull']:,}",
        f"- DB metadata benchmark_aum positive: {result['db']['db_aum_positive']:,}",
        f"- DB metadata benchmark_aum sum: {result['db']['db_aum_sum']:,}",
        f"- project_mission_name non-null: {result['db']['notion_project_nonnull']:,}",
        "",
        "## Source Coverage",
        "",
        "| Source | Source funds | DB intersection | DB only | Source only |",
        "|---|---:|---:|---:|---:|",
    ]
    for name, info in result["db_vs_sources"].items():
        src_count = result["sources"][name]["unique_funds"]
        lines.append(
            f"| {name} | {src_count:,} | {info['intersection']:,} | "
            f"{info['only_left']:,} | {info['only_right']:,} |"
        )

    lines.extend(["", "## Status Mismatches", ""])
    for name, info in result["status_mismatches"].items():
        lines.append(f"- `{name}`: overlap {info['overlap']:,}, diff {info['diff_count']:,}")

    lines.extend(["", "## AUM Reconciliation", ""])
    for name, info in result["aum_reconciliation"].items():
        lines.append(
            f"- `{name}`: overlap {info['overlap']:,}, "
            f"DB AUM non-null {info['db_aum_nonnull_in_overlap']:,}, "
            f"source AUM non-null {info['source_aum_nonnull_in_overlap']:,}, "
            f"exact match {info['exact_match_count']:,}, "
            f"total abs diff {info['total_abs_diff']:,}"
        )

    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "- The current `funds` table is not a complete lifecycle universe. It contains 580 funds versus 1,099 funds in the fund management source.",
            "- The DB is suitable for current dashboard search/exposure analysis, but it is not sufficient for lifecycle, liquidation, or runoff analysis without adding lifecycle and AUM snapshot tables.",
            "- Fund management should be treated as the master universe for lifecycle/status/date fields.",
            "- AUM files should be treated as dated financial snapshots, not as the master fund universe.",
            "- Tomorrow's updated AUM file should be loaded as an additional snapshot rather than overwriting historical AUM files.",
        ]
    )
    OUTPUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote {OUTPUT_MD}")


if __name__ == "__main__":
    main()
