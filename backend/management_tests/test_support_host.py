"""The shared support host must retain its existing routes, including on failed activation."""

import importlib.util
import subprocess
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "management_support_host", ROOT / "backend/deploy/management/support_host.py"
)
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)
SUPPORT = (ROOT / "backend/deploy/nginx/support.conf").read_text(encoding="utf-8")


def test_management_include_preserves_every_existing_support_directive():
    changed = HOST.support_configuration(SUPPORT)
    assert changed.replace("    " + HOST.INCLUDE + "\n", "") == SUPPORT
    assert HOST.support_configuration(changed) == changed
    assert "proxy_pass http://127.0.0.1:5710;" in HOST.ROUTES


@pytest.mark.parametrize(
    "text",
    [
        SUPPORT.replace("supp.khaanehyar.ir", "other.example"),
        SUPPORT.replace(HOST.ANCHOR, "    location /custom-api/ {"),
        SUPPORT + "\nlocation /management/ { return 200; }",
        SUPPORT + "\n" + HOST.INCLUDE,
    ],
)
def test_unknown_or_conflicting_configuration_is_rejected(text):
    with pytest.raises(ValueError):
        HOST.support_configuration(text)


@pytest.mark.parametrize("had_snippet", [False, True])
def test_failed_nginx_validation_restores_support_bytes(tmp_path, had_snippet):
    target = tmp_path / "support.conf"
    target.write_text(SUPPORT, encoding="utf-8")
    snippet = tmp_path / "management.conf"
    if had_snippet:
        snippet.write_text(HOST.ROUTES)
    state = tmp_path / "backup"
    # Windows symlink privileges are not required to exercise actual backup/write/restore.
    with (
        patch.object(HOST, "check", return_value=HOST.support_configuration(SUPPORT)),
        patch.object(HOST.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "nginx")),
        pytest.raises(subprocess.CalledProcessError),
    ):
        HOST.activate(state, target, tmp_path / "enabled", snippet)
    assert target.read_text(encoding="utf-8") == SUPPORT
    assert snippet.exists() == had_snippet
    if had_snippet:
        assert snippet.read_text() == HOST.ROUTES


def test_unknown_existing_snippet_is_rejected_before_writing(tmp_path):
    target = tmp_path / "support.conf"
    target.write_text(SUPPORT, encoding="utf-8")
    snippet = tmp_path / "management.conf"
    snippet.write_text("different existing configuration")
    link = Mock(spec=Path)
    link.is_symlink.return_value = True
    link.resolve.return_value = target.resolve()
    with pytest.raises(ValueError):
        HOST.check(target, link, snippet)
    assert target.read_text(encoding="utf-8") == SUPPORT
    assert snippet.read_text() == "different existing configuration"
