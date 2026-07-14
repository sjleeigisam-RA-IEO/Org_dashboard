import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ALIAS_PATH = BASE_DIR / "t5t_writer_aliases.json"


def normalize_email(value):
    return str(value or "").strip().lower()


def normalize_name(value):
    return " ".join(str(value or "").strip().split()).casefold()


def staff_identity_priority(row):
    metadata = row.get("metadata") or {}
    return (
        bool(metadata.get("is_main")),
        metadata.get("division_scope") == "RA",
        not str(row.get("staff_id") or "").startswith("staff_ext_"),
    )


def load_alias_rules(path=DEFAULT_ALIAS_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class WriterIdentityResolver:
    def __init__(self, staff_rows, alias_rules=None):
        self.staff_by_id = {}
        self.staff_by_email = {}
        self.staff_by_name = {}
        self.alias_by_email = {}
        self.alias_by_name = {}

        ordered_staff = sorted(staff_rows or [], key=staff_identity_priority, reverse=True)
        for row in ordered_staff:
            staff_id = row.get("staff_id")
            if not staff_id:
                continue
            self.staff_by_id[staff_id] = row
            email = normalize_email(row.get("email"))
            name = normalize_name(row.get("name"))
            if email:
                self.staff_by_email.setdefault(email, row)
            if name:
                self.staff_by_name.setdefault(name, row)

        for rule in alias_rules if alias_rules is not None else load_alias_rules():
            staff_id = rule.get("canonical_staff_id")
            if staff_id not in self.staff_by_id:
                raise ValueError(f"Writer alias references missing staff_id: {staff_id}")
            for email in rule.get("email_aliases") or []:
                self.alias_by_email[normalize_email(email)] = rule
            for name in rule.get("name_aliases") or []:
                self.alias_by_name[normalize_name(name)] = rule

    def _from_rule(self, rule, source):
        staff = self.staff_by_id[rule["canonical_staff_id"]]
        return {
            "staff_id": staff["staff_id"],
            "name": rule.get("canonical_name") or staff.get("name"),
            "email": normalize_email(rule.get("canonical_email") or staff.get("email")),
            "source": source,
            "rule": rule,
        }

    @staticmethod
    def _from_staff(staff, source):
        return {
            "staff_id": staff["staff_id"],
            "name": staff.get("name"),
            "email": normalize_email(staff.get("email")),
            "source": source,
            "rule": None,
        }

    def resolve(self, email=None, name=None):
        normalized_email = normalize_email(email)
        normalized_name = normalize_name(name)

        if normalized_email and normalized_email in self.alias_by_email:
            return self._from_rule(self.alias_by_email[normalized_email], "writer_email_alias")
        if normalized_name and normalized_name in self.alias_by_name:
            return self._from_rule(self.alias_by_name[normalized_name], "writer_name_alias")
        if normalized_email and normalized_email in self.staff_by_email:
            return self._from_staff(self.staff_by_email[normalized_email], "writer_email")
        if normalized_name and normalized_name in self.staff_by_name:
            return self._from_staff(self.staff_by_name[normalized_name], "writer_name")
        return None
