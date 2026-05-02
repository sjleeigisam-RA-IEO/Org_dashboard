import argparse
import math
import os
import re
from pathlib import Path

import pandas as pd
from supabase import create_client
from env_utils import get_required_supabase_config


BASE_DIR = Path(__file__).resolve().parent
ARCHIVE_DIR = BASE_DIR / "_archive"
FUND_ID_RE = re.compile(r"^[A-Z0-9]+$")


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


def find_source_files():
    files = {}
    for path in ARCHIVE_DIR.glob("*.xlsx"):
        if "20260427" not in path.name:
            continue
        if not path.name:
            continue
        first = ord(path.name[0])
        if first == 0xB300:  # 대
            files["lender"] = path
        elif first == 0xC218:  # 수
            files["beneficiary"] = path
    missing = {"lender", "beneficiary"} - set(files)
    if missing:
        raise FileNotFoundError(f"Missing exposure workbook(s): {sorted(missing)}")
    return files


def valid_fund_id(value):
    value = clean_str(value)
    return bool(value and FUND_ID_RE.match(value))


def build_lenders(path, valid_fund_ids):
    df = pd.read_excel(path, header=0, dtype=object)
    records = []
    skipped_invalid = 0
    skipped_missing_fund = 0
    for _, row in df.iterrows():
        fund_id = clean_str(row.get("펀드코드"))
        lender = clean_str(row.get("대주"))
        if not valid_fund_id(fund_id) or not lender:
            skipped_invalid += 1
            continue
        if fund_id not in valid_fund_ids:
            skipped_missing_fund += 1
            continue
        records.append(
            {
                "fund_id": fund_id,
                "lender_raw": lender,
                "lender_clean": lender,
                "committed_amt": clean_int(row.get("대출약정금액(원)")),
                "drawn_amt": clean_int(row.get("대출인출금액(원)")),
                "remaining_amt": clean_int(row.get("대출잔여금액(원)")),
                "drawdown_date": clean_date(row.get("대출인출일")),
                "loan_maturity_date": clean_date(row.get("대출만기일")),
                "trench": clean_str(row.get("트렌치")),
                "interest_type": clean_str(row.get("이자유형")),
                "base_rate": clean_num(row.get("기준금리")),
                "spread_rate": clean_num(row.get("가산금리")),
                "all_in_rate": clean_num(row.get("All-in금리")),
                "remarks": clean_str(row.get("비고")),
                "base_date": clean_date(row.get("기준일자")),
            }
        )
    return records, {"invalid": skipped_invalid, "missing_fund": skipped_missing_fund}


def build_beneficiaries(path, valid_fund_ids):
    df = pd.read_excel(path, header=0, dtype=object)
    records = []
    skipped_invalid = 0
    skipped_missing_fund = 0
    for _, row in df.iterrows():
        fund_id = clean_str(row.get("펀드코드"))
        beneficiary = clean_str(row.get("수익자"))
        if not valid_fund_id(fund_id) or not beneficiary:
            skipped_invalid += 1
            continue
        if fund_id not in valid_fund_ids:
            skipped_missing_fund += 1
            continue
        records.append(
            {
                "fund_id": fund_id,
                "beneficiary_raw": beneficiary,
                "beneficiary_clean": beneficiary,
                "beneficiary_type": clean_str(row.get("수익자구분")),
                "beneficiary_cat": clean_str(row.get("수익자분류")),
                "committed_amt": clean_int(row.get("총약정금액")),
                "invested_amt": clean_int(row.get("투입금액")),
                "remaining_amt": clean_int(row.get("잔여약정금액")),
                "share_ratio": clean_num(row.get("비율(%)")),
                "setup_units": clean_num(row.get("설정해지좌수")),
                "setup_amt": clean_num(row.get("설정해지금액")),
                "remarks": clean_str(row.get("비고")),
                "base_date": clean_date(row.get("기준일자")),
            }
        )
    return records, {"invalid": skipped_invalid, "missing_fund": skipped_missing_fund}


def collapse_records(records, key_fields, sum_fields, join_fields=None):
    join_fields = join_fields or []
    collapsed = {}
    for record in records:
        key = tuple(record.get(field) for field in key_fields)
        if key not in collapsed:
            collapsed[key] = dict(record)
            continue

        target = collapsed[key]
        for field in sum_fields:
            left = target.get(field) or 0
            right = record.get(field) or 0
            summed = left + right
            target[field] = summed if summed != 0 else None

        for field in join_fields:
            values = []
            for value in [target.get(field), record.get(field)]:
                value = clean_str(value)
                if value and value not in values:
                    values.append(value)
            target[field] = " / ".join(values) if values else None

        for field, value in record.items():
            if field in key_fields or field in sum_fields or field in join_fields:
                continue
            if target.get(field) is None and value is not None:
                target[field] = value
    return list(collapsed.values())


