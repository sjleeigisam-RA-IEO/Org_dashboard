import importlib.util
import unittest
from pathlib import Path


PORTAL_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = PORTAL_DIR.parent
SCRIPT_PATH = PORTAL_DIR / "sync_one_account_rm75_profile.py"
MIGRATION_PATH = PORTAL_DIR / "migrations" / "2026-09-11_one_account_rm75_profile.sql"
EDGE_PATH = ROOT_DIR / "supabase" / "functions" / "ra-capital-exposure" / "index.ts"
CAPITAL_JS_PATH = PORTAL_DIR / "portfolio-analysis" / "js" / "capital-relationship-analysis.js"

SPEC = importlib.util.spec_from_file_location("one_account_rm75", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class OneAccountClassificationTests(unittest.TestCase):
    def classify(self, category, code=None, investor_class=None):
        classification = {}
        if code:
            classification["code"] = code
        if investor_class:
            classification["excel_investor_class"] = investor_class
        return MODULE.relationship_classification({
            "category": category,
            "piscfh": {"classification": classification},
        })

    def test_overseas_lp_scope_precedes_piscfh_public_code(self):
        result = self.classify("해외LP", "S", "국부펀드")
        self.assertEqual(result["portal_role_class"], "해외LP")
        self.assertEqual(result["piscfh_code"], "S")
        self.assertEqual(result["investor_class"], "국부펀드")

    def test_financial_and_domestic_lp_crosswalks(self):
        self.assertEqual(self.classify("미분류", "I")["portal_role_class"], "금융기관")
        self.assertEqual(self.classify("미분류", "P")["portal_role_class"], "국내LP")

    def test_unclassified_overseas_account_remains_visible_but_reviewable(self):
        result = self.classify("해외LP")
        self.assertEqual(result["portal_role_class"], "해외LP")
        self.assertEqual(result["classification_review_status"], "review")


class PortalProjectionContractTests(unittest.TestCase):
    def test_rm_columns_exist_only_in_restricted_profile_contract(self):
        sql = MIGRATION_PATH.read_text(encoding="utf-8")
        self.assertIn("primary_rm_id text", sql)
        self.assertIn("rm_is_confirmed boolean", sql)
        safe_view = sql.split(
            "create view public.one_account_portal_party_bridge_current_v1 as", 1
        )[1].split("drop view if exists public.one_account_delegated_exposure_current_v1", 1)[0]
        self.assertNotIn("primary_rm", safe_view)
        self.assertNotIn("backup_rm", safe_view)
        self.assertNotIn("sponsor_rm", safe_view)

    def test_edge_function_uses_explicit_rm_free_projection(self):
        source = EDGE_PATH.read_text(encoding="utf-8")
        self.assertIn('postgrest("one_account_portal_party_bridge_current_v1"', source)
        self.assertIn("portal_role_class", source)
        self.assertNotIn("primary_rm", source)
        self.assertNotIn("backup_rm", source)
        self.assertNotIn("sponsor_rm", source)

    def test_frontend_applies_account_class_only_to_beneficiaries(self):
        source = CAPITAL_JS_PATH.read_text(encoding="utf-8")
        self.assertIn("normalizeRole(row) === 'beneficiary' && account.portalRoleClass", source)
        self.assertIn("patch.role_class = account.portalRoleClass", source)
        self.assertNotIn("primary_rm", source)
        self.assertNotIn("backup_rm", source)
        self.assertNotIn("sponsor_rm", source)


if __name__ == "__main__":
    unittest.main()
