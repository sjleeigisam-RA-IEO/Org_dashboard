import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import update_fund_db_incremental as base


ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT_DIR / "00. Raw Data" / "26.08"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
SNAPSHOT_DATE = "2026-07-31"
SOURCE_DATE = "20260821"

PATHS = {
    "fund": SOURCE_DIR / f"펀드 관리_{SOURCE_DATE}.xlsx",
    "aum": SOURCE_DIR / f"펀드 AUM 관리_{SOURCE_DATE}.xlsx",
    "asset": SOURCE_DIR / f"투자 자산 관리_{SOURCE_DATE}.xlsx",
    "lender": SOURCE_DIR / f"대주 정보 조회_{SOURCE_DATE}.xlsx",
    "beneficiary": SOURCE_DIR / f"수익자 정보 조회_{SOURCE_DATE}.xlsx",
}

BACKUP_TABLES = (
    "funds",
    "asset_master",
    "aum_snapshots",
    "fund_lifecycle",
    "lender_exposures",
    "beneficiary_exposures",
    "lender_exposure_source_metadata",
    "beneficiary_exposure_source_metadata",
    "party_master",
    "party_aliases",
    "party_identity_map",
    "party_role_classifications",
)

CANONICAL_OVERRIDES = {
    ("lender", "KB생명"): "KB라이프생명보험",
    ("lender", "KB증권(수탁)"): "KB증권",
    ("lender", "농협은행(수탁)"): "농협은행",
    ("lender", "산업은행"): "한국산업은행",
    ("lender", "우리은행(수탁)"): "우리은행",
    ("lender", "중소기업은행(수탁)"): "중소기업은행",
    ("lender", "한국증권금융(수탁)"): "한국증권금융",
    ("lender", "한국투자증권(수탁)"): "한국투자증권",
    ("lender", "흥국생명보험(수탁)"): "흥국생명보험",
    ("lender", "동양생명"): "동양생명보험",
    ("lender", "TBD"): "미확정 대주(TBD)",
}

NEW_PARTY_SPECS = {
    "CACIB": {
        "origin": "해외",
        "country": "FR",
        "roles": {"lender": ("은행", "직접대주", 0.90, "confirmed")},
    },
    "KB캐피탈": {
        "origin": "국내",
        "country": "KR",
        "roles": {"lender": ("캐피탈·여전", "직접대주", 0.95, "confirmed")},
    },
    "KDB생명보험": {
        "origin": "국내",
        "country": "KR",
        "roles": {
            "lender": ("보험", "직접대주", 0.95, "confirmed"),
            "beneficiary": ("금융기관", None, 0.95, "confirmed"),
        },
    },
    "미확정 대주(TBD)": {
        "origin": "확인 필요",
        "country": None,
        "roles": {"lender": ("미확인", "검토 필요", 0.00, "review")},
    },
    "동양생명보험": {
        "origin": "국내",
        "country": "KR",
        "roles": {"lender": ("보험", "직접대주", 0.95, "confirmed")},
    },
    "롯데카드": {
        "origin": "국내",
        "country": "KR",
        "roles": {"lender": ("캐피탈·여전", "직접대주", 0.95, "confirmed")},
    },
    "신한저축은행": {
        "origin": "국내",
        "country": "KR",
        "roles": {"lender": ("저축은행", "직접대주", 0.95, "confirmed")},
    },
    "에스프로젝트와이디": {
        "origin": "국내",
        "country": "KR",
        "roles": {"lender": ("유동화SPV", "직접대주", 0.75, "review")},
    },
    "에이알에이코리아부동산크레딧일반사모투자회사제1호": {
        "origin": "국내",
        "country": "KR",
        "roles": {"lender": ("펀드·투자기구", "직접대주", 0.90, "confirmed")},
    },
    "제이비우리캐피탈": {
        "roles": {"lender": ("캐피탈·여전", "직접대주", 0.95, "confirmed")},
    },
    "부산은행": {
        "roles": {"lender": ("은행", "직접대주", 0.95, "confirmed")},
    },
    "경남은행": {
        "roles": {"lender": ("은행", "직접대주", 0.95, "confirmed")},
    },
}


