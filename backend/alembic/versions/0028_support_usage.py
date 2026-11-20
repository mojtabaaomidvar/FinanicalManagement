"""Anonymous usage totals and support-only registration metadata."""

from alembic import context, op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

MODULES = ("dashboard", "transactions", "accounts", "budgets", "bills", "reports", "calendar",
           "shopping", "inventory", "tasks", "documents", "meals", "equipment", "vehicles",
           "goals", "activities", "children", "pets", "market", "settings", "notifications")


def upgrade() -> None:
    if not context.is_offline_mode():
        privileged = op.get_bind().execute(sa.text(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user"
        )).scalar_one()
        if not privileged:
            raise RuntimeError("Support aggregate migration requires the database migration administrator.")
    op.add_column("members", sa.Column("support_registered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("members", sa.Column("support_last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table("support_usage_counters",
        sa.Column("hour", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("module", sa.Text(), primary_key=True),
        sa.Column("action", sa.Text(), primary_key=True),
        sa.Column("count", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("module IN (" + ",".join(repr(module) for module in MODULES) + ")", name="support_usage_module"),
        sa.CheckConstraint("action IN ('open','create','update','complete','delete')", name="support_usage_action"),
        sa.CheckConstraint("count > 0", name="support_usage_positive"))
    # No arguments, identifiers, amounts or record contents can leave this function.
    # The application role remains NOSUPERUSER/NOBYPASSRLS. Execution is granted
    # explicitly by the launcher after the administrator performs this migration.
    op.execute("""
        CREATE FUNCTION public.support_record_counts()
        RETURNS TABLE (transactions bigint, scheduled_plans bigint, open_tasks bigint,
                       completed_tasks bigint, shopping_lists bigint, documents bigint)
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog
        SET row_security = off
        AS $counts$
          SELECT (SELECT count(*) FROM public.transactions WHERE repeat='none'),
                 (SELECT count(*) FROM public.transactions WHERE repeat<>'none'),
                 (SELECT count(*) FROM public.tasks WHERE NOT completed),
                 (SELECT count(*) FROM public.tasks WHERE completed),
                 (SELECT count(*) FROM public.shopping_lists),
                 (SELECT count(*) FROM public.documents)
        $counts$
    """)
    op.execute("REVOKE ALL ON FUNCTION public.support_record_counts() FROM PUBLIC")


def downgrade() -> None:
    op.execute("DROP FUNCTION public.support_record_counts()")
    op.drop_table("support_usage_counters")
    op.drop_column("members", "support_last_login_at")
    op.drop_column("members", "support_registered_at")
