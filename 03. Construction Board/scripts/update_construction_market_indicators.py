from __future__ import annotations

import ast
import json
import re
import ssl
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
BOARD_DIR = ROOT / "03. Construction Board"
DATA_DIR = BOARD_DIR / "data"
OUT = DATA_DIR / "construction_market_indicators_cache.json"
NARA_CACHE = DATA_DIR / "construction_nara_contracts_cache.json"
KST = timezone(timedelta(hours=9))
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

KOSIS_ORG_ID = "397"
KOSIS_TBL_ID = "DT_39701_A003"
KOSIS_ITM_ID = "16397AAA0"
KOSIS_SOURCE_URL = "https://kosis.kr/serviceInfo/newContrainDataDetail.do?boardIdx=2004001&boardOrgId=397"
KOSIS_API_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
KOSIS_BASE_YEAR = "2020"
DEFAULT_KOSIS_PERIODS = 84

MOLIT_BASE_ANCHOR = {
    "period": "2020-09-15",
    "value": 167.8,
    "change_pct": 2.19,
    "source_name": "국토교통부",
    "source_url": "https://www.molit.go.kr/USR/I0204/m_45/dtl.jsp?gubun=&idx=16566&lcmspage=1&old_search_dept_nm=&psize=10&search=%EA%B8%B0%EB%B3%B8%ED%98%95%EA%B1%B4%EC%B6%95%EB%B9%84&search_dept_id=&search_dept_nm=&search_regdate_e=&search_regdate_s=&srch_usr_ctnt=&srch_usr_nm=&srch_usr_num=&srch_usr_titl=Y&srch_usr_year=",
    "note": "KOSIS 기준연도 2020에 가까운 기본형건축비 앵커. 16~25층 이하, 전용면적 60~85㎡, 지상층 기준",
    "public_py_amount": 647.5,
    "public_py_note": "보도자료상 공급면적 3.3㎡당 건축비 상한액 참고",
}

KOSIS_CATEGORIES = [
    ("kosis_construction_cost_index_total", "건설", "15397AA2AA", "전체 공사비 변동"),
    ("kosis_construction_cost_index_building", "건물건설 및 건축보수", "15397AA2AA1", "건축/보수 기준"),
    ("kosis_construction_cost_index_residential", "주거용건물", "15397AA2AA11", "주거용 건축 기준"),
    ("kosis_construction_cost_index_non_residential", "비주거용건물", "15397AA2AA12", "오피스/물류 등 비주거 기준"),
    ("kosis_construction_cost_index_civil", "토목건설", "15397AA2AA2", "인프라/토목 기준"),
]

MOLIT_BASIC_COST_POINTS = [
    MOLIT_BASE_ANCHOR,
    {
        "period": "2025-09-15",
        "value": 217.4,
        "change_pct": 1.59,
        "source_name": "국토교통부",
        "source_url": "https://eiec.kdi.re.kr/policy/materialView.do?num=271047&pg=&pp=20&topic=C",
        "note": "16~25층 이하, 전용면적 60~85㎡, 지상층 기준",
    },
    {
        "period": "2026-03-01",
        "value": 222.0,
        "change_pct": 2.12,
        "source_name": "국토교통부",
        "source_url": "https://www.molit.go.kr/USR/I0204/m_45/dtl.jsp?idx=18796&lcmspage=1&psize=10&srch_usr_titl=Y",
        "note": "16~25층 이하, 전용면적 60~85㎡, 지상층 기준",
    },
    {
        "period": "2026-07-15",
        "value": 223.7,
        "change_pct": 0.77,
        "source_name": "국토교통부",
        "source_url": "https://www.molit.go.kr/USR/NEWS/m_71/dtl.jsp?id=95092223",
        "note": "16~25층 이하, 전용면적 60~85㎡, 지상층 기준",
    },
]


def now_kst() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST")


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", "" if value is None else str(value)).strip()


def parse_float(value: Any) -> float:
    text = compact_text(value)
    if not text:
        return 0.0
    text = text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else 0.0


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def read_env_values() -> dict[str, str]:
    values: dict[str, str] = {}
    for path in [ROOT / ".env", ROOT / "51. IOTA_platform" / ".env"]:
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def decode_kosis_payload(raw: bytes) -> Any:
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        normalized = re.sub(r"([{,])([A-Za-z_][A-Za-z0-9_]*):", r'\1"\2":', text)
        normalized = re.sub(r":\s*null", ": None", normalized)
        normalized = re.sub(r":\s*true", ": True", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r":\s*false", ": False", normalized, flags=re.IGNORECASE)
        return ast.literal_eval(normalized)


