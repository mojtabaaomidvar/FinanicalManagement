"""Vehicles share maintenance; service expenses keep their immutable provenance.

Revision ID: 0019
Revises: 0018
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FAMILY = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"
_ADULT = """EXISTS (SELECT 1 FROM members m
    WHERE m.id = NULLIF(current_setting('app.document_member_id', true), '')::uuid
      AND m.family_id = family_id AND m.status = 'active' AND m.membership_state = 'active'
      AND (m.document_access_not_before IS NULL OR
           m.document_access_not_before <= (now() AT TIME ZONE 'Asia/Tehran')::date)
      AND ((m.birth_date IS NOT NULL AND m.birth_date <=
            ((now() AT TIME ZONE 'Asia/Tehran')::date - interval '18 years')::date)
           OR (m.birth_date IS NULL AND m.relation <> 'فرزند')))"""


def upgrade() -> None:
    op.create_table(
        "vehicles",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("brand", sa.Text()),
        sa.Column("model", sa.Text()),
        sa.Column("plate", sa.Text()),
        sa.Column("purchase_date", sa.Date()),
        sa.Column("odometer", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("insurance_until", sa.Date()),
        sa.Column("inspection_until", sa.Date()),
        sa.Column("document_id", UUID(as_uuid=True)),
        sa.Column("service_task_id", UUID(as_uuid=True)),
        sa.Column("service_due_date", sa.Date()),
        sa.Column("service_due_odometer", sa.Integer()),
        sa.Column(
            "service_reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column(
            "created_by", UUID(as_uuid=True), sa.ForeignKey("members.id", ondelete="SET NULL")
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("id", "family_id", name="uq_vehicles_id_family"),
        sa.CheckConstraint("revision >= 1", name="vehicle_revision_positive"),
        sa.CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="vehicle_title_length"),
        sa.CheckConstraint(
            "brand IS NULL OR char_length(brand) <= 80", name="vehicle_brand_length"
        ),
        sa.CheckConstraint(
            "model IS NULL OR char_length(model) <= 80", name="vehicle_model_length"
        ),
        sa.CheckConstraint(
            "plate IS NULL OR char_length(plate) <= 30", name="vehicle_plate_length"
        ),
        sa.CheckConstraint("odometer BETWEEN 0 AND 100000000", name="vehicle_odometer_range"),
        sa.CheckConstraint(
            "service_due_odometer IS NULL OR service_due_odometer BETWEEN 0 AND 100000000",
            name="vehicle_next_odometer_range",
        ),
    )
    for column, target, name in (
        ("document_id", "documents", "fk_vehicle_document_family"),
        ("service_task_id", "tasks", "fk_vehicle_task_family"),
    ):
        op.execute(
            f"ALTER TABLE vehicles ADD CONSTRAINT {name} FOREIGN KEY ({column}, family_id) "
            f"REFERENCES {target} (id, family_id) ON DELETE SET NULL ({column})"
        )
    op.create_index("ix_vehicles_family_id", "vehicles", ["family_id"])
    op.create_index("ix_vehicles_family_due", "vehicles", ["family_id", "service_due_date"])
    op.execute("ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE vehicles FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY vehicles_family_isolation ON vehicles FOR ALL "
        f"USING ({_FAMILY}) WITH CHECK ({_FAMILY})"
    )
    op.execute("""
        CREATE FUNCTION vehicle_bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.odometer < OLD.odometer THEN
                RAISE EXCEPTION 'Vehicle odometer cannot decrease' USING ERRCODE='23514';
            END IF;
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER vehicles_revision BEFORE UPDATE ON vehicles "
        "FOR EACH ROW EXECUTE FUNCTION vehicle_bump_revision()"
    )
    op.create_unique_constraint("uq_transactions_id_family", "transactions", ["id", "family_id"])
    op.add_column("transactions", sa.Column("source_kind", sa.Text()))
    op.create_check_constraint(
        "transaction_source_kind",
        "transactions",
        "source_kind IS NULL OR source_kind='vehicle_service'",
    )
    op.create_check_constraint(
        "transaction_source_shape",
        "transactions",
        "source_kind IS NULL OR (type='expense' AND category='transport' "
        "AND repeat='none' AND repeat_end IS NULL)",
    )
    source_access = "source_kind IS NULL OR " + _ADULT.replace(
        "m.family_id = family_id", "m.family_id = transactions.family_id"
    )
    op.execute(
        "CREATE POLICY transactions_vehicle_service_age ON transactions "
        f"AS RESTRICTIVE FOR ALL USING ({source_access}) WITH CHECK ({source_access})"
    )
    photo_access = """EXISTS (SELECT 1 FROM transactions t
        WHERE t.id = transaction_photos.transaction_id
          AND t.family_id = transaction_photos.family_id)"""
    op.execute(
        "CREATE POLICY transaction_photos_vehicle_service_age ON transaction_photos "
        f"AS RESTRICTIVE FOR ALL USING ({photo_access}) WITH CHECK ({photo_access})"
    )
    op.execute("""
        CREATE FUNCTION transaction_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.source_kind = 'vehicle_service' AND
               ROW(NEW.source_kind, NEW.type, NEW.category, NEW.date, NEW.member_id,
                   NEW.repeat, NEW.repeat_end, NEW.to_account_id) IS DISTINCT FROM
               ROW(OLD.source_kind, OLD.type, OLD.category, OLD.date, OLD.member_id,
                   OLD.repeat, OLD.repeat_end, OLD.to_account_id) THEN
                RAISE EXCEPTION 'Vehicle service expense provenance is immutable'
                    USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER transactions_source_guard BEFORE UPDATE ON transactions "
        "FOR EACH ROW EXECUTE FUNCTION transaction_source_guard()"
    )
    op.alter_column("maintenance_records", "equipment_id", nullable=True)
    op.add_column("maintenance_records", sa.Column("vehicle_id", UUID(as_uuid=True)))
    op.add_column("maintenance_records", sa.Column("performed_odometer", sa.Integer()))
    op.add_column("maintenance_records", sa.Column("next_due_odometer", sa.Integer()))
    op.add_column("maintenance_records", sa.Column("transaction_id", UUID(as_uuid=True)))
    op.add_column(
        "maintenance_records",
        sa.Column("had_cost", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_foreign_key(
        "fk_maintenance_vehicle_family",
        "maintenance_records",
        "vehicles",
        ["vehicle_id", "family_id"],
        ["id", "family_id"],
        ondelete="CASCADE",
    )
    op.execute(
        "ALTER TABLE maintenance_records ADD CONSTRAINT fk_maintenance_transaction_family "
        "FOREIGN KEY (transaction_id, family_id) REFERENCES transactions (id, family_id) "
        "ON DELETE SET NULL (transaction_id)"
    )
    op.create_check_constraint(
        "maintenance_one_target",
        "maintenance_records",
        "num_nonnulls(equipment_id, vehicle_id) = 1",
    )
    op.create_check_constraint(
        "maintenance_vehicle_details",
        "maintenance_records",
        "(equipment_id IS NOT NULL AND performed_odometer IS NULL "
        "AND next_due_odometer IS NULL AND transaction_id IS NULL AND NOT had_cost) OR "
        "(vehicle_id IS NOT NULL AND performed_odometer IS NOT NULL "
        "AND performed_odometer BETWEEN 0 AND 100000000 AND "
        "(next_due_odometer IS NULL OR (next_due_odometer > performed_odometer "
        "AND next_due_odometer <= 100000000)))",
    )
    op.create_check_constraint(
        "maintenance_cost_link", "maintenance_records", "transaction_id IS NULL OR had_cost"
    )
    history_access = "vehicle_id IS NULL OR " + _ADULT.replace(
        "m.family_id = family_id", "m.family_id = maintenance_records.family_id"
    )
    op.execute(
        "CREATE POLICY maintenance_vehicle_age ON maintenance_records "
        f"AS RESTRICTIVE FOR ALL USING ({history_access}) WITH CHECK ({history_access})"
    )
    op.create_index("ix_maintenance_records_vehicle_id", "maintenance_records", ["vehicle_id"])
    op.create_index(
        "ix_maintenance_records_transaction_id", "maintenance_records", ["transaction_id"]
    )


def downgrade() -> None:
    op.execute("DROP POLICY maintenance_vehicle_age ON maintenance_records")
    op.execute("DELETE FROM maintenance_records WHERE vehicle_id IS NOT NULL")
    for name in ("maintenance_cost_link", "maintenance_vehicle_details", "maintenance_one_target"):
        op.drop_constraint(name, "maintenance_records", type_="check")
    op.drop_constraint(
        "fk_maintenance_transaction_family", "maintenance_records", type_="foreignkey"
    )
    op.drop_constraint("fk_maintenance_vehicle_family", "maintenance_records", type_="foreignkey")
    for name in (
        "had_cost",
        "transaction_id",
        "next_due_odometer",
        "performed_odometer",
        "vehicle_id",
    ):
        op.drop_column("maintenance_records", name)
    op.alter_column("maintenance_records", "equipment_id", nullable=False)
    op.execute("DROP POLICY transactions_vehicle_service_age ON transactions")
    op.execute("DROP POLICY transaction_photos_vehicle_service_age ON transaction_photos")
    op.execute("DROP TRIGGER transactions_source_guard ON transactions")
    op.execute("DROP FUNCTION transaction_source_guard()")
    op.drop_constraint("transaction_source_shape", "transactions", type_="check")
    op.drop_constraint("transaction_source_kind", "transactions", type_="check")
    op.drop_column("transactions", "source_kind")
    op.drop_constraint("uq_transactions_id_family", "transactions", type_="unique")
    op.drop_table("vehicles")
    op.execute("DROP FUNCTION vehicle_bump_revision()")
