import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from match_t5t_entities import build_asset_target_maps, build_update


class AssetTargetMatchingTests(unittest.TestCase):
    def setUp(self):
        self.projects = [{"project_id": "project-1"}, {"project_id": "project-2"}]
        self.funds = [{"fund_id": "fund-1"}, {"fund_id": "fund-2"}]
        self.item = {"form_item_id": "item-1", "metadata": {}}

    def maps(self, links, fund_links=()):
        return build_asset_target_maps(links, fund_links, self.projects, self.funds)

    def update(self, kind, row, project_map, fund_map):
        best = (0.99, "exact", "Test asset", {"kind": kind, "row": row})
        return build_update(self.item, best, project_map, fund_map)

    def test_fund_in_legacy_project_field_stays_a_fund(self):
        project_map, fund_map, audit = self.maps([{
            "asset_id": "asset-1", "legacy_project_id": "fund-1",
            "target_type": "fund_as_project", "resolved_fund_id": "fund-1",
        }])
        update = self.update("fund", {"fund_id": "fund-1", "primary_asset_id": "asset-1"}, project_map, fund_map)
        self.assertEqual(update["matched_fund_id"], "fund-1")
        self.assertNotIn("matched_project_id", update)
        self.assertEqual(update["match_status"], "matched")
        self.assertEqual(audit["fund_as_project_links"], 1)

    def test_asset_can_resolve_through_fund_as_project(self):
        project_map, fund_map, _ = self.maps([{
            "asset_id": "asset-1", "target_type": "fund_as_project", "resolved_fund_id": "fund-1",
        }])
        update = self.update("asset", {"asset_id": "asset-1"}, project_map, fund_map)
        self.assertEqual(update["matched_fund_id"], "fund-1")
        self.assertNotIn("matched_project_id", update)

    def test_resolved_project_id_takes_precedence_over_legacy_code(self):
        project_map, fund_map, _ = self.maps([{
            "asset_id": "asset-1", "legacy_project_id": "old-code",
            "target_type": "project", "resolved_project_id": "project-1",
        }])
        update = self.update("fund", {"fund_id": "fund-1", "primary_asset_id": "asset-1"}, project_map, fund_map)
        self.assertEqual(update["matched_project_id"], "project-1")

    def test_missing_targets_cannot_be_written_as_foreign_keys(self):
        project_map, fund_map, audit = self.maps([
            {"asset_id": "asset-1", "target_type": "project", "resolved_project_id": "missing-project"},
            {"asset_id": "asset-1", "target_type": "fund_as_project", "resolved_fund_id": "missing-fund"},
        ], [{"asset_id": "asset-1", "fund_id": "missing-fund"}])
        update = self.update("asset", {"asset_id": "asset-1"}, project_map, fund_map)
        self.assertEqual(update["match_status"], "candidate_match")
        self.assertNotIn("matched_project_id", update)
        self.assertNotIn("matched_fund_id", update)
        self.assertEqual(audit, {"invalid_project_links": 1, "invalid_fund_links": 2, "fund_as_project_links": 1})

    def test_unresolved_or_null_links_are_not_guessed(self):
        project_map, fund_map, audit = self.maps([
            {"asset_id": "asset-1", "target_type": "unresolved", "legacy_project_id": "project-1"},
            {"asset_id": None, "target_type": "project", "resolved_project_id": "project-1"},
            {"asset_id": "asset-1", "target_type": "project", "resolved_project_id": None},
        ])
        self.assertFalse(project_map)
        self.assertFalse(fund_map)
        self.assertEqual(audit["unresolved_links"], 1)
        self.assertEqual(audit["invalid_project_links"], 2)

    def test_duplicate_fund_edges_do_not_create_false_ambiguity(self):
        link = {"asset_id": "asset-1", "target_type": "fund_as_project", "resolved_fund_id": "fund-1"}
        project_map, fund_map, _ = self.maps([link, link], [{"asset_id": "asset-1", "fund_id": "fund-1"}])
        self.assertEqual(fund_map["asset-1"], ["fund-1"])
        update = self.update("asset", {"asset_id": "asset-1"}, project_map, fund_map)
        self.assertEqual(update["matched_fund_id"], "fund-1")

    def test_multiple_project_links_are_not_arbitrarily_selected(self):
        project_map, fund_map, _ = self.maps([
            {"asset_id": "asset-1", "target_type": "project", "resolved_project_id": project["project_id"]}
            for project in self.projects
        ])
        update = self.update("fund", {"fund_id": "fund-1", "primary_asset_id": "asset-1"}, project_map, fund_map)
        self.assertNotIn("matched_project_id", update)
        self.assertEqual(update["matched_fund_id"], "fund-1")

    def test_multiple_fund_links_remain_candidates(self):
        project_map, fund_map, _ = self.maps([], [
            {"asset_id": "asset-1", "fund_id": fund["fund_id"]} for fund in self.funds
        ])
        update = self.update("asset", {"asset_id": "asset-1"}, project_map, fund_map)
        self.assertEqual(update["match_status"], "candidate_match")
        self.assertNotIn("matched_fund_id", update)

    def test_valid_pilot_project_remains_supported(self):
        project_map, fund_map, _ = self.maps([{
            "asset_id": "asset-1", "target_type": "pilot_code", "resolved_project_id": "project-1",
        }])
        update = self.update("asset", {"asset_id": "asset-1"}, project_map, fund_map)
        self.assertEqual(update["matched_project_id"], "project-1")


if __name__ == "__main__":
    unittest.main()
