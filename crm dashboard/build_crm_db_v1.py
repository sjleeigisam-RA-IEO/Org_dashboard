from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
T5T_DASHBOARD_PATH = ROOT_DIR / "t5t-dashboard" / "data" / "dashboard.json"
GROUP_RULES_VERSION = "v0100"
GROUP_RULES_PATH = BASE_DIR / f"crm_group_alias_rules_{GROUP_RULES_VERSION}.csv"
COUNTERPARTY_SEED_VERSION = "v0110"
COUNTERPARTY_SEED_PATH = BASE_DIR / f"counterparty_seed_{COUNTERPARTY_SEED_VERSION}.csv"


TYPE_TAXONOMY: list[dict[str, str]] = [
    {
        "stakeholder_group_code": "capital_partner",
        "stakeholder_group_name": "자본 파트너",
        "stakeholder_type_code": "fund_beneficiary",
        "stakeholder_type_name": "펀드 수익자",
        "stakeholder_subtype_code": "beneficiary_unknown",
        "stakeholder_subtype_name": "수익자 일반",
        "t5t_type_name": "기관투자자(LP)",
        "description": "펀드 수익자 스냅샷 기반의 자본 제공자 역할",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "capital_partner",
        "stakeholder_group_name": "자본 파트너",
        "stakeholder_type_code": "institutional_lp",
        "stakeholder_type_name": "기관투자자(LP)",
        "stakeholder_subtype_code": "lp_unknown",
        "stakeholder_subtype_name": "LP 일반",
        "t5t_type_name": "기관투자자(LP)",
        "description": "T5T 로그에서 식별된 LP 또는 출자자 역할",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "financing_partner",
        "stakeholder_group_name": "금융 파트너",
        "stakeholder_type_code": "lender",
        "stakeholder_type_name": "금융기관(대주)",
        "stakeholder_subtype_code": "lender_unknown",
        "stakeholder_subtype_name": "대주 일반",
        "t5t_type_name": "금융기관(대주)",
        "description": "대주 스냅샷 또는 T5T 로그에서 식별된 금융 제공자 역할",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "occupier_customer",
        "stakeholder_group_name": "임차/사용자",
        "stakeholder_type_code": "tenant",
        "stakeholder_type_name": "임차인",
        "stakeholder_subtype_code": "tenant_unknown",
        "stakeholder_subtype_name": "임차인 일반",
        "t5t_type_name": "임차인",
        "description": "오피스, 리테일, 호텔, 물류 등 점유자 또는 잠재 임차인",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "transaction_counterparty",
        "stakeholder_group_name": "거래 상대방",
        "stakeholder_type_code": "buyer_seller",
        "stakeholder_type_name": "매수/매도인",
        "stakeholder_subtype_code": "counterparty_unknown",
        "stakeholder_subtype_name": "거래 상대방 일반",
        "t5t_type_name": "매수/매도인",
        "description": "매수인, 매도인, 시행사, 선매수자 등 거래 상대방",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "advisor_intermediary",
        "stakeholder_group_name": "자문/중개",
        "stakeholder_type_code": "advisor",
        "stakeholder_type_name": "주간사/자문",
        "stakeholder_subtype_code": "advisor_unknown",
        "stakeholder_subtype_name": "자문 일반",
        "t5t_type_name": "주간사/자문",
        "description": "브로커, 법무자문, 회계자문, PM, 컨설팅 등",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "public_authority",
        "stakeholder_group_name": "공공/행정",
        "stakeholder_type_code": "public_body",
        "stakeholder_type_name": "공공/행정기관",
        "stakeholder_subtype_code": "public_unknown",
        "stakeholder_subtype_name": "공공기관 일반",
        "t5t_type_name": "공공/행정기관",
        "description": "서울시, 지자체, 공기업, 인허가 협의기관 등",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "strategic_partner",
        "stakeholder_group_name": "전략/해외 파트너",
        "stakeholder_type_code": "overseas_partner",
        "stakeholder_type_name": "해외 파트너",
        "stakeholder_subtype_code": "overseas_partner_unknown",
        "stakeholder_subtype_name": "해외 파트너 일반",
        "t5t_type_name": "해외 파트너",
        "description": "JV 파트너, 로컬 운영 파트너, 해외 기관 등",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "project_partner",
        "stakeholder_group_name": "프로젝트 파트너",
        "stakeholder_type_code": "operator_contractor",
        "stakeholder_type_name": "운영/시공 파트너",
        "stakeholder_subtype_code": "project_partner_unknown",
        "stakeholder_subtype_name": "프로젝트 파트너 일반",
        "t5t_type_name": "",
        "description": "운영사, 시공사, CM, AMC 외부 파트너 등 향후 확장용",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "community_group",
        "stakeholder_group_name": "지역/커뮤니티",
        "stakeholder_type_code": "community",
        "stakeholder_type_name": "주민/이해집단",
        "stakeholder_subtype_code": "community_unknown",
        "stakeholder_subtype_name": "커뮤니티 일반",
        "t5t_type_name": "",
        "description": "주민단, 상인회 등 비정형 이해집단",
        "is_active": "Y",
    },
    {
        "stakeholder_group_code": "other",
        "stakeholder_group_name": "기타",
        "stakeholder_type_code": "other",
        "stakeholder_type_name": "기타",
        "stakeholder_subtype_code": "other_unknown",
        "stakeholder_subtype_name": "기타",
        "t5t_type_name": "",
        "description": "분류 미정 또는 보류",
        "is_active": "Y",
    },
]


