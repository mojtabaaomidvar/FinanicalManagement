"""Authenticated envelopes retain document compatibility and reject altered context."""

from __future__ import annotations

import base64
import uuid

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings
from app.models.document import HouseholdDocument
from app.models.goal import Goal
from app.services.encrypted_payload import cipher_from_key, decrypt_payload, encrypt_payload


@pytest.mark.parametrize("encoded", ["", "bad-base64!", "☃", base64.b64encode(b"x" * 31).decode()])
def test_invalid_key_is_rejected_without_returning_input(encoded):
    with pytest.raises(ValueError, match="^Invalid encryption key.$"):
        cipher_from_key(encoded)


def test_legacy_document_ciphertext_decrypts_and_new_envelope_uses_legacy_format():
    from app.services import documents

    key = base64.b64decode(settings.document_encryption_key)
    row = HouseholdDocument(id=uuid.uuid4(), family_id=uuid.uuid4(), owner_id=uuid.uuid4())
    plaintext = b"legacy document contents"
    nonce = bytes(range(12))
    aad = f"khaneyar-document-v1:{row.family_id}:{row.id}:file".encode("ascii")
    legacy = b"KYDOC1" + nonce + AESGCM(key).encrypt(nonce, plaintext, aad)
    assert documents._decrypt(row, "file", legacy) == plaintext
    generated = documents._encrypt(row, "file", plaintext)
    assert generated.startswith(b"KYDOC1")
    assert AESGCM(key).decrypt(generated[6:18], generated[18:], aad) == plaintext
    assert documents._decrypt(row, "file", generated) == plaintext


def test_random_nonces_and_aad_are_authenticated():
    cipher = cipher_from_key(settings.document_encryption_key)
    data = b"private content"
    first = encrypt_payload(cipher, data, prefix=b"KYGOAL1", aad=b"owner-one")
    second = encrypt_payload(cipher, data, prefix=b"KYGOAL1", aad=b"owner-one")
    assert first != second and first[7:19] != second[7:19]
    assert data not in first
    assert decrypt_payload(cipher, first, prefix=b"KYGOAL1", aad=b"owner-one") == data
    with pytest.raises(InvalidTag):
        decrypt_payload(cipher, first, prefix=b"KYGOAL1", aad=b"owner-two")
    altered = first[:-1] + bytes([first[-1] ^ 1])
    with pytest.raises(InvalidTag):
        decrypt_payload(cipher, altered, prefix=b"KYGOAL1", aad=b"owner-one")


@pytest.mark.parametrize("data", [b"", b"KYGOAL1", b"KYGOAL1" + b"x" * 27, b"KYDOC1" + b"x" * 40])
def test_malformed_or_other_domain_envelope_is_rejected(data):
    with pytest.raises(ValueError, match="^Invalid encrypted envelope.$"):
        decrypt_payload(
            cipher_from_key(settings.document_encryption_key),
            data,
            prefix=b"KYGOAL1",
            aad=b"owner-one",
        )


@pytest.mark.parametrize("changed", ["id", "family_id", "owner_id"])
def test_goal_aad_binds_identity_family_and_owner(changed):
    from app.services import goals

    row = Goal(id=uuid.uuid4(), family_id=uuid.uuid4(), owner_id=uuid.uuid4())
    cipher = cipher_from_key(settings.document_encryption_key)
    payload = encrypt_payload(cipher, b"goal", prefix=b"KYGOAL1", aad=goals._aad(row))
    setattr(row, changed, uuid.uuid4())
    with pytest.raises(InvalidTag):
        decrypt_payload(cipher, payload, prefix=b"KYGOAL1", aad=goals._aad(row))
