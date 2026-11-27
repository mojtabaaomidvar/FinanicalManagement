"""Emit content-free household invalidations only after committed changes."""
from alembic import op
import sqlalchemy as sa

revision = "0041_household_changes"
down_revision = "0040_inventory_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION public.notify_household_change() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        DECLARE before_row jsonb; after_row jsonb; old_family text; new_family text;
        BEGIN
            IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
            IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
            IF TG_OP = 'UPDATE' AND
                (before_row - ARRAY['revision', 'updated_at', 'support_last_login_at']) =
                (after_row - ARRAY['revision', 'updated_at', 'support_last_login_at'])
            THEN RETURN NEW; END IF;
            IF TG_TABLE_NAME = 'families' THEN
                old_family := before_row->>'id'; new_family := after_row->>'id';
            ELSE
                old_family := before_row->>'family_id'; new_family := after_row->>'family_id';
            END IF;
            IF old_family IS NOT NULL THEN PERFORM pg_notify('khaneyar_household', old_family); END IF;
            IF new_family IS NOT NULL AND new_family IS DISTINCT FROM old_family THEN
                PERFORM pg_notify('khaneyar_household', new_family);
            END IF;
            RETURN COALESCE(NEW, OLD);
        END;
        $$;
    """)
    tables = op.get_bind().execute(sa.text("""
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'family_id'
          AND table_name NOT LIKE '%receipt%' AND table_name NOT LIKE 'usage_%'
        UNION SELECT 'families'
    """)).scalars()
    quote = op.get_bind().dialect.identifier_preparer.quote
    for table in tables:
        op.execute(f'CREATE TRIGGER household_changed AFTER INSERT OR UPDATE OR DELETE ON public.{quote(table)} '
                   'FOR EACH ROW EXECUTE FUNCTION public.notify_household_change()')


def downgrade() -> None:
    op.execute('DROP FUNCTION public.notify_household_change() CASCADE')
