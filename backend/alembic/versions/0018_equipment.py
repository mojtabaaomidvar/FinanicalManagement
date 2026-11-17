"""Home equipment, family-safe links and append-only service history.

Revision ID: 0018
Revises: 0017
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREDICATE = "family_id = NULLIF(current_setting('app.family_id', true), '')::uuid"


def _shared_columns() -> list[sa.Column]:
    return [
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "family_id",
            UUID(as_uuid=True),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by", UUID(as_uuid=True), sa.ForeignKey("members.id", ondelete="SET NULL")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    op.create_unique_constraint("uq_documents_id_family", "documents", ["id", "family_id"])
    op.create_unique_constraint("uq_tasks_id_family", "tasks", ["id", "family_id"])
    op.create_table(
        "home_equipment",
        *_shared_columns(),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("brand", sa.Text()),
        sa.Column("model", sa.Text()),
        sa.Column("purchase_date", sa.Date()),
        sa.Column("warranty_until", sa.Date()),
        sa.Column("warranty_document_id", UUID(as_uuid=True)),
        sa.Column("service_task_id", UUID(as_uuid=True)),
        sa.Column("service_due_date", sa.Date()),
        sa.Column(
            "service_reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("id", "family_id", name="uq_home_equipment_id_family"),
        sa.CheckConstraint("revision >= 1", name="equipment_revision_positive"),
        sa.CheckConstraint("char_length(title) BETWEEN 1 AND 120", name="equipment_title_length"),
        sa.CheckConstraint(
            "brand IS NULL OR char_length(brand) <= 80", name="equipment_brand_length"
        ),
        sa.CheckConstraint(
            "model IS NULL OR char_length(model) <= 80", name="equipment_model_length"
        ),
        sa.CheckConstraint(
            "purchase_date IS NULL OR warranty_until IS NULL OR warranty_until >= purchase_date",
            name="equipment_warranty_after_purchase",
        ),
    )
    # PostgreSQL 15+ nulls the optional id without nulling its tenant column.
    op.execute(
        "ALTER TABLE home_equipment ADD CONSTRAINT fk_equipment_document_family "
        "FOREIGN KEY (warranty_document_id, family_id) REFERENCES documents (id, family_id) "
        "ON DELETE SET NULL (warranty_document_id)"
    )
    op.execute(
        "ALTER TABLE home_equipment ADD CONSTRAINT fk_equipment_task_family "
        "FOREIGN KEY (service_task_id, family_id) REFERENCES tasks (id, family_id) "
        "ON DELETE SET NULL (service_task_id)"
    )
    op.create_table(
        "maintenance_records",
        *_shared_columns(),
        sa.Column("equipment_id", UUID(as_uuid=True), nullable=False),
        sa.Column("performed_on", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("next_due_date", sa.Date()),
        sa.Column("operation_id", UUID(as_uuid=True), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["equipment_id", "family_id"],
            ["home_equipment.id", "home_equipment.family_id"],
            ondelete="CASCADE",
            name="fk_maintenance_equipment_family",
        ),
        sa.UniqueConstraint("family_id", "operation_id", name="uq_maintenance_family_operation"),
        sa.CheckConstraint(
            "char_length(description) BETWEEN 1 AND 1000", name="maintenance_description_length"
        ),
        sa.CheckConstraint(
            "next_due_date IS NULL OR next_due_date > performed_on", name="maintenance_next_date"
        ),
    )
    op.create_index(
        "ix_home_equipment_family_due", "home_equipment", ["family_id", "service_due_date"]
    )
    op.create_index(
        "ix_maintenance_equipment_performed",
        "maintenance_records",
        ["equipment_id", "performed_on"],
    )
    op.execute("""
        CREATE FUNCTION equipment_bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.revision := OLD.revision + 1;
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$
    """)
    op.execute(
        "CREATE TRIGGER home_equipment_revision BEFORE UPDATE ON home_equipment "
        "FOR EACH ROW EXECUTE FUNCTION equipment_bump_revision()"
    )
    for table in ("home_equipment", "maintenance_records"):
        op.create_index(f"ix_{table}_family_id", table, ["family_id"])
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_family_isolation ON {table} FOR ALL "
            f"USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
        )


def downgrade() -> None:
    op.drop_table("maintenance_records")
    op.drop_table("home_equipment")
    op.execute("DROP FUNCTION equipment_bump_revision()")
    op.drop_constraint("uq_tasks_id_family", "tasks", type_="unique")
    op.drop_constraint("uq_documents_id_family", "documents", type_="unique")
