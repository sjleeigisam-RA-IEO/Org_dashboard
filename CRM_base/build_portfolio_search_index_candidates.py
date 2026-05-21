from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
PROJECT_BASIS_CSV = OUTPUT_DIR / "project_name_cleanup_basis.csv"
SEARCH_CSV = OUTPUT_DIR / "portfolio_search_index_candidates.csv"
SUMMARY_MD = OUTPUT_DIR / "portfolio_search_index_design.md"


def load_env() -> dict[str, str]:
    values = {}
    for line in (PROJECT_DIR / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def fetch_all(client, table: str, select: str = "*") -> list[dict]:
    rows = []
    start = 0
    size = 1000
    while True:
        batch = (
            client.table(table)
            .select(select)
            .range(start, start + size - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ").strip()
    return "" if text.lower() in {"", "none", "null", "nan", "-"} else text


def normalize(value) -> str:
    text = clean(value).lower()
    text = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", text)
    return re.sub(r"[\s\.,·ㆍ\-_/\\|]+", "", text)


def region_tokens(address: str) -> list[str]:
    text = clean(address)
    if not text:
        return []
    parts = re.split(r"\s+", text)
    tokens = []
    for part in parts[:4]:
        part = part.strip(",")
        if len(part) >= 2 and part not in tokens:
            tokens.append(part)
    if len(parts) >= 2:
        combined = " ".join(parts[:2])
        if combined not in tokens:
            tokens.append(combined)
    return tokens


def add_token(rows: list[dict[str, str]], seen: set[tuple], **record) -> None:
    token = clean(record.get("search_text"))
    if not token:
        return
    record["search_text"] = token
    record["search_key"] = normalize(token)
    key = (
        record.get("entity_type"),
        record.get("entity_id"),
        record.get("token_type"),
        record["search_key"],
        record.get("related_asset_id", ""),
        record.get("related_fund_id", ""),
    )
    if not record["search_key"] or key in seen:
        return
    seen.add(key)
    rows.append(record)


def main() -> None:
    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])
    beneficiary_rows = fetch_all(
        client,
        "beneficiary_exposures",
        "id,fund_id,asset_id,beneficiary_clean,beneficiary_raw,counterparty_id,base_date",
    )
    lender_rows = fetch_all(
        client,
        "lender_exposures",
        "id,fund_id,asset_id,lender_clean,lender_raw,counterparty_id,base_date",
    )

    with PROJECT_BASIS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        basis_rows = list(csv.DictReader(handle))

    output_rows: list[dict[str, str]] = []
    seen: set[tuple] = set()

    for row in basis_rows:
        asset_id = row.get("asset_id", "")
        fund_id = row.get("fund_id", "")
        project_id = row.get("project_id", "")
        final_asset_name = row.get("final_asset_name", "")
        final_fund_name = row.get("final_fund_name", "")
        fund_short_name = row.get("final_fund_short_name", "")
        project_label = row.get("project_display_name_candidate", "")
        project_class = row.get("project_display_class", "")
        address = row.get("asset_address", "")

        add_token(
            output_rows,
            seen,
            entity_type="asset",
            entity_id=asset_id,
            token_type="asset_name",
            search_text=final_asset_name,
            display_text=final_asset_name,
            related_asset_id=asset_id,
            related_fund_id=fund_id,
            related_project_id=project_id,
            result_behavior="open_asset_drawer",
            source="project_name_cleanup_basis.final_asset_name",
        )
        add_token(
            output_rows,
            seen,
            entity_type="fund",
            entity_id=fund_id,
            token_type="fund_name",
            search_text=final_fund_name,
            display_text=final_fund_name,
            related_asset_id=asset_id,
            related_fund_id=fund_id,
            related_project_id=project_id,
            result_behavior="open_fund_drawer",
            source="funds.fund_name",
        )
        add_token(
            output_rows,
            seen,
            entity_type="fund",
            entity_id=fund_id,
            token_type="fund_short_name",
            search_text=fund_short_name,
            display_text=final_fund_name or fund_short_name,
            related_asset_id=asset_id,
            related_fund_id=fund_id,
            related_project_id=project_id,
            result_behavior="open_fund_drawer",
            source="funds.short_name",
        )
        if project_label:
            behavior = (
                "open_project_drawer"
                if project_class == "actual_project_keep"
                else "open_context_drawer"
            )
            add_token(
                output_rows,
                seen,
                entity_type="project" if project_class == "actual_project_keep" else "project_context",
                entity_id=project_id or f"{asset_id}:{fund_id}",
                token_type="project_or_business_label",
                search_text=project_label,
                display_text=project_label,
                related_asset_id=asset_id,
                related_fund_id=fund_id,
                related_project_id=project_id,
                result_behavior=behavior,
                source=row.get("project_display_name_source", ""),
            )
        for token in region_tokens(address):
            add_token(
                output_rows,
                seen,
                entity_type="address",
                entity_id=asset_id,
                token_type="address_region",
                search_text=token,
                display_text=f"{final_asset_name} · {address}",
                related_asset_id=asset_id,
                related_fund_id=fund_id,
                related_project_id=project_id,
                result_behavior="open_asset_drawer",
                source="asset_address.region_token",
            )

    for row in beneficiary_rows:
        name = clean(row.get("beneficiary_clean") or row.get("beneficiary_raw"))
        add_token(
            output_rows,
            seen,
            entity_type="beneficiary",
            entity_id=clean(row.get("counterparty_id")) or f"beneficiary:{normalize(name)}",
            token_type="beneficiary_name",
            search_text=name,
            display_text=name,
            related_asset_id=clean(row.get("asset_id")),
            related_fund_id=clean(row.get("fund_id")),
            related_project_id="",
            result_behavior="open_beneficiary_drawer",
            source="beneficiary_exposures.beneficiary_clean",
        )

    for row in lender_rows:
        name = clean(row.get("lender_clean") or row.get("lender_raw"))
        add_token(
            output_rows,
            seen,
            entity_type="lender",
            entity_id=clean(row.get("counterparty_id")) or f"lender:{normalize(name)}",
            token_type="lender_name",
            search_text=name,
            display_text=name,
            related_asset_id=clean(row.get("asset_id")),
            related_fund_id=clean(row.get("fund_id")),
            related_project_id="",
            result_behavior="open_lender_drawer",
            source="lender_exposures.lender_clean",
        )

    fieldnames = [
        "entity_type",
        "entity_id",
        "token_type",
        "search_text",
        "search_key",
        "display_text",
        "related_asset_id",
        "related_fund_id",
        "related_project_id",
        "result_behavior",
        "source",
    ]
    with SEARCH_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(output_rows)

    type_counts = Counter(row["entity_type"] for row in output_rows)
    token_counts = Counter(row["token_type"] for row in output_rows)
    lines = [
        "# 포트폴리오 통합 검색 인덱스 설계",
        "",
        f"- 후보 CSV: `{SEARCH_CSV.name}`",
        f"- 검색 토큰 후보: {len(output_rows)}행",
        "",
        "## 검색 범위",
        "",
        "- 자산명: `final_asset_name`",
        "- 프로젝트명/업무 라벨: 실제 프로젝트명 또는 fund context label",
        "- 펀드명/비히클명: `fund_name`, `short_name`",
        "- 수익자명: `beneficiary_exposures.beneficiary_clean`",
        "- 대주명: `lender_exposures.lender_clean`",
        "- 주소/지역명: 자산 주소에서 시/도, 구/군 등 토큰 추출",
        "",
        "## 엔티티 타입별 토큰",
        "",
        "| entity_type | count |",
        "|---|---:|",
    ]
    for key, count in type_counts.most_common():
        lines.append(f"| `{key}` | {count} |")
    lines.extend(["", "## 토큰 타입별 건수", "", "| token_type | count |", "|---|---:|"])
    for key, count in token_counts.most_common():
        lines.append(f"| `{key}` | {count} |")
    lines.extend(
        [
            "",
            "## 표시 원칙",
            "",
            "- 검색은 넓게 잡되, 결과 클릭 후에는 entity_type에 맞는 drawer를 연다.",
            "- 프로젝트명은 필수 정식명칭이 아니라 검색 가능한 업무 라벨로 취급한다.",
            "- `project_context` 결과는 실제 프로젝트가 아니라 자산+펀드 맥락 drawer로 연다.",
            "- 주소/지역 검색은 자산 drawer로 연결한다.",
            "- 수익자/대주 검색은 해당 투자/대출 익스포저 drawer에서 연결 자산·펀드를 보여준다.",
        ]
    )
    SUMMARY_MD.write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps({"rows": len(output_rows), "entity_type": type_counts, "token_type": token_counts}, ensure_ascii=False, indent=2, default=dict))
    print(str(SEARCH_CSV))
    print(str(SUMMARY_MD))


if __name__ == "__main__":
    main()
