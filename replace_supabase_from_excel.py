import argparse
import json
import math
import os
import re
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
ARCHIVE_DIR = BASE_DIR / "_archive"
FUND_ID_RE = re.compile(r"^[A-Z0-9]+$")


def find_source_files():
    files = list(ARCHIVE_DIR.glob("[[]new]*.xlsx"))
    sources = {}
    for path in files:
        head = pd.read_excel(path, header=None, nrows=1, dtype=object)
        col_count = head.shape[1]
        first_values = [str(v).strip() for v in head.iloc[0, :3].tolist()]
        if col_count == 36 and first_values[:2] == ["펀드정보", "펀드정보"]:
            sources["aum"] = path
        elif col_count == 59 and first_values[:3] == ["펀드코드", "펀드명", "약칭"]:
            sources["fund"] = path
        elif col_count == 41 and first_values[:3] == ["펀드코드", "약칭", "펀드명"]:
            sources["asset_lookup"] = path
        elif col_count == 56 and first_values[:3] == ["선택", "자산코드", "자산(건물)명"]:
            sources["asset_manage"] = path

    missing = {"aum", "fund", "asset_lookup", "asset_manage"} - set(sources)
    if missing:
        raise FileNotFoundError(f"Missing source workbook(s): {sorted(missing)}")
    return sources


def clean_value(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if pd.isna(value):
        return None
    if isinstance(value, str):
        text = value.replace("\xa0", " ").strip()
        return text or None
    return value


def clean_str(value):
    value = clean_value(value)
    if value is None:
        return None
    text = str(value).replace("\xa0", " ").strip()
    if text.lower() in {"nan", "none", "nat"}:
        return None
    return text or None


def clean_date(value):
    value = clean_value(value)
    if value is None:
        return None
    dt = pd.to_datetime(value, errors="coerce")
    if pd.isna(dt):
        return None
    return dt.strftime("%Y-%m-%d")


def clean_num(value):
    value = clean_value(value)
    if value is None:
        return None
    if isinstance(value, str):
        value = value.replace(",", "").replace("%", "").strip()
    num = pd.to_numeric(value, errors="coerce")
    if pd.isna(num):
        return None
    return float(num)


def clean_int(value):
    value = clean_num(value)
    if value is None:
        return None
    return int(round(value))


def json_safe(value):
    value = clean_value(value)
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (int, float, str, bool)) or value is None:
        if isinstance(value, float) and math.isnan(value):
            return None
        return value
    return str(value)


def row_dict(row, columns):
    result = {}
    for source_col, target_key in columns.items():
        if source_col in row.index:
            value = clean_value(row[source_col])
            if value is not None:
                result[target_key] = json_safe(value)
    return result


def read_sources(paths):
    fund = pd.read_excel(paths["fund"], header=0, dtype=object)
    aum = pd.read_excel(paths["aum"], header=1, dtype=object)
    asset_lookup = pd.read_excel(paths["asset_lookup"], header=0, dtype=object)
    asset_manage = pd.read_excel(paths["asset_manage"], header=0, dtype=object)
    return fund, aum, asset_lookup, asset_manage


def valid_fund_rows(df, id_col="펀드코드", name_col="펀드명"):
    fund_id = df[id_col].apply(clean_str)
    fund_name = df[name_col].apply(clean_str)
    return fund_id.apply(lambda x: bool(x and FUND_ID_RE.match(x))) & fund_name.notna()


def first_non_empty(values):
    cleaned = [clean_str(v) for v in values]
    cleaned = [v for v in cleaned if v]
    if not cleaned:
        return None
    unique = []
    for value in cleaned:
        if value not in unique:
            unique.append(value)
    return ", ".join(unique[:3])


def build_asset_manage_index(asset_manage):
    by_name_addr = {}
    by_name = {}
    for _, row in asset_manage.iterrows():
        name = clean_str(row.get("자산(건물)명"))
        addr = clean_str(row.get("전체주소(시/도, 구/군 포함)"))
        if not name:
            continue
        record = row.to_dict()
        by_name.setdefault(name, record)
        if addr:
            by_name_addr[(name, addr)] = record
    return by_name_addr, by_name