BENEFICIARY_SUBTYPE_MAP = {
    "보험사": ("insurance_company", "보험사"),
    "증권사": ("securities_company", "증권사"),
    "은행": ("bank", "은행"),
    "공제회": ("mutual_aid_association", "공제회"),
    "연기금": ("pension_fund", "연기금"),
    "자산운용사": ("asset_manager", "자산운용사"),
    "상장공모리츠": ("reits", "리츠"),
    "SPC": ("spc", "SPC"),
    "정부기관": ("government_body", "정부기관"),
    "일반기업": ("corporate", "일반기업"),
    "개인": ("individual", "개인"),
    "비공개": ("undisclosed", "비공개"),
}


LENDER_SUBTYPE_MAP = {
    "은행": ("bank", "은행"),
    "보험사": ("insurance_company", "보험사"),
    "증권사": ("securities_company", "증권사"),
    "여전사": ("specialized_credit_finance", "여전사"),
    "저축은행": ("savings_bank", "저축은행"),
    "상호금융": ("mutual_finance", "상호금융"),
    "유동화증권": ("securitized_vehicle", "유동화증권"),
    "공제회": ("mutual_aid_association", "공제회"),
    "연기금": ("pension_fund", "연기금"),
}


T5T_TYPE_MAP = {
    "기관투자자(LP)": ("capital_partner", "institutional_lp", "lp_unknown", "LP 일반"),
    "금융기관(대주)": ("financing_partner", "lender", "lender_unknown", "대주 일반"),
    "임차인": ("occupier_customer", "tenant", "tenant_unknown", "임차인 일반"),
    "매수/매도인": ("transaction_counterparty", "buyer_seller", "counterparty_unknown", "거래 상대방 일반"),
    "주간사/자문": ("advisor_intermediary", "advisor", "advisor_unknown", "자문 일반"),
    "공공/행정기관": ("public_authority", "public_body", "public_unknown", "공공기관 일반"),
    "해외 파트너": ("strategic_partner", "overseas_partner", "overseas_partner_unknown", "해외 파트너 일반"),
}


COUNTERPARTY_CATEGORY_MAP = {
    "Operator": ("project_partner", "운영/시공 파트너", "operator_contractor", "운영/시공 파트너", "operator", "운영사"),
    "시공사": ("project_partner", "운영/시공 파트너", "operator_contractor", "운영/시공 파트너", "contractor", "시공사"),
    "설계사": ("project_partner", "운영/시공 파트너", "operator_contractor", "운영/시공 파트너", "designer", "설계사"),
    "CM": ("project_partner", "운영/시공 파트너", "operator_contractor", "운영/시공 파트너", "cm", "CM"),
    "SI": ("strategic_partner", "전략/해외 파트너", "other", "기타", "si", "SI"),
    "FI": ("capital_partner", "자본 파트너", "institutional_lp", "기관투자자(LP)", "fi", "FI"),
}


GENERIC_NAME_KIND = {
    "매도인": "role_placeholder",
    "매수인": "role_placeholder",
    "선매수자": "role_placeholder",
    "잠재 SI": "role_placeholder",
    "잠재 임차인": "role_placeholder",
    "시행사": "organization",
    "주민단": "group",
    "공제회": "organization",
    "신한": "organization",
    "KB": "organization",
    "하나": "organization",
}


@dataclass
class Entity:
    entity_id: str
    canonical_name: str
    display_name: str
    entity_kind: str
    primary_stakeholder_group_code: str
    primary_stakeholder_type_code: str
    primary_stakeholder_type_name: str
    source_systems: str
    latest_base_date: str
    is_active: str = "Y"
    notes: str = ""


def load_excel_sources() -> dict[str, pd.DataFrame]:
    sources: dict[str, pd.DataFrame] = {}
    for path in sorted(BASE_DIR.glob("*.xlsx")):
        df = pd.read_excel(path)
        cols = set(df.columns)
        if "수익자" in cols:
            sources["beneficiary"] = df
        elif "대주" in cols:
            sources["lender"] = df
        elif "구분" in cols and "분류" in cols:
            sources["beneficiary_code"] = df
        elif "분류" in cols:
            sources["lender_code"] = df
    return sources


