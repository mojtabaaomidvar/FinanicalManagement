"""Acquire before source/account/transaction locks; released by commit or rollback.

Family-local serialization also covers transfers whose old/new account sets are
only known after loading a protected source row. Independent families never share
this lock (apart from a harmless possible 64-bit hash collision).
"""
from sqlalchemy import text
from sqlalchemy.orm import Session


def lock_financial_family(db: Session, family_id: object) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
               {"key": "wallet:" + str(family_id)})