def build_missing_funds(paths, valid_fund_ids):
    candidates = []
    for source_name in ["lender", "beneficiary"]:
        df = pd.read_excel(paths[source_name], header=0, dtype=object)
        for _, row in df.iterrows():
            fund_id = clean_str(row.get("펀드코드"))
            if not valid_fund_id(fund_id) or fund_id in valid_fund_ids:
                continue
            candidates.append(
                {
                    "fund_id": fund_id,
                    "short_name": clean_str(row.get("약칭")),
                    "fund_name": clean_str(row.get("펀드명")),
                    "sector": clean_str(row.get("투자섹터")),
                    "asset_name": clean_str(row.get("자산")),
                    "status": clean_str(row.get("운용상태")),
                    "location": clean_str(row.get("국내해외구분")),
                    "setup_date": clean_date(row.get("펀드설정일")),
                    "maturity_date": clean_date(row.get("펀드만기일")),
                    "dept": clean_str(row.get("담당부서")),
                    "manager": clean_str(row.get("담당자")),
                    "metadata": {"source": source_name, "supplemented_from_exposure_file": True},
                }
            )

    deduped = {}
    for record in candidates:
        if record["fund_id"] not in deduped:
            deduped[record["fund_id"]] = record
    return list(deduped.values())


def get_client():
    url, key = get_required_supabase_config()
    return create_client(url, key)


def fetch_valid_fund_ids(client):
    fund_ids = set()
    start = 0
    size = 1000
    while True:
        rows = client.table("funds").select("fund_id").range(start, start + size - 1).execute().data
        fund_ids.update(row["fund_id"] for row in rows if row.get("fund_id"))
        if len(rows) < size:
            break
        start += size
    return fund_ids


def delete_table(client, table, batch_size=500):
    total = 0
    while True:
        rows = client.table(table).select("id").limit(batch_size).execute().data
        ids = [row["id"] for row in rows if row.get("id") is not None]
        if not ids:
            break
        client.table(table).delete().in_("id", ids).execute()
        total += len(ids)
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Replace exposure tables in Supabase.")
    args = parser.parse_args()

    files = find_source_files()
    client = get_client()
    valid_fund_ids = fetch_valid_fund_ids(client)
    missing_funds = build_missing_funds(files, valid_fund_ids)
    augmented_fund_ids = set(valid_fund_ids)
    augmented_fund_ids.update(row["fund_id"] for row in missing_funds)

    raw_lenders, lender_skips = build_lenders(files["lender"], augmented_fund_ids)
    raw_beneficiaries, beneficiary_skips = build_beneficiaries(files["beneficiary"], augmented_fund_ids)
    lenders = collapse_records(
        raw_lenders,
        ["fund_id", "lender_clean", "base_date"],
        ["committed_amt", "drawn_amt", "remaining_amt"],
        ["trench", "interest_type", "remarks"],
    )
    beneficiaries = collapse_records(
        raw_beneficiaries,
        ["fund_id", "beneficiary_clean", "base_date"],
        ["committed_amt", "invested_amt", "remaining_amt", "setup_units", "setup_amt", "share_ratio"],
        ["beneficiary_type", "beneficiary_cat", "remarks"],
    )

    print("Source files:")
    print(f"  lender: {files['lender']}")
    print(f"  beneficiary: {files['beneficiary']}")
    print("\nPrepared dataset:")
    print(f"  valid funds in DB: {len(valid_fund_ids)}")
    print(f"  supplemental funds: {len(missing_funds)} {[(r['fund_id'], r['fund_name']) for r in missing_funds]}")
    print(f"  lender_exposures: {len(lenders)} raw={len(raw_lenders)} skipped={lender_skips}")
    print(f"  beneficiary_exposures: {len(beneficiaries)} raw={len(raw_beneficiaries)} skipped={beneficiary_skips}")
    print("  lender sample:", lenders[:2])
    print("  beneficiary sample:", beneficiaries[:2])

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to replace exposure tables.")
        return

    if missing_funds:
        insert_records(client, "funds", missing_funds)
    delete_table(client, "lender_exposures")
    delete_table(client, "beneficiary_exposures")
    insert_records(client, "lender_exposures", lenders)
    insert_records(client, "beneficiary_exposures", beneficiaries)
    print("\nExposure replacement completed.")


if __name__ == "__main__":
    main()
