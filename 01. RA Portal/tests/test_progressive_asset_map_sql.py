import re
import unittest
from pathlib import Path


SQL_PATH = Path(__file__).parents[1] / 'migrations' / '2026-09-03_progressive_asset_map_serving.sql'


class ProgressiveAssetMapSqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL_PATH.read_text(encoding='utf-8').lower()

    def test_view_is_service_only(self):
        self.assertIn('security_invoker = true', self.sql)
        self.assertRegex(self.sql, r'revoke\s+all\s+on\s+public\.asset_map_location_progressive_v1\s+from\s+public,\s*anon,\s*authenticated')
        self.assertNotRegex(self.sql, r'grant\s+select.*asset_map_location_progressive_v1')

    def test_all_location_tiers_are_explicit(self):
        for tier in ('verified', 'candidate_asset', 'local_area', 'uncertain_point', 'city_text', 'aggregate_only', 'insufficient'):
            self.assertIn(f"'{tier}'", self.sql)
        self.assertGreaterEqual(self.sql.count("review_status = 'review_required'"), 3)

    def test_no_sensitive_lineage_in_projection(self):
        match = re.search(r'create or replace view.*?\bas\s+select(.*?)\bfrom\s+public\.asset_master', self.sql, re.S)
        self.assertIsNotNone(match)
        for field in ('evidence', 'candidate_fingerprint', 'geocoder_place_id', 'raw_address'):
            self.assertNotIn(field, match.group(1))


if __name__ == '__main__':
    unittest.main()