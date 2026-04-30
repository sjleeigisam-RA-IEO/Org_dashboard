import argparse
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from replace_supabase_from_excel import (
    build_fund_assets,
    clean_date,
    clean_num,
    clean_str,
    dataframe_to_records,
    delete_table,
    insert_records,
    read_sources,
    row_dict,
)


BASE_DIR = Path(__file__).resolve().parent
ARCHIVE_DIR = BASE_DIR / "_archive"


CLASSIFICATION_COLUMNS = [
    "Vehicle구분",
    "모집형태",
    "모자구분",
    "법적형태",
    "펀드분류",
    "국내/해외",
    "주요투자지역",
    "투자섹터",
    "펀드유형",
    "투자전략",
    "펀드형태",
    "멀티클래스구분",
    "설정환매방식",
    "개발여부",
    "위탁운용여부",
    "당사펀드재간접포함",
    "Share-Deal여부",
    "AUM합산대상여부",
    "KMS대상여부",
    "회계감사여부",
]


def find_workbooks():
    sources = {}
    for path in ARCHIVE_DIR.glob("*.xlsx"):
        if path.name.startswith("~$"):
            continue
        try:
            head = pd.read_excel(path, header=None, nrows=1, dtype=object)
        except Exception:
            continue
        col_count = head.shape[1]
        first_values = [str(v).strip() for v in head.iloc[0, :3].tolist()]

        if "20260424" in path.name and col_count == 62:
            sources["fund_base"] = path
        elif "20260428" in path.name and col_count == 59 and first_values == ["펀드코드", "펀드명", "약칭"]:
            sources["fund_class"] = path
        elif "20260427" in path.name and col_count in (33, 36):
            sources["aum"] = path
        elif "aum" not in sources and "20260429" in path.name and col_count == 36:
            sources["aum"] = path
        elif "20260428" in path.name and col_count == 41 and first_values == ["펀드코드", "약칭", "펀드명"]:
            sources["asset_lookup"] = path
        elif "20260428" in path.name and col_count == 56 and first_values == ["선택", "자산코드", "자산(건물)명"]:
            sources["asset_manage"] = path

    missing = {"fund_base", "fund_class", "aum", "asset_lookup", "asset_manage"} - set(sources)
    if missing:
        raise FileNotFoundError(f"Missing workbook(s): {sorted(missing)}")
    return sources


def read_hybrid_sources(paths):
    base = pd.read_excel(paths["fund_base"], header=1, dtype=object)
    classifier = pd.read_excel(paths["fund_class"], header=0, dtype=object)
    _, aum, asset_lookup, asset_manage = read_sources(
        {
            "fund": paths["fund_class"],
            "aum": paths["aum"],
            "asset_lookup": paths["asset_lookup"],
            "asset_manage": paths["asset_manage"],
        }
    )
    return base, classifier, aum, asset_lookup, asset_manage


def valid_fund_rows(df, id_col="펀드코드", name_col="펀드명"):
    fund_id = df[id_col].apply(clean_str)
    fund_name = df[name_col].apply(clean_str)
    return fund_id.str.match(r"^[A-Z0-9]+$", na=False) & fund_name.notna()


def normalize_base_columns(base):
    rename = {
        "설정일": "최초 설정일",
        "위헙등급": "위험등급",
        "부서": "담당부서(투자)",
        "담당자": "담당자(투자)",
        "책임자": "책임자(투자)",
        "부서.1": "부서(운용)",
        "담당자.1": "담당자(운용)",
        "책임자.1": "책임자(운용)",
        "회계기간(월)": "회계기간",
    }
    return base.rename(columns={k: v for k, v in rename.items() if k in base.columns})


