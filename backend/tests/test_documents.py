"""Document confidentiality and CRUD through real HTTP and PostgreSQL RLS."""

from __future__ import annotations

import base64
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core.config import settings
from tests.conftest import API, AUTH, expect_status
from tests.conftest import add_active_member as _add_active_member

DOCS = f"{API}/documents"
PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer <<>>\n%%EOF"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


def add_active_member(client, owner):
    actor = _add_active_member(client, owner)
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation",
            headers=owner.h,
            json={"relation": "سایر"},
        ),
        200,
    )
    return actor


def create_document(
    client, actor, *, file_name="policy.pdf", data=PDF, mime="application/pdf", **fields
):
    return client.post(
        DOCS,
        headers=actor.h,
        data={"title": "بیمهٔ خانه", **fields},
        files={"file": (file_name, data, mime)},
    )


def create_doc(client, actor, **fields):
    return expect_status(create_document(client, actor, **fields), 201).json()


def listed(client, actor):
    return expect_status(client.get(DOCS, headers=actor.h), 200).json()


def update(client, actor, doc, **fields):
    return client.patch(
        f"{DOCS}/{doc['id']}", headers=actor.h, json={"base_revision": doc["revision"], **fields}
    )


def file_of(client, actor, doc):
    return client.get(f"{DOCS}/{doc['id']}/file", headers=actor.h)


def test_default_private_crud_file_and_encrypted_at_rest(client, raw_sql, home_a):
    doc = create_doc(client, home_a, category="حقوقی", expiry_date="2027-01-14")
    assert doc["visibility"] == "private" and doc["owner_id"] == home_a.member_id
    assert doc["reminder_enabled"] is True
    assert doc["can_edit"] and doc["can_delete"] and doc["can_change_visibility"]
    assert "url" not in doc and "encrypted_metadata" not in doc and "family_id" not in doc
    assert listed(client, home_a)[0] == doc
    response = expect_status(file_of(client, home_a, doc), 200)
    assert response.content == PDF and response.headers["Cache-Control"] == "no-store"
    assert response.headers["Content-Type"] == "application/pdf"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Security-Policy"] == (
        "default-src 'none'; object-src 'none'; frame-ancestors 'none'"
    )
    # Edge strips bodies from native fetch responses carrying Content-Disposition.
    # The UI uses the authorized metadata filename in its download attribute.
    assert "Content-Disposition" not in response.headers
    raw_sql.execute(
        text(
            "SELECT set_config('app.family_id', :fid, true), "
            "set_config('app.document_member_id', :mid, true)"
        ),
        {"fid": home_a.family_id, "mid": home_a.member_id},
    )
    metadata = bytes(
        raw_sql.execute(
            text("SELECT encrypted_metadata FROM documents WHERE id=:id"), {"id": doc["id"]}
        ).scalar_one()
    )
    assert "بیمهٔ خانه".encode() not in metadata and b"policy.pdf" not in metadata
    path = (
        Path(settings.storage_dir)
        / "private-documents"
        / home_a.family_id
        / home_a.member_id
        / (doc["id"] + ".bin")
    )
    ciphertext = path.read_bytes()
    assert ciphertext.startswith(b"KYDOC1") and PDF not in ciphertext
    raw_sql.rollback()
    edited = expect_status(
        update(
            client,
            home_a,
            doc,
            title="بیمه جدید",
            category=None,
            expiry_date=None,
            reminder_enabled=False,
        ),
        200,
    ).json()
    assert edited["revision"] == 2 and edited["category"] is None and edited["expiry_date"] is None
    assert edited["reminder_enabled"] is False and edited["title"] == "بیمه جدید"
    assert file_of(client, home_a, edited).content == PDF
    expect_status(
        client.delete(f"{DOCS}/{doc['id']}", headers=home_a.h, params={"base_revision": 2}), 204
    )
    assert listed(client, home_a) == [] and not path.exists()


def test_private_owner_excludes_both_admins_and_other_member(client, home_a):
    owner = add_active_member(client, home_a)
    other = add_active_member(client, home_a)
    admin = add_active_member(client, home_a)
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    doc = create_doc(client, owner)
    for actor in (home_a, admin, other):
        assert listed(client, actor) == []
        expect_status(file_of(client, actor, doc), 404)
        expect_status(update(client, actor, doc, title="غیرمجاز"), 404)
        expect_status(
            client.delete(f"{DOCS}/{doc['id']}", headers=actor.h, params={"base_revision": 1}), 404
        )
    assert file_of(client, owner, doc).content == PDF


