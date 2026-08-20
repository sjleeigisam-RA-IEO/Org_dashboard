GENERAL_WORK_STATUS = "general_work"
MISSION_STATUS = "mission"
GENERAL_WORK_TASK_TYPE = "General"
MISSION_TASK_TYPE = "Mission"
PROJECT_TASK_TYPE = "\ud504\ub85c\uc81d\ud2b8"
FUND_INVESTOR_TASK_TYPE = "\ud380\ub4dc\u00b7\ud22c\uc790\uc790"
INTERNAL_OTHER_TASK_TYPE = "\ub0b4\ubd80\u00b7\uae30\ud0c0"

GENERIC_PROJECT_TEXT_TERMS = [
    "\uc218\uc775\uc790 \ubbf8\ud305",
    "\ud22c\uc790\uc790 \ubbf8\ud305",
    "\ubb3c\ub958\ud3ec\ud2b8\ud3f4\ub9ac\uc624",
    "\ubb3c\ub958 \ud3ec\ud2b8\ud3f4\ub9ac\uc624",
    "\ubb3c\ub958\uc139\ud130\ubdf0",
    "\ud611\uc5c5",
    "\uc2dc\uc7a5 \ub9ac\uc11c\uce58",
    "\uc139\ud130\ud380\ub4dc \uac80\ud1a0",
    "\uc2dc\ub2c8\uc5b4 \ube14\ub77c\uc778\ub4dc",
]


def normalize_text(value):
    return (value or "").strip()


def is_general_work(project_text=None, raw_text=None, classification_summary=None, match_status=None):
    if match_status == "matched":
        return False

    project_text = normalize_text(project_text)
    raw_text = normalize_text(raw_text)
    classification_summary = normalize_text(classification_summary)
    combined = " ".join(part for part in [project_text, raw_text, classification_summary] if part)

    if project_text:
        return any(term in project_text or term in combined for term in GENERIC_PROJECT_TEXT_TERMS)

    return bool(raw_text or classification_summary)


def effective_match_status(item):
    status = item.get("match_status")
    if status == "matched":
        return "matched"
    if status == GENERAL_WORK_STATUS:
        return GENERAL_WORK_STATUS
    if status == MISSION_STATUS:
        return MISSION_STATUS
    if is_general_work(
        item.get("project_text"),
        item.get("raw_text"),
        item.get("classification_summary"),
        status,
    ):
        return GENERAL_WORK_STATUS
    return status or "raw_unmatched"


def effective_task_type(item):
    status = effective_match_status(item)
    if status == GENERAL_WORK_STATUS:
        return GENERAL_WORK_TASK_TYPE
    if status == MISSION_STATUS:
        return MISSION_TASK_TYPE
    if item.get("task_type") and item["task_type"] not in {"Project", "General", "GeneralWork", "\uc77c\ubc18\uc5c5\ubb34", "\ubbf8\uc158"}:
        return item["task_type"]
    if item.get("matched_project_id"):
        return PROJECT_TASK_TYPE
    if item.get("matched_fund_id"):
        return FUND_INVESTOR_TASK_TYPE
    return INTERNAL_OTHER_TASK_TYPE
