import re


def normalize_t5t_list_breaks(value):
    """Add readable line breaks before inline list markers in T5T text."""
    if value is None:
        return value
    text = str(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return text

    protected_space = "\ue000"
    text = re.sub(r"(\([^\n()]{1,40})\n([0-9]{1,2}\))", r"\1 \2", text)
    text = re.sub(r"(\([^\n()]{1,40})[\t ]+([0-9]{1,2}\))", rf"\1{protected_space}\2", text)

    # Common pasted formats collapse bullets and numbered lists into one line.
    text = re.sub(r"([^\n])[\t ]+([-–—])[\t ]+(?=\S)", r"\1\n\2 ", text)
    for _ in range(2):
        text = re.sub(r"([^\n])[\t ]+([0-9]{1,2}[\.)])[\t ]+(?=\S)", _numbered_marker_break, text)
    text = re.sub(r"([^\n])[\t ]+(ㅇ)[\t ]+(?=\S)", r"\1\n\2 ", text)
    text = re.sub(r"([^\n])[\t ]+([①-⑳])[\t ]*(?=\S)", r"\1\n\2 ", text)
    text = re.sub(r"([^\n])[\t ]+([•ㆍ·])[\t ]*(?=\S)", r"\1\n\2 ", text)

    lines = []
    for line in text.split("\n"):
        normalized = re.sub(r"[\t ]{2,}", " ", line).rstrip()
        # Drop orphan placeholder bullets that often come from empty Notion fields.
        marker_only = normalized.strip().replace(" ", "")
        if marker_only and all(ch in "-–—" for ch in marker_only):
            continue
        lines.append(normalized)

    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).replace(protected_space, " ").strip()


def _numbered_marker_break(match):
    prefix = match.string[:match.start()]
    marker = match.group(2)
    last_line = prefix.rsplit("\n", 1)[-1] + match.group(1)
    if marker.endswith(")") and last_line.rfind("(") > last_line.rfind(")"):
        return match.group(0)
    return f"{match.group(1)}\n{marker} "