def overlay_classifications(base, classifier):
    base = normalize_base_columns(base)
    base = base[valid_fund_rows(base)].copy()
    base["fund_id"] = base["펀드코드"].apply(clean_str)
    base = base.drop_duplicates(subset=["fund_id"], keep="last")

    classifier = classifier[valid_fund_rows(classifier)].copy()
    classifier["fund_id"] = classifier["펀드코드"].apply(clean_str)
    classifier = classifier.drop_duplicates(subset=["fund_id"], keep="last").set_index("fund_id", drop=False)

    overlay_count = 0
    for idx, row in base.iterrows():
        fund_id = row["fund_id"]
        if fund_id not in classifier.index:
            continue
        for col in CLASSIFICATION_COLUMNS:
            if col in base.columns and col in classifier.columns:
                value = clean_str(classifier.at[fund_id, col])
                if value is not None:
                    base.at[idx, col] = value
                    overlay_count += 1

    return base, classifier, overlay_count


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


def build_funds(base, classifier, aum, asset_lookup):
    base, classifier, overlay_count = overlay_classifications(base, classifier)

    aum = aum[valid_fund_rows(aum)].copy()
    aum["fund_id"] = aum["펀드코드"].apply(clean_str)
    aum = aum.drop_duplicates(subset=["fund_id"], keep="last")
    for column in ["수익자", "대주"]:
        if column not in aum.columns:
            aum[column] = None

    asset_lookup = asset_lookup[valid_fund_rows(asset_lookup)].copy()
    asset_summary = asset_lookup.groupby("펀드코드", dropna=True).agg(
        base_asset_class=("기초자산", first_non_empty),
        asset_nature_class=("자산성격", first_non_empty),
        business_stage_class=("사업단계", first_non_empty),
    ).reset_index()
    asset_summary["fund_id"] = asset_summary["펀드코드"].apply(clean_str)

    merged = base.merge(
        aum[
            [
                "fund_id",
                "운용상태",
                "기준일자",
                "기준가",
                "순자산총액",
                "AUM\n입력일자",
                "Equity 총액(원)",
                "Loan 총액(원)",
                "기준일자 임대보증금(원)",
                "AUM(원)",
                "Equity 총액(원).1",
                "Loan 총액(원).1",
                "기준일자 임대보증금(원).1",
                "AUM(원).1",
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
                "담당부서(투자)": "investment_department",
                "담당자(투자)": "investment_manager",
                "책임자(투자)": "investment_responsible_manager",
                "부서(운용)": "department",
                "담당자(운용)": "manager",
                "책임자(운용)": "responsible_manager",
                "운용역 정보": "manager_info",
                "AUM합산대상여부": "is_aum_included",
                "KMS대상여부": "is_kms_target",
                "회계감사여부": "is_audited",
                "사업자등록번호": "business_registration_no",
                "금감원코드": "fss_code",
                "금융투자협회코드": "kofia_code",
                "집합투자기구분류": "collective_investment_scheme_class",
                "KSD펀드코드": "ksd_fund_code",
                "KSD종목코드": "ksd_item_code",
                "결산기준일": "settlement_base_date",
                "회계기간": "accounting_period",
                "수익자": "beneficiaries_summary",
                "대주": "lenders_summary",
            },
        )
        metadata["fund_base_source"] = "펀드 관리_20260424.xlsx"
        if clean_str(row.get("fund_id")) in classifier.index:
            metadata["classification_source"] = "[new]펀드 관리_20260428.xlsx"
            metadata["fund_classification_source"] = "[new]펀드 관리_20260428.xlsx"

        for key, value in {
            "base_asset_class": row.get("base_asset_class"),
            "asset_nature_class": row.get("asset_nature_class"),
            "business_stage_class": row.get("business_stage_class"),
        }.items():
            cleaned = clean_str(value)
            if cleaned is not None:
                metadata[key] = cleaned
        if any(metadata.get(k) for k in ("base_asset_class", "asset_nature_class", "business_stage_class")):
            metadata["asset_classification_source"] = "[new]투자 자산 조회_20260428.xlsx"

        amount_fields = {
            "aum_base_date": row.get("기준일자"),
            "base_price": row.get("기준가"),
            "net_asset_value": row.get("순자산총액"),
            "aum_input_date": row.get("AUM\n입력일자"),
            "equity_won": row.get("Equity 총액(원)"),
            "loan_won": row.get("Loan 총액(원)"),
            "deposit_won": row.get("기준일자 임대보증금(원)"),
            "benchmark_aum": row.get("AUM(원)"),
            "invested_equity_won": row.get("Equity 총액(원).1"),
            "invested_loan_won": row.get("Loan 총액(원).1"),
            "invested_deposit_won": row.get("기준일자 임대보증금(원).1"),
            "invested_aum": row.get("AUM(원).1"),
            "termination_date": row.get("해지일"),
        }
        for key, value in amount_fields.items():
            cleaned = clean_date(value) if key.endswith("_date") else clean_num(value)
            if cleaned is not None:
                metadata[key] = cleaned
        aum_status = clean_str(row.get("운용상태_aum"))
        if aum_status is not None:
            metadata["aum_status"] = aum_status
            metadata["aum_source"] = "펀드 AUM 관리_20260427.xlsx"

        record = {
            "fund_id": clean_str(row.get("fund_id")),
            "short_name": clean_str(row.get("약칭")),
            "fund_name": clean_str(row.get("펀드명")),
            "sector": clean_str(row.get("투자섹터")),
            "asset_name": clean_str(row.get("자산명")),
            "status": clean_str(row.get("운용상태")),
            "location": clean_str(row.get("국내/해외")),
            "setup_date": clean_date(row.get("최초 설정일")),
            "maturity_date": clean_date(row.get("만기일")),
            "dept": clean_str(row.get("부서(운용)")) or clean_str(row.get("담당부서(투자)")),
            "manager": clean_str(row.get("담당자(운용)")) or clean_str(row.get("담당자(투자)")),
            "parent_fund_id": None,
            "metadata": metadata,
            "project_mission_name": clean_str(row.get("자산명")),
            # Legacy physical column names kept for dashboard/query compatibility.
            # Values are sourced from [new]투자 자산 조회_20260428.xlsx, not Notion.
            "notion_base_asset_class": clean_str(row.get("base_asset_class")),
            "notion_asset_nature_class": clean_str(row.get("asset_nature_class")),
            "notion_holding_type_class": clean_str(row.get("모자구분")),
            "notion_business_stage_class": clean_str(row.get("business_stage_class")),
            "notion_investment_strategy_class": clean_str(row.get("투자전략")),
            "notion_vehicle_class": clean_str(row.get("Vehicle구분")),
        }
        records.append(record)

    funds = pd.DataFrame(records)
    return funds, overlay_count


def get_client():
    load_dotenv(BASE_DIR / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL/SUPABASE_KEY missing in .env")
    return create_client(url, key)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Delete and replace Supabase data.")
    args = parser.parse_args()

    paths = find_workbooks()
    base, classifier, aum, asset_lookup, asset_manage = read_hybrid_sources(paths)
    funds, overlay_count = build_funds(base, classifier, aum, asset_lookup)
    fund_assets = build_fund_assets(asset_lookup, asset_manage, set(funds["fund_id"]))

    print("Hybrid source files:")
    for key, path in paths.items():
        print(f"  {key}: {path.name}")
    print("\nPrepared hybrid dataset:")
    print(f"  funds: {len(funds)}")
    print(f"  fund_assets: {len(fund_assets)}")
    print(f"  classification overlay cells: {overlay_count}")
    print(f"  funds with classification_source=0428: {funds['metadata'].apply(lambda m: m.get('classification_source') is not None).sum()}")
    print(f"  funds with AUM metadata: {funds['metadata'].apply(lambda m: 'benchmark_aum' in m).sum()}")
    print("  sample funds:")
    print(funds[["fund_id", "fund_name", "status", "setup_date", "maturity_date", "sector", "dept"]].head(10).to_string(index=False))

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to replace Supabase data.")
        return

    client = get_client()
    for table, key_col in [
        ("market_data", "id"),
        ("beneficiary_exposures", "id"),
        ("lender_exposures", "id"),
        ("fund_assets", "id"),
        ("funds", "fund_id"),
    ]:
        delete_table(client, table, key_col)

    insert_records(client, "funds", dataframe_to_records(funds))
    insert_records(client, "fund_assets", dataframe_to_records(fund_assets))
    print("\nHybrid replacement completed.")


if __name__ == "__main__":
    main()