def load_json_cache(filenames):
    for filename in filenames:
        path = BASE_DIR / filename
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    return {}


def load_geocoding_cache():
    return load_json_cache(["geocoding_cache.json", "_archive/geocoding_cache.json"])


def load_building_cache():
    return load_json_cache(["building_cache.json", "_archive/building_cache.json"])


def build_funds(fund_df, aum_df, asset_lookup):
    fund_df = fund_df[valid_fund_rows(fund_df)].copy()
    fund_df["fund_id"] = fund_df["펀드코드"].apply(clean_str)
    fund_df = fund_df.drop_duplicates(subset=["fund_id"], keep="last")

    aum_df = aum_df[valid_fund_rows(aum_df)].copy()
    aum_df["fund_id"] = aum_df["펀드코드"].apply(clean_str)
    aum_df = aum_df.drop_duplicates(subset=["fund_id"], keep="last")

    asset_lookup = asset_lookup[valid_fund_rows(asset_lookup)].copy()
    asset_summary = asset_lookup.groupby("펀드코드", dropna=True).agg(
        base_asset_class=("기초자산", first_non_empty),
        asset_nature_class=("자산성격", first_non_empty),
        business_stage_class=("사업단계", first_non_empty),
    ).reset_index()
    asset_summary["fund_id"] = asset_summary["펀드코드"].apply(clean_str)

    merged = fund_df.merge(
        aum_df[
            [
                "fund_id",
                "기준일자",
                "기준가",
                "순자산총액",
                "AUM\n입력일자",
                "Equity 총액(원)",
                "Loan 총액(원)",
                "기준일자 임대보증금(원)",
                "AUM(원)",
                "부서",
                "담당자",
                "수익자",
                "대주",
            ]
        ],
        on="fund_id",
        how="left",
        suffixes=("", "_aum"),
    )
    merged = merged.merge(
        asset_summary[
            [
                "fund_id",
                "base_asset_class",
                "asset_nature_class",
                "business_stage_class",
            ]
        ],
        on="fund_id",
        how="left",
    )

    records = []
    for _, row in merged.iterrows():
        metadata = row_dict(
            row,
            {
                "Vehicle구분": "vehicle_type",
                "모집형태": "recruitment_type",
                "모자구분": "parent_child_type",
                "법적형태": "legal_form",
                "펀드분류": "fund_class",
                "국내/해외": "domestic_overseas",
                "주요투자지역": "primary_region",
                "투자섹터": "investment_sector",
                "펀드유형": "fund_type",
                "투자전략": "investment_strategy",
                "펀드형태": "fund_shape",
                "멀티클래스구분": "multi_class_type",
                "설정환매방식": "subscription_redemption_type",
                "개발여부": "is_development",
                "위탁운용여부": "is_delegated_management",
                "당사펀드재간접포함": "includes_igis_fund_of_funds",
                "Share-Deal여부": "is_share_deal",
                "판매사": "sales_company",
                "수탁사": "trustee",
                "사무관리사": "administrator",
                "위험등급": "risk_grade",
                "담당부문(운용)": "division",
                "부서(운용)": "department",
                "담당자(운용)": "manager",
                "책임자(운용)": "responsible_manager",
                "담당부서(투자)": "investment_department",
                "담당자(투자)": "investment_manager",
                "책임자(투자)": "investment_responsible_manager",
                "AUM합산대상여부": "is_aum_included",
                "KMS대상여부": "is_kms_target",
                "회계감사여부": "is_audited",
                "사업자등록번호": "business_registration_no",
                "금감원코드": "fss_code",
                "금융투자협회코드": "kofia_code",
                "사무수탁사코드": "administrator_code",
                "사무수탁사펀드명": "administrator_fund_name",
                "집합투자기구분류": "collective_investment_scheme_class",
                "KSD펀드코드": "ksd_fund_code",
                "KSD종목코드": "ksd_item_code",
                "결산기준일": "settlement_base_date",
                "회계기간": "accounting_period",
                "수익자": "beneficiaries_summary",
                "대주": "lenders_summary",
            },
        )

        amount_fields = {
            "aum_base_date": row.get("기준일자"),
            "base_price": row.get("기준가"),
            "net_asset_value": row.get("순자산총액"),
            "aum_input_date": row.get("AUM\n입력일자"),
            "equity_won": row.get("Equity 총액(원)"),
            "loan_won": row.get("Loan 총액(원)"),
            "deposit_won": row.get("기준일자 임대보증금(원)"),
            "benchmark_aum": row.get("AUM(원)"),
        }
        for key, value in amount_fields.items():
            if key.endswith("_date"):
                cleaned = clean_date(value)
            else:
                cleaned = clean_num(value)
            if cleaned is not None:
                metadata[key] = cleaned

        sector = clean_str(row.get("투자섹터"))
        vehicle = clean_str(row.get("Vehicle구분"))
        strategy = clean_str(row.get("투자전략"))
        base_asset = clean_str(row.get("base_asset_class"))
        asset_nature = clean_str(row.get("asset_nature_class"))
        business_stage = clean_str(row.get("business_stage_class"))

        for key, value in {
            "base_asset_class": base_asset,
            "asset_nature_class": asset_nature,
            "business_stage_class": business_stage,
        }.items():
            if value is not None:
                metadata[key] = value
        if any(metadata.get(k) for k in ("base_asset_class", "asset_nature_class", "business_stage_class")):
            metadata["asset_classification_source"] = "[new]투자 자산 조회_20260428.xlsx"
        metadata["fund_classification_source"] = "[new]펀드 관리_20260428.xlsx"

        record = {
            "fund_id": clean_str(row.get("fund_id")),
            "short_name": clean_str(row.get("약칭")),
            "fund_name": clean_str(row.get("펀드명")),
            "sector": sector,
            "asset_name": clean_str(row.get("자산명")),
            "status": clean_str(row.get("운용상태")),
            "location": clean_str(row.get("국내/해외")),
            "setup_date": clean_date(row.get("최초 설정일")),
            "maturity_date": clean_date(row.get("만기일")),
            "dept": clean_str(row.get("부서(운용)")) or clean_str(row.get("부서")),
            "manager": clean_str(row.get("담당자(운용)")) or clean_str(row.get("담당자")),
            "parent_fund_id": None,
            "metadata": metadata,
            "project_mission_name": clean_str(row.get("자산명")),
            # Legacy physical column names kept for dashboard/query compatibility.
            # Values are sourced from [new]투자 자산 조회_20260428.xlsx, not Notion.
            "notion_base_asset_class": base_asset,
            "notion_asset_nature_class": asset_nature,
            "notion_holding_type_class": clean_str(row.get("모자구분")),
            "notion_business_stage_class": business_stage,
            "notion_investment_strategy_class": strategy,
            "notion_vehicle_class": vehicle,
        }
        records.append(record)

    return pd.DataFrame(records)