def test_shared_policy_and_owner_only_visibility(client, home_a):
    owner = add_active_member(client, home_a)
    other = add_active_member(client, home_a)
    admin = add_active_member(client, home_a)
    expect_status(client.post(f"{AUTH}/members/{admin.member_id}/promote", headers=home_a.h), 200)
    doc = create_doc(client, owner, visibility="shared")
    other_view = listed(client, other)[0]
    assert not other_view["can_edit"] and not other_view["can_delete"]
    assert file_of(client, other, doc).content == PDF
    expect_status(update(client, other, doc, title="غیرمجاز"), 403)
    expect_status(update(client, admin, doc, visibility="private"), 403)
    doc = expect_status(update(client, admin, doc, title="اصلاح مدیر"), 200).json()
    assert doc["can_edit"] and not doc["can_change_visibility"]
    doc = expect_status(update(client, home_a, doc, category="بیمه"), 200).json()
    doc = expect_status(update(client, owner, doc, visibility="private"), 200).json()
    assert listed(client, home_a) == [] and listed(client, admin) == []
    assert listed(client, owner)[0]["visibility"] == "private"


def test_cross_household_and_unsigned_generic_file_never_expose_document(client, home_a, home_b):
    doc = create_doc(client, home_a, visibility="shared")
    assert listed(client, home_b) == []
    expect_status(file_of(client, home_b, doc), 404)
    expect_status(update(client, home_b, doc, title="غیرمجاز"), 404)
    from app.services.storage import sign_path

    path = f"private-documents/{home_a.family_id}/{home_a.member_id}/{doc['id']}.bin"
    expect_status(client.get(f"{API}/files/{path}", params={"sig": sign_path(path)}), 404)


@pytest.mark.parametrize(
    "endpoint,method",
    [
        (DOCS, "get"),
        (DOCS, "post"),
        (DOCS + "/" + str(uuid.uuid4()), "patch"),
        (DOCS + "/" + str(uuid.uuid4()), "delete"),
        (DOCS + "/" + str(uuid.uuid4()) + "/file", "get"),
    ],
)
def test_authentication_and_errors_no_store(client, endpoint, method):
    response = getattr(client, method)(endpoint)
    assert response.status_code in {401, 422}
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("state", ["suspended", "removed", "pending", "rejected"])
def test_membership_revocation_denies_saved_file_url(client, raw_sql, home_a, state):
    actor = add_active_member(client, home_a)
    doc = create_doc(client, actor)
    raw_sql.execute(
        text("UPDATE members SET membership_state=:state WHERE id=:id"),
        {"state": state, "id": actor.member_id},
    )
    raw_sql.commit()
    expect_status(file_of(client, actor, doc), 403)


@pytest.mark.parametrize("birth,relation", [("2015-01-01", "خودم"), (None, "فرزند")])
def test_known_minors_cannot_list_upload_or_read_shared(client, raw_sql, home_a, birth, relation):
    actor = add_active_member(client, home_a)
    doc = create_doc(client, home_a, visibility="shared")
    raw_sql.execute(
        text("UPDATE members SET birth_date=:birth, relation=:relation WHERE id=:id"),
        {"birth": birth, "relation": relation, "id": actor.member_id},
    )
    raw_sql.commit()
    expect_status(client.get(DOCS, headers=actor.h), 403)
    expect_status(create_document(client, actor), 403)
    expect_status(file_of(client, actor, doc), 403)


def test_revision_conflicts_preserve_changed_data(client, home_a):
    doc = create_doc(client, home_a)
    new = expect_status(update(client, home_a, doc, title="نسخه تازه"), 200).json()
    expect_status(update(client, home_a, doc, title="نسخه قدیمی"), 409)
    expect_status(
        client.delete(f"{DOCS}/{doc['id']}", headers=home_a.h, params={"base_revision": 1}), 409
    )
    assert listed(client, home_a)[0]["title"] == new["title"]


@pytest.mark.parametrize(
    "data,mime",
    [
        (b"", "application/pdf"),
        (b"<html>secret</html>", "application/pdf"),
        (PDF, "image/png"),
        (PNG, "image/svg+xml"),
        (b"%PDF-incomplete", "application/pdf"),
    ],
)
def test_rejects_invalid_or_spoofed_file_without_creating_record(client, home_a, data, mime):
    expect_status(create_document(client, home_a, data=data, mime=mime), 422)
    assert listed(client, home_a) == []


