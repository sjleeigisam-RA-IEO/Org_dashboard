import argparse
import csv
import difflib
import hashlib
import json
import re
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

from update_20260731_snapshot import management_sql

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output" / "overseas_asset_location"
CACHE_PATH = OUTPUT_DIR / "nominatim_cache_v1.json"
PHOTON_CACHE_PREFIX = "photon|"
MIGRATION_PATH = ROOT / "migrations" / "2026-09-03_overseas_asset_location_normalization.sql"
USER_AGENT = "IGIS-RA-Portal-asset-location-normalization/1.0 (internal data QA)"
CLASSIFIER_VERSION = "overseas-location-v2"
GEOCODER_VERSION = "nominatim-photon-osm-2026-09"
TRUSTED_EXISTING_COORDINATE_SOURCES = {"manual_verified", "authoritative_source", "source_document_verified"}
REGIONS = ("북미", "유럽", "아시아", "글로벌")
PLACEHOLDER_RE = re.compile(r"아래\s*자산별|상세\s*내역|복수\s*도시|[0-9]+개\s*도시|미정|해당\s*없음", re.I)
NON_PHYSICAL_RE = re.compile(
    r"(대출|담보대출|선순위|메자닌|수익증권|지분증권|브릿지론|대여금|채권)"
    r"|(^|[^a-z])(fund|sicav|raif|scsp|co-invest|secondary|loan|note|cm(?:b|m)bs|mezz(?:anine)?|"
    r"debt\s+strateg(?:y|ies)|credit\s+fund|infrastructure\s+partners)([^a-z]|$)"
    r"|real\s+estate\s+partners\s+[ivx0-9]+$",
    re.I,
)
MULTI_SITE_RE = re.compile(r"(portfolio|포트폴리오|[0-9]+개\s*도시|복수\s*도시|BTS\s+Logistics)", re.I)
PRECISION_RANK = {
    "address_point": 7,
    "building": 6,
    "street": 5,
    "district": 4,
    "city": 3,
    "region": 2,
    "country": 1,
    "unknown": 0,
}
REGION_COUNTRIES = {
    "북미": {"US", "CA", "MX", "GU", "PR", "VI", "BM", "BS", "KY"},
    "유럽": {
        "AL", "AD", "AT", "BE", "BA", "BG", "BY", "CH", "CY", "CZ", "DE", "DK",
        "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI",
        "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT",
        "RO", "RS", "SE", "SI", "SK", "SM", "UA", "VA",
    },
    "아시아": {
        "AE", "AM", "AZ", "BD", "BH", "BN", "BT", "CN", "GE", "HK", "ID", "IL",
        "IN", "IQ", "IR", "JO", "JP", "KH", "KR", "KW", "KZ", "LA", "LB", "LK",
        "MM", "MN", "MO", "MV", "MY", "NP", "OM", "PH", "PK", "QA", "SA", "SG",
        "TH", "TJ", "TL", "TM", "TR", "TW", "UZ", "VN", "YE", "AU", "NZ",
    },
}
ISO3_BY_ALPHA2 = {
    "AD": "AND", "AE": "ARE", "AL": "ALB", "AM": "ARM", "AT": "AUT", "AU": "AUS", "AZ": "AZE",
    "BA": "BIH", "BD": "BGD", "BE": "BEL", "BG": "BGR", "BH": "BHR", "BM": "BMU", "BN": "BRN",
    "BS": "BHS", "BT": "BTN", "BY": "BLR", "CA": "CAN", "CH": "CHE", "CN": "CHN", "CY": "CYP",
    "CZ": "CZE", "DE": "DEU", "DK": "DNK", "EE": "EST", "ES": "ESP", "FI": "FIN", "FR": "FRA",
    "GB": "GBR", "GE": "GEO", "GR": "GRC", "GU": "GUM", "HK": "HKG", "HR": "HRV", "HU": "HUN",
    "ID": "IDN", "IE": "IRL", "IL": "ISR", "IN": "IND", "IQ": "IRQ", "IR": "IRN", "IS": "ISL",
    "IT": "ITA", "JO": "JOR", "JP": "JPN", "KH": "KHM", "KR": "KOR", "KW": "KWT", "KY": "CYM",
    "KZ": "KAZ", "LA": "LAO", "LB": "LBN", "LI": "LIE", "LK": "LKA", "LT": "LTU", "LU": "LUX",
    "LV": "LVA", "MC": "MCO", "MD": "MDA", "ME": "MNE", "MK": "MKD", "MM": "MMR", "MN": "MNG",
    "MO": "MAC", "MT": "MLT", "MV": "MDV", "MX": "MEX", "MY": "MYS", "NL": "NLD", "NO": "NOR",
    "NP": "NPL", "NZ": "NZL", "OM": "OMN", "PH": "PHL", "PK": "PAK", "PL": "POL", "PR": "PRI",
    "PT": "PRT", "QA": "QAT", "RO": "ROU", "RS": "SRB", "SA": "SAU", "SE": "SWE", "SG": "SGP",
    "SI": "SVN", "SK": "SVK", "SM": "SMR", "TH": "THA", "TJ": "TJK", "TL": "TLS", "TM": "TKM",
    "TR": "TUR", "TW": "TWN", "UA": "UKR", "US": "USA", "UZ": "UZB", "VA": "VAT", "VI": "VIR",
    "VN": "VNM", "XK": "XKX", "YE": "YEM",
}
CITY_ALIASES = {
    "뉴욕": "New York", "몬트리올": "Montreal", "워싱턴 D.C.": "Washington DC",
    "워싱턴 D.C": "Washington DC", "마이애미": "Miami", "로스앤젤레스": "Los Angeles",
    "라스베이거스": "Las Vegas", "파리": "Paris", "런던": "London", "브뤼셀": "Brussels",
    "프랑크푸르트": "Frankfurt", "함부르크": "Hamburg", "바르셀로나": "Barcelona",
    "프라하": "Prague", "도쿄": "Tokyo", "시드니": "Sydney", "알렉산드리아": "Alexandria",
}
NON_CITY_LABELS = {"조지아", "일리노이", "텍사스", "뉴저지", "하와이", "버지니아", "Delaware"}


def raw_value(value):
    if value is None:
        return None
    return str(value)


def clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def fold(value):
    text = unicodedata.normalize("NFKD", clean(value)).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]", "", text)


def valid_coordinate(latitude, longitude):
    try:
        lat, lon = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lon <= 180