def build_fund_assets(asset_lookup, asset_manage, valid_fund_ids):
    asset_lookup = asset_lookup[valid_fund_rows(asset_lookup)].copy()
    asset_lookup["fund_id"] = asset_lookup["펀드코드"].apply(clean_str)
    asset_lookup = asset_lookup[asset_lookup["fund_id"].isin(valid_fund_ids)].copy()

    by_name_addr, by_name = build_asset_manage_index(asset_manage)
    geo_cache = load_geocoding_cache()
    building_cache = load_building_cache()

    records = []
    for _, row in asset_lookup.iterrows():
        name = clean_str(row.get("자산(건물)명"))
        addr = clean_str(row.get("전체주소(시/도, 구/군 포함)"))
        manage = by_name_addr.get((name, addr), {}) or by_name.get(name, {})
        geo = geo_cache.get(addr) if addr else None
        building = building_cache.get(addr, {}) if addr else {}
        if not isinstance(building, dict):
            building = {}
        lat = lng = None
        if isinstance(geo, list) and len(geo) >= 2:
            lat, lng = geo[0], geo[1]

        metadata = row_dict(
            row,
            {
                "약칭": "fund_short_name",
                "펀드명": "fund_name",
                "국내/해외": "fund_location",
                "펀드유형": "fund_type",
                "순번": "asset_sequence",
                "기초자산": "base_asset_class",
                "자산성격": "asset_nature_class",
                "사업단계": "business_stage_class",
                "투자전략": "investment_strategy_class",
                "Vehicle구분": "vehicle_class",
                "국내/해외(자산)": "asset_location_type",
                "투자국가": "investment_country",
                "현지운용사": "local_asset_manager",
                "현지PM": "local_pm",
                "재간접투자유형": "indirect_investment_type",
                "재간접투자섹터": "indirect_investment_sector",
                "재간접투자전략": "indirect_investment_strategy",
                "운용상태": "fund_status",
                "펀드형태": "fund_shape",
                "모자구분": "parent_child_type",
                "담당부문": "division",
                "담당부서": "department",
                "담당자": "manager",
            },
        )
        manage_meta = row_dict(
            pd.Series(manage),
            {
                "자산코드": "asset_code",
                "투자국가": "managed_investment_country",
                "투자도시": "managed_investment_city",
                "대출통화": "loan_currency",
                "대출금액": "loan_amount",
                "LTV": "ltv",
                "감정평가 금액": "appraisal_value",
                "ESG Certificate 종류": "esg_certificate_type",
                "획득일자": "esg_acquired_date",
                "등급": "esg_grade",
                "만료일자": "esg_expiry_date",
                "매입일자": "acquisition_date",
                "매입통화": "acquisition_currency",
                "매입가격": "acquisition_price",
                "매각일자": "disposition_date",
                "매각통화": "disposition_currency",
                "매각가격": "disposition_price",
            },
        )
        metadata.update(manage_meta)
        if addr:
            metadata["address"] = addr
        if building:
            metadata["building_ledger_source"] = "building_cache.json"
            metadata["building_ledger"] = {k: json_safe(v) for k, v in building.items()}
        pnu = clean_str(building.get("pnu"))
        if pnu:
            metadata["pnu"] = pnu

        completion_date = (
            clean_date(manage.get("준공(예정)일"))
            or clean_date(row.get("준공(예정)일"))
            or clean_date(building.get("completion_date"))
        )
        gfa = (
            clean_num(row.get("연면적(m²)"))
            or clean_num(manage.get("연면적(m²)"))
            or clean_num(building.get("gfa"))
        )
        record = {
            "fund_id": clean_str(row.get("fund_id")),
            "asset_name": name,
            "asset_type": clean_str(row.get("기초자산")),
            "address": addr,
            "location_category": clean_str(row.get("투자지역")) or clean_str(row.get("국내/해외(자산)")),
            "completion_date": completion_date,
            "gross_floor_area": gfa,
            "metadata": metadata,
            "lat": clean_num(lat),
            "lng": clean_num(lng),
            "site_area": clean_num(manage.get("토지면적(㎡)")) or clean_num(building.get("site_area")),
            "scr": clean_num(manage.get("매입당시 Cap rate(%)")),
            "far": clean_num(manage.get("전용률")) or clean_num(building.get("far")),
            "main_usage": (
                clean_str(row.get("기초자산"))
                or clean_str(manage.get("기초자산"))
                or clean_str(building.get("main_usage"))
            ),
            "structure": clean_str(building.get("structure")),
            "floors_up": clean_int(manage.get("건물규모(지상 층수)")) or clean_int(building.get("floors_up")),
            "floors_down": clean_int(manage.get("건물규모(지하 층수)")) or clean_int(building.get("floors_down")),
            "elevators": None,
            "parking": clean_int(manage.get("주차대수")),
            "height": clean_num(building.get("height")),
            "gfa": gfa,
        }
        records.append(record)

    df = pd.DataFrame(records)
    if not df.empty:
        df = df.drop_duplicates(subset=["fund_id", "asset_name"], keep="last")
    return df


