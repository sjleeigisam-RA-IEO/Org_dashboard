import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from t5t_writer_identity import WriterIdentityResolver


class WriterIdentityResolverTests(unittest.TestCase):
    def setUp(self):
        self.staff = [
            {
                "staff_id": "staff_10171",
                "name": "권순일",
                "email": "ksoonil@igisam.com",
                "metadata": {"is_main": True, "division_scope": "RA"},
            },
            {
                "staff_id": "staff_10346",
                "name": "신민재",
                "email": "minjae.sheen@igisam.com",
                "metadata": {"is_main": True, "division_scope": "RA"},
            },
        ]
        self.rules = [
            {
                "canonical_staff_id": "staff_10171",
                "canonical_name": "권순일",
                "canonical_email": "ksoonil@igisam.com",
                "name_aliases": ["권순일", "ksoonil"],
                "email_aliases": ["ksoon@igisam.com", "ksoonil@igiam.com"],
            },
            {
                "canonical_staff_id": "staff_10346",
                "canonical_name": "신민재",
                "canonical_email": "minjae.sheen@igisam.com",
                "name_aliases": ["신민재", "minjae.sheen"],
                "email_aliases": ["minjae.sheen@igisam.com"],
            },
        ]
        self.resolver = WriterIdentityResolver(self.staff, self.rules)

    def test_resolves_email_typo_to_canonical_staff(self):
        match = self.resolver.resolve("ksoonil@igiam.com", "권순일")
        self.assertEqual(match["staff_id"], "staff_10171")
        self.assertEqual(match["email"], "ksoonil@igisam.com")

    def test_resolves_name_when_email_is_missing(self):
        match = self.resolver.resolve(None, "신민재")
        self.assertEqual(match["staff_id"], "staff_10346")

    def test_returns_none_for_unknown_writer(self):
        self.assertIsNone(self.resolver.resolve(None, "Unknown"))


if __name__ == "__main__":
    unittest.main()