def location_subject_type(row):
    name = clean(row.get("canonical_name"))
    address = clean(row.get("address_text"))
    city = clean(row.get("city"))
    if NON_PHYSICAL_RE.search(name):
        return "non_physical_vehicle", "instrument_or_vehicle_name"
    if MULTI_SITE_RE.search(name) or PLACEHOLDER_RE.search(address) or PLACEHOLDER_RE.search(city):
        return "multi_site_portfolio", "multi_site_or_placeholder"
    if address or valid_coordinate(row.get("latitude"), row.get("longitude")):
        return "single_site", "single_site_candidate"
    return "unresolved_subject", "missing_specific_location"


def source_has_street_number(address):
    first = clean(address).split(",", 1)[0]
    if not first or re.match(r"^[A-Z]-?\d{4,6}\b", first, re.I):
        return False
    if re.search(r"\b(?:unit|lot|no\.?)\s*\d+", first, re.I):
        return True
    if re.match(r"^\d+(?:[-/]\d+)*[A-Za-z]?(?:\s+\S+|$)", first):
        return bool(re.search(r"[A-Za-z]|[-/]", first))
    return bool(re.search(r"[A-Za-z].*\b\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)*\b$", first))


def normalize_house_number(value):
    token = unicodedata.normalize("NFKC", clean(value)).lower()
    token = token.replace("–", "-").replace("—", "-").replace("−", "-")
    return re.sub(r"\s+", "", token)


def source_house_numbers(address):
    for component in (clean(part) for part in clean(address).split(",")):
        if not component or re.match(r"^[A-Z]-?\d{4,6}\b", component, re.I):
            continue
        if re.match(r"^unit\b", component, re.I):
            continue
        labelled = re.match(r"^(?:lot|no\.?)\s*(\d+[a-z]?(?:[-/]\d+[a-z]?)*)\b", component, re.I)
        leading = re.match(r"^(\d+[a-z]?(?:[-/]\d+[a-z]?)*)\b", component, re.I)
        trailing = re.search(r"\b(\d+[a-z]?(?:[-/]\d+[a-z]?)*)\s*$", component, re.I)
        match = labelled or leading or trailing
        if match:
            return {normalize_house_number(match.group(1))}
    return set()


def direction_tokens(value):
    raw = clean(value).upper()
    found = set()
    for token, pattern in {
        "NE": r"\bN\s*\.\s*E\s*\.?\b", "NW": r"\bN\s*\.\s*W\s*\.?\b",
        "SE": r"\bS\s*\.\s*E\s*\.?\b", "SW": r"\bS\s*\.\s*W\s*\.?\b",
    }.items():
        if re.search(pattern, raw):
            found.add(token)
    text = re.sub(r"[^A-Z]", "", raw)
    for token, variants in {
        "NE": ("NORTHEAST",), "NW": ("NORTHWEST",),
        "SE": ("SOUTHEAST",), "SW": ("SOUTHWEST",),
    }.items():
        if any(variant in text for variant in variants):
            found.add(token)
    if not found:
        spaced = re.sub(r"[^A-Z]", " ", clean(value).upper())
        found.update(re.findall(r"\b(?:NE|NW|SE|SW)\b", spaced))
    return found


def directional_consistent(source_address, result):
    source_tokens = direction_tokens(source_address)
    if not source_tokens:
        return True
    result_tokens = direction_tokens((result.get("address") or {}).get("road"))
    return bool(result_tokens and source_tokens == result_tokens)


ROAD_STOP = {
    "street", "st", "road", "rd", "avenue", "ave", "boulevard", "blvd", "drive", "dr",
    "lane", "ln", "place", "pl", "highway", "hwy", "route", "rue", "via", "strasse",
    "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest",
    "ne", "nw", "se", "sw", "the", "de", "la", "le", "of",
}


def word_tokens(value):
    text = unicodedata.normalize("NFKD", clean(value)).encode("ascii", "ignore").decode("ascii").lower()
    return [token for token in re.findall(r"[a-z0-9]+", text) if token not in ROAD_STOP]


def road_consistent(source_address, result):
    road = clean((result.get("address") or {}).get("road"))
    result_tokens = word_tokens(road)
    source_tokens = set(word_tokens(source_address))
    if not road or not result_tokens or not source_tokens:
        return False
    overlap = sum(token in source_tokens for token in result_tokens) / len(result_tokens)
    source_compact = "".join(word_tokens(source_address))
    road_compact = "".join(result_tokens)
    similarity = difflib.SequenceMatcher(None, road_compact, source_compact).ratio()
    return overlap >= 0.67 or similarity >= 0.72


def source_postcodes(value):
    text = clean(value).upper()
    patterns = (
        r"\b\d{5}(?:-\d{4})?\b",
        r"\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b",
        r"\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b",
    )
    return {re.sub(r"\s+", "", match) for pattern in patterns for match in re.findall(pattern, text)}


def postcode_consistent(source_address, result):
    expected = source_postcodes(source_address)
    if not expected:
        return True
    actual = re.sub(r"\s+", "", clean((result.get("address") or {}).get("postcode")).upper())
    return bool(actual and any(actual == code or actual.startswith(code) or code.startswith(actual) for code in expected))


COUNTRY_TEXT_PATTERNS = {
    "US": r"\b(?:USA|U\.?S\.?A?\.?|UNITED STATES)\b",
    "CA": r"\bCANADA\b", "GB": r"\b(?:UK|UNITED KINGDOM|ENGLAND)\b",
    "DE": r"\bGERMANY\b", "FR": r"\bFRANCE\b", "BE": r"\bBELGIUM\b",
    "IT": r"\bITALY\b", "ES": r"\bSPAIN\b", "AT": r"\bAUSTRIA\b",
    "NL": r"\b(?:NETHERLANDS|HOLLAND)\b", "PL": r"\bPOLAND\b",
    "CZ": r"\b(?:CZECHIA|CZECH REPUBLIC)\b", "JP": r"\bJAPAN\b", "GU": r"\bGUAM\b",
}
US_STATE_CODES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split()
CA_PROVINCE_CODES = "AB BC MB NB NL NS NT NU ON PE QC SK YT".split()


