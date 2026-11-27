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
    new_stock(client, other, title='كالاي شخصي', category='cleaning', unit='بطری')
    rows = proposals(database)
    assert len(rows) == 1
    assert set(rows[0]) == {'id', 'submission_key', 'title', 'category', 'unit', 'status', 'submitted_at', 'reviewed_at', 'published_at'}
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


def test_review_requires_operator_and_origin_and_preserves_packaged_catalog(client, home_a, database):
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


def catalog(client, who):
    response = client.get('/api/v1/inventory/catalog', headers=who.h)
    assert response.status_code == 200, response.text
    return response.json()


def test_catalog_read_is_authenticated_and_excludes_pending_rejected_and_private_data(client, home_a, database):
    assert client.get('/api/v1/inventory/catalog').status_code == 401
    before = catalog(client, home_a)
    assert len(before) == 904 and len({row['id'] for row in before}) == 904
    assert all(set(row) == {'id', 'catalog_id', 'title', 'group', 'unit', 'aliases', 'common'} for row in before)
    assert len({row['catalog_id'] for row in before}) == 904
    new_stock(client, home_a, title='نام خصوصی پیشنهادی', category='cleaning', unit='بطری', note='یادداشت خانوادگی')
    assert catalog(client, home_a) == before
    login(client)
    rejected = client.post(PREFIX + '/catalog/review', headers=ORIGIN,
                          json={'id':str(proposals(database)[0]['id']), 'status':'rejected'})
    assert rejected.status_code == 200
    assert catalog(client, home_a) == before


def test_operator_edits_and_publishes_for_all_households_without_changing_stock(client, home_a, database):
    stock = new_stock(client, home_a, title='محصول پیشنهادی', category='cleaning', quantity='2.75', unit='بطری', note='خصوصی')
    proposal = proposals(database)[0]
    login(client)
    body = {'id':str(proposal['id']), 'status':'approved', 'title':'محصول اصلاح‌شده', 'category':'personal_care', 'unit':'بسته'}
    result = client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=body)
    assert result.status_code == 200, result.text
    assert result.json()['published_at']
    other = create_household(client)
    first = next(row for row in catalog(client, home_a) if row['title'] == body['title'])
    second = next(row for row in catalog(client, other) if row['title'] == body['title'])
    assert first == second
    assert first['id'] == str(proposal['id']) and first['group'] == body['category'] and first['unit'] == 'بسته'
    assert stock_of(client, home_a)[0] == stock
    assert stock_of(client, other) == []
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=body).status_code == 200
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json={**body, 'unit':'عدد'}).status_code == 409
    assert len([row for row in catalog(client, home_a) if row['title'] == body['title']]) == 1
    # Inference uses published metadata on both direct and historical outbox writes.
    new_stock(client, other, title=body['title'], unit='بسته')
    assert stock_of(client, other)[0]['category'] == body['category']
    out = send(client, home_a, mutation('inventory.create', str(uuid.uuid4()), None,
               title=body['title'], unit='بسته', quantity=1))
    assert next(row for row in out['snapshot']['inventory'] if row['title'] == body['title'])['category'] == body['category']
    assert len(proposals(database)) == 1


@pytest.mark.parametrize('changes', [
    {'category':'invented-group'}, {'category':None}, {'title':'   '}, {'title':'!!!'},
    {'title':'x' * 121}, {'unit':'x' * 21}, {'unknown':'value'},
])
def test_invalid_review_never_publishes(client, home_a, database, changes):
    new_stock(client, home_a, title='قلم برای بررسی', category='cleaning')
    login(client)
    body = {'id':str(proposals(database)[0]['id']), 'status':'approved', **changes}
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=body).status_code == 422
    assert proposals(database)[0]['status'] == 'pending'
    assert len(catalog(client, home_a)) == 904


