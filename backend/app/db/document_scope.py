"""Document-specific member context, retained across commits on the same Session."""

from __future__ import annotations

from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal

_KEY = "app_document_member_id"


def bind_member(db: Session, member_id: object) -> None:
    db.info[_KEY] = str(member_id)
    db.execute(
        text("SELECT set_config('app.document_member_id', :mid, true)"), {"mid": str(member_id)}
    )


def clear_member(db: Session) -> None:
    db.info.pop(_KEY, None)


@event.listens_for(SessionLocal, "after_begin")
def _set_member(session: Session, transaction: object, connection: object) -> None:
    member_id = session.info.get(_KEY)
    if member_id is not None:
        connection.exec_driver_sql(
            "SELECT set_config('app.document_member_id', %s, true)", (member_id,)
        )
