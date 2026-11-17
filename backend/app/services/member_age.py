"""Document eligibility kept separate from freely editable profile information."""

from __future__ import annotations

from datetime import date, timedelta

from app.services.clock import utcnow


def today_tehran() -> date:
    return (utcnow() + timedelta(hours=3, minutes=30)).date()


def required_not_before(birth_date: date | None, relation: str) -> date | None:
    today = today_tehran()
    try:
        cutoff = today.replace(year=today.year - 18)
    except ValueError:
        cutoff = today.replace(year=today.year - 18, day=28)
    if birth_date is not None and birth_date > cutoff:
        if birth_date.year > 9981:
            return date.max
        try:
            return birth_date.replace(year=birth_date.year + 18)
        except ValueError:
            return birth_date.replace(year=birth_date.year + 18, day=28)
    if birth_date is None and relation == "فرزند":
        return date.max
    return None


def preserve_document_eligibility(
    member, new_birth: date | None, new_relation: str, *, manager_approval: bool = False
) -> None:
    required = required_not_before(new_birth, new_relation)
    if manager_approval:
        member.document_access_not_before = required
        return
    restrictions = [
        member.document_access_not_before,
        required_not_before(member.birth_date, member.relation),
        required,
    ]
    member.document_access_not_before = max(
        (value for value in restrictions if value is not None), default=None
    )


def document_age_restricted(member) -> bool:
    stored = member.document_access_not_before
    return (stored is not None and stored > today_tehran()) or required_not_before(
        member.birth_date, member.relation
    ) is not None