def normalize_name(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def md5_id(prefix, *parts):
    raw = "|".join(str(part or "") for part in parts)
    return prefix + hashlib.md5(raw.encode("utf-8")).hexdigest()[:24]


def party_id_for_name(name):
    return "pty_" + hashlib.md5(normalize_name(name).encode("utf-8")).hexdigest()[:24]


def clean_payload(row):
    return {key: value for key, value in row.items() if value is not None}


def ordered_distinct(values):
    result = []
    for value in values:
        text = base.clean_text(value)
        if text and text not in result:
            result.append(text)
    return result


def joined(values):
    items = ordered_distinct(values)
    return " / ".join(items) if items else None


def earliest(values):
    items = sorted(value for value in (base.clean_date(item) for item in values) if value)
    return items[0] if items else None


def latest(values):
    items = sorted(value for value in (base.clean_date(item) for item in values) if value)
    return items[-1] if items else None


def same_number_or_none(values):
    numbers = {base.clean_number(value) for value in values if base.clean_number(value) is not None}
    return next(iter(numbers)) if len(numbers) == 1 else None


def same_bool_or_none(values):
    items = {base.yn_bool(value) for value in values if base.yn_bool(value) is not None}
    return next(iter(items)) if len(items) == 1 else None


def sum_integer(rows, field):
    return sum(base.clean_number(row.get(field), integer=True) or 0 for row in rows)


def source_rows():
    missing = [str(path) for path in PATHS.values() if not path.exists()]
    if missing:
        raise RuntimeError("Missing source files: " + ", ".join(missing))
    return {
        "fund": base.read_sheet(PATHS["fund"], 1),
        "aum": base.read_aum_sheet(PATHS["aum"]),
        "asset": base.read_sheet(PATHS["asset"], 1),
        "lender": base.read_sheet(PATHS["lender"], 1),
        "beneficiary": base.read_sheet(PATHS["beneficiary"], 1),
    }


def validate_source_dates(sources):
    result = {}
    for role in ("lender", "beneficiary"):
        dates = Counter(
            base.clean_date(row.get("기준일자"))
            for row in sources[role]
            if base.clean_text(row.get("펀드코드"))
        )
        nonblank = {key for key in dates if key}
        if nonblank != {SNAPSHOT_DATE}:
            raise RuntimeError(f"Unexpected {role} source dates: {dict(dates)}")
        result[role] = dict(dates)
    valid_aum_rows = [row for row in sources["aum"] if base.valid_fund_id(row.get("fund_id"))]
    aum_base_dates = Counter(base.clean_date(row.get("base_date")) for row in valid_aum_rows)
    nonblank_aum = {key for key in aum_base_dates if key}
    if nonblank_aum != {SNAPSHOT_DATE}:
        raise RuntimeError(f"Unexpected AUM base dates: {dict(aum_base_dates)}")
    fallback_current = sum(
        1
        for row in valid_aum_rows
        if not base.clean_date(row.get("base_date"))
        and base.clean_date(row.get("input_date")) == SNAPSHOT_DATE
    )
    historical_without_base = sum(
        1
        for row in valid_aum_rows
        if not base.clean_date(row.get("base_date"))
        and base.clean_date(row.get("input_date"))
        and base.clean_date(row.get("input_date")) != SNAPSHOT_DATE
    )
    result["aum"] = {
        "base_date_counts": dict(aum_base_dates),
        "input_date_fallback_current": fallback_current,
        "historical_without_base_date": historical_without_base,
    }
    return result


def aum_effective_date(row):
    base_date = base.clean_date(row.get("base_date"))
    if base_date:
        return base_date, "base_date"
    input_date = base.clean_date(row.get("input_date"))
    if input_date:
        return input_date, "input_date_fallback"
    return None, "unresolved"


def build_identity_context(db):
    parties = {row["party_id"]: row for row in db["party_master"]}
    party_key_groups = defaultdict(set)
    alias_groups = defaultdict(set)
    identity_index = {}
    active_roles = {}
    for row in db["party_master"]:
        party_key_groups[normalize_name(row.get("party_key") or row.get("display_name"))].add(row["party_id"])
    for row in db["party_aliases"]:
        alias_groups[normalize_name(row.get("alias_key") or row.get("alias_name"))].add(row["party_id"])
    for row in db["party_identity_map"]:
        identity_index[(row.get("role_type"), normalize_name(row.get("source_name_key") or row.get("source_name")))] = row
    for row in db["party_role_classifications"]:
        if row.get("valid_to") is None:
            active_roles[(row.get("party_id"), row.get("role_type"))] = row
    return {
        "parties": parties,
        "party_key_groups": party_key_groups,
        "alias_groups": alias_groups,
        "identity_index": identity_index,
        "active_roles": active_roles,
    }


def one_party_id(groups, key):
    values = groups.get(key, set())
    return next(iter(values)) if len(values) == 1 else None


def resolve_party(role, raw_name, context):
    raw_key = normalize_name(raw_name)
    override = CANONICAL_OVERRIDES.get((role, raw_name))
    if override:
        canonical_key = normalize_name(override)
        party_id = one_party_id(context["party_key_groups"], canonical_key)
        if not party_id:
            party_id = one_party_id(context["alias_groups"], canonical_key)
        party_id = party_id or party_id_for_name(override)
        return party_id, override, "manual_alias", None

    identity = context["identity_index"].get((role, raw_key))
    if identity and identity.get("party_id") in context["parties"]:
        party = context["parties"][identity["party_id"]]
        return identity["party_id"], party["display_name"], "identity_map", identity

    party_id = one_party_id(context["alias_groups"], raw_key)
    if party_id:
        return party_id, context["parties"][party_id]["display_name"], "unique_alias", None

    party_id = one_party_id(context["party_key_groups"], raw_key)
    if party_id:
        return party_id, context["parties"][party_id]["display_name"], "party_key", None

    if raw_name.endswith("(수탁)"):
        base_name = raw_name[:-4].strip()
        base_key = normalize_name(base_name)
        party_id = one_party_id(context["party_key_groups"], base_key) or one_party_id(context["alias_groups"], base_key)
        if party_id:
            return party_id, context["parties"][party_id]["display_name"], "trustee_suffix", None

    canonical = raw_name
    return party_id_for_name(canonical), canonical, "new_identity", None


def prepare_identity_rows(sources, db):
    context = build_identity_context(db)
    resolved = {"lender": {}, "beneficiary": {}}
    methods = Counter()
    used_roles = set()
    missing_identity_rows = []
    alias_rows = []
    new_parties = {}

    for role, field in (("lender", "대주"), ("beneficiary", "수익자")):
        for row in sources[role]:
            raw_name = base.clean_text(row.get(field))
            if not raw_name or not base.valid_fund_id(row.get("펀드코드")):
                continue
            if raw_name in resolved[role]:
                continue
            party_id, canonical, method, identity = resolve_party(role, raw_name, context)
            resolved[role][raw_name] = {
                "party_id": party_id,
                "canonical": canonical,
                "method": method,
                "source_standard_id": identity.get("source_standard_id") if identity else None,
                "source_standard_name": identity.get("source_standard_name") if identity else None,
            }
            methods[(role, method)] += 1
            used_roles.add((party_id, role))

            if party_id not in context["parties"]:
                spec = NEW_PARTY_SPECS.get(canonical, {})
                origin = spec.get("origin", "확인 필요")
                new_parties[party_id] = {
                    "party_id": party_id,
                    "party_key": normalize_name(canonical),
                    "display_name": canonical,
                    "notes": "2026-07-31 source identity; role classification follows snapshot rules",
                    "party_origin": origin,
                    "domicile_country_code": spec.get("country"),
                    "origin_basis": "2026-07-31 source name and explicit snapshot mapping",
                    "origin_confidence": 0.9 if origin in {"국내", "해외"} else 0.3,
                    "origin_review_status": "confirmed" if origin in {"국내", "해외"} else "review",
                }

            raw_key = normalize_name(raw_name)
            if (role, raw_key) not in context["identity_index"]:
                confidence = 0.2 if canonical == "미확정 대주(TBD)" else (0.98 if method != "new_identity" else 0.85)
                review_status = "review" if canonical == "미확정 대주(TBD)" else "confirmed"
                missing_identity_rows.append(
                    {
                        "identity_id": md5_id("pidm_", role, raw_key),
                        "role_type": role,
                        "source_name": raw_name,
                        "source_name_key": raw_key,
                        "party_id": party_id,
                        "match_type": f"snapshot_20260731_{method}",
                        "preserve_attribute": "원천 명칭은 alias와 exposure raw 필드에 보존",
                        "confidence": confidence,
                        "review_status": review_status,
                        "source_file": PATHS[role].name,
                        "source_snapshot_date": SNAPSHOT_DATE,
                    }
                )

            alias_rows.append(
                {
                    "alias_id": md5_id("pal_", party_id, raw_key, "snapshot_20260731"),
                    "party_id": party_id,
                    "alias_name": raw_name,
                    "alias_key": raw_key,
                    "source_table": "snapshot_20260731",
                    "confidence": 1.0,
                }
            )

    role_rows = []
    for party_id, role in sorted(used_roles):
        if (party_id, role) in context["active_roles"]:
            continue
        canonical = new_parties.get(party_id, context["parties"].get(party_id, {})).get("display_name")
        spec = NEW_PARTY_SPECS.get(canonical, {})
        role_spec = spec.get("roles", {}).get(role)
        if role_spec:
            role_class, subtype, confidence, review_status = role_spec
        else:
            role_class = "기타" if role == "beneficiary" else "미확인"
            subtype, confidence, review_status = None, 0.0, "review"
        role_rows.append(
            clean_payload(
                {
                    "classification_id": md5_id("prc_", role, party_id, "snapshot_20260731"),
                    "party_id": party_id,
                    "role_type": role,
                    "classification_scheme": "snapshot_20260731",
                    "role_class": role_class,
                    "role_subtype": subtype,
                    "source_role_class": role_class,
                    "source_role_subtype": subtype,
                    "classification_basis": "2026-07-31 source identity and explicit role rule",
                    "confidence": confidence,
                    "review_status": review_status,
                    "valid_from": "1900-01-01",
                    "source_file": PATHS[role].name,
                }
            )
        )

    return {
        "resolved": resolved,
        "methods": {f"{role}:{method}": count for (role, method), count in sorted(methods.items())},
        "new_parties": list(new_parties.values()),
        "identity_rows": missing_identity_rows,
        "alias_rows": list({row["alias_id"]: row for row in alias_rows}.values()),
        "role_rows": role_rows,
    }


def historical_relation_indexes(db, role):
    table = f"{role}_exposures" if role == "lender" else "beneficiary_exposures"
    grouped = defaultdict(list)
    for row in db[table]:
        grouped[(str(row.get("fund_id") or ""), row.get("party_id"))].append(row)
    result = {}
    for key, rows in grouped.items():
        asset_ids = {row.get("asset_id") for row in rows if row.get("asset_id")}
        counterparty_ids = {row.get("counterparty_id") for row in rows if row.get("counterparty_id")}
        result[key] = {
            "asset_id": next(iter(asset_ids)) if len(asset_ids) == 1 else None,
            "counterparty_id": next(iter(counterparty_ids)) if len(counterparty_ids) == 1 else None,
        }
    return result


def prepare_lender_rows(source, identity, db):
    groups = defaultdict(list)
    source_numbers = defaultdict(list)
    for row_number, row in enumerate(source, start=2):
        fund_id = base.clean_text(row.get("펀드코드"))
        raw_name = base.clean_text(row.get("대주"))
        if not base.valid_fund_id(fund_id) or not raw_name:
            continue
        resolved = identity[raw_name]
        key = (fund_id, resolved["party_id"])
        groups[key].append(row)
        source_numbers[key].append(row_number)

    relations = historical_relation_indexes(db, "lender")
    records = []
    metadata = {}
    for key, rows in sorted(groups.items()):
        fund_id, party_id = key
        canonical = identity[base.clean_text(rows[0].get("대주"))]["canonical"]
        raw_names = ordered_distinct(row.get("대주") for row in rows)
        relation = relations.get(key, {})
        record = clean_payload(
            {
                "fund_id": fund_id,
                "lender_raw": " / ".join(raw_names),
                "lender_clean": canonical,
                "committed_amt": sum_integer(rows, "대출약정금액(원)"),
                "drawn_amt": sum_integer(rows, "대출인출금액(원)"),
                "remaining_amt": sum_integer(rows, "대출잔여금액(원)"),
                "drawdown_date": earliest(row.get("대출인출일") for row in rows),
                "loan_maturity_date": latest(row.get("대출만기일") for row in rows),
                "start_date": earliest(row.get("대출인출일") for row in rows),
                "end_date": latest(row.get("대출만기일") for row in rows),
                "trench": joined(row.get("트렌치") for row in rows),
                "interest_type": joined(row.get("이자유형") for row in rows),
                "base_rate": same_number_or_none(row.get("기준금리") for row in rows),
                "spread_rate": same_number_or_none(row.get("가산금리") for row in rows),
                "interest_rate": same_number_or_none(row.get("대출금리") for row in rows),
                "all_in_rate": same_number_or_none(row.get("All-in금리") for row in rows),
                "remarks": joined(row.get("비고") for row in rows),
                "base_date": SNAPSHOT_DATE,
                "counterparty_id": relation.get("counterparty_id"),
                "asset_id": relation.get("asset_id"),
                "party_id": party_id,
            }
        )
        records.append(record)
        resolved_items = [identity[raw_name] for raw_name in raw_names]
        is_trustee = any("(수탁)" in raw_name for raw_name in raw_names) or any("신탁업자" in str(row.get("비고") or "") for row in rows)
        metadata[key] = clean_payload(
            {
                "source_lender_role": "신탁업자/명의대주" if is_trustee else "직접대주",
                "source_account_notation": joined(raw_name for raw_name in raw_names if raw_name != canonical),
                "source_loan_type": joined(row.get("대출유형") for row in rows),
                "shareholder_loan_flag": same_bool_or_none(row.get("주주대여금여부") for row in rows),
                "securitization_flag": same_bool_or_none(row.get("유동화증권여부") for row in rows),
                "source_standard_id": joined(item.get("source_standard_id") for item in resolved_items),
                "source_standard_name": joined(item.get("source_standard_name") for item in resolved_items),
                "source_rows": source_numbers[key],
                "source_file": PATHS["lender"].name,
                "source_snapshot_date": SNAPSHOT_DATE,
            }
        )
    return records, metadata


def prepare_beneficiary_rows(source, identity, db):
    groups = defaultdict(list)
    source_numbers = defaultdict(list)
    adjustments = []
    normalized_rows = []
    for row_number, original in enumerate(source, start=2):
        row = dict(original)
        fund_id = base.clean_text(row.get("펀드코드"))
        raw_name = base.clean_text(row.get("수익자"))
        if not base.valid_fund_id(fund_id) or not raw_name:
            continue
        committed = base.clean_number(row.get("총약정금액"), integer=True) or 0
        invested = base.clean_number(row.get("투입금액"), integer=True) or 0
        remaining = base.clean_number(row.get("잔여약정금액"), integer=True) or 0
        difference = committed - invested - remaining
        if difference and abs(difference) <= 10:
            row["잔여약정금액"] = remaining + difference
            note = f"원천 반올림 보정: 잔여약정금액 {difference:+d}원"
            row["비고"] = joined([row.get("비고"), note])
            adjustments.append({"row": row_number, "fund_id": fund_id, "beneficiary": raw_name, "adjustment_won": difference})
        resolved = identity[raw_name]
        key = (fund_id, resolved["party_id"])
        groups[key].append(row)
        source_numbers[key].append(row_number)
        normalized_rows.append(row)

    relations = historical_relation_indexes(db, "beneficiary")
    records = []
    metadata = {}
    for key, rows in sorted(groups.items()):
        fund_id, party_id = key
        canonical = identity[base.clean_text(rows[0].get("수익자"))]["canonical"]
        raw_names = ordered_distinct(row.get("수익자") for row in rows)
        relation = relations.get(key, {})
        record = clean_payload(
            {
                "fund_id": fund_id,
                "beneficiary_raw": " / ".join(raw_names),
                "beneficiary_clean": canonical,
                "committed_amt": sum_integer(rows, "총약정금액"),
                "invested_amt": sum_integer(rows, "투입금액"),
                "remaining_amt": sum_integer(rows, "잔여약정금액"),
                "share_ratio": sum(base.clean_number(row.get("비율(%)")) or 0 for row in rows),
                "setup_units": sum_integer(rows, "설정해지좌수"),
                "setup_amt": sum_integer(rows, "설정해지금액"),
                "remarks": joined(row.get("비고") for row in rows),
                "base_date": SNAPSHOT_DATE,
                "invested_date": earliest(row.get("약정콜일자") for row in rows),
                "counterparty_id": relation.get("counterparty_id"),
                "asset_id": relation.get("asset_id"),
                "party_id": party_id,
            }
        )
        records.append(record)
        resolved_items = [identity[raw_name] for raw_name in raw_names]
        metadata[key] = clean_payload(
            {
                "source_beneficiary_type": joined(row.get("수익자구분") for row in rows),
                "source_beneficiary_category": joined(row.get("수익자분류") for row in rows),
                "source_standard_id": joined(item.get("source_standard_id") for item in resolved_items),
                "source_standard_name": joined(item.get("source_standard_name") for item in resolved_items),
                "initial_commitment_date": earliest(row.get("최초약정일") for row in rows),
                "capital_call_date": earliest(row.get("약정콜일자") for row in rows),
                "source_rows": source_numbers[key],
                "source_file": PATHS["beneficiary"].name,
                "source_snapshot_date": SNAPSHOT_DATE,
            }
        )
    return records, metadata, adjustments, normalized_rows


def prepare_funds(sources):
    aum_by_fund = {}
    for row in sources["aum"]:
        fund_id = base.clean_text(row.get("fund_id"))
        effective_date, date_basis = aum_effective_date(row)
        if base.valid_fund_id(fund_id) and effective_date == SNAPSHOT_DATE:
            if fund_id in aum_by_fund:
                raise RuntimeError(f"Duplicate AUM fund_id: {fund_id}")
            aum_by_fund[fund_id] = {**row, "_date_basis": date_basis}

    funds = []
    snapshots = []
    lifecycle = []
    seen = set()
    for row in sources["fund"]:
        fund_id = base.clean_text(row.get("펀드코드"))
        fund_name = base.clean_text(row.get("펀드명"))
        if not base.valid_fund_id(fund_id) or not fund_name:
            continue
        if fund_id in seen:
            raise RuntimeError(f"Duplicate fund_id in fund source: {fund_id}")
        seen.add(fund_id)
        fund = clean_payload(
            {
                "fund_id": fund_id,
                "short_name": base.clean_text(row.get("약칭")),
                "fund_name": fund_name,
                "sector": base.clean_text(row.get("투자섹터")),
                "asset_name": base.clean_text(row.get("자산명")),
                "status": base.clean_text(row.get("운용상태")),
                "location": base.clean_text(row.get("국내/해외")),
                "setup_date": base.clean_date(row.get("최초 설정일")),
                "maturity_date": base.clean_date(row.get("만기일")),
                "termination_date": base.clean_date(row.get("해지일")),
                "dept": base.clean_text(row.get("부서(운용)")),
                "manager": base.clean_text(row.get("담당자(운용)")),
                "project_mission_name": base.clean_text(row.get("자산명")),
                "notion_holding_type_class": base.clean_text(row.get("모자구분")),
                "notion_investment_strategy_class": base.clean_text(row.get("투자전략")),
                "notion_vehicle_class": base.clean_text(row.get("Vehicle구분")),
                "recruitment_type": base.clean_text(row.get("모집형태")),
                "legal_form": base.clean_text(row.get("법적형태")),
                "fund_class": base.clean_text(row.get("펀드종류")),
                "fund_type": base.clean_text(row.get("펀드유형")),
                "division": base.clean_text(row.get("담당부문(운용)")),
                "primary_region": base.clean_text(row.get("주요투자지역")),
                "is_development": base.clean_text(row.get("개발여부")),
                "is_delegated": base.clean_text(row.get("위탁운용여부")),
            }
        )
        aum = aum_by_fund.get(fund_id)
        if aum:
            fund.update(
                clean_payload(
                    {
                        "aum_base_date": SNAPSHOT_DATE,
                        "base_price": base.clean_number(aum.get("base_price")),
                        "net_asset_value": base.clean_number(aum.get("net_asset_value"), integer=True),
                        "aum_input_date": base.clean_date(aum.get("input_date")),
                        "equity_won": base.clean_number(aum.get("equity"), integer=True),
                        "loan_won": base.clean_number(aum.get("loan"), integer=True),
                        "deposit_won": base.clean_number(aum.get("deposit"), integer=True),
                        "benchmark_aum": base.clean_number(aum.get("aum"), integer=True),
                        "invested_equity_won": base.clean_number(aum.get("invested_equity"), integer=True),
                        "invested_loan_won": base.clean_number(aum.get("invested_loan"), integer=True),
                        "invested_deposit_won": base.clean_number(aum.get("invested_deposit"), integer=True),
                        "invested_aum": base.clean_number(aum.get("invested_aum"), integer=True),
                        "aum_status": base.clean_text(aum.get("status")),
                        "aum_source": PATHS["aum"].name,
                    }
                )
            )
            snapshots.append(
                {
                    "snapshot_id": base.make_id("aum_current", fund_id, SNAPSHOT_DATE),
                    "fund_id": fund_id,
                    "snapshot_date": SNAPSHOT_DATE,
                    "snapshot_year": 2026,
                    "region": None,
                    "sector": fund.get("sector"),
                    "aum": base.clean_number(aum.get("aum"), integer=True),
                    "loan": base.clean_number(aum.get("loan"), integer=True),
                    "equity": base.clean_number(aum.get("equity"), integer=True),
                    "deposit": base.clean_number(aum.get("deposit"), integer=True),
                    "is_liquidated": fund.get("status") == "청산",
                    "source_system": "current_aum_snapshot",
                    "metadata": {
                        "source_file": PATHS["aum"].name,
                        "source_date": SOURCE_DATE,
                        "base_date": SNAPSHOT_DATE,
                        "date_basis": aum.get("_date_basis"),
                        "input_date": base.clean_date(aum.get("input_date")),
                        "fund_name": fund_name,
                        "short_name": fund.get("short_name"),
                        "asset_name": fund.get("asset_name"),
                        "status": fund.get("status"),
                    },
                }
            )
        funds.append(fund)
        lifecycle.append(
            clean_payload(
                {
                    "fund_id": fund_id,
                    "op_status": fund.get("status"),
                    "setup_date": fund.get("setup_date"),
                    "maturity_date": fund.get("maturity_date"),
                    "liquidation_date": fund.get("termination_date"),
                    "fund_name": fund_name,
                    "short_name": fund.get("short_name"),
                    "sector": fund.get("sector"),
                    "asset_name": fund.get("asset_name"),
                    "is_aum_target": base.yn_bool(row.get("AUM합산대상여부")),
                    "aum_base": base.clean_number(aum.get("aum"), integer=True) if aum else None,
                    "aum_base_date": SNAPSHOT_DATE if aum else None,
                    "source_system": "current_aum_snapshot" if aum else "fund_master_20260821",
                    "metadata": {"source_file": PATHS["fund"].name, "source_date": SOURCE_DATE},
                }
            )
        )
    return funds, snapshots, lifecycle, aum_by_fund


def prepare_assets(source, existing):
    records, resolution, conflicts = base.build_asset_master_records(source, existing, PATHS["asset"])
    return [clean_payload(record) for record in records], resolution, conflicts


def sum_fields(rows, fields):
    return {field: sum(int(row.get(field) or 0) for row in rows) for field in fields}


def attach_existing_ids(records, existing, role):
    table_prefix = "lender" if role == "lender" else "beneficiary"
    index = defaultdict(list)
    for row in existing:
        if row.get("base_date") == SNAPSHOT_DATE:
            index[(str(row.get("fund_id") or ""), row.get("party_id"))].append(row)
    expected_keys = {(row["fund_id"], row["party_id"]) for row in records}
    unexpected = sorted(str(key) for key in set(index) - expected_keys)
    collisions = {str(key): len(rows) for key, rows in index.items() if len(rows) > 1}
    if unexpected or collisions:
        raise RuntimeError(f"Unexpected existing {role} July rows: unexpected={unexpected[:10]}, collisions={collisions}")
    for record in records:
        rows = index.get((record["fund_id"], record["party_id"]), [])
        if rows:
            record["id"] = rows[0]["id"]


def backup_database(db, output_dir):
    backup_dir = output_dir / "before"
    backup_dir.mkdir(parents=True, exist_ok=True)
    for table in BACKUP_TABLES:
        (backup_dir / f"{table}.json").write_text(
            json.dumps(db[table], ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
    return backup_dir


def management_sql(sql):
    env_path = ROOT_DIR / ".env"
    values = {}
    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    token = values.get("token") or values.get("SUPABASE_ACCESS_TOKEN") or values.get("SUPABASE_TOKEN")
    if not token:
        raise RuntimeError("Supabase management token is required to update the current-snapshot view")
    supabase_url = values.get("SUPABASE_URL", "")
    match = re.search(r"https://([a-z0-9]+)\.supabase\.co", supabase_url)
    if not match:
        raise RuntimeError("Unable to derive Supabase project reference")
    endpoint = f"https://api.supabase.com/v1/projects/{match.group(1)}/database/query"
    request = Request(
        endpoint,
        data=json.dumps({"query": sql}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Codex-RA-Dashboard/1.0",
        },
    )
    try:
        with urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase SQL API failed ({error.code}): {detail}") from error


def write_exposures(client, table, records):
    updates = [row for row in records if row.get("id") is not None]
    inserts = [{key: value for key, value in row.items() if key != "id"} for row in records if row.get("id") is None]
    client.write_grouped(table, updates, on_conflict="id")
    client.write_grouped(table, inserts)
    return {"updated": len(updates), "inserted": len(inserts)}


def build_metadata_rows(client, role, records, metadata_by_key):
    table = "lender_exposures" if role == "lender" else "beneficiary_exposures"
    current = client.fetch_all(table)
    index = defaultdict(list)
    for row in current:
        if row.get("base_date") == SNAPSHOT_DATE:
            index[(str(row.get("fund_id") or ""), row.get("party_id"))].append(row)
    output = []
    for record in records:
        key = (record["fund_id"], record["party_id"])
        matches = index.get(key, [])
        if len(matches) != 1:
            raise RuntimeError(f"Expected one stored {role} row for {key}, got {len(matches)}")
        output.append({"exposure_id": matches[0]["id"], **metadata_by_key[key]})
    return output


def current_view_sql():
    path = Path(__file__).resolve().parent / "migrations" / "2026-09-01_party_current_global_snapshot.sql"
    return path.read_text(encoding="utf-8-sig")


def verify(client, prepared):
    stored_lenders = [row for row in client.fetch_all("lender_exposures") if row.get("base_date") == SNAPSHOT_DATE]
    stored_beneficiaries = [row for row in client.fetch_all("beneficiary_exposures") if row.get("base_date") == SNAPSHOT_DATE]
    stored_snapshots = [row for row in client.fetch_all("aum_snapshots") if row.get("snapshot_date") == SNAPSHOT_DATE]
    current = client.fetch_all("party_exposure_current")
    current_lenders = [row for row in current if row.get("role_type") == "lender"]
    current_beneficiaries = [row for row in current if row.get("role_type") == "beneficiary"]
    funds = client.fetch_all("funds")
    dated_funds = [row for row in funds if row.get("aum_base_date") == SNAPSHOT_DATE]

    expected_lender = sum_fields(prepared["lenders"], ("committed_amt", "drawn_amt", "remaining_amt"))
    expected_beneficiary = sum_fields(prepared["beneficiaries"], ("committed_amt", "invested_amt", "remaining_amt"))
    expected_aum = sum_fields(prepared["snapshots"], ("aum", "loan", "equity", "deposit"))
    checks = {
        "lender_row_count": len(stored_lenders) == len(prepared["lenders"]),
        "beneficiary_row_count": len(stored_beneficiaries) == len(prepared["beneficiaries"]),
        "aum_snapshot_count": len(stored_snapshots) == len(prepared["snapshots"]),
        "fund_aum_count": len(dated_funds) == len(prepared["snapshots"]),
        "lender_stored_sums": sum_fields(stored_lenders, expected_lender) == expected_lender,
        "beneficiary_stored_sums": sum_fields(stored_beneficiaries, expected_beneficiary) == expected_beneficiary,
        "aum_stored_sums": sum_fields(stored_snapshots, expected_aum) == expected_aum,
        "lender_parts_equal_total": expected_lender["committed_amt"] == expected_lender["drawn_amt"] + expected_lender["remaining_amt"],
        "beneficiary_parts_equal_total": expected_beneficiary["committed_amt"] == expected_beneficiary["invested_amt"] + expected_beneficiary["remaining_amt"],
        "aum_parts_equal_total": expected_aum["aum"] == expected_aum["loan"] + expected_aum["equity"] + expected_aum["deposit"],
        "current_lender_is_global_july": len(current_lenders) == len(prepared["lenders"]) and {row.get("base_date") for row in current_lenders} == {SNAPSHOT_DATE},
        "current_beneficiary_is_global_july": len(current_beneficiaries) == len(prepared["beneficiaries"]) and {row.get("base_date") for row in current_beneficiaries} == {SNAPSHOT_DATE},
        "current_lender_sums": sum_fields(current_lenders, expected_lender) == expected_lender,
        "current_beneficiary_sums": sum_fields(current_beneficiaries, expected_beneficiary) == expected_beneficiary,
        "all_current_rows_classified": all(row.get("party_id") and row.get("role_class") for row in current),
    }
    return {
        "ok": all(checks.values()),
        "checks": checks,
        "counts": {
            "funds": len(funds),
            "funds_at_2026_07_31": len(dated_funds),
            "lender_rows": len(stored_lenders),
            "beneficiary_rows": len(stored_beneficiaries),
            "aum_snapshots": len(stored_snapshots),
        },
        "sums": {
            "lender": expected_lender,
            "beneficiary": expected_beneficiary,
            "aum": expected_aum,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Prepare or apply the 2026-07-31 RA dashboard snapshot.")
    parser.add_argument("--apply", action="store_true", help="Write the prepared snapshot to Supabase.")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    sources = source_rows()
    source_dates = validate_source_dates(sources)
    url, api_key = base.read_env()
    client = base.PostgrestClient(url, api_key)
    print("Fetching live database state...")
    db = {table: client.fetch_all(table) for table in BACKUP_TABLES}

    identities = prepare_identity_rows(sources, db)
    funds, snapshots, lifecycle, aum_by_fund = prepare_funds(sources)
    assets, asset_resolution, asset_conflicts = prepare_assets(sources["asset"], db["asset_master"])
    lenders, lender_metadata = prepare_lender_rows(sources["lender"], identities["resolved"]["lender"], db)
    beneficiaries, beneficiary_metadata, adjustments, normalized_beneficiary_source = prepare_beneficiary_rows(
        sources["beneficiary"], identities["resolved"]["beneficiary"], db
    )
    attach_existing_ids(lenders, db["lender_exposures"], "lender")
    attach_existing_ids(beneficiaries, db["beneficiary_exposures"], "beneficiary")

    prepared = {
        "funds": funds,
        "snapshots": snapshots,
        "lifecycle": lifecycle,
        "assets": assets,
        "lenders": lenders,
        "beneficiaries": beneficiaries,
    }
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = OUTPUT_DIR / f"snapshot_20260731_{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=True)
    valid_lender_source = [
        row
        for row in sources["lender"]
        if base.valid_fund_id(row.get("펀드코드")) and base.clean_text(row.get("대주"))
    ]
    source_lender_sums = {
        "committed_amt": sum_integer(valid_lender_source, "대출약정금액(원)"),
        "drawn_amt": sum_integer(valid_lender_source, "대출인출금액(원)"),
        "remaining_amt": sum_integer(valid_lender_source, "대출잔여금액(원)"),
    }
    source_beneficiary_sums = {
        "committed_amt": sum_integer(normalized_beneficiary_source, "총약정금액"),
        "invested_amt": sum_integer(normalized_beneficiary_source, "투입금액"),
        "remaining_amt": sum_integer(normalized_beneficiary_source, "잔여약정금액"),
    }
    plan = {
        "mode": "apply" if args.apply else "dry-run",
        "snapshot_date": SNAPSHOT_DATE,
        "source_dates": source_dates,
        "source_files": {key: str(value) for key, value in PATHS.items()},
        "counts": {
            "funds": len(funds),
            "dated_aum_funds": len(aum_by_fund),
            "assets": len(assets),
            "lender_source_rows": sum(1 for row in sources["lender"] if row.get("대주")),
            "lender_collapsed_rows": len(lenders),
            "beneficiary_source_rows": sum(1 for row in sources["beneficiary"] if row.get("수익자")),
            "beneficiary_collapsed_rows": len(beneficiaries),
            "new_parties": len(identities["new_parties"]),
            "new_identity_mappings": len(identities["identity_rows"]),
            "new_or_fallback_role_classifications": len(identities["role_rows"]),
            "asset_conflicts": len(asset_conflicts),
        },
        "identity_methods": identities["methods"],
        "new_party_names": [row["display_name"] for row in identities["new_parties"]],
        "new_or_fallback_role_classifications": [
            {
                "party": next(
                    (
                        row["display_name"]
                        for row in identities["new_parties"]
                        if row["party_id"] == role_row["party_id"]
                    ),
                    db["party_master"] and next(
                        (
                            row["display_name"]
                            for row in db["party_master"]
                            if row["party_id"] == role_row["party_id"]
                        ),
                        role_row["party_id"],
                    ),
                ),
                "role_type": role_row["role_type"],
                "role_class": role_row["role_class"],
                "review_status": role_row["review_status"],
            }
            for role_row in identities["role_rows"]
        ],
        "asset_conflicts": asset_conflicts,
        "beneficiary_rounding_adjustments": adjustments,
        "source_sums": {"lender": source_lender_sums, "beneficiary_adjusted": source_beneficiary_sums},
        "prepared_sums": {
            "lender": sum_fields(lenders, source_lender_sums),
            "beneficiary": sum_fields(beneficiaries, source_beneficiary_sums),
            "aum": sum_fields(snapshots, ("aum", "loan", "equity", "deposit")),
        },
        "relations": "Existing asset_fund_links and fund_assets preserved because the 20260821 export has no fund-asset relation workbook.",
    }
    (output_dir / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps(plan, ensure_ascii=False, indent=2, default=str))
    print(f"Plan: {output_dir / 'plan.json'}")
    if not args.apply:
        print("Dry-run complete. Re-run with --apply after reviewing the plan.")
        return

    backup_dir = backup_database(db, output_dir)
    print(f"Backup: {backup_dir}")
    client.write_grouped("party_master", identities["new_parties"], on_conflict="party_id")
    client.write_grouped("party_role_classifications", identities["role_rows"], on_conflict="classification_id")
    client.write_grouped("party_identity_map", identities["identity_rows"], on_conflict="role_type,source_name_key")
    client.write_grouped("party_aliases", identities["alias_rows"], on_conflict="party_id,alias_key,source_table")
    client.write_grouped("funds", funds, on_conflict="fund_id")
    client.write_grouped("fund_lifecycle", lifecycle, on_conflict="fund_id")
    client.write_grouped("asset_master", assets, on_conflict="asset_id")
    client.write_grouped("aum_snapshots", snapshots, on_conflict="snapshot_id")
    exposure_write = {
        "lender": write_exposures(client, "lender_exposures", lenders),
        "beneficiary": write_exposures(client, "beneficiary_exposures", beneficiaries),
    }
    lender_metadata_rows = build_metadata_rows(client, "lender", lenders, lender_metadata)
    beneficiary_metadata_rows = build_metadata_rows(client, "beneficiary", beneficiaries, beneficiary_metadata)
    client.write_grouped("lender_exposure_source_metadata", lender_metadata_rows, on_conflict="exposure_id")
    client.write_grouped("beneficiary_exposure_source_metadata", beneficiary_metadata_rows, on_conflict="exposure_id")
    management_sql(current_view_sql())
    client.request("POST", "rpc/refresh_party_exposure_surfaces", payload={})
    verification = verify(client, prepared)
    verification["exposure_write"] = exposure_write
    (output_dir / "verification.json").write_text(
        json.dumps(verification, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    print(json.dumps(verification, ensure_ascii=False, indent=2, default=str))
    print(f"Verification: {output_dir / 'verification.json'}")
    if not verification["ok"]:
        raise RuntimeError("Post-update verification failed; inspect the backup and verification report.")


if __name__ == "__main__":
    main()
