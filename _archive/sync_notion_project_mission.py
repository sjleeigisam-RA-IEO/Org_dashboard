import argparse
import json
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client


NOTION_COLUMNS = {
    "vehicle": "Vehicle(약칭)",
    "project_mission_name": "Project & Mission 이름",
    "notion_base_asset_class": "[분류] 기초자산_작업중",
    "notion_asset_nature_class": "[분류] 자산성격_작업중",
    "notion_holding_type_class": "[분류] 보유형태_작업중",
    "notion_business_stage_class": "[분류] 사업단계_작업중",
    "notion_investment_strategy_class": "[분류] 투자전략_작업중",
    "notion_vehicle_class": "[분류] 비히클_작업중",
}

DB_COLUMNS = [
    "project_mission_name",
    "notion_base_asset_class",
    "notion_asset_nature_class",
    "notion_holding_type_class",
    "notion_business_stage_class",
    "notion_investment_strategy_class",
    "notion_vehicle_class",
]


def normalize_text(value):
    if pd.isna(value):
        return None
    text = str(value).strip()
    if not text:
        return None
    return " ".join(text.split())


def load_notion_export(file_path: Path) -> pd.DataFrame:
    readers = [
        lambda p: pd.read_csv(p, encoding="utf-8-sig"),
        lambda p: pd.read_csv(p, encoding="cp949"),
        lambda p: pd.read_excel(p),
    ]
    last_error = None
    for reader in readers:
        try:
            return reader(file_path)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Failed to read Notion export: {file_path}\n{last_error}")


def pick_input_file(base_dir: Path, explicit_path: str | None) -> Path:
    if explicit_path:
        path = Path(explicit_path)
        if not path.is_absolute():
            path = base_dir / path
        if not path.exists():
            raise FileNotFoundError(path)
        return path

    patterns = [
        "notion_project_mission*.csv",
        "notion_project_mission*.xlsx",
        "project_mission*.csv",
        "project_mission*.xlsx",
    ]
    candidates = []
    for pattern in patterns:
        candidates.extend(base_dir.glob(pattern))
    if not candidates:
        raise FileNotFoundError(
            "No Notion export file found. Place a CSV/XLSX export in this folder or pass --input."
        )
    return max(candidates, key=lambda path: path.stat().st_mtime)


def build_notion_mapping(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    missing = [name for name in NOTION_COLUMNS.values() if name not in df.columns]
    if missing:
        raise ValueError(f"Missing required Notion columns: {missing}")

    work = df[list(NOTION_COLUMNS.values())].copy()
    work.columns = list(NOTION_COLUMNS.keys())
    for column in work.columns:
        work[column] = work[column].apply(normalize_text)

    work = work[work["vehicle"].notna()].copy()
    work["vehicle_key"] = work["vehicle"].str.lower()

    duplicate_counts = work.groupby("vehicle_key").size().to_dict()
    duplicated_keys = {key for key, count in duplicate_counts.items() if count > 1}
    unique_rows = work[~work["vehicle_key"].isin(duplicated_keys)].copy()
    unique_rows = unique_rows.drop_duplicates(subset=["vehicle_key"])

    report = {
        "source_rows": int(len(df)),
        "rows_with_vehicle": int(len(work)),
        "duplicate_vehicle_keys": sorted(duplicated_keys),
        "duplicate_vehicle_count": len(duplicated_keys),
        "usable_vehicle_rows": int(len(unique_rows)),
    }
    return unique_rows, report


def fetch_funds(client) -> pd.DataFrame:
    rows = client.table("funds").select("fund_id, short_name, fund_name, project_mission_name").execute().data
    funds = pd.DataFrame(rows)
    if funds.empty:
        return pd.DataFrame(columns=["fund_id", "short_name", "fund_name", "project_mission_name", "vehicle_key"])
    funds["short_name"] = funds["short_name"].apply(normalize_text)
    funds["vehicle_key"] = funds["short_name"].str.lower()
    return funds


def build_match_result(funds: pd.DataFrame, notion_rows: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    merged = funds.merge(
        notion_rows,
        how="left",
        on="vehicle_key",
        suffixes=("_db", "_notion"),
    )
    matched = merged[merged["project_mission_name_notion"].notna()].copy()
    unmatched = merged[merged["project_mission_name_notion"].isna()].copy()

    update_columns = []
    rename_map = {}
    for column in DB_COLUMNS:
        notion_column = f"{column}_notion" if f"{column}_notion" in matched.columns else column
        update_columns.append(notion_column)
        rename_map[notion_column] = column

    update_df = matched[
        ["fund_id", "short_name", "fund_name"] + update_columns
    ].copy()
    update_df = update_df.rename(columns=rename_map)

    report = {
        "fund_rows": int(len(funds)),
        "matched_funds": int(len(update_df)),
        "unmatched_funds": int(len(unmatched)),
        "matched_short_names_sample": update_df["short_name"].head(20).tolist(),
        "unmatched_short_names_sample": unmatched["short_name"].dropna().head(20).tolist(),
    }
    return update_df, report


def ensure_columns_exist(client):
    row = client.table("funds").select("*").limit(1).execute().data
    if not row:
        raise RuntimeError("funds table is empty; cannot verify schema")
    keys = set(row[0].keys())
    missing = [column for column in DB_COLUMNS if column not in keys]
    if missing:
        raise RuntimeError(
            "Target columns do not exist in Supabase yet. Run migrations/2026-04-24_add_notion_search_fields.sql first.\n"
            f"Missing columns: {missing}"
        )


def apply_updates(client, updates: pd.DataFrame):
    for _, row in updates.iterrows():
        payload = {column: row[column] for column in DB_COLUMNS}
        client.table("funds").update(payload).eq("fund_id", row["fund_id"]).execute()


def main():
    parser = argparse.ArgumentParser(description="Sync Notion Project & Mission names and classifications into Supabase funds table.")
    parser.add_argument("--input", help="Path to exported Notion CSV/XLSX")
    parser.add_argument("--apply", action="store_true", help="Apply updates to Supabase")
    parser.add_argument("--report", default="notion_sync_report.json", help="Path to write sync report JSON")
    args = parser.parse_args()

    try:
        base_dir = Path(__file__).resolve().parent
        input_file = pick_input_file(base_dir, args.input)

        load_dotenv(dotenv_path=base_dir / ".env")
        client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

        notion_df = load_notion_export(input_file)
        notion_rows, notion_report = build_notion_mapping(notion_df)
        funds = fetch_funds(client)
        updates, match_report = build_match_result(funds, notion_rows)

        report = {
            "input_file": str(input_file),
            "notion": notion_report,
            "matching": match_report,
            "update_preview": updates.head(30).to_dict(orient="records"),
            "apply_requested": args.apply,
        }

        if args.apply:
            ensure_columns_exist(client)
            apply_updates(client, updates)
            report["applied_updates"] = int(len(updates))

        report_path = Path(args.report)
        if not report_path.is_absolute():
            report_path = base_dir / report_path
        with open(report_path, "w", encoding="utf-8") as file:
            json.dump(report, file, ensure_ascii=False, indent=2)

        print(json.dumps({
            "input_file": str(input_file),
            "matched_funds": match_report["matched_funds"],
            "unmatched_funds": match_report["unmatched_funds"],
            "duplicate_vehicle_count": notion_report["duplicate_vehicle_count"],
            "report_path": str(report_path),
            "applied": args.apply,
        }, ensure_ascii=False, indent=2))
    except Exception as exc:
        raise SystemExit(str(exc))


if __name__ == "__main__":
    main()
