"""Shared activities extend canonical calendar events and family-bound participants.

Revision ID: 0021
Revises: 0020
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MEMBER = "NULLIF(current_setting('app.document_member_id', true), '')::uuid"
_FAMILY = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"
_ACTIVE = f"""EXISTS (SELECT 1 FROM members m WHERE m.id = {_MEMBER}
    AND m.family_id = family_events.family_id AND m.status='active'
    AND m.membership_state='active')"""  # noqa: S608 -- module-owned SQL constants.
_ADMIN = f"""EXISTS (SELECT 1 FROM members m WHERE m.id = {_MEMBER}
    AND m.family_id = family_events.family_id AND m.role IN ('owner','admin'))"""  # noqa: S608
_MODIFY = f"({_ACTIVE}) AND (member_id = {_MEMBER} OR ({_ADMIN}))"


def upgrade() -> None:
    op.create_unique_constraint("uq_family_events_id_family", "family_events", ["id", "family_id"])
    for column, name in (("member_id", "creator"), ("for_member_id", "for_member")):
        op.drop_constraint(
            f"fk_family_events_{column}_members", "family_events", type_="foreignkey"
        )
        op.execute(
            f"ALTER TABLE family_events ADD CONSTRAINT fk_event_{name}_family "
            f"FOREIGN KEY ({column}, family_id) REFERENCES members (id, family_id) "
            f"ON DELETE SET NULL ({column})"
        )
    op.add_column(
        "family_events",
        sa.Column("kind", sa.Text(), nullable=False, server_default=sa.text("'event'")),
    )
    op.add_column("family_events", sa.Column("activity_status", sa.Text()))
    op.add_column("family_events", sa.Column("location", sa.Text()))
    op.add_column(
        "family_events",
        sa.Column("reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "family_events",
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column(
        "family_events",
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_check_constraint("event_kind", "family_events", "kind IN ('event','activity')")
    op.create_check_constraint("event_revision_positive", "family_events", "revision >= 1")
    op.create_check_constraint(
        "event_activity_shape",
        "family_events",
        "(kind='event' AND activity_status IS NULL AND location IS NULL AND reminder_enabled) OR "
        "(kind='activity' AND activity_status IS NOT NULL "
        "AND activity_status IN ('planned','done','cancelled') AND for_member_id IS NULL "
        "AND char_length(title) BETWEEN 1 AND 120 "
        "AND (note IS NULL OR char_length(note) <= 2000) "
        "AND (location IS NULL OR char_length(location) <= 180))",
    )
    for action, expression in (
        ("SELECT", f"kind='event' OR ({_ACTIVE})"),
        ("INSERT", f"kind='event' OR (({_ACTIVE}) AND member_id = {_MEMBER})"),
        ("UPDATE", f"kind='event' OR ({_MODIFY})"),
        ("DELETE", f"kind='event' OR ({_MODIFY})"),
    ):
        using = "" if action == "INSERT" else f"USING ({expression})"
        check = f"WITH CHECK ({expression})" if action in {"INSERT", "UPDATE"} else ""
        op.execute(
            f"CREATE POLICY family_events_activity_{action.lower()} ON family_events "
            f"AS RESTRICTIVE FOR {action} {using} {check}"
        )
    op.execute("""
        CREATE FUNCTION family_event_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.family_id IS DISTINCT FROM OLD.family_id OR
               NEW.kind IS DISTINCT FROM OLD.kind THEN
                RAISE EXCEPTION 'Event family and kind are immutable' USING ERRCODE='42501';
            END IF;
            IF OLD.kind='activity' AND NEW.member_id IS DISTINCT FROM OLD.member_id THEN
                IF NEW.member_id IS NOT NULL OR OLD.member_id IS NULL OR
                   EXISTS (SELECT 1 FROM members m WHERE m.id=OLD.member_id) THEN
                    RAISE EXCEPTION 'Activity creator is immutable' USING ERRCODE='42501';
                END IF;
            END IF;
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER family_events_revision BEFORE UPDATE ON family_events "
        "FOR EACH ROW EXECUTE FUNCTION family_event_before_update()"
    )
    op.create_table(
        "activity_participants",
        sa.Column("activity_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("member_id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["activity_id", "family_id"],
            ["family_events.id", "family_events.family_id"],
            name="fk_activity_participant_event_family",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id", "family_id"],
            ["members.id", "members.family_id"],
            name="fk_activity_participant_member_family",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_activity_participants_family_id", "activity_participants", ["family_id"])
    op.execute("ALTER TABLE activity_participants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE activity_participants FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY activity_participants_family_isolation ON activity_participants "
        f"FOR ALL USING ({_FAMILY}) WITH CHECK ({_FAMILY})"
    )
    parent_read = """EXISTS (SELECT 1 FROM family_events e
        WHERE e.id=activity_participants.activity_id
          AND e.family_id=activity_participants.family_id AND e.kind='activity')"""
    parent_modify = f"""EXISTS (SELECT 1 FROM family_events e
        WHERE e.id=activity_participants.activity_id
          AND e.family_id=activity_participants.family_id AND e.kind='activity'
          AND (e.member_id={_MEMBER} OR EXISTS (
        SELECT 1 FROM members m WHERE m.id={_MEMBER} AND m.family_id=e.family_id
        AND m.role IN ('owner','admin'))))"""  # noqa: S608 -- module-owned SQL constants.
    for action in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        expression = parent_read if action == "SELECT" else parent_modify
        using = "" if action == "INSERT" else f"USING ({expression})"
        check = f"WITH CHECK ({expression})" if action in {"INSERT", "UPDATE"} else ""
        op.execute(
            f"CREATE POLICY activity_participants_{action.lower()} ON activity_participants "
            f"AS RESTRICTIVE FOR {action} {using} {check}"
        )
    op.execute("""
        CREATE FUNCTION activity_participant_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM family_events e WHERE e.id=NEW.activity_id
                           AND e.family_id=NEW.family_id AND e.kind='activity') THEN
                RAISE EXCEPTION 'Participant target must be an activity'
                    USING ERRCODE='23514', CONSTRAINT='activity_participant_target_kind';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM members m WHERE m.id=NEW.member_id
                           AND m.family_id=NEW.family_id AND m.membership_state='active') THEN
                RAISE EXCEPTION 'Activity participant must have active membership'
                    USING ERRCODE='23514', CONSTRAINT='activity_participant_active_member';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER activity_participants_guard BEFORE INSERT OR UPDATE "
        "ON activity_participants "
        "FOR EACH ROW EXECUTE FUNCTION activity_participant_before_write()"
    )


def downgrade() -> None:
    op.drop_table("activity_participants")
    op.execute("DROP FUNCTION activity_participant_before_write()")
    for action in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        op.execute(f"DROP POLICY family_events_activity_{action.lower()} ON family_events")
    # Migration owner holds the DDL lock until commit; no family context is assumed.
    op.execute("ALTER TABLE family_events DISABLE ROW LEVEL SECURITY")
    op.execute("DELETE FROM family_events WHERE kind='activity'")
    op.execute("ALTER TABLE family_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE family_events FORCE ROW LEVEL SECURITY")
    op.execute("DROP TRIGGER family_events_revision ON family_events")
    op.execute("DROP FUNCTION family_event_before_update()")
    for name in ("event_activity_shape", "event_revision_positive", "event_kind"):
        op.drop_constraint(name, "family_events", type_="check")
    for column in (
        "updated_at",
        "revision",
        "reminder_enabled",
        "location",
        "activity_status",
        "kind",
    ):
        op.drop_column("family_events", column)
    for column, name in (("member_id", "creator"), ("for_member_id", "for_member")):
        op.drop_constraint(f"fk_event_{name}_family", "family_events", type_="foreignkey")
        op.create_foreign_key(
            f"fk_family_events_{column}_members",
            "family_events",
            "members",
            [column],
            ["id"],
            ondelete="SET NULL",
        )
    op.drop_constraint("uq_family_events_id_family", "family_events", type_="unique")
