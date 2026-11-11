"""مجوز ویرایش باید تا commit معتبر بماند؛ reassignment مدیر قفل ردیف را رعایت کند."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from tests.conftest import CATEGORY, Actor, make_transaction


def test_member_edit_locks_row_until_commit_before_manager_reassignment(
    client: Any, home_a: Actor, member_a: Actor, monkeypatch: Any
) -> None:
    from app.core.errors import AppError
    from app.db.rls import bind_family_to_session
    from app.db.session import SessionLocal
    from app.models.family import Member
    from app.models.transaction import Transaction
    from app.schemas.data import TransactionWrite
    from app.services import transactions

    tx_id = UUID(make_transaction(client, member_a, "30000"))
    member_body = TransactionWrite(
        member_id=member_a.member_id,
        type="expense",
        amount=Decimal("25000"),
        category=CATEGORY,
        date="2026-09-02",
    )
    manager_body = member_body.model_copy(
        update={"member_id": home_a.member_id, "amount": Decimal("27000")}
    )
    stored = select(Transaction.member_id, Transaction.amount).where(Transaction.id == tx_id)

    with SessionLocal() as member_db, SessionLocal() as manager_db:
        family_id = UUID(home_a.family_id)
        bind_family_to_session(member_db, family_id)
        bind_family_to_session(manager_db, family_id)
        member_actor = member_db.get(Member, UUID(member_a.member_id))
        manager_actor = manager_db.get(Member, UUID(home_a.member_id))
        assert member_actor is not None and manager_actor is not None
        member_commit = member_db.commit
        manager_db.execute(text("SET LOCAL lock_timeout = '200ms'"))

        def commit_after_competing_reassignment() -> None:
            # عضو SELECT مجاز را انجام داده، اما هنوز UPDATE خود را commit نکرده است.
            with pytest.raises(OperationalError) as blocked:
                transactions.update(manager_db, manager_actor, tx_id, manager_body)
            assert getattr(blocked.value.orig, "sqlstate", None) == "55P03"
            manager_db.rollback()
            member_commit()

        with monkeypatch.context() as patch:
            patch.setattr(member_db, "commit", commit_after_competing_reassignment)
            transactions.update(member_db, member_actor, tx_id, member_body)

        assert tuple(member_db.execute(stored).one()) == (
            UUID(member_a.member_id), Decimal("25000")
        )
        # پس از commit عضو، مدیر قفل را می‌گیرد و reassignment را واقعاً ذخیره می‌کند.
        transactions.update(manager_db, manager_actor, tx_id, manager_body)
        reassigned = tuple(manager_db.execute(stored).one())
        assert reassigned == (UUID(home_a.member_id), Decimal("27000"))

        with pytest.raises(AppError) as denied:
            transactions.update(member_db, member_actor, tx_id, member_body)
        assert denied.value.http_status == 404
        assert denied.value.code == "NOT_FOUND"
        member_db.rollback()
        assert tuple(manager_db.execute(stored).one()) == reassigned