def source_country_codes(row):
    raw_country = clean(row.get("country_code")).upper()
    if raw_country in ISO3_BY_ALPHA2:
        return {raw_country}
    alpha3_to_alpha2 = {alpha3: alpha2 for alpha2, alpha3 in ISO3_BY_ALPHA2.items()}
    if raw_country in alpha3_to_alpha2:
        return {alpha3_to_alpha2[raw_country]}
    codes = set()
    text = " ".join((raw_country, clean(row.get("address_text")))).upper()
    codes.update(code for code, pattern in COUNTRY_TEXT_PATTERNS.items() if re.search(pattern, text, re.I))
    if re.search(r",\s*(?:" + "|".join(US_STATE_CODES) + r")\b", text):
        codes.add("US")
    if re.search(r",\s*(?:" + "|".join(CA_PROVINCE_CODES) + r")\b", text):
        codes.add("CA")
    if re.search(r"\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b", text):
        codes.add("CA")
    if re.search(r"\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b", text):
        codes.add("GB")
    return codes


def source_country_consistent(row, alpha2):
    expected = source_country_codes(row)
    return not expected or alpha2 in expected


CITY_CANONICAL = {
    "frankfurtammain": "frankfurt", "frankfurt": "frankfurt",
    "washingtondc": "washington", "washington": "washington",
    "newyorkcity": "newyork", "newyork": "newyork",
    "stlouis": "saintlouis", "saintlouis": "saintlouis",
}


def canonical_city(value):
    key = fold(CITY_ALIASES.get(clean(value), clean(value)))
    return CITY_CANONICAL.get(key, key)


def expected_city(row):
    raw = clean(row.get("city"))
    if not raw or raw in NON_CITY_LABELS or PLACEHOLDER_RE.search(raw):
        return ""
    return CITY_ALIASES.get(raw, raw) if re.search(r"[A-Za-z]", CITY_ALIASES.get(raw, raw)) else ""


def city_component_in_source(source_address, actual_city):
    target = canonical_city(actual_city)
    return bool(target and any(canonical_city(part) == target for part in clean(source_address).split(",")))


def city_consistent(row, result):
    expected = expected_city(row)
    actual = address_city(result.get("address") or {})
    if not actual:
        return False
    if not expected:
        return city_component_in_source(row.get("address_text"), actual)
    return canonical_city(expected) == canonical_city(actual)


def build_query(row):
    address = clean(row.get("address_text"))
    city = expected_city(row)
    if not address or PLACEHOLDER_RE.search(address):
        return ""
    query = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", address)
    query = re.sub(r"(?<=[A-Za-z])(?=Street\b)", " ", query, flags=re.I)
    if city and fold(city) not in fold(query):
        query = f"{query}, {city}"
    return clean(query)


def iso_country(alpha2, fallback_name=""):
    code = clean(alpha2).upper()
    if not code:
        return clean(fallback_name) or None, None, None
    return clean(fallback_name) or ("Kosovo" if code == "XK" else None), code, ISO3_BY_ALPHA2.get(code)


def region_consistent(region, alpha2):
    if not alpha2 or region == "글로벌":
        return True
    allowed = REGION_COUNTRIES.get(region)
    return not allowed or alpha2 in allowed


def address_city(address):
    for key in ("city", "town", "municipality", "village", "borough", "city_district"):
        if clean(address.get(key)):
            return clean(address[key])
    return clean(address.get("county")) or None


def precision_for(result, source_address):
    address = result.get("address") or {}
    result_class = clean(result.get("class")).lower()
    result_type = clean(result.get("type")).lower()
    source_numbers = source_house_numbers(source_address)
    matched_house = normalize_house_number(address.get("house_number"))
    if matched_house and matched_house in source_numbers:
        return "address_point"
    if result_class in {"building", "amenity", "office", "tourism", "shop"} or result_type in {
        "building", "office", "hotel", "apartments", "commercial", "warehouse", "hospital",
        "university", "residential", "house",
    }:
        return "building"
    if result_class == "highway" or result_type in {"road", "street", "tertiary", "secondary", "residential"}:
        return "street"
    if result_type in {"suburb", "neighbourhood", "quarter", "district", "county", "borough"}:
        return "district"
    if result_type in {"city", "town", "village", "municipality"}:
        return "city"
    if result_type in {"state", "province", "region"}:
        return "region"
    if result_type == "country" or result_class == "boundary" and clean(address.get("country")) and len(address) <= 3:
        return "country"
    return "unknown"


def confidence_for(result, precision, query, region):
    base = {
        "address_point": 0.97,
        "building": 0.91,
        "street": 0.78,
        "district": 0.68,
        "city": 0.62,
        "region": 0.48,
        "country": 0.35,
        "unknown": 0.40,
    }[precision]
    address = result.get("address") or {}
    alpha2 = clean(address.get("country_code")).upper()
    if not region_consistent(region, alpha2):
        base -= 0.30
    postcode = clean(address.get("postcode"))
    if postcode and fold(postcode) in fold(query):
        base += 0.02
    return round(max(0.0, min(1.0, base)), 2)


def candidate_score(result, query, row):
    precision = precision_for(result, query)
    confidence = confidence_for(result, precision, query, row.get("portfolio_region"))
    alpha2 = clean((result.get("address") or {}).get("country_code")).upper()
    country_ok = region_consistent(row.get("portfolio_region"), alpha2)
    source_country_ok = source_country_consistent(row, alpha2)
    city_ok = city_consistent(row, result)
    direction_ok = directional_consistent(row.get("address_text"), result)
    road_ok = road_consistent(row.get("address_text"), result)
    postcode_ok = postcode_consistent(row.get("address_text"), result)
    return (country_ok, source_country_ok, city_ok, direction_ok, postcode_ok, road_ok, PRECISION_RANK[precision], confidence, float(result.get("importance") or 0))


def load_cache():
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text(encoding="utf-8"))


def save_cache(cache):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(cache, ensure_ascii=False, indent=2)
    if CACHE_PATH.exists() and CACHE_PATH.read_text(encoding="utf-8") == payload:
        return False
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(payload, encoding="utf-8")
    return True


def request_json(session, endpoint, params, attempts=3):
    for attempt in range(attempts):
        response = session.get(endpoint, params=params, timeout=45)
        if response.status_code == 200:
            return response.json()
        if response.status_code not in (429, 500, 502, 503, 504):
            response.raise_for_status()
        time.sleep(2 ** attempt)
    response.raise_for_status()


