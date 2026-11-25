"""Regression coverage on disposable PostgreSQL; no live SMS or paid inference."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest
from sqlalchemy import text

from app.services.sms_parser import detect_bank, extract_date, extract_time, parse_sms
from app.services.transaction_categories import BY_TYPE
from tests.conftest import API, expect_status, next_card


RAW = "برداشت مبلغ 250,000 ریال; موجودی 1,000,000; 1405/09/03-14:37:52"


def wallet(client, actor, balance=100000):
    return expect_status(client.post(API + "/accounts", headers=actor.h, json={
        "member_id": actor.member_id, "title": "test wallet", "kind": "wallet", "initial_balance": balance,
    }), 201).json()["id"]


def import_sms(client, actor, raw=RAW, **metadata):
    expect_status(client.post(API + "/sms", headers=actor.h, json={"items": [{
        "raw_text": raw, "bank": "بانک دی", "date": "2000-01-01", **metadata,
    }]}), 200)
    return client.get(API + "/sms", headers=actor.h).json()[0]


def payment(actor, account_id, **changes):
    return {"member_id": actor.member_id, "account_id": account_id, "type": "expense",
            "category": "food", "amount": 25000, "date": "2026-11-24", "time": "14:37:52", **changes}


def record(client, actor, sms_id, fields=None, **changes):
    return client.post(API + f"/sms/{sms_id}/record", headers=actor.h,
                       json={"transaction": fields, **changes})


@pytest.mark.parametrize("raw", ["موجودی", "دیروز", "today", "شهرستان", "سرمایه‌گذاری", "development"])
def test_bank_substrings_are_not_bank_evidence(raw):
    assert detect_bank(raw) is None


@pytest.mark.parametrize(("raw", "bank"), [
    ("بانک دی", "بانک دی"), ("Day Bank", "بانک دی"),
    ("بانک توسعه صادرات", "بانک توسعه صادرات"),
    ("بانک قرض‌الحسنه مهر ایران", "بانک مهر ایران"),
    ("بانک ملی بانک ملت", None),
])
def test_explicit_banks_and_conflicts(raw, bank):
    assert detect_bank(raw) == bank


@pytest.mark.parametrize("raw", ["1405/07/31", "2026/02/30", "05/09/03", "03/09/2026",
                                 "1405/09/03 و 1405/09/04", "91405/09/03"])
def test_calendar_ambiguity_and_rollover_require_review(raw):
    assert extract_date(raw) is None


@pytest.mark.parametrize(("raw", "expected"), [("۱۴:۳۷:۵۲", "14:37:52"), ("9:07", "09:07"),
    ("00:00", "00:00"), ("23:59:59", "23:59:59"), ("24:00", None), ("12:60", None),
    ("12:00:61", None), ("12:00 و 13:00", None)])
def test_time_precision_and_validation(raw, expected):
    assert extract_time(raw) == expected


def test_parser_retains_original_units_and_actual_event_time():
    parsed = parse_sms(RAW)
    assert (parsed.bank, parsed.amount, parsed.date, parsed.time) == (None, 250000, date(2026, 11, 24), "14:37:52")


def test_every_fixed_category_is_accepted_only_for_its_type(client, home_a):
    source, destination = wallet(client, home_a), wallet(client, home_a)
    for kind, categories in BY_TYPE.items():
        for category in categories:
            fields = payment(home_a, source, type=kind, category=category,
                             to_account_id=destination if kind == "transfer" else None, amount=10)
            expect_status(client.post(API + "/transactions", headers=home_a.h, json=fields), 201)
            fields["type"] = "expense" if kind == "income" else "income"
            expect_status(client.post(API + "/transactions", headers=home_a.h, json=fields), 422)


def test_import_is_server_parsed_and_receipt_time_is_separate(client, home_a):
    sms = import_sms(client, home_a, received_at="2026-11-25T20:00:00Z")
    assert sms["raw_text"] == RAW
    assert sms["bank"] is None and sms["date"] == "2026-11-24" and sms["time"] == "14:37:52"
    assert sms["received_at"].startswith("2026-11-25")
    assert sms["parser_version"] == "deterministic-v2"
    absent = import_sms(client, home_a, raw="برداشت مبلغ 250000 ریال", received_at="2026-11-25T20:00:00Z")
    assert absent["date"] is None and absent["time"] is None


def test_atomic_record_replay_notes_and_tombstone(client, home_a):
    account_id = wallet(client, home_a)
    sms = import_sms(client, home_a)
    fields = payment(home_a, account_id, note="شرح دلخواه")
    transaction = expect_status(record(client, home_a, sms["id"], fields), 200).json()
    assert transaction["time"] == "14:37:52" and transaction["note"] == "شرح دلخواه"
    replay = expect_status(record(client, home_a, sms["id"], {**fields, "amount": 9999999}), 200).json()
    assert replay["id"] == transaction["id"] and replay["amount"] == "25000"
    assert len(client.get(API + "/transactions", headers=home_a.h).json()) == 1
    stored = client.get(API + "/sms", headers=home_a.h).json()[0]
    assert stored["transaction_id"] == transaction["id"] and stored["status"] == "recorded"
    expect_status(client.patch(API + f'/sms/{sms["id"]}', headers=home_a.h, json={"status": "pending"}), 409)
    expect_status(client.delete(API + f'/transactions/{transaction["id"]}', headers=home_a.h), 204)
    expect_status(record(client, home_a, sms["id"], fields), 409)
    assert client.get(API + "/transactions", headers=home_a.h).json() == []


def test_bad_financial_write_rolls_back_both_sides(client, home_a):
    account_id = wallet(client, home_a, balance=20000)
    sms = import_sms(client, home_a)
    for changes, status in [({"category": "salary"}, 422), ({"date": None}, 422),
                            ({"time": "24:00"}, 422), ({}, 409)]:
        expect_status(record(client, home_a, sms["id"], payment(home_a, account_id, **changes)), status)
        assert client.get(API + "/transactions", headers=home_a.h).json() == []
        assert client.get(API + "/sms?status=pending", headers=home_a.h).json()[0]["transaction_id"] is None


def test_recording_concurrent_devices_and_reimports_make_one_transaction(client, home_a):
    account_id = wallet(client, home_a)
    sms = import_sms(client, home_a)
    def send(_):
        return record(client, home_a, sms["id"], payment(home_a, account_id))
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(send, range(4)))
    assert all(response.status_code == 200 for response in results), [r.text for r in results]
    assert len({r.json()["id"] for r in results}) == 1
    assert len(client.get(API + "/transactions", headers=home_a.h).json()) == 1
    assert expect_status(client.post(API + "/sms", headers=home_a.h,
        json={"items": [{"raw_text": RAW}]}), 200).json() == 0
    assert len(client.get(API + "/sms", headers=home_a.h).json()) == 1


def test_concurrent_imports_and_transport_identity(client, home_a):
    def send(_):
        return client.post(API + "/sms", headers=home_a.h, json={"items": [{"raw_text": RAW}]})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(send, range(4)))
    assert sum(expect_status(r, 200).json() for r in results) == 1
    # Distinct delivery IDs permit truly separate, identical financial events.
    raw = RAW + "; delivery identity test"
    for transport_id in ["message-a", "message-b", "message-a"]:
        client.post(API + "/sms", headers=home_a.h, json={"items": [{"raw_text": raw, "transport_id": transport_id}]})
    assert len(client.get(API + "/sms", headers=home_a.h).json()) == 3
    # A repeated stable delivery ID wins even if the transport changed the body.
    replay = client.post(API + "/sms", headers=home_a.h, json={"items": [{
        "raw_text": raw + "; forwarded again", "transport_id": "message-a"}]})
    assert expect_status(replay, 200).json() == 0


def test_fee_and_sms_link_are_atomic_and_replayed_once(client, home_a):
    account_id = expect_status(client.post(API + "/accounts", headers=home_a.h, json={
        "member_id": home_a.member_id, "title": "fee bank", "kind": "bank", "initial_balance": 100000,
        "card_number": next_card(),
    }), 201).json()["id"]
    sms = import_sms(client, home_a)
    fields = payment(home_a, account_id, transfer_fee_method="card_to_card")
    tx = expect_status(record(client, home_a, sms["id"], fields), 200).json()
    expect_status(record(client, home_a, sms["id"], fields), 200)
    rows = client.get(API + "/transactions", headers=home_a.h).json()
    assert len(rows) == 2 and sum(row["source_kind"] == "transfer_fee" for row in rows) == 1
    assert tx["transfer_fee_rial"] is not None
    assert next(row for row in rows if row["source_kind"] == "transfer_fee")["time"] == tx["time"]


def test_old_duplicate_pending_alias_never_makes_another_transaction(client, home_a, raw_sql):
    account_id = wallet(client, home_a)
    sms = import_sms(client, home_a)
    tx = expect_status(record(client, home_a, sms["id"], payment(home_a, account_id)), 200).json()
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": home_a.family_id})
    alias_id = raw_sql.execute(text("""INSERT INTO sms_messages (family_id, member_id, raw_text, status)
        VALUES (CAST(:family AS uuid), CAST(:member AS uuid), :raw, 'pending') RETURNING id"""),
        {"family": home_a.family_id, "member": home_a.member_id, "raw": RAW}).scalar_one()
    raw_sql.commit()
    replay = expect_status(record(client, home_a, str(alias_id), payment(home_a, account_id)), 200).json()
    assert replay["id"] == tx["id"]
    assert len(client.get(API + "/transactions", headers=home_a.h).json()) == 1
    assert client.get(API + "/sms?status=pending", headers=home_a.h).json() == []
    # Even without a second link, the old body alias resolves via the canonical SMS.
    assert expect_status(record(client, home_a, str(alias_id)), 200).json()["id"] == tx["id"]
    expect_status(client.delete(API + f'/transactions/{tx["id"]}', headers=home_a.h), 204)
    expect_status(record(client, home_a, str(alias_id), payment(home_a, account_id)), 409)
    assert client.get(API + "/transactions", headers=home_a.h).json() == []


def test_sms_record_is_inaccessible_across_families(client, home_a, home_b):
    sms = import_sms(client, home_a)
    expect_status(record(client, home_b, sms["id"]), 404)


def test_recipient_isolation_and_explicit_legacy_receipt(client, home_a, member_a, raw_sql):
    account_id = wallet(client, home_a)
    sms = import_sms(client, home_a)
    expect_status(record(client, member_a, sms["id"], payment(member_a, account_id)), 404)
    legacy = expect_status(client.post(API + "/transactions", headers=home_a.h,
        json=payment(home_a, account_id, note="بانک دی — متن قبلی")), 201).json()
    expect_status(record(client, home_a, sms["id"], existing_transaction_id=legacy["id"]), 409)
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": home_a.family_id})
    raw_sql.execute(text("UPDATE sms_messages SET parser_version=NULL, identity_key=NULL WHERE id=CAST(:id AS uuid)"), {"id": sms["id"]})
    raw_sql.commit()
    linked = expect_status(record(client, home_a, sms["id"], existing_transaction_id=legacy["id"]), 200).json()
    assert linked["id"] == legacy["id"] and linked["note"] == legacy["note"]
    assert len(client.get(API + "/transactions", headers=home_a.h).json()) == 1


def test_legacy_receipt_cannot_link_another_member_or_family_transaction(client, home_a, member_a, home_b, raw_sql):
    sms = import_sms(client, home_a)
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": home_a.family_id})
    raw_sql.execute(text("UPDATE sms_messages SET parser_version=NULL, identity_key=NULL WHERE id=CAST(:id AS uuid)"), {"id": sms["id"]})
    raw_sql.commit()
    for other in [member_a, home_b]:
        tx = expect_status(client.post(API + "/transactions", headers=other.h,
            json=payment(other, wallet(client, other))), 201).json()
        expect_status(record(client, home_a, sms["id"], existing_transaction_id=tx["id"]), 409)
    pending = client.get(API + "/sms?status=pending", headers=home_a.h).json()
    assert pending[0]["transaction_id"] is None


def test_legacy_receipt_cannot_reuse_another_sms_link_or_generated_fee(client, home_a, raw_sql):
    account_id = expect_status(client.post(API + "/accounts", headers=home_a.h, json={
        "member_id": home_a.member_id, "title": "receipt bank", "kind": "bank", "initial_balance": 100000,
        "card_number": next_card(),
    }), 201).json()["id"]
    first = import_sms(client, home_a)
    tx = expect_status(record(client, home_a, first["id"], payment(home_a, account_id,
        transfer_fee_method="card_to_card")), 200).json()
    fee = next(row for row in client.get(API + "/transactions", headers=home_a.h).json()
        if row["source_kind"] == "transfer_fee")
    legacy = import_sms(client, home_a, raw=RAW + "; different historical message")
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": home_a.family_id})
    raw_sql.execute(text("UPDATE sms_messages SET parser_version=NULL, identity_key=NULL WHERE id=CAST(:id AS uuid)"), {"id": legacy["id"]})
    raw_sql.commit()
    for transaction_id in [tx["id"], fee["id"]]:
        expect_status(record(client, home_a, legacy["id"], existing_transaction_id=transaction_id), 409)
    assert len(client.get(API + "/transactions", headers=home_a.h).json()) == 2
    assert client.get(API + "/sms?status=pending", headers=home_a.h).json()[0]["transaction_id"] is None


def test_fee_failure_after_flush_rolls_back_payment_fee_and_sms_link(client, home_a, monkeypatch):
    from app.core.errors import AppError
    from app.services import transactions
    account_id = expect_status(client.post(API + "/accounts", headers=home_a.h, json={
        "member_id": home_a.member_id, "title": "fee failure bank", "kind": "bank", "initial_balance": 100000,
        "card_number": next_card(),
    }), 201).json()["id"]
    sms = import_sms(client, home_a)
    sync = transactions._sync_transfer_fee
    def fail_after_flush(db, row):
        sync(db, row)
        db.flush()
        raise AppError("TEST_FAILURE", "Synthetic failure after payment and fee insertion", 409)
    monkeypatch.setattr(transactions, "_sync_transfer_fee", fail_after_flush)
    expect_status(record(client, home_a, sms["id"], payment(home_a, account_id,
        transfer_fee_method="card_to_card")), 409)
    assert client.get(API + "/transactions", headers=home_a.h).json() == []
    pending = client.get(API + "/sms?status=pending", headers=home_a.h).json()
    assert pending[0]["id"] == sms["id"] and pending[0]["transaction_id"] is None


def test_distinct_transport_ids_record_distinct_identical_events(client, home_a):
    account_id = wallet(client, home_a)
    for identity in ["event-1", "event-2"]:
        import_sms(client, home_a, transport_id=identity)
    rows = client.get(API + "/sms?status=pending", headers=home_a.h).json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda sms: record(client, home_a, sms["id"], payment(home_a, account_id)), rows))
    assert len({expect_status(result, 200).json()["id"] for result in results}) == 2
    assert len(client.get(API + "/transactions", headers=home_a.h).json()) == 2


def test_unlinked_recorded_legacy_sms_never_creates_another_transaction(client, home_a, raw_sql):
    account_id = wallet(client, home_a)
    sms = import_sms(client, home_a)
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": home_a.family_id})
    raw_sql.execute(text("UPDATE sms_messages SET status='recorded', parser_version=NULL, identity_key=NULL WHERE id=CAST(:id AS uuid)"), {"id": sms["id"]})
    raw_sql.commit()
    expect_status(record(client, home_a, sms["id"], payment(home_a, account_id)), 409)
    assert client.get(API + "/transactions", headers=home_a.h).json() == []


def test_historical_mismatched_category_can_be_edited_without_reclassification(client, home_a, raw_sql):
    account_id = wallet(client, home_a)
    fields = payment(home_a, account_id, type="income", category="ride", note="historical note")
    transaction = expect_status(client.post(API + "/transactions", headers=home_a.h, json=fields), 201).json()
    raw_sql.execute(text("SELECT set_config('app.family_id', :family, true)"), {"family": home_a.family_id})
    raw_sql.execute(text("UPDATE transactions SET category='food' WHERE id=CAST(:id AS uuid)"), {"id": transaction["id"]})
    raw_sql.commit()
    expect_status(client.patch(API + f'/transactions/{transaction["id"]}', headers=home_a.h,
        json={**fields, "category": "food", "note": "edited note"}), 204)
    stored = client.get(API + "/transactions", headers=home_a.h).json()[0]
    assert stored["category"] == "food" and stored["note"] == "edited note"


def test_ai_finance_scope_is_rejected_before_inference(client, home_a, monkeypatch):
    from app.services import household_assistant, contextual_assistant
    def forbidden(*args, **kwargs):
        pytest.fail("financial-only input must not invoke an AI provider")
    monkeypatch.setattr(household_assistant, "request_deepseek_json", forbidden)
    monkeypatch.setattr(contextual_assistant, "_infer", forbidden)
    expect_status(client.post(API + "/assistant/analyze", headers=home_a.h,
        json={"text": "ثبت درآمد تاکسی", "scope": "finance"}), 422)
    expect_status(client.post(API + "/assistant/report", headers=home_a.h,
        json={"text": "ثبت تراکنش 25000 تومان"}), 422)


def test_additive_migration_preserves_existing_sms_and_transactions(client, home_a, database):
    from alembic import command
    from alembic.config import Config
    from tests.conftest import BACKEND_DIR, MIGRATION_URL
    account_id = wallet(client, home_a)
    import_sms(client, home_a)
    expect_status(client.post(API + "/transactions", headers=home_a.h,
        json=payment(home_a, account_id, note="بانک دی — شرح قدیمی")), 201)
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["migration_url"] = MIGRATION_URL.render_as_string(hide_password=False)
    command.downgrade(cfg, "0034_assistant_receipts")
    def snapshot():
        with database.connect() as connection:
            return {table: connection.execute(text(f"SELECT row_to_json(t) FROM {table} t ORDER BY id")).scalars().all()
                    for table in ["transactions", "sms_messages"]}
    before = snapshot()
    try:
        command.upgrade(cfg, "head")
        after = snapshot()
        for table, rows in before.items():
            assert [{key: row[key] for key in rows[i]} for i, row in enumerate(after[table])] == rows
        assert all(row["transaction_id"] is None and row["parser_version"] is None and row["time"] is None
                   for row in after["sms_messages"])
    finally:
        command.upgrade(cfg, "head")
        from tests.conftest import grant_test_application_access
        grant_test_application_access(database)
