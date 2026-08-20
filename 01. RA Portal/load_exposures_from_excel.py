import argparse
import json
import math
import os
import re
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
ARCHIVE_DIR = BASE_DIR / "_archive"
SOURCE_DIR = BASE_DIR.parent / "00. Raw Data"
FUND_ID_RE = re.compile(r"^[A-Z0-9]+$")
PREFERRED_SOURCE_PATTERNS = {
    "lender": ("대주*외부검증*통합본_20260713_v*.xlsx",),
    "beneficiary": ("수익자*외부검증*통합본_20260713_v*.xlsx",),
}
PREFERRED_SOURCE_SHEETS = {
    "lender": "검증_대출레코드",
    "beneficiary": "검증_투자레코드",
}


def get_required_supabase_config():
    env_path = BASE_DIR.parent / ".env"
    if not env_path.exists():
        env_path = BASE_DIR / ".env"

    values = {}
    repeated_keys = []
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key == "SUPABASE_KEY":
            repeated_keys.append(value)
        else:
            values[key] = value

    values.update({key: value for key, value in os.environ.items() if key.startswith("SUPABASE_")})
    url = values.get("SUPABASE_URL")
    key = (
        values.get("SUPABASE_SERVICE_ROLE_KEY")
        or next((value for value in repeated_keys if value.startswith("sb_secret_")), None)
        or values.get("SUPABASE_KEY")
        or values.get("SUPABASE_ANON_KEY")
        or next((value for value in repeated_keys if value), None)
    )
    if not url or not key:
        raise RuntimeError(f"SUPABASE_URL and a Supabase API key must be set in {env_path}")
    return url, key


class PostgrestResult:
    def __init__(self, data=None):
        self.data = data


class PostgrestQuery:
    def __init__(self, client, relation):
        self.client = client
        self.relation = relation
        self.method = "GET"
        self.params = {}
        self.payload = None
        self.prefer = None

    def select(self, columns):
        self.method = "GET"
        self.params["select"] = columns
        return self

    def range(self, start, end):
        self.params["offset"] = start
        self.params["limit"] = end - start + 1
        return self

    def limit(self, size):
        self.params["limit"] = size
        return self

    def delete(self):
        self.method = "DELETE"
        return self

    def insert(self, payload):
        self.method = "POST"
        self.payload = payload
        self.prefer = "return=representation"
        return self

    def upsert(self, payload, on_conflict):
        self.method = "POST"
        self.payload = payload
        self.params["on_conflict"] = on_conflict
        self.prefer = "resolution=merge-duplicates,return=representation"
        return self

    def in_(self, column, values):
        encoded = ",".join(str(value) for value in values)
        self.params[column] = f"in.({encoded})"
        return self

    def execute(self):
        return PostgrestResult(
            self.client.request(
                self.method,
                self.relation,
                params=self.params,
                payload=self.payload,
                prefer=self.prefer,
            )
        )


class PostgrestClient:
    def __init__(self, url, api_key):
        self.base_url = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def request(self, method, relation, params=None, payload=None, prefer=None):
        query = f"?{urlencode(params or {}, doseq=True, safe=',.*()')}" if params else ""
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            f"{self.base_url}/{relation}{query}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=120) as response:
                raw = response.read()
                return json.loads(raw.decode("utf-8")) if raw else None
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"PostgREST {method} {relation} failed: {error.code} {detail}") from error

    def table(self, relation):
        return PostgrestQuery(self, relation)

    def rpc(self, function_name):
        query = PostgrestQuery(self, f"rpc/{function_name}")
        query.method = "POST"
        query.payload = {}
        return query


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


def clean_bool(value):
    value = clean_value(value)
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)

    text = str(value).replace("\xa0", " ").strip().lower()
    if text in {"y", "yes", "true", "1", "예", "해당", "있음"}:
        return True
    if text in {"n", "no", "false", "0", "아니오", "비해당", "없음"}:
        return False
    return None


def source_file_sort_key(path):
    snapshot_match = re.search(r"(20\d{6})", path.stem)
    version_match = re.search(r"_v(\d+)", path.stem, flags=re.IGNORECASE)
    return (
        int(snapshot_match.group(1)) if snapshot_match else 0,
        int(version_match.group(1)) if version_match else 0,
        path.stat().st_mtime,
    )