def photon_results(payload):
    converted = []
    for feature in payload.get("features") or []:
        props = feature.get("properties") or {}
        coordinates = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coordinates) < 2:
            continue
        address = {
            "house_number": props.get("housenumber"), "road": props.get("street"),
            "city": props.get("city"), "town": props.get("town"), "village": props.get("village"),
            "county": props.get("county"), "state": props.get("state"), "postcode": props.get("postcode"),
            "country": props.get("country"), "country_code": clean(props.get("countrycode")).lower(),
        }
        converted.append({
            "lat": coordinates[1], "lon": coordinates[0], "address": address,
            "display_name": ", ".join(clean(props.get(key)) for key in ("name", "street", "city", "state", "country") if clean(props.get(key))),
            "place_id": props.get("osm_id"), "osm_id": props.get("osm_id"), "osm_type": props.get("osm_type"),
            "class": props.get("osm_key"), "type": props.get("osm_value"), "importance": props.get("importance") or 0,
            "licence": "© OpenStreetMap contributors; Photon by Komoot", "_provider": "photon_openstreetmap",
        })
    return converted


def existing_record(row):
    existing = row.get("existing_location") or {}
    if not existing:
        return None
    keep = {
        "asset_id", "asset_code", "canonical_name", "portfolio_region", "location_subject_type",
        "raw_country", "raw_city", "raw_address", "normalized_country_name", "country_code_alpha2",
        "country_code_alpha3", "normalized_city", "normalized_admin1", "normalized_postcode", "latitude",
        "longitude", "coordinate_source", "coordinate_precision", "match_method", "confidence",
        "review_status", "is_map_eligible", "review_note", "source_system", "source_record_id",
        "geocoder_place_id", "classifier_version", "geocoder_version", "candidate_fingerprint",
        "evidence", "normalized_at",
    }
    record = {key: existing.get(key) for key in keep}
    record.update({
        "asset_id": row["asset_id"],
        "asset_code": clean(row.get("asset_code")) or existing.get("asset_code"),
        "canonical_name": clean(row.get("canonical_name")) or existing.get("canonical_name"),
        "portfolio_region": clean(row.get("portfolio_region")) or existing.get("portfolio_region"),
    })
    return record


def geocode_rows(rows, geocode=True, limit=None, refresh_existing=False):
    cache = load_cache()
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en"})
    uncached_calls = 0
    candidates = [row for row in rows if location_subject_type(row)[0] == "single_site"]
    if limit is not None:
        candidates = candidates[:limit]
    candidate_ids = {row["asset_id"] for row in candidates}
    results = []
    last_call = 0.0
    for source_row in rows:
        persisted = existing_record(source_row)
        if persisted and not refresh_existing:
            results.append(persisted)
            continue
        row = dict(source_row)
        if persisted and refresh_existing:
            row["country_code"] = persisted.get("raw_country")
            row["city"] = persisted.get("raw_city")
            row["address_text"] = persisted.get("raw_address")
            if clean(row.get("geocode_source")) in {"nominatim_openstreetmap", "photon_openstreetmap"}:
                row["latitude"] = None
                row["longitude"] = None
        subject_type, subject_reason = location_subject_type(row)
        query = build_query(row)
        geocoder_result = None
        match_method = subject_reason
        if subject_type == "single_site" and row["asset_id"] in candidate_ids:
            if valid_coordinate(row.get("latitude"), row.get("longitude")):
                cache_key = f"reverse:{float(row['latitude']):.7f},{float(row['longitude']):.7f}"
                if geocode and cache_key not in cache:
                    wait = max(0, 1.05 - (time.monotonic() - last_call))
                    if wait:
                        time.sleep(wait)
                    cache[cache_key] = request_json(
                        session,
                        "https://nominatim.openstreetmap.org/reverse",
                        {"lat": row["latitude"], "lon": row["longitude"], "format": "jsonv2", "addressdetails": 1, "namedetails": 1},
                    )
                    last_call = time.monotonic()
                    uncached_calls += 1
                    save_cache(cache)
                geocoder_result = cache.get(cache_key)
                match_method = "existing_coordinate_reverse_check"
            elif query:
                cache_key = f"search:{fold(query)}"
                if geocode and cache_key not in cache:
                    wait = max(0, 1.05 - (time.monotonic() - last_call))
                    if wait:
                        time.sleep(wait)
                    cache[cache_key] = request_json(
                        session,
                        "https://nominatim.openstreetmap.org/search",
                        {"q": query, "format": "jsonv2", "addressdetails": 1, "namedetails": 1, "limit": 5},
                    )
                    last_call = time.monotonic()
                    uncached_calls += 1
                    save_cache(cache)
                found = cache.get(cache_key) or []
                if found:
                    geocoder_result = sorted(found, key=lambda x: candidate_score(x, query, row), reverse=True)[0]
                    match_method = "nominatim_address_search"
                else:
                    photon_key = PHOTON_CACHE_PREFIX + fold(query)
                    if geocode and photon_key not in cache:
                        wait = max(0, 1.05 - (time.monotonic() - last_call))
                        if wait:
                            time.sleep(wait)
                        cache[photon_key] = request_json(
                            session,
                            "https://photon.komoot.io/api/",
                            {"q": query, "limit": 5, "lang": "en"},
                        )
                        last_call = time.monotonic()
                        uncached_calls += 1
                        save_cache(cache)
                    photon_found = photon_results(cache.get(photon_key) or {})
                    if photon_found:
                        geocoder_result = sorted(photon_found, key=lambda x: candidate_score(x, query, row), reverse=True)[0]
                        match_method = "photon_address_search"
        record = normalized_record(row, subject_type, query, geocoder_result, match_method)
        if persisted and persisted.get("review_status") in {"manually_verified", "manually_rejected"}:
            for key in (
                "normalized_country_name", "country_code_alpha2", "country_code_alpha3", "normalized_city",
                "normalized_admin1", "normalized_postcode", "latitude", "longitude", "coordinate_source",
                "coordinate_precision", "match_method", "confidence", "review_status", "is_map_eligible",
                "review_note", "source_system", "source_record_id", "geocoder_place_id", "classifier_version",
                "geocoder_version", "candidate_fingerprint", "evidence", "normalized_at",
            ):
                if key in persisted and persisted[key] is not None:
                    record[key] = persisted[key]
            record["review_status"] = persisted["review_status"]
            record["is_map_eligible"] = bool(persisted.get("is_map_eligible"))
            record["review_note"] = persisted.get("review_note")
            record["classifier_version"] = persisted.get("classifier_version") or "manual-review-v1"
            record["geocoder_version"] = persisted.get("geocoder_version") or "manual-review"
            record["candidate_fingerprint"] = persisted.get("candidate_fingerprint") or terminal_fingerprint(row, record)
        results.append(record)
    save_cache(cache)
    return results, uncached_calls