def fetch_url(url: str, params: dict[str, str]) -> Any:
    full_url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(full_url, headers={"User-Agent": USER_AGENT})
    context = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=30, context=context) as resp:
        raw = resp.read()
    payload = decode_kosis_payload(raw)
    if isinstance(payload, dict) and payload.get("err"):
        raise RuntimeError(compact_text(payload.get("errMsg")) or f"KOSIS error {payload.get('err')}")
    return payload


def period_to_label(value: Any) -> str:
    text = compact_text(value)
    if re.fullmatch(r"\d{6}", text):
        return f"{text[:4]}-{text[4:]}"
    return text


def previous_year_month(period: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}", period):
        return ""
    return f"{int(period[:4]) - 1}-{period[5:]}"


def build_kosis_series(api_key: str, periods: int) -> list[dict[str, Any]]:
    params = {
        "method": "getList",
        "apiKey": api_key,
        "orgId": KOSIS_ORG_ID,
        "tblId": KOSIS_TBL_ID,
        "itmId": KOSIS_ITM_ID,
        "objL1": "ALL",
        "format": "json",
        "jsonVD": "Y",
        "prdSe": "M",
        "newEstPrdCnt": str(periods),
    }
    payload = fetch_url(KOSIS_API_URL, params)
    if not isinstance(payload, list):
        raise RuntimeError("KOSIS response was not a row list")

    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in payload:
        code = compact_text(row.get("C1"))
        if code:
            by_code[code].append(row)

    series: list[dict[str, Any]] = []
    for series_id, label, code, description in KOSIS_CATEGORIES:
        source_rows = sorted(by_code.get(code, []), key=lambda item: compact_text(item.get("PRD_DE")))
        point_values: dict[str, float] = {}
        raw_points: list[dict[str, Any]] = []
        for row in source_rows:
            period = period_to_label(row.get("PRD_DE"))
            value = parse_float(row.get("DT"))
            if not period or value <= 0:
                continue
            point_values[period] = value
            raw_points.append(
                {
                    "period": period,
                    "value": value,
                    "source_name": "KOSIS/한국건설기술연구원",
                    "source_url": KOSIS_SOURCE_URL,
                    "updated_at": compact_text(row.get("LST_CHN_DE")),
                }
            )

        points: list[dict[str, Any]] = []
        for point in raw_points:
            previous = point_values.get(previous_year_month(point["period"]))
            if previous:
                point["yoy_pct"] = round(((point["value"] / previous) - 1) * 100, 2)
            points.append(point)

        series.append(
            {
                "id": series_id,
                "group": "KOSIS",
                "label": label,
                "unit": "2020=100",
                "frequency": "월",
                "source_name": "KOSIS/한국건설기술연구원",
                "source_url": KOSIS_SOURCE_URL,
                "description": description,
                "base": {
                    "year": KOSIS_BASE_YEAR,
                    "label": "2020년 연평균=100",
                    "meaning": "지수는 단가 자체가 아니라 2020년 평균 대비 공사비 투입 가격 수준을 보여줍니다.",
                    "unit_cost_anchor": {
                        "source_name": "국토교통부 기본형건축비",
                        "period": MOLIT_BASE_ANCHOR["period"],
                        "value": MOLIT_BASE_ANCHOR["value"],
                        "unit": "만원/㎡",
                        "value_py": round(parse_float(MOLIT_BASE_ANCHOR["value"]) * 3.305785, 1),
                        "public_py_amount": MOLIT_BASE_ANCHOR["public_py_amount"],
                        "source_url": MOLIT_BASE_ANCHOR["source_url"],
                        "note": MOLIT_BASE_ANCHOR["note"],
                    },
                },
                "points": points,
                "api": {
                    "org_id": KOSIS_ORG_ID,
                    "tbl_id": KOSIS_TBL_ID,
                    "itm_id": KOSIS_ITM_ID,
                    "obj_l1": code,
                    "prd_se": "M",
                },
            }
        )
    return series