def source_snapshot_date(path):
    match = re.search(r"(20\d{6})", path.stem)
    if not match:
        return None
    return pd.to_datetime(match.group(1), format="%Y%m%d", errors="coerce").strftime("%Y-%m-%d")


def find_source_files():
    files = {}

    for source_name, patterns in PREFERRED_SOURCE_PATTERNS.items():
        candidates = []
        for pattern in patterns:
            candidates.extend(SOURCE_DIR.glob(pattern))
        if candidates:
            files[source_name] = max(candidates, key=source_file_sort_key)

    for path in ARCHIVE_DIR.glob("*.xlsx"):
        if "20260427" not in path.name:
            continue
        if not path.name:
            continue
        first = ord(path.name[0])
        if first == 0xB300 and "lender" not in files:  # 대
            files["lender"] = path
        elif first == 0xC218 and "beneficiary" not in files:  # 수
            files["beneficiary"] = path
    missing = {"lender", "beneficiary"} - set(files)
    if missing:
        raise FileNotFoundError(f"Missing exposure workbook(s): {sorted(missing)}")
    return files


def read_source_dataframe(path, source_name):
    with pd.ExcelFile(path) as workbook:
        preferred_sheet = PREFERRED_SOURCE_SHEETS[source_name]
        sheet_name = preferred_sheet if preferred_sheet in workbook.sheet_names else workbook.sheet_names[0]
        dataframe = pd.read_excel(workbook, sheet_name=sheet_name, header=0, dtype=object)
    return dataframe, sheet_name


def valid_fund_id(value):
    value = clean_str(value)
    return bool(value and FUND_ID_RE.match(value))


def build_lenders(path, valid_fund_ids):
    df, sheet_name = read_source_dataframe(path, "lender")
    records = []
    metadata_records = []
    skipped_invalid = 0
    skipped_missing_fund = 0
    snapshot_date = source_snapshot_date(path)
    for workbook_row_number, (_, row) in enumerate(df.iterrows(), start=2):
        fund_id = clean_str(row.get("펀드코드"))
        lender = clean_str(row.get("대주"))
        if not valid_fund_id(fund_id) or not lender:
            skipped_invalid += 1
            continue
        if fund_id not in valid_fund_ids:
            skipped_missing_fund += 1
            continue
        base_date = clean_date(row.get("기준일자"))
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
                "base_date": base_date,
            }
        )

        metadata = {
            "fund_id": fund_id,
            "lender_clean": lender,
            "base_date": base_date,
            "source_lender_role": clean_str(row.get("대주역할")),
            "source_account_notation": clean_str(row.get("실질대주/계정표기")),
            "source_loan_type": clean_str(row.get("대출유형")),
            "shareholder_loan_flag": clean_bool(row.get("주주대여금여부")),
            "securitization_flag": clean_bool(row.get("유동화증권여부")),
            "source_standard_id": clean_str(row.get("표준대주ID_후보")),
            "source_standard_name": clean_str(row.get("표준대주법인명_후보")),
            "source_group_name": clean_str(row.get("상위그룹_후보")),
            "source_file": path.name,
            "source_snapshot_date": snapshot_date,
        }
        metadata["source_rows"] = [
            {
                "record_id": clean_str(row.get("대주레코드ID")),
                "workbook_file": path.name,
                "workbook_sheet": sheet_name,
                "workbook_row_number": workbook_row_number,
                "original_row_number": clean_int(row.get("원본행번호")),
                "source_lender_role": metadata["source_lender_role"],
                "source_account_notation": metadata["source_account_notation"],
                "source_loan_type": metadata["source_loan_type"],
                "shareholder_loan_flag": metadata["shareholder_loan_flag"],
                "securitization_flag": metadata["securitization_flag"],
                "source_standard_id": metadata["source_standard_id"],
                "source_standard_name": metadata["source_standard_name"],
                "source_group_name": metadata["source_group_name"],
            }
        ]
        metadata_records.append(metadata)
    return records, metadata_records, {"invalid": skipped_invalid, "missing_fund": skipped_missing_fund}


