"""Exercise actual web swaps and rollback without touching the management identity directory."""

import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "management_web_upgrade",
    Path(__file__).resolve().parents[1] / "deploy/management/upgrade-management-web.py",
)
UPGRADE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPGRADE)


@pytest.fixture
def installation(tmp_path):
    base = tmp_path / "management"
    live = base / "web"
    incoming = tmp_path / "release/web"
    runtime = base / "source/backend/app/management"
    for path in (live / "assets", incoming / "assets", runtime):
        path.mkdir(parents=True)
    (live / "version.json").write_text('{"version":"0.1.0"}')
    (live / "management.html").write_text("old HTML")
    (live / "assets/old.js").write_text("old script")
    (incoming / "version.json").write_text('{"version":"0.2.0"}')
    (incoming / "management.html").write_text("dashboard HTML")
    (incoming / "assets/new.js").write_text("dashboard script")
    (runtime / "main.py").write_text("unchanged runtime")
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"mode": "production", "origin": UPGRADE.ORIGIN, "web_root": str(live)}))
    identity = tmp_path / "identity.sqlite3"
    identity.write_bytes(b"Existing password and TOTP must remain untouched")

    def hashes(root):
        return {path.relative_to(root).as_posix(): UPGRADE.checksum(path)
                for path in root.rglob("*") if path.is_file()}

    manifest = {"tag": "management-v0.2.0", "management_version": "0.2.0",
                "web_sha256": hashes(incoming), "baseline_web_sha256": hashes(live),
                "retained_asset_sha256": {"assets/old.js": UPGRADE.checksum(live / "assets/old.js")},
                "baseline_runtime_sha256": hashes(runtime)}
    (incoming.parent / "validation.json").write_text(json.dumps(manifest))
    return base, incoming.parent, config, identity


def test_upgrade_preserves_identity_old_assets_backup_and_is_repeatable(installation):
    base, bundle, config, identity = installation
    before = identity.read_bytes(), config.read_bytes()
    probes = []
    result = UPGRADE.apply(bundle, base=base, config_path=config,
                           check_service=lambda origin, version: probes.append(version))
    assert result["updated"]
    assert (base / "web/management.html").read_text() == "dashboard HTML"
    assert (base / "web/assets/old.js").read_text() == "old script"
    assert (Path(result["backup"]) / "management.html").read_text() == "old HTML"
    assert (identity.read_bytes(), config.read_bytes()) == before
    assert probes == ["0.1.0", "0.2.0"]
    repeated = UPGRADE.apply(bundle, base=base, config_path=config, check_service=lambda *_: None)
    assert not repeated["updated"]


def test_failed_health_check_restores_the_previous_web_directory(installation):
    base, bundle, config, identity = installation
    before = identity.read_bytes()

    def service(_origin, version):
        if version == "0.2.0":
            raise RuntimeError("test health failure")

    with pytest.raises(RuntimeError, match="test health failure"):
        UPGRADE.apply(bundle, base=base, config_path=config, check_service=service)
    assert (base / "web/management.html").read_text() == "old HTML"
    assert identity.read_bytes() == before


@pytest.mark.parametrize("changed", ["web", "runtime", "bundle", "extra-file"])
def test_mismatched_source_or_installation_stops_before_swapping(installation, changed):
    base, bundle, config, identity = installation
    target = {"web": base / "web/management.html", "runtime": base / "source/backend/app/management/main.py",
              "bundle": bundle / "web/management.html", "extra-file": base / "web/manual.txt"}[changed]
    target.write_text("manual change")
    before = identity.read_bytes()
    with pytest.raises(ValueError):
        UPGRADE.apply(bundle, base=base, config_path=config, check_service=lambda *_: None)
    assert not (base / "web-backups").exists()
    assert identity.read_bytes() == before


def test_path_traversal_manifest_is_rejected(installation):
    _, bundle, _, _ = installation
    with pytest.raises(ValueError, match="Invalid release"):
        UPGRADE.verify_tree(bundle / "web", {"../config.json": "0" * 64})