def dataframe_to_records(df):
    int_columns = {"floors_up", "floors_down", "elevators", "parking"}
    records = []
    for row in df.to_dict(orient="records"):
        item = {}
        for key, value in row.items():
            if key in int_columns:
                item[key] = clean_int(value)
                continue
            value = clean_value(value)
            if isinstance(value, float) and math.isnan(value):
                value = None
            if isinstance(value, pd.Timestamp):
                value = value.strftime("%Y-%m-%d")
            if isinstance(value, dict):
                value = {
                    k: json_safe(v)
                    for k, v in value.items()
                    if json_safe(v) is not None
                }
            item[key] = value
        records.append(item)
    return records


def get_client():
    load_dotenv(BASE_DIR / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL/SUPABASE_KEY missing in .env")
    return create_client(url, key)


def delete_table(client, table, key_col, batch_size=500):
    total = 0
    while True:
        res = client.table(table).select(key_col).limit(batch_size).execute()
        keys = [row[key_col] for row in (res.data or []) if row.get(key_col) is not None]
        if not keys:
            break
        client.table(table).delete().in_(key_col, keys).execute()
        total += len(keys)
        print(f"Deleted {total} from {table}...")
    return total


def insert_records(client, table, records, batch_size=500):
    total = 0
    for start in range(0, len(records), batch_size):
        chunk = records[start : start + batch_size]
        if not chunk:
            continue
        client.table(table).insert(chunk).execute()
        total += len(chunk)
        print(f"Inserted {total}/{len(records)} into {table}...")
    return total


def validate_dataset(funds, fund_assets):
    issues = []
    if funds["fund_id"].duplicated().any():
        issues.append("funds has duplicate fund_id")
    if funds["fund_id"].isna().any():
        issues.append("funds has blank fund_id")
    if funds["fund_name"].isna().any():
        issues.append("funds has blank fund_name")
    invalid_asset_refs = sorted(set(fund_assets["fund_id"]) - set(funds["fund_id"]))
    if invalid_asset_refs:
        issues.append(f"fund_assets has invalid fund_id refs: {invalid_asset_refs[:10]}")
    return issues


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Delete and replace Supabase data.")
    parser.add_argument(
        "--keep-extra-tables",
        action="store_true",
        help="Do not clear lender_exposures, beneficiary_exposures, and market_data.",
    )
    args = parser.parse_args()

    paths = find_source_files()
    print("Source files:")
    for key, path in paths.items():
        print(f"  {key}: {path}")

    fund_df, aum_df, asset_lookup, asset_manage = read_sources(paths)
    funds = build_funds(fund_df, aum_df, asset_lookup)
    fund_assets = build_fund_assets(asset_lookup, asset_manage, set(funds["fund_id"]))
    issues = validate_dataset(funds, fund_assets)

    print("\nPrepared dataset:")
    print(f"  funds: {len(funds)}")
    print(f"  fund_assets: {len(fund_assets)}")
    print(f"  active funds: {(funds['status'] == '운용').sum()}")
    print(f"  closed funds: {(funds['status'] == '청산').sum()}")
    print(f"  funds with AUM metadata: {funds['metadata'].apply(lambda m: 'benchmark_aum' in m).sum()}")
    print(f"  assets with lat/lng: {fund_assets[['lat', 'lng']].notna().all(axis=1).sum()}")
    print("  sample funds:")
    print(funds[["fund_id", "fund_name", "status", "setup_date", "maturity_date", "dept", "manager"]].head(8).to_string(index=False))
    if issues:
        print("\nValidation issues:")
        for issue in issues:
            print(f"  - {issue}")
        raise SystemExit(1)

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to replace Supabase data.")
        return

    client = get_client()
    if not args.keep_extra_tables:
        for table, key_col in [
            ("market_data", "id"),
            ("beneficiary_exposures", "id"),
            ("lender_exposures", "id"),
        ]:
            delete_table(client, table, key_col)

    delete_table(client, "fund_assets", "id")
    delete_table(client, "funds", "fund_id")

    insert_records(client, "funds", dataframe_to_records(funds))
    insert_records(client, "fund_assets", dataframe_to_records(fund_assets))
    print("\nReplacement completed.")


if __name__ == "__main__":
    main()