def build_beneficiaries(path, valid_fund_ids):
    df, sheet_name = read_source_dataframe(path, "beneficiary")
    records = []
    metadata_records = []
    skipped_invalid = 0
    skipped_missing_fund = 0
    snapshot_date = source_snapshot_date(path)
    for workbook_row_number, (_, row) in enumerate(df.iterrows(), start=2):
        fund_id = clean_str(row.get("펀드코드"))
        beneficiary = clean_str(row.get("수익자"))
        if not valid_fund_id(fund_id) or not beneficiary:
            skipped_invalid += 1
            continue
        if fund_id not in valid_fund_ids:
            skipped_missing_fund += 1
            continue
        base_date = clean_date(row.get("기준일자"))
        records.append(
            {
                "fund_id": fund_id,
                "beneficiary_raw": beneficiary,
                "beneficiary_clean": beneficiary,
                "committed_amt": clean_int(row.get("총약정금액")),
                "invested_amt": clean_int(row.get("투입금액")),
                "remaining_amt": clean_int(row.get("잔여약정금액")),
                "share_ratio": clean_num(row.get("비율(%)")),
                "setup_units": clean_num(row.get("설정해지좌수")),
                "setup_amt": clean_num(row.get("설정해지금액")),
                "remarks": clean_str(row.get("비고")),
                "base_date": base_date,
            }
        )

        # Preserve source classification as provenance; canonical classification belongs to the clean DB contract.
        metadata = {
            "fund_id": fund_id,
            "beneficiary_clean": beneficiary,
            "base_date": base_date,
            "source_beneficiary_type": clean_str(row.get("수익자구분")),
            "source_beneficiary_category": clean_str(row.get("수익자분류")),
            "source_standard_id": clean_str(row.get("표준투자자ID_후보")),
            "source_standard_name": clean_str(row.get("표준투자자명_후보")),
            "source_group_name": clean_str(row.get("상위그룹_후보")),
            "initial_commitment_date": clean_date(row.get("최초약정일")),
            "capital_call_date": clean_date(row.get("약정콜일자")),
            "source_file": path.name,
            "source_snapshot_date": snapshot_date,
        }
        metadata["source_rows"] = [
            {
                "record_id": clean_str(row.get("투자레코드ID")),
                "workbook_file": path.name,
                "workbook_sheet": sheet_name,
                "workbook_row_number": workbook_row_number,
                "original_file": clean_str(row.get("원본파일")),
                "original_sheet": clean_str(row.get("원본시트")),
                "original_row_number": clean_int(row.get("원본행번호")),
                "source_beneficiary_type": metadata["source_beneficiary_type"],
                "source_beneficiary_category": metadata["source_beneficiary_category"],
                "source_standard_id": metadata["source_standard_id"],
                "source_standard_name": metadata["source_standard_name"],
                "source_group_name": metadata["source_group_name"],
                "initial_commitment_date": metadata["initial_commitment_date"],
                "capital_call_date": metadata["capital_call_date"],
            }
        ]
        metadata_records.append(metadata)
    return records, metadata_records, {"invalid": skipped_invalid, "missing_fund": skipped_missing_fund}


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


def collapse_metadata_records(records, key_fields):
    collapsed = {}
    for record in records:
        key = tuple(record.get(field) for field in key_fields)
        if key not in collapsed:
            collapsed[key] = dict(record)
            collapsed[key]["source_rows"] = list(record.get("source_rows") or [])
            continue

        target = collapsed[key]
        target["source_rows"].extend(record.get("source_rows") or [])
        for field, value in record.items():
            if field in key_fields or field == "source_rows":
                continue
            if target.get(field) is None and value is not None:
                target[field] = value
    return list(collapsed.values())


def build_missing_funds(paths, valid_fund_ids):
    candidates = []
    for source_name in ["lender", "beneficiary"]:
        df, _ = read_source_dataframe(paths[source_name], source_name)
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
    return PostgrestClient(url, key)


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


def insert_records(client, table, records, batch_size=500, return_rows=False):
    total = 0
    inserted_rows = []
    for start in range(0, len(records), batch_size):
        chunk = records[start : start + batch_size]
        if not chunk:
            continue
        response = client.table(table).insert(chunk).execute()
        if return_rows:
            inserted_rows.extend(response.data or [])
        total += len(chunk)
        print(f"Inserted {total}/{len(records)} into {table}...")
    if return_rows:
        if len(inserted_rows) != len(records):
            raise RuntimeError(
                f"Expected {len(records)} returned rows from {table}, received {len(inserted_rows)}."
            )
        return inserted_rows
    return total