def test_publication_rolls_back_with_review_failure(client, home_a, database, monkeypatch):
    from app.core.errors import AppError
    from app.services import inventory_catalog
    new_stock(client, home_a, title='قلم اتمیک', category='cleaning', quantity='4')
    login(client)

    def fail_after_publication(db, title):
        raise AppError('SERVER', 'Injected publication failure', 503)

    monkeypatch.setattr(inventory_catalog, 'approved_entry', fail_after_publication)
    response = client.post(PREFIX + '/catalog/review', headers=ORIGIN,
                           json={'id':str(proposals(database)[0]['id']), 'status':'approved'})
    assert response.status_code == 503
    with database.connect() as connection:
        assert connection.execute(text('SELECT count(*) FROM inventory_catalog_entries')).scalar_one() == 0
    assert proposals(database)[0]['status'] == 'pending'
    monkeypatch.undo()  # End publication fault injection before the independent stock read.
    assert str(stock_of(client, home_a)[0]['quantity']) == '4.00'


def test_concurrent_normalized_duplicates_have_one_public_identity(client, home_a, database):
    from concurrent.futures import ThreadPoolExecutor
    new_stock(client, home_a, title='پیشنهاد نخست', category='cleaning', unit='بطری')
    new_stock(client, home_a, title='پیشنهاد دوم', category='cleaning', unit='بطری')
    login(client)
    rows = proposals(database)
    assert len(rows) == 2
    bodies = [{'id':str(row['id']), 'status':'approved', 'title':title}
              for row, title in zip(rows, ['محصول کیفی', 'محصول كيفي'], strict=True)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda body: client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=body), bodies))
    assert [response.status_code for response in responses] == [200, 200]
    published = [row for row in catalog(client, home_a) if row['title'].startswith('محصول')]
    assert len(published) == 1
    assert sum(row['published_at'] is not None for row in proposals(database)) == 2


def test_legacy_approved_candidate_stays_private_until_explicit_publication(client, home_a, database):
    new_stock(client, home_a, title='پیشنهاد قدیمی', category='cleaning', unit='بطری')
    row = proposals(database)[0]
    with database.begin() as connection:
        connection.execute(text("UPDATE inventory_catalog_proposals SET status='approved', reviewed_at=now()"))
    assert len(catalog(client, home_a)) == 904
    login(client)
    result = client.post(PREFIX + '/catalog/review', headers=ORIGIN, json={'id':str(row['id']), 'status':'approved'})
    assert result.status_code == 200 and result.json()['published_at']
    assert len(catalog(client, home_a)) == 905


def test_duplicate_public_name_cannot_silently_overwrite_category_or_unit(client, home_a, database):
    new_stock(client, home_a, title='نام پیشنهادی اول', category='cleaning', unit='بطری')
    new_stock(client, home_a, title='نام پیشنهادی دوم', category='cleaning', unit='قوطی')
    first, second = proposals(database)
    login(client)
    first_review = {'id':str(first['id']), 'status':'approved', 'title':'نام مشترک منتشرشده', 'unit':'بطری'}
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=first_review).status_code == 200
    conflict = client.post(PREFIX + '/catalog/review', headers=ORIGIN,
                           json={'id':str(second['id']), 'status':'approved', 'title':'نام مشترک منتشرشده', 'unit':'قوطی'})
    assert conflict.status_code == 409
    assert next(row for row in proposals(database) if row['id'] == second['id'])['status'] == 'pending'
    entry = next(row for row in catalog(client, home_a) if row['title'] == first_review['title'])
    assert entry['unit'] == 'بطری'


def test_review_of_existing_preset_never_claims_to_publish_different_metadata(client, home_a, database):
    new_stock(client, home_a, title='نام نادرست پیشنهادی', category='cleaning', unit='بطری')
    row = proposals(database)[0]
    login(client)
    body = {'id':str(row['id']), 'status':'approved', 'title':'آب', 'category':'drinks', 'unit':'پاکت'}
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json=body).status_code == 409
    assert client.post(PREFIX + '/catalog/review', headers=ORIGIN, json={**body, 'unit':'بطری'}).status_code == 200
    assert len(catalog(client, home_a)) == 904


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
