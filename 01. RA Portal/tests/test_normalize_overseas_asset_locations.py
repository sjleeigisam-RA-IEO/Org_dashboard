import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PORTAL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PORTAL_ROOT))
SPEC = importlib.util.spec_from_file_location(
    "normalize_overseas_asset_locations",
    PORTAL_ROOT / "normalize_overseas_asset_locations.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NormalizeOverseasAssetLocationsTests(unittest.TestCase):
    def test_fund_and_loan_are_not_single_sites(self):
        for name in (
            "Brookfield Strategic Real Estate Partners V",
            "EQT Infrastructure VI (No.1) EUR SCSp",
            "Bell 본사(몬트리올) 대출",
            "Washington Square Mezzanine Loan",
            "New York Jackson Park CMBS Loan",
            "Jersey City 65 Bay Street B-Note Loan",
        ):
            with self.subTest(name=name):
                kind, _ = MODULE.location_subject_type({"canonical_name": name})
                self.assertEqual(kind, "non_physical_vehicle")

    def test_multi_site_portfolio_is_not_a_point(self):
        kind, _ = MODULE.location_subject_type(
            {"canonical_name": "Albany, Cleveland, Omaha BTS Logistics", "city": "미국 내 3개 도시"}
        )
        self.assertEqual(kind, "multi_site_portfolio")

    def test_specific_address_is_single_site(self):
        kind, _ = MODULE.location_subject_type(
            {"canonical_name": "Atlanta Office Midtown I", "address_text": "754 Peachtree Street, Atlanta"}
        )
        self.assertEqual(kind, "single_site")

    def test_query_joins_city_and_repairs_joined_street(self):
        query = MODULE.build_query(
            {"address_text": "754 PeachtreeStreet, GA 30308", "city": "Atlanta"}
        )
        self.assertIn("Peachtree Street", query)
        self.assertTrue(query.endswith("Atlanta"))

    def test_house_number_match_is_address_point(self):
        result = {
            "class": "tourism",
            "type": "hotel",
            "address": {"house_number": "7621", "road": "Beach Boulevard"},
        }
        self.assertEqual(MODULE.precision_for(result, "7621 Beach Boulevard"), "address_point")

    def test_road_result_is_not_exact(self):
        result = {"class": "highway", "type": "tertiary", "address": {"road": "Rue La Boétie"}}
        self.assertEqual(MODULE.precision_for(result, "54 Rue La Boétie"), "street")

    def test_region_country_consistency(self):
        self.assertTrue(MODULE.region_consistent("북미", "US"))
        self.assertFalse(MODULE.region_consistent("북미", "FR"))
        self.assertTrue(MODULE.region_consistent("글로벌", "KR"))

    def test_city_mismatch_blocks_candidate(self):
        row = {"city": "뉴욕"}
        result = {"address": {"city": "Arviat"}}
        self.assertFalse(MODULE.city_consistent(row, result))

    def test_city_alias_matches_normalized_city(self):
        row = {"city": "뉴욕"}
        result = {"address": {"city": "New York"}}
        self.assertTrue(MODULE.city_consistent(row, result))

    def test_postcode_or_region_is_not_a_street_number(self):
        self.assertFalse(MODULE.source_has_street_number("A-1030 Vienna, Austria"))
        self.assertFalse(MODULE.source_has_street_number("Lombardy, Milano, Italy"))
        for address in (
            "725 West Peachtree Street, Atlanta", "555 10th Avenue, NY", "810 7th Street NW",
            "Rue Brederode 13, Bruxelles", "2-4-1 Shiba-Koen, Tokyo", "1-1,Gonoe,Uki",
        ):
            with self.subTest(address=address):
                self.assertTrue(MODULE.source_has_street_number(address))

    def test_reverse_state_level_result_cannot_auto_verify(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "New York Asset",
            "portfolio_region": "북미", "country_code": None, "city": "뉴욕",
            "address_text": "555 10th Avenue, New York, NY 10036", "latitude": 40.0, "longitude": -77.0,
            "geocode_source": "geocoding_cache", "representative_source": "asset_master",
        }
        result = {"lat": "40", "lon": "-77", "address": {"state": "Pennsylvania", "country": "United States", "country_code": "us"}, "class": "boundary", "type": "administrative"}
        record = MODULE.normalized_record(row, "single_site", "reverse", result, "existing_coordinate_reverse_check")
        self.assertFalse(record["is_map_eligible"])
        self.assertNotEqual(record["coordinate_precision"], "address_point")

    def test_same_house_number_wrong_road_cannot_auto_verify(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
            "city": "Atlanta", "address_text": "725 West Peachtree Street, Atlanta, GA 30308",
            "representative_source": "asset_master",
        }
        result = {"lat": "33.7", "lon": "-84.3", "address": {"house_number": "725", "road": "Spring Street", "city": "Atlanta", "postcode": "30308", "country": "United States", "country_code": "us"}, "class": "building", "type": "office"}
        record = MODULE.normalized_record(row, "single_site", "query", result, "nominatim_address_search")
        self.assertFalse(record["is_map_eligible"])
        self.assertIn("도로명 불일치", record["review_note"])

    def test_explicit_alpha2_and_alpha3_country_codes_are_authoritative(self):
        self.assertEqual(MODULE.source_country_codes({"country_code": "JP", "address_text": "Tokyo"}), {"JP"})
        self.assertEqual(MODULE.source_country_codes({"country_code": "JPN", "address_text": "Tokyo"}), {"JP"})
        row = {"asset_id": "a", "asset_code": "A", "canonical_name": "Asset", "portfolio_region": "아시아", "country_code": "JP", "city": "Tokyo", "address_text": "2-4-1 Shiba-Koen, Tokyo", "representative_source": "asset_master"}
        result = {"lat": "1", "lon": "103", "address": {"house_number": "2-4-1", "road": "Shiba-Koen", "city": "Tokyo", "country_code": "sg"}, "class": "building", "type": "office"}
        record = MODULE.normalized_record(row, "single_site", "q", result, "nominatim_address_search")
        self.assertFalse(record["is_map_eligible"])

    def test_explicit_country_code_overrides_conflicting_address_inference(self):
        row = {"country_code": "JP", "address_text": "2-4-1 Shiba-Koen, Tokyo, United States"}
        self.assertEqual(MODULE.source_country_codes(row), {"JP"})
        self.assertFalse(MODULE.source_country_consistent(row, "US"))

    def test_all_supported_region_countries_have_alpha3_codes(self):
        supported = set().union(*MODULE.REGION_COUNTRIES.values())
        self.assertEqual(supported - set(MODULE.ISO3_BY_ALPHA2), set())

    def test_missing_alpha3_cannot_auto_promote(self):
        saved = MODULE.ISO3_BY_ALPHA2.pop("RO", None)
        try:
            row = {
                "asset_id": "ast_ro", "asset_code": "RO1", "canonical_name": "Romania Asset",
                "portfolio_region": "유럽", "country_code": "RO", "city": "Bucharest",
                "address_text": "1 Main Street, Bucharest", "representative_source": "asset_master",
            }
            result = {
                "lat": "44.4", "lon": "26.1",
                "address": {"house_number": "1", "road": "Main Street", "city": "Bucharest", "country_code": "ro"},
                "class": "building", "type": "office",
            }
            record = MODULE.normalized_record(row, "single_site", row["address_text"], result, "nominatim_address_search")
            self.assertIsNone(record["country_code_alpha3"])
            self.assertFalse(record["is_map_eligible"])
        finally:
            if saved is not None:
                MODULE.ISO3_BY_ALPHA2["RO"] = saved

    def test_city_comparison_is_exact_after_controlled_aliasing(self):
        row = {"city": "New York", "address_text": "1 Main Street, New York"}
        york = {"address": {"city": "York"}}
        self.assertFalse(MODULE.city_consistent(row, york))
        self.assertFalse(MODULE.city_component_in_source("1 Main Street, New York", "York"))
        frankfurt = {"address": {"city": "Frankfurt am Main"}}
        self.assertTrue(MODULE.city_consistent({"city": "프랑크푸르트", "address_text": "Frankfurt"}, frankfurt))

    def test_same_region_wrong_country_cannot_auto_verify(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
            "city": "Atlanta", "address_text": "725 West Peachtree Street, Atlanta, GA 30308",
            "representative_source": "asset_master",
        }
        result = {"lat": "45", "lon": "-75", "address": {"house_number": "725", "road": "West Peachtree Street", "city": "Atlanta", "postcode": "30308", "country": "Canada", "country_code": "ca"}, "class": "building", "type": "office"}
        record = MODULE.normalized_record(row, "single_site", "query", result, "nominatim_address_search")
        self.assertFalse(record["is_map_eligible"])
        self.assertIn("국가 근거", record["review_note"])
        self.assertEqual(MODULE.source_country_codes(row), {"US"})

    def test_compound_house_numbers_do_not_collapse_or_auto_promote(self):
        cases = (
            ("12-14 Main Street, Atlanta, GA 30308", "1214", "Main Street", "Atlanta", "북미", "US", "us"),
            ("12/14 Main Street, Atlanta, GA 30308", "1214", "Main Street", "Atlanta", "북미", "USA", "us"),
            ("2-4-1 Shiba-Koen, Tokyo", "2", "Shiba-Koen", "Tokyo", "아시아", "JP", "jp"),
        )
        for source, wrong, road, city, region, source_country, result_country in cases:
            with self.subTest(source=source, wrong=wrong):
                row = {
                    "asset_id": "ast_compound", "asset_code": "A1", "canonical_name": "Asset",
                    "portfolio_region": region, "country_code": source_country, "city": city,
                    "address_text": source, "representative_source": "asset_master",
                }
                result = {
                    "lat": "35", "lon": "135",
                    "address": {"house_number": wrong, "road": road, "city": city, "country_code": result_country},
                    "class": "place", "type": "house",
                }
                record = MODULE.normalized_record(row, "single_site", source, result, "nominatim_address_search")
                self.assertNotEqual(record["coordinate_precision"], "address_point")
                self.assertFalse(record["is_map_eligible"])

    def test_postcode_cannot_be_used_as_house_number(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
            "city": "Atlanta", "address_text": "725 West Peachtree Street, Atlanta, GA 30308",
            "representative_source": "asset_master",
        }
        result = {"lat": "33.7", "lon": "-84.3", "address": {"house_number": "30308", "road": "West Peachtree Street", "city": "Atlanta", "postcode": "30308", "country": "United States", "country_code": "us"}, "class": "building", "type": "office"}
        record = MODULE.normalized_record(row, "single_site", "query", result, "nominatim_address_search")
        self.assertFalse(record["is_map_eligible"])
        self.assertNotEqual(record["coordinate_precision"], "address_point")
        self.assertEqual(MODULE.source_house_numbers(row["address_text"]), {"725"})

    def test_postcode_mismatch_cannot_auto_verify(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
            "city": "Atlanta", "address_text": "725 West Peachtree Street, Atlanta, GA 30308",
            "representative_source": "asset_master",
        }
        result = {"lat": "33.7", "lon": "-84.3", "address": {"house_number": "725", "road": "West Peachtree Street", "city": "Atlanta", "postcode": "99999", "country": "United States", "country_code": "us"}, "class": "building", "type": "office"}
        record = MODULE.normalized_record(row, "single_site", "query", result, "nominatim_address_search")
        self.assertFalse(record["is_map_eligible"])
        self.assertIn("우편번호 불일치", record["review_note"])

    def test_partial_existing_coordinates_cannot_auto_verify(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
            "city": "Atlanta", "address_text": "725 West Peachtree Street, Atlanta, GA 30308",
            "latitude": 33.7, "longitude": None, "representative_source": "asset_master",
        }
        result = {"lat": "33.7", "lon": "-84.3", "address": {"house_number": "725", "road": "West Peachtree Street", "city": "Atlanta", "postcode": "30308", "country": "United States", "country_code": "us"}, "class": "building", "type": "office"}
        record = MODULE.normalized_record(row, "single_site", "query", result, "nominatim_address_search")
        self.assertFalse(record["is_map_eligible"])
        self.assertIn("한 값만 존재", record["review_note"])

    def test_photon_result_conversion_and_direction_guard(self):
        payload = {"features": [{
            "geometry": {"coordinates": [-76.9964531, 38.9006399]},
            "properties": {
                "osm_id": 1, "osm_type": "W", "osm_key": "office", "osm_value": "company",
                "name": "WeWork", "street": "7th Street Northeast", "housenumber": "810",
                "city": "Washington", "state": "District of Columbia", "country": "United States",
                "countrycode": "US", "postcode": "20002",
            },
        }]}
        result = MODULE.photon_results(payload)[0]
        self.assertEqual(result["address"]["house_number"], "810")
        self.assertEqual(result["_provider"], "photon_openstreetmap")
        self.assertFalse(MODULE.directional_consistent("810 7th Street NW", result))
        self.assertFalse(MODULE.directional_consistent("810 7th Street, N.W.", result))

    def test_unchanged_cache_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as directory:
            original = MODULE.CACHE_PATH
            MODULE.CACHE_PATH = Path(directory) / "cache.json"
            try:
                self.assertTrue(MODULE.save_cache({"a": 1}))
                self.assertFalse(MODULE.save_cache({"a": 1}))
                self.assertTrue(MODULE.save_cache({"a": 2}))
            finally:
                MODULE.CACHE_PATH = original

    def test_existing_record_preserves_lineage_without_refresh(self):
        persisted = {
            "asset_id": "ast_existing", "review_status": "auto_verified", "is_map_eligible": True,
            "classifier_version": "classifier-v1", "geocoder_version": "geocoder-v1",
            "candidate_fingerprint": "a" * 64,
        }
        source = {
            "asset_id": "ast_existing", "asset_code": "A1", "canonical_name": "Existing Asset",
            "portfolio_region": "북미", "existing_location": persisted,
        }
        rows, calls = MODULE.geocode_rows([source], geocode=False, refresh_existing=False)
        self.assertEqual(calls, 0)
        self.assertEqual(rows[0]["classifier_version"], "classifier-v1")
        self.assertEqual(rows[0]["geocoder_version"], "geocoder-v1")
        self.assertEqual(rows[0]["candidate_fingerprint"], "a" * 64)

    def test_terminal_manual_decision_survives_generation(self):
        persisted = {
            "raw_country": None, "raw_city": "Manual City", "raw_address": "1 Manual Road",
            "normalized_country_name": "United States", "country_code_alpha2": "US", "country_code_alpha3": "USA",
            "normalized_city": "Manual City", "normalized_admin1": "Manual State", "normalized_postcode": "10000",
            "latitude": 40.1, "longitude": -73.9, "coordinate_source": "manual_verified",
            "coordinate_precision": "address_point", "match_method": "manual_review", "confidence": 1.0,
            "review_status": "manually_verified", "is_map_eligible": True, "review_note": "approved",
            "source_system": "manual", "source_record_id": "A1", "candidate_fingerprint": None,
            "classifier_version": None, "geocoder_version": None,
            "evidence": {"review": "approved"}, "normalized_at": "2026-09-03T00:00:00+00:00",
        }
        source = {
            "asset_id": "ast_manual", "asset_code": "A1", "canonical_name": "Manual Asset",
            "asset_kind": "physical_asset", "portfolio_region": "북미", "address_text": "changed",
            "existing_location": persisted,
        }
        rows, calls = MODULE.geocode_rows([source], geocode=False, refresh_existing=True)
        self.assertEqual(calls, 0)
        self.assertEqual(rows[0]["review_status"], "manually_verified")
        self.assertTrue(rows[0]["is_map_eligible"])
        self.assertEqual(rows[0]["latitude"], 40.1)
        self.assertEqual(rows[0]["evidence"], {"review": "approved"})
        self.assertEqual(rows[0]["classifier_version"], "manual-review-v1")
        self.assertEqual(rows[0]["geocoder_version"], "manual-review")
        self.assertEqual(len(rows[0]["candidate_fingerprint"]), 64)

    def test_upsert_is_current_run_scoped_atomic_and_manual_safe(self):
        sql = MODULE.upsert_sql([{"asset_id": "ast_one", "review_status": "review_required", "is_map_eligible": False}])
        self.assertIn("with current_run(asset_id) as (values ('ast_one'))", sql.lower())
        self.assertIn("review_status not in ('manually_verified','manually_rejected')", sql.lower())
        self.assertIn("raw_address=coalesce(public.asset_location_normalization.raw_address, excluded.raw_address)", sql.lower())
        self.assertIn("raw_address is null and excluded.raw_address is not null", sql.lower())
        self.assertIn("asset.latitude is null and asset.longitude is null", sql.lower())
        self.assertIn("candidate fingerprint mismatch", MODULE.postcondition_sql([{"asset_id": "ast_one", "candidate_fingerprint": "f" * 64}], 0).lower())
        self.assertIn("source population members changed", MODULE.postcondition_sql([{"asset_id": "ast_one", "candidate_fingerprint": "f" * 64}], 0).lower())
        self.assertNotIn("coalesce(asset.latitude, location.latitude)", sql.lower())
        self.assertIn("asset.is_physical is true", sql.lower())

    def test_manifest_hash_expected_count_and_tamper_guards(self):
        row = {"asset_id": "ast_one", "review_status": "auto_verified", "is_map_eligible": True, "candidate_fingerprint": "f" * 64}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            digest = MODULE.write_manifest(path, [row], {"map_eligible": 1}, "20260903T000000Z")
            payload, actual = MODULE.load_verified_manifest(path, digest, 1)
            self.assertEqual(actual, digest)
            self.assertEqual(payload["row_count"], 1)
            with self.assertRaises(ValueError):
                MODULE.load_verified_manifest(path, digest, 0)
            path.write_bytes(path.read_bytes() + b" ")
            with self.assertRaises(ValueError):
                MODULE.load_verified_manifest(path, digest, 1)

    def test_legacy_limit_apply_is_rejected(self):
        proc = subprocess.run(
            [sys.executable, str(PORTAL_ROOT / "normalize_overseas_asset_locations.py"), "--limit", "1", "--apply"],
            text=True, capture_output=True,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("direct --apply", proc.stderr)

    def test_raw_address_preserves_whitespace_exactly(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
            "country_code": None, "city": "New  York", "address_text": "Near Purdue  University",
            "representative_source": "asset_master",
        }
        record = MODULE.normalized_record(row, "single_site", "manual_review", "", None)
        self.assertEqual(record["raw_city"], "New  York")
        self.assertEqual(record["raw_address"], "Near Purdue  University")

    def test_existing_location_is_reused_without_refresh(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
            "existing_location": {
                "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Asset", "portfolio_region": "북미",
                "location_subject_type": "single_site", "raw_country": None, "raw_city": "Atlanta",
                "raw_address": "1 Main St", "normalized_country_name": "United States",
                "country_code_alpha2": "US", "country_code_alpha3": "USA", "normalized_city": "Atlanta",
                "latitude": 33.1, "longitude": -84.1, "coordinate_source": "nominatim_openstreetmap",
                "coordinate_precision": "address_point", "match_method": "nominatim_address_search",
                "confidence": 0.97, "review_status": "auto_verified", "is_map_eligible": True,
                "source_system": "asset_master", "evidence": {}, "normalized_at": "2026-09-03T00:00:00+00:00",
            },
        }
        rows, calls = MODULE.geocode_rows([row], geocode=False)
        self.assertEqual(calls, 0)
        self.assertTrue(rows[0]["is_map_eligible"])
        self.assertEqual(rows[0]["latitude"], 33.1)

    def test_raw_location_fields_are_immutable_on_upsert(self):
        sql = MODULE.upsert_sql([
            {
                "asset_id": "ast_test", "canonical_name": "Asset", "location_subject_type": "unresolved_subject",
                "coordinate_precision": "unknown", "confidence": 0, "review_status": "unresolved",
                "is_map_eligible": False, "source_system": "asset_master", "evidence": {},
            }
        ])
        update_clause = sql.split("on conflict (asset_id) do update set", 1)[1].split("update public.asset_master", 1)[0]
        self.assertNotIn("raw_country=excluded.raw_country", update_clause)
        self.assertNotIn("raw_city=excluded.raw_city", update_clause)
        self.assertNotIn("raw_address=excluded.raw_address", update_clause)

    def test_unresolved_does_not_become_map_eligible(self):
        row = {
            "asset_id": "ast_test", "asset_code": "A1", "canonical_name": "Unknown Site",
            "portfolio_region": "유럽", "asset_kind": "physical_asset", "metadata": {},
        }
        result = MODULE.normalized_record(row, "unresolved_subject", "", None, "missing_specific_location")
        self.assertEqual(result["review_status"], "unresolved")
        self.assertFalse(result["is_map_eligible"])
        self.assertIsNone(result["latitude"])


if __name__ == "__main__":
    unittest.main()
