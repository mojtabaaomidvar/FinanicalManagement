"""Small authenticated envelope primitives; domains own their AAD and public errors."""

from __future__ import annotations

import base64
import binascii
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def cipher_from_key(encoded_key: str) -> AESGCM:
    try:
        key = base64.b64decode(encoded_key, altchars=b"-_", validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("Invalid encryption key.") from None
    if len(key) != 32:
        raise ValueError("Invalid encryption key.")
    return AESGCM(key)


def encrypt_payload(cipher: AESGCM, data: bytes, *, prefix: bytes, aad: bytes) -> bytes:
    nonce = secrets.token_bytes(12)
    return prefix + nonce + cipher.encrypt(nonce, data, aad)


def decrypt_payload(cipher: AESGCM, data: bytes, *, prefix: bytes, aad: bytes) -> bytes:
    if not data.startswith(prefix) or len(data) < len(prefix) + 28:
        raise ValueError("Invalid encrypted envelope.")
    offset = len(prefix)
    return cipher.decrypt(data[offset : offset + 12], data[offset + 12 :], aad)