def test_png_size_limit_and_missing_key_fail_closed(client, home_a, monkeypatch):
    doc = create_doc(client, home_a, file_name="receipt.png", data=PNG, mime="image/png")
    assert file_of(client, home_a, doc).content == PNG
    expect_status(create_document(client, home_a, data=PDF + b"x" * (10 * 1024 * 1024)), 413)
    monkeypatch.setattr(settings, "document_encryption_key", "")
    response = expect_status(file_of(client, home_a, doc), 503)
    assert response.json()["error"] == "DOCUMENTS_NOT_CONFIGURED"
    expect_status(create_document(client, home_a), 503)


def test_private_rows_are_protected_in_database_and_member_scope_does_not_leak(
    client, raw_sql, home_a
):
    owner = add_active_member(client, home_a)
    doc = create_doc(client, owner)
    raw_sql.execute(
        text(
            "SELECT set_config('app.family_id', :fid, true), "
            "set_config('app.document_member_id', :mid, true)"
        ),
        {"fid": home_a.family_id, "mid": home_a.member_id},
    )
    assert raw_sql.execute(text("SELECT count(*) FROM documents")).scalar_one() == 0
    raw_sql.execute(
        text("SELECT set_config('app.document_member_id', :mid, true)"), {"mid": owner.member_id}
    )
    assert raw_sql.execute(text("SELECT count(*) FROM documents")).scalar_one() == 1
    raw_sql.rollback()
    assert raw_sql.execute(text("SELECT count(*) FROM documents")).scalar_one() == 0
    raw_sql.rollback()
    assert listed(client, owner)[0]["id"] == doc["id"]
    assert listed(client, home_a) == []
    assert listed(client, owner)[0]["id"] == doc["id"]


def test_audit_contains_ids_and_actions_without_document_text(client, home_a, caplog):
    with caplog.at_level("INFO", logger="app.services.documents"):
        doc = create_doc(client, home_a)
        expect_status(file_of(client, home_a, doc), 200)
    records = [
        record.getMessage() for record in caplog.records if record.name == "app.services.documents"
    ]
    assert any("action=file" in record and doc["id"] in record for record in records)
    assert all(
        "بیمه" not in record and "policy.pdf" not in record and "%PDF" not in record
        for record in records
    )


def test_document_notification_preferences_round_trip(client, home_a):
    response = expect_status(
        client.patch(
            f"{API}/notifications/prefs",
            headers=home_a.h,
            json={"domains": {"documents": False}, "lead_days": {"documents": 30}},
        ),
        200,
    )
    assert response.json()["domains"]["documents"] is False
    assert response.json()["lead_days"]["documents"] == 30


def test_concurrent_updates_preserve_one_winner(client, home_a):
    doc = create_doc(client, home_a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda title: update(client, home_a, doc, title=title), ["اول", "دوم"])
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    assert listed(client, home_a)[0]["title"] == winner["title"]


def test_ciphertext_swap_and_corruption_fail_closed(client, home_a):
    first = create_doc(client, home_a)
    second = create_doc(client, home_a)
    prefix = Path(settings.storage_dir) / "private-documents" / home_a.family_id / home_a.member_id
    first_path = prefix / (first["id"] + ".bin")
    second_path = prefix / (second["id"] + ".bin")
    original = first_path.read_bytes()
    first_path.write_bytes(second_path.read_bytes())
    response = expect_status(file_of(client, home_a, first), 503)
    assert response.json()["error"] == "DOCUMENT_UNAVAILABLE"
    first_path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
    expect_status(file_of(client, home_a, first), 503)
    assert file_of(client, home_a, second).content == PDF


@pytest.mark.parametrize(
    "field,value",
    [
        ("owner_id", str(uuid.uuid4())),
        ("family_id", str(uuid.uuid4())),
        ("file_name", "changed.pdf"),
        ("mime_type", "text/html"),
        ("title", None),
    ],
)
def test_patch_rejects_ownership_file_mutation_and_required_null(client, home_a, field, value):
    doc = create_doc(client, home_a)
    expect_status(update(client, home_a, doc, **{field: value}), 422)
    assert listed(client, home_a)[0]["revision"] == 1


def test_oversized_multipart_and_duplicate_field_fail_without_saved_record(client, home_a):
    response = create_document(client, home_a, data=b"x" * (12 * 1024 * 1024))
    expect_status(response, 413)
    duplicate = client.post(
        DOCS,
        headers=home_a.h,
        files=[
            ("title", (None, "اول")),
            ("title", (None, "دوم")),
            ("file", ("test.pdf", PDF, "application/pdf")),
        ],
    )
    expect_status(duplicate, 422)
    assert listed(client, home_a) == []


