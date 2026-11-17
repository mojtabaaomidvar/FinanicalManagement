"""Create persistent fictional accounts once; never reset a manual test session."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from local_sandbox import (
    BACKEND_DIR,
    SANDBOX_ACCOUNTS,
    SANDBOX_FAMILY_ID,
    SANDBOX_PASSWORD,
    SandboxError,
    configure_sandbox,
    report_failure,
    require_sandbox_database,
)


def seed() -> None:
    configure_sandbox()
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db.rls import bind_family_to_session
    from app.db.session import SessionLocal
    from app.models.account import Account
    from app.models.family import Family, Member
    from app.models.settings import AppSetting
    from app.schemas.data import TransactionWrite
    from app.services.transactions import create_uncommitted

    migration_config = Config(str(BACKEND_DIR / "alembic.ini"))
    migration_config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(migration_config, "head")

    with SessionLocal() as db:
        require_sandbox_database(db)
        # A deterministic family identity is the sandbox marker. This entire
        # bootstrap commits once, so the marker cannot precede a partial seed.
        if db.get(Family, SANDBOX_FAMILY_ID) is not None:
            print("Local sandbox already initialized; all manual changes were preserved.")
            return
        if (
            db.execute(select(Family.id).limit(1)).first() is not None
            or db.execute(select(Member.id).limit(1)).first() is not None
        ):
            raise SandboxError("Unmarked nonempty database refused; no data was changed.")

        family = Family(
            id=SANDBOX_FAMILY_ID,
            name="خانوادهٔ آزمایشی",
            code="900001",
            currency="تومان",
            budget=Decimal("5000000"),
        )
        db.add(family)
        db.flush()
        members = []
        for index, (phone, name, role) in enumerate(SANDBOX_ACCOUNTS, start=1):
            member = Member(
                id=uuid.uuid5(SANDBOX_FAMILY_ID, f"member-{index}"),
                family_id=family.id,
                phone=phone,
                name=name,
                role=role,
                password_hash=hash_password(SANDBOX_PASSWORD),
                status="active",
                membership_state="active",
                currency="تومان",
                relation="خودم" if role == "owner" else "سایر",
            )
            db.add(member)
            members.append(member)
        db.flush()
        family.created_by = members[0].id
        app_settings = db.get(AppSetting, 1)
        if app_settings is None:
            app_settings = AppSetting(id=1)
            db.add(app_settings)
        app_settings.otp_enabled = False
        app_settings.dev_mode = False
        bind_family_to_session(db, family.id)
        today = datetime.now(timezone(timedelta(hours=3, minutes=30))).date()
        for index, member in enumerate(members, start=1):
            account = Account(
                id=uuid.uuid5(SANDBOX_FAMILY_ID, f"account-{index}"),
                family_id=family.id,
                member_id=member.id,
                title=f"کیف پول {member.name}",
                kind="wallet",
                initial_balance=Decimal("1000000"),
                sms_enabled=False,
            )
            db.add(account)
            db.flush()
            create_uncommitted(db, family.id, TransactionWrite(
                member_id=str(member.id),
                type="expense",
                amount=Decimal("10000"),
                category="other-e",
                date=today,
                note=f"هزینهٔ نمونهٔ {member.name}",
                account_id=str(account.id),
                repeat="none",
            ))
        db.commit()
    print("Local sandbox initialized: owner, two members, admin, wallets and sample expenses.")


if __name__ == "__main__":
    try:
        seed()
    except Exception as exc:
        report_failure(exc)
        raise SystemExit(1) from None