def build_molit_basic_cost_series() -> dict[str, Any]:
    points = []
    for point in MOLIT_BASIC_COST_POINTS:
        item = dict(point)
        item["value_py"] = round(parse_float(point["value"]) * 3.305785, 1)
        points.append(item)
    return {
        "id": "molit_basic_construction_cost",
        "group": "MOLIT",
        "label": "기본형건축비",
        "unit": "만원/㎡",
        "frequency": "고시",
        "source_name": "국토교통부",
        "source_url": "https://www.molit.go.kr/USR/NEWS/m_71/dtl.jsp?id=95092223",
        "description": "분양가상한제 공동주택 기준선입니다. KOSIS 2020=100 지수의 감을 잡기 위한 실제 단가 앵커로 함께 표시합니다.",
        "points": points,
    }


def build_nara_contract_amount_series() -> dict[str, Any]:
    cache = read_json(NARA_CACHE)
    monthly: dict[str, dict[str, float]] = defaultdict(lambda: {"amount": 0.0, "count": 0.0})
    for company in cache.get("companies", []):
        for award in company.get("awards", []):
            date = compact_text(award.get("date"))
            if not date:
                continue
            period = date[:7] if re.match(r"\d{4}-\d{2}", date) else ""
            amount = parse_float(award.get("amount_krw"))
            if not period or amount <= 0:
                continue
            monthly[period]["amount"] += amount / 100_000_000
            monthly[period]["count"] += 1

    points = [
        {
            "period": period,
            "value": round(values["amount"], 2),
            "count": int(values["count"]),
            "source_name": "나라장터 계약정보",
            "source_url": compact_text(cache.get("source_url")) or "https://www.data.go.kr/data/15129427/openapi.do",
        }
        for period, values in sorted(monthly.items())
    ]
    return {
        "id": "nara_public_contract_amount",
        "group": "G2B",
        "label": "나라장터 계약액",
        "unit": "억원",
        "frequency": "수시",
        "source_name": "나라장터 계약정보",
        "source_url": compact_text(cache.get("source_url")) or "https://www.data.go.kr/data/15129427/openapi.do",
        "description": "현재 대시보드 회사명 매칭 캐시 안의 공사 계약금액 합계입니다.",
        "points": points,
        "status_note": compact_text(cache.get("source_note")) or "회사명 기준 공사 계약정보 캐시",
    }


def build_pps_cost_square_status() -> dict[str, Any]:
    return {
        "id": "pps_cost_square_status",
        "group": "PPS",
        "label": "조달청 공사비정보광장",
        "unit": "상태",
        "frequency": "원문 확인",
        "source_name": "조달청",
        "source_url": "https://pcae.g2b.go.kr",
        "description": "유형별 공사비 기준은 공사비정보광장 원문/접근권한 확인 후 시계열화합니다.",
        "points": [],
        "status_note": "익명 접속 기준 SSO 영역이라 자동 수집 연결이 필요합니다.",
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    env = read_env_values()
    api_key = compact_text(env.get("KOSIS_API_KEY"))
    periods = max(DEFAULT_KOSIS_PERIODS, int(parse_float(env.get("KOSIS_CONSTRUCTION_INDEX_PERIODS") or DEFAULT_KOSIS_PERIODS) or DEFAULT_KOSIS_PERIODS))
    errors: list[str] = []
    series: list[dict[str, Any]] = []

    if api_key:
        try:
            series.extend(build_kosis_series(api_key, periods))
        except Exception as exc:
            errors.append(f"KOSIS 건설공사비지수 수집 실패: {type(exc).__name__}: {exc}")
    else:
        errors.append("KOSIS_API_KEY가 .env에 없습니다.")

    series.append(build_molit_basic_cost_series())
    series.append(build_nara_contract_amount_series())
    series.append(build_pps_cost_square_status())

    payload = {
        "generated_at": now_kst(),
        "status": "partial" if errors else "ok",
        "source_note": "시장 공사비 기준지표 캐시입니다. KOSIS 키 값은 저장하지 않습니다.",
        "series": series,
        "errors": errors,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    counts = {item["id"]: len(item.get("points") or []) for item in series}
    print(f"Wrote {OUT}")
    print(f"status={payload['status']} series={len(series)} points={counts}")
    if errors:
        print("errors=" + "; ".join(errors))


if __name__ == "__main__":
    main()
