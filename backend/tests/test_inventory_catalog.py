"""Persistent categories, anonymous proposal review and historical outbox compatibility."""
import hashlib
import json
from pathlib import Path
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import create_household
from tests.test_shopping import new_stock, stock_of
from tests.test_shopping_offline import mutation, send, snapshot
from tests.test_support_panel import operator, login, PREFIX, ORIGIN  # noqa: F401


def proposals(database):
    with database.connect() as conn:
        return conn.execute(text("SELECT * FROM inventory_catalog_proposals ORDER BY title")).mappings().all()


def test_packaged_catalog_parity_and_exact_matching():
    from app.services.inventory_catalog import CATALOG, infer_category
    root = Path(__file__).resolve().parents[2]
    assert CATALOG == json.loads((root / 'src/domain/inventory/inventory.catalog.json').read_text(encoding='utf-8'))
    for group, items in CATALOG.items():
        for item in items:
            assert infer_category(item['title']) == group
    assert infer_category('تُخم مرغ') == 'refrigerated'
    assert infer_category('وایتكس') == 'cleaning'
    assert infer_category('چسب تفلون') == 'plumbing'
    assert infer_category('تخم') is None
    assert infer_category('نام شخصی') is None


def test_saved_category_and_minimal_deduplicated_proposals(client, home_a, database):
    item = new_stock(client, home_a, title='کالای شخصی', category='cleaning', quantity='9', unit='بطری', note='یادداشت خصوصی')
    assert item['category'] == 'cleaning' and 'threshold' not in item
    other = create_household(client)
    new_stock(client, other, title='کالای شخصی', category='cleaning', unit='بطری')
    rows = proposals(database)
    assert len(rows) == 1
    assert set(rows[0]) == {'id', 'submission_key', 'title', 'category', 'unit', 'status', 'submitted_at', 'reviewed_at'}
    assert rows[0]['title'] == 'کالای شخصی'
    assert 'یادداشت خصوصی' not in str(rows)
    new_stock(client, home_a, title='تُخم مرغ')
    assert len(proposals(database)) == 1
    assert snapshot(client, home_a)['inventory'][0]['category'] is not None
    assert len(stock_of(client, other)) == 1
    update = client.patch('/api/v1/inventory/' + item['id'], headers=home_a.h,
                        json={'title':item['title'], 'quantity':4, 'unit':'بطری'})
    assert update.status_code == 200, update.text
    assert update.json()['category'] == 'cleaning'


def test_offline_save_replay_and_conflict_do_not_duplicate_or_leak(client, home_a, database):
    body = mutation('inventory.create', str(uuid.uuid4()), None, title='محصول آفلاین', category='repairs', unit='عدد', quantity=12, note='خصوصی')
    first = send(client, home_a, body)
    assert first['snapshot']['inventory'][0]['category'] == 'repairs'
    assert send(client, home_a, body)['replayed'] is True
    assert len(proposals(database)) == 1
    failed = mutation('inventory.update', body['entity_id'], 99, title='نباید پیشنهاد شود', category='cleaning')
    send(client, home_a, failed, 409)
    assert len(proposals(database)) == 1
    old_update = mutation('inventory.update', body['entity_id'], 1, title='محصول آفلاین', quantity=3, threshold=4)
    result = send(client, home_a, old_update)
    assert result['snapshot']['inventory'][0]['category'] == 'repairs'
    assert send(client, home_a, old_update)['replayed'] is True
    assert len(proposals(database)) == 2  # Historical write has no unit; no identity/quantity is the dedup key.


def test_historical_payload_hash_remains_replayable(client, home_a, database):
    body = mutation('inventory.create', str(uuid.uuid4()), None, title='برنج', quantity=2, threshold=4)
    result = send(client, home_a, body)
    assert result['snapshot']['inventory'][0]['category'] == 'grains'
    encoded = json.dumps(body, sort_keys=True, separators=(',', ':'))
    with database.connect() as conn:
        saved = conn.execute(text('SELECT request_hash FROM shopping_sync_receipts WHERE operation_id=:id'), {'id':body['operation_id']}).scalar_one()
    assert saved == hashlib.sha256(encoded.encode()).hexdigest()
    assert send(client, home_a, body)['replayed'] is True


