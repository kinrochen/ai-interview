"""Recover identity only from the supplied document, preserving entered values."""

import re

PLACEHOLDERS = {
    "未识别",
    "未知",
    "解析中...",
    "解析失败",
    "候选人",
    "unknown",
    "none",
    "null",
    "n/a",
}
EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<!\d)(?:\+?86[-\s]?)?(1[3-9]\d[-\s]?\d{4}[-\s]?\d{4})(?!\d)")


def meaningful(value):
    text = str(value or "").strip()
    return text if text and text.lower() not in PLACEHOLDERS else ""


def resolve_identity(text, parsed, existing):
    info = parsed.get("contact_info") or {}
    info = info if isinstance(info, dict) else {}
    basic = parsed.get("basic_info") or {}
    basic = basic if isinstance(basic, dict) else {}
    normalized = re.sub(r"\s+", "", text).lower()

    def grounded(value):
        value = meaningful(value)
        return (
            value if value and re.sub(r"\s+", "", value).lower() in normalized else ""
        )

    name = grounded(parsed.get("candidate_name") or basic.get("name"))
    if not name:
        match = re.search(
            r"(?:姓名|Name)\s*[:：]\s*([\u4e00-\u9fff·]{2,12}|[A-Za-z][A-Za-z .-]{1,60})",
            text,
            re.I,
        )
        name = match.group(1).strip() if match else ""
    if not name:
        first_lines = [line.strip() for line in text.splitlines()[:5] if line.strip()]
        name = next(
            (
                line
                for line in first_lines
                if re.fullmatch(r"[\u4e00-\u9fff·]{2,4}", line)
                and line
                not in {"个人简历", "求职简历", "教育经历", "工作经历", "基本信息"}
            ),
            "",
        )
    email = grounded(info.get("email") or parsed.get("email"))
    if not EMAIL.fullmatch(email):
        found = EMAIL.search(text)
        email = found.group() if found else ""
    phone = grounded(info.get("phone") or parsed.get("contact"))
    if not phone:
        found = PHONE.search(text)
        phone = re.sub(r"\s|-", "", found.group(1)) if found else ""
    return {
        "candidate_name": meaningful(existing.candidate_name) or name or "未识别",
        "contact": meaningful(existing.contact) or phone or None,
        "email": meaningful(existing.email) or email or None,
    }