def upsert_records(client, table, records, batch_size=500):
    total = 0
    for start in range(0, len(records), batch_size):
        chunk = records[start : start + batch_size]
        if not chunk:
            continue
        client.table(table).upsert(chunk, on_conflict="exposure_id").execute()
        total += len(chunk)
        print(f"Upserted {total}/{len(records)} into {table}...")
    return total


def metadata_rows_for_inserted_exposures(inserted_rows, metadata_records, clean_name_field):
    key_fields = ["fund_id", clean_name_field, "base_date"]
    metadata_by_grain = {
        tuple(record.get(field) for field in key_fields): record for record in metadata_records
    }
    matched_grains = set()
    upserts = []

    for exposure in inserted_rows:
        grain = tuple(exposure.get(field) for field in key_fields)
        metadata = metadata_by_grain.get(grain)
        if metadata is None:
            raise RuntimeError(f"Missing source metadata for inserted exposure grain: {grain}")
        if exposure.get("id") is None:
            raise RuntimeError(f"Inserted exposure has no returned id: {grain}")

        row = dict(metadata)
        for field in key_fields:
            row.pop(field, None)
        row["exposure_id"] = exposure["id"]
        upserts.append(row)
        matched_grains.add(grain)

    unmatched = set(metadata_by_grain) - matched_grains
    if unmatched:
        examples = sorted(unmatched, key=str)[:3]
        raise RuntimeError(f"Source metadata did not match inserted exposure rows: {examples}")
    return upserts


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

    raw_lenders, raw_lender_metadata, lender_skips = build_lenders(
        files["lender"], augmented_fund_ids
    )
    raw_beneficiaries, raw_beneficiary_metadata, beneficiary_skips = build_beneficiaries(
        files["beneficiary"], augmented_fund_ids
    )
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
        ["remarks"],
    )
    lender_metadata = collapse_metadata_records(
        raw_lender_metadata,
        ["fund_id", "lender_clean", "base_date"],
    )
    beneficiary_metadata = collapse_metadata_records(
        raw_beneficiary_metadata,
        ["fund_id", "beneficiary_clean", "base_date"],
    )

    print("Source files:")
    print(f"  lender: {files['lender']}")
    print(f"  beneficiary: {files['beneficiary']}")
    print("\nPrepared dataset:")
    print(f"  valid funds in DB: {len(valid_fund_ids)}")
    print(f"  supplemental funds: {len(missing_funds)} {[(r['fund_id'], r['fund_name']) for r in missing_funds]}")
    print(f"  lender_exposures: {len(lenders)} raw={len(raw_lenders)} skipped={lender_skips}")
    print(f"  beneficiary_exposures: {len(beneficiaries)} raw={len(raw_beneficiaries)} skipped={beneficiary_skips}")
    print(f"  lender_exposure_source_metadata: {len(lender_metadata)}")
    print(f"  beneficiary_exposure_source_metadata: {len(beneficiary_metadata)}")
    print("  lender sample:", lenders[:2])
    print("  beneficiary sample:", beneficiaries[:2])

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to replace exposure tables.")
        return

    if missing_funds:
        insert_records(client, "funds", missing_funds)
    delete_table(client, "lender_exposures")
    delete_table(client, "beneficiary_exposures")
    inserted_lenders = insert_records(client, "lender_exposures", lenders, return_rows=True)
    lender_metadata_upserts = metadata_rows_for_inserted_exposures(
        inserted_lenders,
        lender_metadata,
        "lender_clean",
    )
    upsert_records(client, "lender_exposure_source_metadata", lender_metadata_upserts)

    inserted_beneficiaries = insert_records(
        client,
        "beneficiary_exposures",
        beneficiaries,
        return_rows=True,
    )
    beneficiary_metadata_upserts = metadata_rows_for_inserted_exposures(
        inserted_beneficiaries,
        beneficiary_metadata,
        "beneficiary_clean",
    )
    upsert_records(
        client,
        "beneficiary_exposure_source_metadata",
        beneficiary_metadata_upserts,
    )
    client.rpc("refresh_party_exposure_surfaces").execute()
    print("Refreshed party exposure dashboard surfaces.")
    print("\nExposure replacement completed.")


if __name__ == "__main__":
    main()