def test_review_requires_operator_and_origin_and_does_not_publish(client, home_a, database):
    from app.services.inventory_catalog import CATALOG
    before = json.dumps(CATALOG, sort_keys=True)
    new_stock(client, home_a, title='قلم ناشناخته', category='cleaning')
    proposal_id = str(proposals(database)[0]['id'])
    body = {'id':proposal_id, 'status':'approved'}
    assert client.get(PREFIX + '/catalog', headers=home_a.h).status_code == 401
    assert client.post(PREFIX + '/catalog/review', headers={**home_a.h, **ORIGIN}, json=body).status_code == 401
    login(client)
    assert client.post(PREFIX + '/catalog/review', json=body).status_code == 403
    assert client.post(PREFIX + '/catalog/review', headers={'Origin':'https://untrusted.example'}, json=body).status_code == 403
    reviewed = client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=body)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()['status'] == 'approved' and reviewed.json()['reviewed_at']
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=body).status_code == 200
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json={**body, 'status':'rejected'}).status_code == 409
    assert client.get(PREFIX + '/catalog').json()['total'] == 0
    assert client.get(PREFIX + '/catalog?status=approved').json()['total'] == 1
    assert client.get(PREFIX + '/catalog?limit=51').status_code == 422
    assert json.dumps(CATALOG, sort_keys=True) == before
    other = create_household(client)
    new_stock(client, other, title='قلم ناشناخته', category='cleaning')
    assert len(proposals(database)) == 1
    assert proposals(database)[0]['status'] == 'approved'


def test_threshold_column_gone_and_inventory_rls_restored(database):
    with database.connect() as conn:
        fields = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='inventory_items'")).scalars().all()
        assert 'category' in fields and 'threshold' not in fields
        assert conn.execute(text("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname='inventory_items'")).scalar_one()


@pytest.mark.parametrize('offline', [False, True])
def test_proposal_and_inventory_roll_back_together(client, home_a, database, monkeypatch, offline):
    from app.core.errors import AppError
    from app.services import inventory_catalog
    original = inventory_catalog.propose

    def fail_after_insert(db, **values):
        original(db, **values)
        db.flush()
        raise AppError('SERVER', 'Injected transactional failure', 503)

    with monkeypatch.context() as patch:
        patch.setattr(inventory_catalog, 'propose', fail_after_insert)
        if offline:
            command = mutation('inventory.create', str(uuid.uuid4()), None,
                               title='Rollback candidate', category='repairs', quantity=2)
            send(client, home_a, command, 503)
        else:
            response = client.post('/api/v1/inventory', headers=home_a.h,
                                   json={'title':'Rollback candidate', 'category':'repairs', 'quantity':2})
            assert response.status_code == 503
    assert proposals(database) == []
    assert stock_of(client, home_a) == []
    if offline:
        assert send(client, home_a, command)['replayed'] is False
    else:
        new_stock(client, home_a, title='Rollback candidate', category='repairs', quantity=2)
    assert len(proposals(database)) == 1


def test_migration_backfills_legacy_rows_and_keeps_quantities_notes_and_receipts(database):
    """Run the irreversible migration in a disposable schema, then roll it all back."""
    import importlib.util
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).resolve().parents[1] / 'alembic/versions/0033_inventory_categories.py'
    spec = importlib.util.spec_from_file_location('inventory_category_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    schema = 'inventory_migration_' + uuid.uuid4().hex
    with database.connect() as conn:
        transaction = conn.begin()
        try:
            conn.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
            conn.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
            conn.exec_driver_sql('''CREATE TABLE inventory_items (
                id uuid PRIMARY KEY, family_id uuid NOT NULL, title text NOT NULL,
                quantity numeric(10,2) NOT NULL, threshold numeric(10,2) NOT NULL, note text,
                CONSTRAINT ck_inventory_items_threshold_not_negative CHECK (threshold >= 0))''')
            conn.exec_driver_sql('ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY')
            conn.exec_driver_sql('ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY')
            conn.exec_driver_sql('CREATE TABLE shopping_sync_receipts (operation_id uuid, request_hash text)')
            rows = [{'id':uuid.uuid4(), 'family':uuid.uuid4(), 'title':title, 'quantity':'2.75', 'threshold':'8', 'note':'private'}
                    for title in ['تُخم مرغ', 'چسب تفلون', 'قلم ناشناس قدیمی']]
            conn.execute(text('INSERT INTO inventory_items VALUES (:id,:family,:title,:quantity,:threshold,:note)'), rows)
            conn.execute(text('INSERT INTO shopping_sync_receipts VALUES (:id,:hash)'), {'id':uuid.uuid4(), 'hash':'immutable-history'})
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
            saved = conn.execute(text('SELECT title, category, quantity, note FROM inventory_items')).mappings().all()
            assert {row['title']:row['category'] for row in saved} == {
                'تُخم مرغ':'refrigerated', 'چسب تفلون':'plumbing', 'قلم ناشناس قدیمی':None}
            assert all(str(row['quantity']) == '2.75' and row['note'] == 'private' for row in saved)
            fields = conn.execute(text('SELECT column_name FROM information_schema.columns WHERE table_schema=:schema AND table_name=\'inventory_items\''), {'schema':schema}).scalars().all()
            assert 'category' in fields and 'threshold' not in fields
            assert conn.execute(text('SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid=\'inventory_items\'::regclass')).scalar_one()
            assert conn.execute(text('SELECT request_hash FROM shopping_sync_receipts')).scalar_one() == 'immutable-history'
            assert conn.execute(text('SELECT count(*) FROM inventory_catalog_proposals')).scalar_one() == 0
        finally:
            transaction.rollback()