def normalize_name(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    return text


def safe_date(value: Any) -> str:
    if value is None or value == "":
        return ""
    dt = pd.to_datetime(value, errors="coerce")
    if pd.isna(dt):
        return ""
    return dt.strftime("%Y-%m-%d")


def most_common(values: list[str]) -> str:
    cleaned = [value for value in values if value]
    if not cleaned:
        return ""
    return Counter(cleaned).most_common(1)[0][0]


def choose_entity_kind(name: str, subtype_name: str = "") -> str:
    if name in GENERIC_NAME_KIND:
        return GENERIC_NAME_KIND[name]
    if subtype_name == "개인" or name.startswith("개인("):
        return "person"
    if any(token in name for token in ["주민", "단체", "협의체"]):
        return "group"
    return "organization"


def add_role(role_rows: list[dict[str, Any]], row: dict[str, Any]) -> None:
    row["canonical_name"] = normalize_name(row["canonical_name"])
    if not row["canonical_name"]:
        return
    role_rows.append(row)


def build_beneficiary_roles(
    beneficiary_df: pd.DataFrame,
    beneficiary_code_df: pd.DataFrame,
) -> list[dict[str, Any]]:
    code_map = (
        beneficiary_code_df.assign(공통코드명=beneficiary_code_df["공통코드명"].map(normalize_name))
        .drop_duplicates(subset=["공통코드명"], keep="first")
        .set_index("공통코드명")
    )
    role_rows: list[dict[str, Any]] = []
    grouped = beneficiary_df.copy()
    grouped["수익자"] = grouped["수익자"].map(normalize_name)
    grouped["자산"] = grouped["자산"].map(normalize_name)

    for name, group in grouped.groupby("수익자"):
        if not name:
            continue
        raw_type = most_common(group["수익자구분"].fillna("").astype(str).tolist())
        raw_class = most_common(group["수익자분류"].fillna("").astype(str).tolist())
        if not raw_class and name in code_map.index:
            raw_class = normalize_name(code_map.loc[name].get("분류", ""))
        subtype_code, subtype_name = BENEFICIARY_SUBTYPE_MAP.get(
            raw_class,
            ("beneficiary_unknown", raw_class or "수익자 일반"),
        )
        add_role(
            role_rows,
            {
                "canonical_name": name,
                "stakeholder_group_code": "capital_partner",
                "stakeholder_group_name": "자본 파트너",
                "stakeholder_type_code": "fund_beneficiary",
                "stakeholder_type_name": "펀드 수익자",
                "stakeholder_subtype_code": subtype_code,
                "stakeholder_subtype_name": subtype_name,
                "source_system": "beneficiary_snapshot",
                "source_role_label": "수익자",
                "source_records": len(group),
                "project_count": group["자산"].replace("", pd.NA).dropna().nunique(),
                "latest_base_date": safe_date(group["기준일자"].max()),
                "owner_department": most_common(group["담당부서"].fillna("").astype(str).tolist()),
                "owner_manager": most_common(group["담당자"].fillna("").astype(str).tolist()),
                "raw_type_label": raw_type,
                "raw_class_label": raw_class,
                "t5t_type_name": "기관투자자(LP)",
                "entity_kind": choose_entity_kind(name, subtype_name),
                "confidence": 0.95 if raw_class else 0.8,
                "status": "active",
                "notes": "",
            },
        )
    return role_rows


def build_lender_roles(
    lender_df: pd.DataFrame,
    lender_code_df: pd.DataFrame,
) -> list[dict[str, Any]]:
    code_map = (
        lender_code_df.assign(공통코드명=lender_code_df["공통코드명"].map(normalize_name))
        .drop_duplicates(subset=["공통코드명"], keep="first")
        .set_index("공통코드명")
    )
    role_rows: list[dict[str, Any]] = []
    grouped = lender_df.copy()
    grouped["대주"] = grouped["대주"].map(normalize_name)
    grouped["자산"] = grouped["자산"].map(normalize_name)

    for name, group in grouped.groupby("대주"):
        if not name:
            continue
        raw_class = ""
        if name in code_map.index:
            raw_class = normalize_name(code_map.loc[name].get("분류", ""))
        subtype_code, subtype_name = LENDER_SUBTYPE_MAP.get(
            raw_class,
            ("lender_unknown", raw_class or "대주 일반"),
        )
        add_role(
            role_rows,
            {
                "canonical_name": name,
                "stakeholder_group_code": "financing_partner",
                "stakeholder_group_name": "금융 파트너",
                "stakeholder_type_code": "lender",
                "stakeholder_type_name": "금융기관(대주)",
                "stakeholder_subtype_code": subtype_code,
                "stakeholder_subtype_name": subtype_name,
                "source_system": "lender_snapshot",
                "source_role_label": "대주",
                "source_records": len(group),
                "project_count": group["자산"].replace("", pd.NA).dropna().nunique(),
                "latest_base_date": safe_date(group["기준일자"].max()),
                "owner_department": most_common(group["담당부서"].fillna("").astype(str).tolist()),
                "owner_manager": most_common(group["담당자"].fillna("").astype(str).tolist()),
                "raw_type_label": "",
                "raw_class_label": raw_class,
                "t5t_type_name": "금융기관(대주)",
                "entity_kind": choose_entity_kind(name, subtype_name),
                "confidence": 0.95 if raw_class else 0.8,
                "status": "active",
                "notes": "",
            },
        )
    return role_rows


def build_t5t_roles() -> list[dict[str, Any]]:
    dashboard = json.loads(T5T_DASHBOARD_PATH.read_text(encoding="utf-8"))
    all_period = dashboard.get("intelligence", {}).get("periods", {}).get("all", {})
    details = all_period.get("details", {}).get("stakeholders", {}) or {}
    role_rows: list[dict[str, Any]] = []

    for name, records in details.items():
        normalized_name = normalize_name(name)
        if not normalized_name:
            continue

        stakeholder_type = ""
        for record in records:
            for item in record.get("stakeholders", []):
                if normalize_name(item.get("name")) == normalized_name:
                    stakeholder_type = item.get("type", "")
                    break
            if stakeholder_type:
                break

        group_code, type_code, subtype_code, subtype_name = T5T_TYPE_MAP.get(
            stakeholder_type,
            ("other", "other", "other_unknown", "기타"),
        )
        add_role(
            role_rows,
            {
                "canonical_name": normalized_name,
                "stakeholder_group_code": group_code,
                "stakeholder_group_name": next(
                    row["stakeholder_group_name"]
                    for row in TYPE_TAXONOMY
                    if row["stakeholder_group_code"] == group_code
                ),
                "stakeholder_type_code": type_code,
                "stakeholder_type_name": stakeholder_type or "기타",
                "stakeholder_subtype_code": subtype_code,
                "stakeholder_subtype_name": subtype_name,
                "source_system": "t5t_dashboard",
                "source_role_label": stakeholder_type or "기타",
                "source_records": len(records),
                "project_count": len(
                    {
                        project_name
                        for record in records
                        for project_name in [
                            normalize_name(record.get("primary_project", "")),
                            *[normalize_name(project) for project in record.get("projects", [])],
                        ]
                        if project_name and project_name != "미연결"
                    }
                ),
                "latest_base_date": max(
                    (safe_date(record.get("work_date")) for record in records),
                    default="",
                ),
                "owner_department": "",
                "owner_manager": "",
                "raw_type_label": stakeholder_type,
                "raw_class_label": "",
                "t5t_type_name": stakeholder_type,
                "entity_kind": choose_entity_kind(normalized_name, subtype_name),
                "confidence": 0.75,
                "status": "active",
                "notes": "T5T 로그 키워드 기반 식별",
            },
        )
    return role_rows


def build_counterparty_seed_roles() -> list[dict[str, Any]]:
    if not COUNTERPARTY_SEED_PATH.exists():
        return []

    seed = pd.read_csv(COUNTERPARTY_SEED_PATH).fillna("")
    role_rows: list[dict[str, Any]] = []
    for row in seed.itertuples(index=False):
        general_name = normalize_name(row.counterparty_general_name)
        if not general_name:
            continue

        categories = [normalize_name(token) for token in str(row.counterparty_category).split(";") if normalize_name(token)]
        if not categories:
            categories = ["기타"]

        for category in categories:
            mapped = COUNTERPARTY_CATEGORY_MAP.get(
                category,
                ("other", "기타", "other", "기타", "other_unknown", category or "기타"),
            )
            group_code, group_name, type_code, type_name, subtype_code, subtype_name = mapped
            related_projects = normalize_name(row.related_projects_text)
            project_count = len([token for token in re.split(r"[;,|]", related_projects) if normalize_name(token)])
            add_role(
                role_rows,
                {
                    "canonical_name": general_name,
                    "stakeholder_group_code": group_code,
                    "stakeholder_group_name": group_name,
                    "stakeholder_type_code": type_code,
                    "stakeholder_type_name": type_name,
                    "stakeholder_subtype_code": subtype_code,
                    "stakeholder_subtype_name": subtype_name,
                    "source_system": "counterparty_seed",
                    "source_role_label": category,
                    "source_records": 1,
                    "project_count": project_count,
                    "latest_base_date": "",
                    "owner_department": "",
                    "owner_manager": normalize_name(row.current_contact_points),
                    "raw_type_label": category,
                    "raw_class_label": "",
                    "t5t_type_name": "",
                    "entity_kind": "organization",
                    "confidence": 0.98,
                    "status": "active",
                    "notes": normalize_name(row.notion_url),
                },
            )
    return role_rows


def build_entities(role_rows: list[dict[str, Any]]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in role_rows:
        grouped[row["canonical_name"]].append(row)

    entities: list[Entity] = []
    entity_rows: dict[str, str] = {}
    role_output: list[dict[str, Any]] = []
    alias_output: list[dict[str, Any]] = []

    sorted_names = sorted(grouped)
    for index, name in enumerate(sorted_names, start=1):
        entity_id = f"SH{index:06d}"
        rows = grouped[name]
        rows_sorted = sorted(rows, key=lambda item: (-item["source_records"], item["stakeholder_type_code"]))
        primary = rows_sorted[0]
        latest_date = max((row["latest_base_date"] for row in rows if row["latest_base_date"]), default="")
        source_systems = ",".join(sorted({row["source_system"] for row in rows}))
        entity = Entity(
            entity_id=entity_id,
            canonical_name=name,
            display_name=name,
            entity_kind=most_common([row["entity_kind"] for row in rows]) or "organization",
            primary_stakeholder_group_code=primary["stakeholder_group_code"],
            primary_stakeholder_type_code=primary["stakeholder_type_code"],
            primary_stakeholder_type_name=primary["stakeholder_type_name"],
            source_systems=source_systems,
            latest_base_date=latest_date,
        )
        entities.append(entity)
        entity_rows[name] = entity_id

        alias_output.append(
            {
                "alias_id": f"AL{len(alias_output) + 1:06d}",
                "entity_id": entity_id,
                "alias_name": name,
                "alias_type": "exact",
                "source_system": "seed_master",
                "confidence": 1.0,
                "notes": "",
            }
        )

        for role_index, row in enumerate(rows_sorted, start=1):
            role_output.append(
                {
                    "entity_role_id": f"{entity_id}-R{role_index:02d}",
                    "entity_id": entity_id,
                    "canonical_name": name,
                    "stakeholder_group_code": row["stakeholder_group_code"],
                    "stakeholder_group_name": row["stakeholder_group_name"],
                    "stakeholder_type_code": row["stakeholder_type_code"],
                    "stakeholder_type_name": row["stakeholder_type_name"],
                    "stakeholder_subtype_code": row["stakeholder_subtype_code"],
                    "stakeholder_subtype_name": row["stakeholder_subtype_name"],
                    "source_system": row["source_system"],
                    "source_role_label": row["source_role_label"],
                    "source_records": row["source_records"],
                    "project_count": row["project_count"],
                    "latest_base_date": row["latest_base_date"],
                    "owner_department": row["owner_department"],
                    "owner_manager": row["owner_manager"],
                    "raw_type_label": row["raw_type_label"],
                    "raw_class_label": row["raw_class_label"],
                    "t5t_type_name": row["t5t_type_name"],
                    "confidence": row["confidence"],
                    "status": row["status"],
                    "notes": row["notes"],
                }
            )

    entity_df = pd.DataFrame([entity.__dict__ for entity in entities])
    role_df = pd.DataFrame(role_output)
    alias_df = pd.DataFrame(alias_output)
    return entity_df, role_df, alias_df


def write_summary(
    entity_df: pd.DataFrame,
    role_df: pd.DataFrame,
    alias_df: pd.DataFrame,
) -> None:
    counts_by_group = (
        role_df.groupby(["stakeholder_group_code", "stakeholder_group_name"])["entity_id"]
        .nunique()
        .reset_index(name="entity_count")
        .sort_values(["stakeholder_group_code"])
    )
    lines = [
        "# CRM DB v1 Summary",
        "",
        "## 구성",
        "",
        f"- entity master: {len(entity_df):,}건",
        f"- entity role bridge: {len(role_df):,}건",
        f"- alias master: {len(alias_df):,}건",
        f"- taxonomy rows: {len(TYPE_TAXONOMY):,}건",
        "",
        "## 설계 원칙",
        "",
        "- 동일 법인/기관이 여러 역할을 가질 수 있으므로 `entity`와 `role`을 분리했습니다.",
        "- `DB손해보험`, `신한캐피탈`처럼 수익자와 대주 양쪽에 등장하는 경우도 한 엔티티 아래 복수 역할로 적재됩니다.",
        "- `매도인`, `공제회`, `신한`처럼 아직 법인 특정이 덜 된 이름은 우선 엔티티로 보관하고, 추후 alias 또는 병합 규칙으로 정리합니다.",
        "- T5T 분류명은 별도 컬럼(`t5t_type_name`)으로 유지해 현재 대시보드와의 호환성을 남겨둡니다.",
        "",
        "## 그룹별 엔티티 수",
        "",
    ]
    for row in counts_by_group.itertuples(index=False):
        lines.append(f"- {row.stakeholder_group_name} (`{row.stakeholder_group_code}`): {row.entity_count}건")

    lines.extend(
        [
            "",
            "## 다음 작업 권장",
            "",
            "- CRM 수기 입력 시 `entity master`를 기준 테이블로 사용하고, 역할 확장은 `entity role bridge`에 누적합니다.",
            "- T5T 키워드 추출어와 실명 법인을 연결할 alias 규칙을 별도 관리하면 `신한` → `신한캐피탈/신한은행` 같은 모호성 정리가 가능해집니다.",
            "- 추후 `운영사`, `시공사`, `주민단`, `공공기관` 정보를 더 넣을 때는 taxonomy만 확장하고 entity 구조는 그대로 유지하면 됩니다.",
            "",
        ]
    )
    (OUTPUT_DIR / "crm_db_v1_summary.md").write_text("\n".join(lines), encoding="utf-8")


def normalize_group_code(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return cleaned or "group"


def load_group_rules() -> pd.DataFrame:
    if not GROUP_RULES_PATH.exists():
        raise RuntimeError(f"그룹 규칙 파일이 없습니다: {GROUP_RULES_PATH.name}")
    rules = pd.read_csv(GROUP_RULES_PATH)
    rules["alias_name"] = rules["alias_name"].map(normalize_name)
    rules = rules.sort_values(["priority", "rule_id"], ascending=[False, True]).drop_duplicates(
        subset=["alias_name"],
        keep="first",
    )
    return rules


def apply_group_rules(
    entity_df: pd.DataFrame,
    role_df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    rules = load_group_rules()
    rule_lookup = {
        normalize_name(row.alias_name): {
            "group_name": row.group_name,
            "group_code": row.group_code,
            "mapping_status": row.mapping_status,
            "rule_id": row.rule_id,
            "version": row.version,
        }
        for row in rules.itertuples(index=False)
    }

    grouped_entities = entity_df.copy()
    grouped_entities["group_name"] = grouped_entities["canonical_name"]
    grouped_entities["group_code"] = grouped_entities["canonical_name"].map(normalize_group_code)
    grouped_entities["group_mapping_status"] = "self"
    grouped_entities["group_rule_id"] = ""
    grouped_entities["group_rule_version"] = GROUP_RULES_VERSION

    for idx, row in grouped_entities.iterrows():
        match = rule_lookup.get(normalize_name(row["canonical_name"]))
        if not match:
            continue
        grouped_entities.at[idx, "group_name"] = match["group_name"]
        grouped_entities.at[idx, "group_code"] = match["group_code"]
        grouped_entities.at[idx, "group_mapping_status"] = match["mapping_status"]
        grouped_entities.at[idx, "group_rule_id"] = match["rule_id"]
        grouped_entities.at[idx, "group_rule_version"] = match["version"]

    grouped_roles = role_df.merge(
        grouped_entities[
            [
                "entity_id",
                "group_name",
                "group_code",
                "group_mapping_status",
                "group_rule_id",
                "group_rule_version",
            ]
        ],
        on="entity_id",
        how="left",
    )
    return grouped_entities, grouped_roles


def build_group_master(grouped_entities: pd.DataFrame, grouped_roles: pd.DataFrame) -> pd.DataFrame:
    role_counts = (
        grouped_roles.groupby(["group_name", "group_code"])
        .agg(
            entity_count=("entity_id", "nunique"),
            role_count=("entity_role_id", "count"),
            latest_base_date=("latest_base_date", "max"),
        )
        .reset_index()
    )
    type_summary = (
        grouped_roles.groupby(["group_name", "group_code", "stakeholder_type_name"])["entity_id"]
        .nunique()
        .reset_index(name="entity_count")
        .sort_values(["group_name", "group_code", "entity_count", "stakeholder_type_name"], ascending=[True, True, False, True])
    )
    dominant_type = type_summary.drop_duplicates(subset=["group_name", "group_code"], keep="first")[
        ["group_name", "group_code", "stakeholder_type_name"]
    ].rename(columns={"stakeholder_type_name": "dominant_stakeholder_type"})

    entity_lists = (
        grouped_entities.groupby(["group_name", "group_code"])
        .agg(
            member_entities=("canonical_name", lambda values: " | ".join(sorted(set(values))[:12])),
            source_systems=("source_systems", lambda values: ",".join(sorted(set(",".join(values).split(","))))),
            group_mapping_status=("group_mapping_status", lambda values: " | ".join(sorted(set(values)))),
        )
        .reset_index()
    )

    group_master = entity_lists.merge(role_counts, on=["group_name", "group_code"], how="left").merge(
        dominant_type,
        on=["group_name", "group_code"],
        how="left",
    )
    return group_master.sort_values(["group_name", "group_code"])


def build_crm_contact_db(grouped_entities: pd.DataFrame, grouped_roles: pd.DataFrame) -> pd.DataFrame:
    role_summary = (
        grouped_roles.groupby("entity_id")
        .agg(
            role_count=("entity_role_id", "count"),
            role_types=("stakeholder_type_name", lambda values: " | ".join(sorted(set(values)))),
            role_subtypes=("stakeholder_subtype_name", lambda values: " | ".join(sorted(set(v for v in values if v)))),
            source_record_total=("source_records", "sum"),
            project_count_max=("project_count", "max"),
            owner_department=("owner_department", lambda values: most_common([normalize_name(v) for v in values])),
            owner_manager=("owner_manager", lambda values: most_common([normalize_name(v) for v in values])),
        )
        .reset_index()
    )

    contact_db = grouped_entities.merge(role_summary, on="entity_id", how="left")
    registered_name_map = (
        grouped_roles[grouped_roles["source_system"] == "counterparty_seed"]
        .groupby("entity_id")["notes"]
        .count()
        .to_dict()
    )
    contact_db["crm_db_version"] = GROUP_RULES_VERSION
    contact_db["record_status"] = "seeded"
    contact_db["counterparty_general_name"] = contact_db["group_name"]
    contact_db["counterparty_registered_name"] = ""
    contact_db["counterparty_category"] = ""
    contact_db["counterparty_resource_list"] = ""
    contact_db["related_projects_text"] = ""
    contact_db["current_contact_points"] = ""
    contact_db["next_target_project"] = ""
    contact_db["importance_level"] = ""
    contact_db["relationship_status"] = ""
    contact_db["interest_topics"] = ""
    contact_db["key_requests"] = ""
    contact_db["risk_notes"] = ""
    contact_db["next_action"] = ""
    contact_db["next_meeting_date"] = ""
    contact_db["coverage_note"] = ""
    ordered_columns = [
        "crm_db_version",
        "entity_id",
        "canonical_name",
        "display_name",
        "group_name",
        "group_code",
        "group_mapping_status",
        "group_rule_id",
        "counterparty_general_name",
        "counterparty_registered_name",
        "counterparty_category",
        "counterparty_resource_list",
        "related_projects_text",
        "current_contact_points",
        "next_target_project",
        "entity_kind",
        "primary_stakeholder_group_code",
        "primary_stakeholder_type_code",
        "primary_stakeholder_type_name",
        "role_count",
        "role_types",
        "role_subtypes",
        "source_systems",
        "source_record_total",
        "project_count_max",
        "latest_base_date",
        "owner_department",
        "owner_manager",
        "record_status",
        "importance_level",
        "relationship_status",
        "interest_topics",
        "key_requests",
        "risk_notes",
        "next_action",
        "next_meeting_date",
        "coverage_note",
    ]
    return contact_db[ordered_columns].sort_values(["group_name", "canonical_name"])


def build_crm_contact_db_v0110(grouped_entities: pd.DataFrame, grouped_roles: pd.DataFrame) -> pd.DataFrame:
    contact_db = build_crm_contact_db(grouped_entities, grouped_roles)
    seed_roles = grouped_roles[grouped_roles["source_system"] == "counterparty_seed"].copy()
    if seed_roles.empty:
        contact_db["crm_db_version"] = COUNTERPARTY_SEED_VERSION
        return contact_db

    seed_raw = pd.read_csv(COUNTERPARTY_SEED_PATH).fillna("")
    seed_raw["counterparty_general_name"] = seed_raw["counterparty_general_name"].map(normalize_name)
    seed_map = (
        seed_raw.groupby("counterparty_general_name")
        .agg(
            counterparty_registered_name=("counterparty_registered_name", lambda values: most_common([normalize_name(v) for v in values])),
            counterparty_category=("counterparty_category", lambda values: " | ".join(sorted(set(normalize_name(v) for v in values if normalize_name(v))))),
            related_projects_text=("related_projects_text", lambda values: " | ".join(sorted(set(normalize_name(v) for v in values if normalize_name(v))))),
            current_contact_points=("current_contact_points", lambda values: " | ".join(sorted(set(normalize_name(v) for v in values if normalize_name(v))))),
            next_target_project=("next_target_project", lambda values: " | ".join(sorted(set(normalize_name(v) for v in values if normalize_name(v))))),
            counterparty_resource_list=("notion_url", lambda values: " | ".join(sorted(set(normalize_name(v) for v in values if normalize_name(v))))),
        )
        .reset_index()
    )
    seed_entity_map = seed_roles[["entity_id", "canonical_name"]].drop_duplicates()
    seed_entity_map = seed_entity_map.merge(
        seed_map,
        left_on="canonical_name",
        right_on="counterparty_general_name",
        how="left",
    ).drop(columns=["counterparty_general_name"])

    contact_db = contact_db.merge(seed_entity_map, on=["entity_id", "canonical_name"], how="left", suffixes=("", "_seed"))
    for column in [
        "counterparty_registered_name",
        "counterparty_category",
        "counterparty_resource_list",
        "related_projects_text",
        "current_contact_points",
        "next_target_project",
    ]:
        seed_column = f"{column}_seed"
        if seed_column in contact_db.columns:
            contact_db[column] = contact_db[seed_column].where(contact_db[seed_column].fillna("") != "", contact_db[column])
            contact_db = contact_db.drop(columns=[seed_column])

    contact_db["crm_db_version"] = COUNTERPARTY_SEED_VERSION
    contact_db.loc[contact_db["counterparty_category"].fillna("") != "", "record_status"] = "counterparty_seeded"
    return contact_db


def write_group_summary(contact_db: pd.DataFrame, group_master: pd.DataFrame) -> None:
    mapped_count = int((contact_db["group_mapping_status"] != "self").sum())
    group_count = int(group_master["group_name"].nunique())
    top_groups = group_master.sort_values(["entity_count", "group_name"], ascending=[False, True]).head(10)
    lines = [
        f"# CRM Contact DB {GROUP_RULES_VERSION}",
        "",
        "## 구성",
        "",
        f"- contact db rows: {len(contact_db):,}건",
        f"- unique groups: {group_count:,}건",
        f"- grouped entities: {mapped_count:,}건",
        f"- group rules version: `{GROUP_RULES_VERSION}`",
        "",
        "## 기준",
        "",
        "- 1차 CRM 적재와 집계는 그룹명 기준으로 수행합니다.",
        "- 세부 법인명은 `canonical_name`으로 유지하고, 그룹 집계는 `group_name`으로 수행합니다.",
        "- 그룹 규칙이 없는 엔티티는 우선 자기 이름을 그룹명으로 유지합니다.",
        "",
        "## 상위 그룹",
        "",
    ]
    for row in top_groups.itertuples(index=False):
        lines.append(
            f"- {row.group_name}: entity {row.entity_count}건 / role {row.role_count}건 / 대표유형 {row.dominant_stakeholder_type or '-'}"
        )
    lines.append("")
    (OUTPUT_DIR / f"crm_contact_db_{GROUP_RULES_VERSION}_summary.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = load_excel_sources()
    missing = [name for name in ["beneficiary", "lender", "beneficiary_code", "lender_code"] if name not in sources]
    if missing:
        raise RuntimeError(f"필수 엑셀 소스 누락: {', '.join(missing)}")

    role_rows: list[dict[str, Any]] = []
    role_rows.extend(build_beneficiary_roles(sources["beneficiary"], sources["beneficiary_code"]))
    role_rows.extend(build_lender_roles(sources["lender"], sources["lender_code"]))
    role_rows.extend(build_t5t_roles())
    role_rows.extend(build_counterparty_seed_roles())

    entity_df, role_df, alias_df = build_entities(role_rows)
    taxonomy_df = pd.DataFrame(TYPE_TAXONOMY)

    taxonomy_df.to_csv(OUTPUT_DIR / "crm_stakeholder_taxonomy_v1.csv", index=False, encoding="utf-8-sig")
    entity_df.to_csv(OUTPUT_DIR / "crm_entity_master_v1.csv", index=False, encoding="utf-8-sig")
    role_df.to_csv(OUTPUT_DIR / "crm_entity_role_bridge_v1.csv", index=False, encoding="utf-8-sig")
    alias_df.to_csv(OUTPUT_DIR / "crm_entity_alias_v1.csv", index=False, encoding="utf-8-sig")
    write_summary(entity_df, role_df, alias_df)

    grouped_entities, grouped_roles = apply_group_rules(entity_df, role_df)
    group_master_df = build_group_master(grouped_entities, grouped_roles)
    crm_contact_db_df = build_crm_contact_db(grouped_entities, grouped_roles)
    crm_contact_db_v0110_df = build_crm_contact_db_v0110(grouped_entities, grouped_roles)

    grouped_entities.to_csv(
        OUTPUT_DIR / f"crm_entity_master_grouped_{GROUP_RULES_VERSION}.csv",
        index=False,
        encoding="utf-8-sig",
    )
    grouped_roles.to_csv(
        OUTPUT_DIR / f"crm_entity_role_grouped_{GROUP_RULES_VERSION}.csv",
        index=False,
        encoding="utf-8-sig",
    )
    group_master_df.to_csv(
        OUTPUT_DIR / f"crm_group_master_{GROUP_RULES_VERSION}.csv",
        index=False,
        encoding="utf-8-sig",
    )
    crm_contact_db_df.to_csv(
        OUTPUT_DIR / f"crm_contact_db_{GROUP_RULES_VERSION}.csv",
        index=False,
        encoding="utf-8-sig",
    )
    crm_contact_db_v0110_df.to_csv(
        OUTPUT_DIR / f"crm_contact_db_{COUNTERPARTY_SEED_VERSION}.csv",
        index=False,
        encoding="utf-8-sig",
    )
    write_group_summary(crm_contact_db_df, group_master_df)
    (OUTPUT_DIR / f"crm_contact_db_{COUNTERPARTY_SEED_VERSION}_summary.md").write_text(
        (
            f"# CRM Contact DB {COUNTERPARTY_SEED_VERSION}\n\n"
            f"- rows: {len(crm_contact_db_v0110_df):,}건\n"
            f"- counterparty seeded rows: {(crm_contact_db_v0110_df['record_status'] == 'counterparty_seeded').sum():,}건\n"
            f"- source seed: `{COUNTERPARTY_SEED_PATH.name}`\n"
        ),
        encoding="utf-8",
    )

    print(f"entity master: {len(entity_df)}")
    print(f"entity role bridge: {len(role_df)}")
    print(f"alias master: {len(alias_df)}")
    print(f"taxonomy: {len(taxonomy_df)}")
    print(f"grouped entity master: {len(grouped_entities)}")
    print(f"grouped role bridge: {len(grouped_roles)}")
    print(f"group master: {len(group_master_df)}")
    print(f"crm contact db: {len(crm_contact_db_df)}")
    print(f"crm contact db {COUNTERPARTY_SEED_VERSION}: {len(crm_contact_db_v0110_df)}")
    print(f"output dir: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