def test_member_rate_limit_uses_existing_protected_counter(client, home_a, rate_limit):
    rate_limit(documents_per_member=1)
    expect_status(client.get(DOCS, headers=home_a.h), 200)
    response = expect_status(client.get(DOCS, headers=home_a.h), 429)
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("birth,relation", [("2015-01-01", "سایر"), (None, "فرزند")])
def test_profile_date_and_relation_spoof_cannot_remove_document_restriction(
    client, raw_sql, home_a, birth, relation
):
    actor = add_active_member(client, home_a)
    shared = create_doc(client, home_a, visibility="shared")
    raw_sql.execute(
        text("UPDATE members SET birth_date=:birth, relation=:relation WHERE id=:id"),
        {"birth": birth, "relation": relation, "id": actor.member_id},
    )
    raw_sql.commit()
    # Profile corrections remain usable, but cannot promote sensitive-document access.
    response = expect_status(
        client.patch(
            f"{API}/members/me",
            headers=actor.h,
            json={"name": "نام تازه", "birth_date": "2000-01-01"},
        ),
        200,
    )
    assert response.json()["name"] == "نام تازه"
    assert "document_access_not_before" not in response.json()
    expect_status(file_of(client, actor, shared), 403)
    expect_status(
        client.patch(
            f"{API}/members/me", headers=actor.h, json={"name": "نام تازه", "birth_date": None}
        ),
        200,
    )
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation", headers=actor.h, json={"relation": "سایر"}
        ),
        200,
    )
    expect_status(client.get(DOCS, headers=actor.h), 403)
    # Even an admin cannot authorize their own formerly restricted account.
    expect_status(client.post(f"{AUTH}/members/{actor.member_id}/promote", headers=home_a.h), 200)
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation", headers=actor.h, json={"relation": "همسر"}
        ),
        200,
    )
    expect_status(client.get(DOCS, headers=actor.h), 403)
    # A different family manager explicitly authorizes reclassification.
    expect_status(
        client.patch(
            f"{API}/members/{actor.member_id}/relation", headers=home_a.h, json={"relation": "سایر"}
        ),
        200,
    )
    expect_status(file_of(client, actor, shared), 200)


def test_adult_offspring_with_existing_birthdate_are_allowed(client, raw_sql, home_a):
    actor = add_active_member(client, home_a)
    raw_sql.execute(
        text("UPDATE members SET birth_date='2000-01-01', relation='فرزند' WHERE id=:id"),
        {"id": actor.member_id},
    )
    raw_sql.commit()
    expect_status(create_document(client, actor), 201)


def test_unknown_child_insert_sets_backend_only_eligibility_date(client, raw_sql, home_a):
    actor = _add_active_member(client, home_a)
    assert (
        raw_sql.execute(
            text("SELECT document_access_not_before FROM members WHERE id=:id"),
            {"id": actor.member_id},
        )
        .scalar_one()
        .isoformat()
        == "9999-12-31"
    )
    raw_sql.rollback()
    expect_status(client.get(DOCS, headers=actor.h), 403)
    expect_status(
        client.patch(
            f"{API}/members/me", headers=actor.h, json={"name": "فرزند", "birth_date": "2000-01-01"}
        ),
        200,
    )
    expect_status(client.get(DOCS, headers=actor.h), 403)


def test_member_removal_cleans_private_and_shared_ciphertext_without_private_read(client, home_a):
    actor = add_active_member(client, home_a)
    private = create_doc(client, actor)
    shared = create_doc(client, actor, visibility="shared")
    home_doc = create_doc(client, home_a)
    root = Path(settings.storage_dir) / "private-documents" / home_a.family_id
    owner_dir = root / actor.member_id
    assert len(list(owner_dir.glob("*.bin"))) == 2
    expect_status(file_of(client, home_a, private), 404)
    expect_status(client.delete(f"{AUTH}/members/{actor.member_id}", headers=home_a.h), 200)
    assert not owner_dir.exists()
    assert all(item["id"] != shared["id"] for item in listed(client, home_a))
    assert file_of(client, home_a, home_doc).content == PDF


def test_successful_create_commit_keeps_file_if_refresh_fails(client, home_a, monkeypatch):
    from sqlalchemy.orm import Session

    original = Session.refresh

    def fail_document_refresh(self, instance, *args, **kwargs):
        from app.models.document import HouseholdDocument

        if isinstance(instance, HouseholdDocument):
            raise RuntimeError("test refresh failure after commit")
        return original(self, instance, *args, **kwargs)

    monkeypatch.setattr(Session, "refresh", fail_document_refresh)
    with pytest.raises(RuntimeError, match="test refresh failure after commit"):
        create_document(client, home_a)
    monkeypatch.setattr(Session, "refresh", original)
    doc = listed(client, home_a)[0]
    assert file_of(client, home_a, doc).content == PDF
