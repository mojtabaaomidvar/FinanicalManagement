"""Server archives exclude credentials; private setup preserves existing sandbox settings."""

from __future__ import annotations

import json
import runpy
import tarfile
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parents[3]


@pytest.fixture
def package_source(tmp_path, monkeypatch):
    module = runpy.run_path(str(PROJECT / "scripts/package-ai-gateway.py"))
    for name in module["FILES"]:
        destination = tmp_path / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes((PROJECT / name).read_bytes())
    sandbox = tmp_path / ".local-test"
    sandbox.mkdir()
    config = {
        "DeepSeekApiKey": "sk-synthetic-private-test-value",
        "DocumentEncryptionKey": "synthetic-existing-encryption-key",
        "Unknown": {"value": "preserve-me"},
    }
    (sandbox / "config.json").write_text(json.dumps(config), encoding="utf-8")
    main = module["main"]
    monkeypatch.setitem(main.__globals__, "ROOT", tmp_path)
    monkeypatch.setattr("sys.argv", ["package-ai-gateway.py", "--private-config"])
    return main, sandbox, config


def test_package_has_no_runtime_key_or_gateway_token(package_source, capsys):
    main, sandbox, original = package_source
    main()
    output = sandbox / "ai-gateway"
    config = json.loads((sandbox / "config.json").read_text(encoding="utf-8"))
    token = config["AiSmsGatewayToken"]
    private = (output / "gateway.env").read_text(encoding="utf-8")
    assert original["DeepSeekApiKey"] in private and token in private
    assert config["DocumentEncryptionKey"] == original["DocumentEncryptionKey"]
    assert config["Unknown"] == original["Unknown"]
    with tarfile.open(output / "khaneyar-ai-gateway.tgz") as archive:
        assert all(not item.issym() and not item.islnk() for item in archive.getmembers())
        for item in archive.getmembers():
            assert not item.name.endswith("/.env") and not item.name.endswith("gateway.env")
            assert ".." not in Path(item.name).parts
            contents = archive.extractfile(item).read().decode("utf-8")
            assert original["DeepSeekApiKey"] not in contents and token not in contents
    command = (output / "vnc-install.txt").read_text(encoding="utf-8")
    assert original["DeepSeekApiKey"] not in command and token not in command
    assert "KHANEYAR_GATEWAY_SETUP" in command
    # The actual command payload must remain valid Python after clipboard transfer.
    compile(command.split("\n", 1)[1].rsplit("KHANEYAR_GATEWAY_SETUP", 1)[0], "vnc", "exec")
    assert "*sys.argv[1:]" in command
    logs = capsys.readouterr()
    assert original["DeepSeekApiKey"] not in logs.out + logs.err
    assert token not in logs.out + logs.err


def test_rebuilding_preserves_private_server_configuration(package_source):
    main, sandbox, _original = package_source
    main()
    private = sandbox / "ai-gateway/gateway.env"
    original_bytes = private.read_bytes()
    original_config = (sandbox / "config.json").read_bytes()
    main()
    assert private.read_bytes() == original_bytes
    assert (sandbox / "config.json").read_bytes() == original_config