def candidate_fingerprint(row, result, match_method):
    payload = {
        "asset_id": row.get("asset_id"),
        "raw_country": raw_value(row.get("country_code")),
        "raw_city": raw_value(row.get("city")),
        "raw_address": raw_value(row.get("address_text")),
        "match_method": match_method,
        "result": result or None,
        "classifier_version": CLASSIFIER_VERSION,
        "geocoder_version": GEOCODER_VERSION,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def terminal_fingerprint(row, record):
    payload = {
        "asset_id": row.get("asset_id"), "review_status": record.get("review_status"),
        "country_code_alpha2": record.get("country_code_alpha2"), "normalized_city": record.get("normalized_city"),
        "latitude": record.get("latitude"), "longitude": record.get("longitude"),
        "coordinate_source": record.get("coordinate_source"), "review_note": record.get("review_note"),
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def normalized_record(row, subject_type, query, result, match_method):
    now = datetime.now(timezone.utc).isoformat()
    source_address = clean(row.get("address_text")) or None
    if not result:
        status = "not_single_site" if subject_type in {"multi_site_portfolio", "non_physical_vehicle"} else "unresolved"
        return {
            "asset_id": row["asset_id"], "asset_code": clean(row.get("asset_code")) or None,
            "canonical_name": clean(row.get("canonical_name")), "portfolio_region": clean(row.get("portfolio_region")) or None,
            "location_subject_type": subject_type, "raw_country": raw_value(row.get("country_code")),
            "raw_city": raw_value(row.get("city")), "raw_address": raw_value(row.get("address_text")),
            "normalized_country_name": None, "country_code_alpha2": None, "country_code_alpha3": None,
            "normalized_city": None, "normalized_admin1": None, "normalized_postcode": None,
            "latitude": None, "longitude": None, "coordinate_source": None, "coordinate_precision": "unknown",
            "match_method": match_method, "confidence": 0.0, "review_status": status, "is_map_eligible": False,
            "review_note": "단일 물리자산 위치가 아니거나 특정 위치 근거가 부족함",
            "source_system": clean(row.get("representative_source")) or "asset_master",
            "source_record_id": clean(row.get("asset_code")) or row["asset_id"], "geocoder_place_id": None,
            "classifier_version": CLASSIFIER_VERSION, "geocoder_version": GEOCODER_VERSION,
            "candidate_fingerprint": candidate_fingerprint(row, None, match_method),
            "evidence": {"query": query or None, "source_metadata": row.get("metadata") or {}, "raw_asset_kind": row.get("asset_kind")},
            "normalized_at": now,
        }
    address = result.get("address") or {}
    country_name, alpha2, alpha3 = iso_country(address.get("country_code"), address.get("country"))
    lat, lon = float(result["lat"]), float(result["lon"])
    if re.search(r"괌|\bguam\b", clean(row.get("address_text")), re.I) and 13.0 <= lat <= 14.0 and 144.0 <= lon <= 145.5:
        country_name, alpha2, alpha3 = "Guam", "GU", "GUM"
    precision = precision_for(result, source_address or query)
    confidence = confidence_for(result, precision, source_address or query, row.get("portfolio_region"))
    consistent = region_consistent(clean(row.get("portfolio_region")), alpha2)
    source_country_ok = source_country_consistent(row, alpha2)
    expected_city_value = expected_city(row)
    actual_city_value = address_city(address)
    actual_city_in_source = city_component_in_source(source_address, actual_city_value)
    source_geography_evidence = bool(expected_city_value or source_country_codes(row) or actual_city_in_source)
    city_ok = city_consistent(row, result)
    direction_ok = directional_consistent(source_address, result)
    road_ok = road_consistent(source_address, result)
    postcode_ok = postcode_consistent(source_address, result)
    specific_source = source_has_street_number(source_address)
    existing_coordinate_check = match_method == "existing_coordinate_reverse_check"
    trusted_existing_coordinate = clean(row.get("geocode_source")) in TRUSTED_EXISTING_COORDINATE_SOURCES
    partial_coordinate = (row.get("latitude") is None) != (row.get("longitude") is None)
    existing_region_conflict = existing_coordinate_check and clean(row.get("portfolio_region")) != "글로벌" and not consistent
    auto = (
        subject_type == "single_site"
        and precision == "address_point"
        and confidence >= 0.90
        and bool(alpha2)
        and bool(alpha3)
        and bool(address_city(address))
        and consistent
        and source_country_ok
        and source_geography_evidence
        and city_ok
        and direction_ok
        and road_ok
        and postcode_ok
        and specific_source
        and not partial_coordinate
        and (not existing_coordinate_check or trusted_existing_coordinate)
        and not existing_region_conflict
    )
    status = "auto_verified" if auto else "review_required"
    note_parts = []
    if not alpha3:
        note_parts.append("ISO alpha-3 국가코드 미확정")
    if not consistent:
        note_parts.append("포트폴리오 권역과 지오코딩 국가 불일치")
    if not source_country_ok:
        note_parts.append("원 주소 국가 근거와 지오코딩 국가 불일치")
    if not source_geography_evidence:
        note_parts.append("원문 도시 또는 국가 근거 부족")
    if not city_ok:
        note_parts.append(f"원문 도시({expected_city_value})와 결과 도시({address_city(address)}) 불일치")
    if not direction_ok:
        note_parts.append("원 주소와 결과 도로 방향(NE/NW/SE/SW) 불일치")
    if not road_ok:
        note_parts.append("원 주소와 결과 도로명 불일치 또는 도로명 근거 없음")
    if not postcode_ok:
        note_parts.append("원 주소와 결과 우편번호 불일치")
    if not specific_source:
        note_parts.append("원 주소에 개별 부동산 번지 근거 없음")
    if partial_coordinate:
        note_parts.append("기존 위도·경도 중 한 값만 존재하여 자동 승격 금지")
    if existing_coordinate_check and not trusted_existing_coordinate:
        note_parts.append("기존 좌표 출처가 수동검증·권위원천으로 확인되지 않음")
    if precision not in {"address_point", "building"}:
        note_parts.append(f"좌표 정밀도 {precision} 수동검토")
    if clean(row.get("portfolio_region")) == "글로벌" and alpha2 == "KR":
        note_parts.append("글로벌 권역 내 국내 좌표 확인 필요")
        auto = False
        status = "review_required"
    return {
        "asset_id": row["asset_id"], "asset_code": clean(row.get("asset_code")) or None,
        "canonical_name": clean(row.get("canonical_name")), "portfolio_region": clean(row.get("portfolio_region")) or None,
        "location_subject_type": subject_type, "raw_country": raw_value(row.get("country_code")),
        "raw_city": raw_value(row.get("city")), "raw_address": raw_value(row.get("address_text")),
        "normalized_country_name": country_name, "country_code_alpha2": alpha2, "country_code_alpha3": alpha3,
        "normalized_city": address_city(address), "normalized_admin1": clean(address.get("state")) or None,
        "normalized_postcode": clean(address.get("postcode")) or None, "latitude": lat, "longitude": lon,
        "coordinate_source": (
            clean(row.get("geocode_source")) or "asset_master_existing_coordinate"
            if match_method == "existing_coordinate_reverse_check"
            else clean(result.get("_provider")) or "nominatim_openstreetmap"
        ),
        "coordinate_precision": precision, "match_method": match_method, "confidence": confidence,
        "review_status": status, "is_map_eligible": bool(auto),
        "review_note": "; ".join(note_parts) or None,
        "source_system": clean(row.get("representative_source")) or "asset_master",
        "source_record_id": clean(row.get("asset_code")) or row["asset_id"],
        "geocoder_place_id": clean(result.get("place_id")) or None,
        "classifier_version": CLASSIFIER_VERSION, "geocoder_version": GEOCODER_VERSION,
        "candidate_fingerprint": candidate_fingerprint(row, result, match_method),
        "evidence": {
            "query": query or None, "display_name": result.get("display_name"), "osm_type": result.get("osm_type"),
            "osm_id": result.get("osm_id"), "result_class": result.get("class"), "result_type": result.get("type"),
            "importance": result.get("importance"), "licence": result.get("licence"),
            "portfolio_region_consistent": consistent, "source_country_consistent": source_country_ok,
            "source_geography_evidence": source_geography_evidence, "city_consistent": city_ok,
            "direction_consistent": direction_ok, "road_consistent": road_ok,
            "postcode_consistent": postcode_ok, "partial_existing_coordinate": partial_coordinate,
            "trusted_existing_coordinate": trusted_existing_coordinate,
            "source_metadata": row.get("metadata") or {},
        },
        "normalized_at": now,
    }


def fetch_assets():
    region_sql = ",".join("'" + region.replace("'", "''") + "'" for region in REGIONS)
    exists = bool(management_sql("select to_regclass('public.asset_location_normalization') is not null as exists")[0]["exists"])
    existing_select = ", to_jsonb(location) as existing_location" if exists else ""
    existing_join = "left join public.asset_location_normalization location using (asset_id)" if exists else ""
    query = f"""
      select asset.asset_id, asset.asset_code, asset.canonical_name, asset.asset_type, asset.asset_kind, asset.is_physical,
             asset.country_code, asset.city, asset.address_text, asset.latitude, asset.longitude, asset.geocode_source,
             asset.portfolio_region, asset.business_stage, asset.representative_source, asset.representative_fund_id,
             asset.review_status, asset.metadata{existing_select}
      from public.asset_master asset
      {existing_join}
      where asset.is_physical is true
        and asset.asset_kind = 'physical_asset'
        and asset.portfolio_region in ({region_sql})
      order by asset.portfolio_region, asset.canonical_name, asset.asset_id
    """
    return management_sql(query)


def write_csv(path, rows):
    fields = [
        "asset_id", "asset_code", "canonical_name", "portfolio_region", "location_subject_type",
        "raw_country", "raw_city", "raw_address", "normalized_country_name", "country_code_alpha2",
        "country_code_alpha3", "normalized_city", "normalized_admin1", "normalized_postcode",
        "latitude", "longitude", "coordinate_source", "coordinate_precision", "match_method",
        "confidence", "review_status", "is_map_eligible", "review_note", "source_system", "source_record_id",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader(); writer.writerows(rows)


def sql_literal(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        return "'" + text.replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def upsert_sql(rows):
    if not rows:
        raise ValueError("manifest rows must not be empty")
    columns = [
        "asset_id", "asset_code", "canonical_name", "portfolio_region", "location_subject_type",
        "raw_country", "raw_city", "raw_address", "normalized_country_name", "country_code_alpha2",
        "country_code_alpha3", "normalized_city", "normalized_admin1", "normalized_postcode", "latitude",
        "longitude", "coordinate_source", "coordinate_precision", "match_method", "confidence",
        "review_status", "is_map_eligible", "review_note", "source_system", "source_record_id",
        "geocoder_place_id", "classifier_version", "geocoder_version", "candidate_fingerprint",
        "evidence", "normalized_at",
    ]
    values = ["(" + ",".join(sql_literal(row.get(col)) for col in columns) + ")" for row in rows]
    run_ids = ",".join("(" + sql_literal(row["asset_id"]) + ")" for row in rows)
    lineage_values = ",".join(
        f"({sql_literal(row['asset_id'])},{sql_literal(row.get('classifier_version'))},"
        f"{sql_literal(row.get('geocoder_version'))},{sql_literal(row.get('candidate_fingerprint'))})"
        for row in rows
    )
    immutable_raw = {"asset_id", "raw_country", "raw_city", "raw_address"}
    mutable_columns = [col for col in columns if col not in immutable_raw]
    updates = ",\n".join(f"{col}=excluded.{col}" for col in mutable_columns)
    change_guard = " or ".join(
        [
            f"public.asset_location_normalization.{col} is distinct from excluded.{col}"
            for col in mutable_columns
        ] + [
            f"(public.asset_location_normalization.{col} is null and excluded.{col} is not null)"
            for col in ("raw_country", "raw_city", "raw_address")
        ]
    )
    eligibility = """
        asset.is_physical is true
        and asset.asset_kind = 'physical_asset'
        and asset.portfolio_region in ('북미','유럽','아시아','글로벌')
    """
    return f"""
      insert into public.asset_location_normalization ({','.join(columns)}) values
      {','.join(values)}
      on conflict (asset_id) do update set
      raw_country=coalesce(public.asset_location_normalization.raw_country, excluded.raw_country),
      raw_city=coalesce(public.asset_location_normalization.raw_city, excluded.raw_city),
      raw_address=coalesce(public.asset_location_normalization.raw_address, excluded.raw_address),
      {updates}, updated_at=now()
      where public.asset_location_normalization.review_status not in ('manually_verified','manually_rejected')
        and ({change_guard});

      -- Preserve terminal manual decisions while backfilling only missing lineage.
      with current_lineage(asset_id,classifier_version,geocoder_version,candidate_fingerprint) as (
        values {lineage_values}
      )
      update public.asset_location_normalization location
      set classifier_version=coalesce(location.classifier_version, current.classifier_version),
          geocoder_version=coalesce(location.geocoder_version, current.geocoder_version),
          candidate_fingerprint=coalesce(location.candidate_fingerprint, current.candidate_fingerprint),
          updated_at=case when location.classifier_version is null or location.geocoder_version is null or location.candidate_fingerprint is null then now() else location.updated_at end
      from current_lineage current
      where location.asset_id=current.asset_id
        and location.review_status in ('manually_verified','manually_rejected')
        and (location.classifier_version is null or location.geocoder_version is null or location.candidate_fingerprint is null);

      -- Revert only coordinates previously written by this automated pipeline when
      -- the current reviewed manifest no longer considers them map eligible.
      with current_run(asset_id) as (values {run_ids})
      update public.asset_master asset
      set country_code = location.raw_country,
          city = location.raw_city,
          latitude = null,
          longitude = null,
          geocode_source = null,
          api_enrichment_status = 'not_found',
          metadata = coalesce(asset.metadata, '{{}}'::jsonb) - 'global_location_normalization',
          updated_at = now()
      from public.asset_location_normalization location
      join current_run run using (asset_id)
      where asset.asset_id = location.asset_id
        and {eligibility}
        and location.is_map_eligible is false
        and asset.geocode_source in ('nominatim_openstreetmap','photon_openstreetmap')
        and asset.metadata ? 'global_location_normalization';

      with current_run(asset_id) as (values {run_ids})
      update public.asset_master asset
      set country_code = location.country_code_alpha2,
          city = coalesce(location.normalized_city, asset.city),
          latitude = case when asset.latitude is null and asset.longitude is null then location.latitude else asset.latitude end,
          longitude = case when asset.latitude is null and asset.longitude is null then location.longitude else asset.longitude end,
          geocode_source = case when asset.latitude is null and asset.longitude is null then location.coordinate_source else asset.geocode_source end,
          source_confidence = greatest(coalesce(asset.source_confidence, 0), location.confidence),
          api_enrichment_status = 'found',
          last_api_enriched_at = now(),
          metadata = coalesce(asset.metadata, '{{}}'::jsonb) || jsonb_build_object(
            'global_location_normalization', jsonb_build_object(
              'country_code', location.country_code_alpha2,
              'city', location.normalized_city,
              'coordinate_precision', location.coordinate_precision,
              'confidence', location.confidence,
              'source', location.coordinate_source,
              'candidate_fingerprint', location.candidate_fingerprint,
              'classifier_version', location.classifier_version,
              'geocoder_version', location.geocoder_version,
              'normalized_at', location.normalized_at
            )
          ),
          updated_at = now()
      from public.asset_location_normalization location
      join current_run run using (asset_id)
      where asset.asset_id = location.asset_id
        and {eligibility}
        and location.review_status in ('auto_verified','manually_verified')
        and location.is_map_eligible is true
        and ((asset.latitude is null and asset.longitude is null) or (asset.latitude is not null and asset.longitude is not null))
        and (
          asset.country_code is distinct from location.country_code_alpha2
          or asset.city is distinct from coalesce(location.normalized_city, asset.city)
          or (asset.latitude is null and asset.longitude is null and location.latitude is not null and location.longitude is not null)
          or asset.source_confidence is distinct from greatest(coalesce(asset.source_confidence, 0), location.confidence)
          or asset.api_enrichment_status is distinct from 'found'
          or asset.metadata->'global_location_normalization' is distinct from jsonb_build_object(
            'country_code', location.country_code_alpha2,
            'city', location.normalized_city,
            'coordinate_precision', location.coordinate_precision,
            'confidence', location.confidence,
            'source', location.coordinate_source,
            'candidate_fingerprint', location.candidate_fingerprint,
            'classifier_version', location.classifier_version,
            'geocoder_version', location.geocoder_version,
            'normalized_at', location.normalized_at
          )
        );
    """


def summarize(rows, uncached_calls):
    providers = sorted({clean(row.get("coordinate_source")) for row in rows if clean(row.get("coordinate_source"))})
    return {
        "target_rows": len(rows),
        "subjects": dict(Counter(row["location_subject_type"] for row in rows)),
        "review_status": dict(Counter(row["review_status"] for row in rows)),
        "coordinate_precision": dict(Counter(row["coordinate_precision"] for row in rows)),
        "countries": dict(Counter(row["country_code_alpha2"] or "unresolved" for row in rows)),
        "map_eligible": sum(bool(row["is_map_eligible"]) for row in rows),
        "expected_auto_verified": sum(row["review_status"] == "auto_verified" and bool(row["is_map_eligible"]) for row in rows),
        "coordinate_candidates": sum(valid_coordinate(row.get("latitude"), row.get("longitude")) for row in rows),
        "uncached_geocoder_calls": uncached_calls,
        "coordinate_sources": providers,
        "attribution": "© OpenStreetMap contributors; Nominatim and Photon geocoding",
    }


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def manifest_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def write_manifest(path, rows, summary, generated_at):
    payload = {
        "manifest_version": 1,
        "generated_at": generated_at,
        "classifier_version": CLASSIFIER_VERSION,
        "geocoder_version": GEOCODER_VERSION,
        "pipeline_sha256": file_sha256(Path(__file__)),
        "migration_sha256": file_sha256(MIGRATION_PATH),
        "row_count": len(rows),
        "expected_auto_verified": sum(row["review_status"] == "auto_verified" and bool(row.get("is_map_eligible")) for row in rows),
        "summary": summary,
        "rows": rows,
    }
    content = manifest_bytes(payload)
    path.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def load_verified_manifest(path, expected_hash, expected_auto):
    content = Path(path).read_bytes()
    actual_hash = hashlib.sha256(content).hexdigest()
    if not expected_hash or actual_hash.lower() != expected_hash.lower():
        raise ValueError(f"manifest SHA-256 mismatch: actual={actual_hash}")
    payload = json.loads(content.decode("utf-8"))
    rows = payload.get("rows") or []
    if payload.get("manifest_version") != 1 or payload.get("classifier_version") != CLASSIFIER_VERSION:
        raise ValueError("unsupported or stale manifest version")
    if payload.get("pipeline_sha256") != file_sha256(Path(__file__)) or payload.get("migration_sha256") != file_sha256(MIGRATION_PATH):
        raise ValueError("manifest was generated by a different pipeline or migration revision")
    if len(rows) != payload.get("row_count") or len({row.get("asset_id") for row in rows}) != len(rows):
        raise ValueError("manifest row count or asset IDs are invalid")
    actual_auto = sum(row.get("review_status") == "auto_verified" and bool(row.get("is_map_eligible")) for row in rows)
    if expected_auto is None or actual_auto != expected_auto or actual_auto != payload.get("expected_auto_verified"):
        raise ValueError(f"expected auto count mismatch: actual={actual_auto}")
    if any(not row.get("candidate_fingerprint") for row in rows):
        raise ValueError("manifest contains rows without candidate fingerprints")
    return payload, actual_hash


def postcondition_sql(rows, expected_auto):
    ids = ",".join(sql_literal(row["asset_id"]) for row in rows)
    id_values = ",".join(f"({sql_literal(row['asset_id'])})" for row in rows)
    fingerprints = ",".join(
        f"({sql_literal(row['asset_id'])},{sql_literal(row['candidate_fingerprint'])})" for row in rows
    )
    return f"""
      do $$
      declare scoped_count integer; eligible_count integer; current_target_count integer; invalid_count integer; fingerprint_mismatch integer; population_mismatch integer;
      begin
        select count(*) into scoped_count from public.asset_location_normalization where asset_id in ({ids});
        if scoped_count <> {len(rows)} then raise exception 'normalization scoped count mismatch: %', scoped_count; end if;
        select count(*) into eligible_count from public.asset_location_normalization
          where asset_id in ({ids}) and review_status = 'auto_verified' and is_map_eligible is true;
        if eligible_count <> {expected_auto} then raise exception 'eligible count mismatch: %', eligible_count; end if;
        select count(*) into current_target_count from public.asset_master
          where is_physical is true and asset_kind='physical_asset'
            and portfolio_region in ('북미','유럽','아시아','글로벌');
        if current_target_count <> {len(rows)} then raise exception 'source population changed: %', current_target_count; end if;
        select count(*) into population_mismatch from (
          (select asset_id from public.asset_master
            where is_physical is true and asset_kind='physical_asset'
              and portfolio_region in ('북미','유럽','아시아','글로벌')
           except select asset_id from (values {id_values}) manifest(asset_id))
          union all
          (select asset_id from (values {id_values}) manifest(asset_id)
           except select asset_id from public.asset_master
            where is_physical is true and asset_kind='physical_asset'
              and portfolio_region in ('북미','유럽','아시아','글로벌'))
        ) delta;
        if population_mismatch <> 0 then raise exception 'source population members changed: %', population_mismatch; end if;
        select count(*) into invalid_count from public.asset_location_normalization
          where asset_id in ({ids}) and is_map_eligible is true and (
            location_subject_type <> 'single_site' or review_status not in ('auto_verified','manually_verified')
            or latitude is null or longitude is null or country_code_alpha2 is null or country_code_alpha3 is null
          );
        if invalid_count <> 0 then raise exception 'invalid map rows: %', invalid_count; end if;
        select count(*) into fingerprint_mismatch
          from (values {fingerprints}) expected(asset_id, candidate_fingerprint)
          join public.asset_location_normalization actual using (asset_id)
          where actual.review_status not in ('manually_verified','manually_rejected')
            and actual.candidate_fingerprint is distinct from expected.candidate_fingerprint;
        if fingerprint_mismatch <> 0 then raise exception 'candidate fingerprint mismatch: %', fingerprint_mismatch; end if;
      end $$;
    """


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-geocode", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--refresh-existing", action="store_true")
    parser.add_argument("--apply", action="store_true", help="disabled unsafe legacy mode")
    parser.add_argument("--rehearse", action="store_true", help="disabled unsafe legacy mode")
    parser.add_argument("--apply-manifest")
    parser.add_argument("--rehearse-manifest")
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--expected-auto", type=int)
    args = parser.parse_args()
    if args.apply or args.rehearse:
        parser.error("direct --apply/--rehearse is disabled; generate then use --rehearse-manifest or --apply-manifest with hash and expected count")
    manifest_action = args.apply_manifest or args.rehearse_manifest
    if args.apply_manifest and args.rehearse_manifest:
        parser.error("choose exactly one manifest action")
    if manifest_action:
        if args.limit is not None:
            parser.error("--limit cannot be used with manifest rehearsal/apply")
        payload, actual_hash = load_verified_manifest(manifest_action, args.manifest_sha256, args.expected_auto)
        rows = payload["rows"]
        migration = MIGRATION_PATH.read_text(encoding="utf-8")
        data_sql = upsert_sql(rows)
        assertions = postcondition_sql(rows, args.expected_auto)
        if args.rehearse_manifest:
            management_sql("begin;\n" + migration + "\n" + data_sql + "\n" + assertions + "\nrollback;")
            print(json.dumps({"rehearsal": "passed", "manifest_sha256": actual_hash, "rows": len(rows), "auto_verified": args.expected_auto}, ensure_ascii=False, indent=2))
        else:
            management_sql("begin;\n" + migration + "\n" + data_sql + "\n" + assertions + "\ncommit;")
            print(json.dumps({"apply": "passed", "manifest_sha256": actual_hash, "rows": len(rows), "auto_verified": args.expected_auto}, ensure_ascii=False, indent=2))
        return

    assets = fetch_assets()
    rows, calls = geocode_rows(
        assets,
        geocode=not args.no_geocode,
        limit=args.limit,
        refresh_existing=args.refresh_existing,
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    full_path = OUTPUT_DIR / f"overseas_asset_location_normalized_{stamp}.csv"
    review_path = OUTPUT_DIR / f"overseas_asset_location_review_{stamp}.csv"
    summary_path = OUTPUT_DIR / f"overseas_asset_location_summary_{stamp}.json"
    manifest_path = OUTPUT_DIR / f"overseas_asset_location_manifest_{stamp}.json"
    write_csv(full_path, rows)
    write_csv(review_path, [row for row in rows if row["review_status"] != "auto_verified"])
    write_csv(OUTPUT_DIR / "overseas_asset_location_normalized_current.csv", rows)
    write_csv(OUTPUT_DIR / "overseas_asset_location_review_current.csv", [row for row in rows if row["review_status"] != "auto_verified"])
    summary = summarize(rows, calls)
    summary.update({"full_path": str(full_path), "review_path": str(review_path), "manifest_path": str(manifest_path)})
    manifest_hash = write_manifest(manifest_path, rows, summary, stamp)
    summary["manifest_sha256"] = manifest_hash
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "overseas_asset_location_summary_current.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
