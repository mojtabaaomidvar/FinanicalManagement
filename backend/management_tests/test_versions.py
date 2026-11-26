import json

import pytest

from app.management.versions import installed_web_version


@pytest.mark.parametrize("value,expected", [
    ({"version": "0.11.0"}, "0.11.0"), ({"version": "0.2.0"}, "0.2.0"),
    ({"version": "0.3.0-preview.1"}, "0.3.0-preview.1"),
    ({"version": "PRIVATE-CONTENT"}, ""), ({"version": 1}, ""), ([], ""),
])
def test_versions_come_from_each_installed_artifact(tmp_path, value, expected):
    (tmp_path / "version.json").write_text(json.dumps(value), encoding="utf-8")
    assert installed_web_version(tmp_path) == expected


def test_missing_or_invalid_metadata_is_unknown_not_api_version(tmp_path):
    assert installed_web_version(tmp_path) == ""
    (tmp_path / "version.json").write_text("invalid", encoding="utf-8")
    assert installed_web_version(tmp_path) == ""
    (tmp_path / "version.json").write_text(" " * 4097, encoding="utf-8")
    assert installed_web_version(tmp_path) == ""
