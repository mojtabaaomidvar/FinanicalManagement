"""Publishing is code-only, checks embedded archives, and cannot expose saved credentials."""

from __future__ import annotations

import json
import runpy
from pathlib import Path

import httpx
import pytest

PROJECT = Path(__file__).resolve().parents[3]


@pytest.fixture
def publisher(tmp_path, monkeypatch):
    packaging = runpy.run_path(str(PROJECT / "scripts/package-ai-gateway.py"))
    for name in (*packaging["FILES"], "scripts/package-ai-gateway.py"):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((PROJECT / name).read_bytes())
    sandbox = tmp_path / ".local-test"
    sandbox.mkdir()
    (sandbox / "config.json").write_text(json.dumps({
        "DeepSeekApiKey": "sk-synthetic-private-deepseek-key",
        "OpenRouterApiKey": "sk-or-synthetic-old-private-key",
        "AiSmsGatewayToken": "t" * 43, "AppPassword": "short-private-password",
    }))
    package = packaging["main"]
    monkeypatch.setitem(package.__globals__, "ROOT", tmp_path)
    monkeypatch.setattr("sys.argv", ["package-ai-gateway.py"])
    package()
    module = runpy.run_path(str(PROJECT / "scripts/publish-ai-gateway.py"))
    main = module["main"]
    monkeypatch.setitem(main.__globals__, "ROOT", tmp_path)
    return module, sandbox / "ai-gateway", tmp_path, package


def test_verified_source_contains_only_allowlisted_current_code(publisher):
    module, directory, _root, _package = publisher
    source = module["verified_source"](directory)
    assert b"*sys.argv[1:]" in source and b"sk-synthetic-private-deepseek-key" not in source
    assert b"sk-or-synthetic-old-private-key" not in source and b"t" * 43 not in source


@pytest.mark.parametrize("problem", ["wrapper", "changed-source", "embedded-key", "legacy-key"])
def test_publication_refuses_mismatched_or_sensitive_code(publisher, problem):
    module, directory, root, package = publisher
    if problem == "wrapper":
        with (directory / "vnc-installer.py").open("ab") as target:
            target.write(b"\n# unexpected edit\n")
    else:
        key = b"sk-or-synthetic-old-private-key" if problem == "legacy-key" else (
            b"sk-synthetic-private-deepseek-key"
        )
        with (root / "backend/app/services/sms_ai_provider.py").open("ab") as target:
            target.write(b"\n# " + key + b"\n")
        if problem != "changed-source":
            package()
    with pytest.raises(RuntimeError):
        module["verified_source"](directory)


def test_downloaded_bytes_are_verified_before_short_commands_are_created(
    publisher, monkeypatch, capsys,
):
    module, directory, _root, _package = publisher
    source = module["verified_source"](directory)
    calls = []

    def respond(request):
        calls.append(request)
        if request.method == "POST":
            assert request.content == source
            return httpx.Response(201, text="https://paste.rs/Synthetic1")
        return httpx.Response(200, content=source)

    client = httpx.Client(transport=httpx.MockTransport(respond), follow_redirects=False)
    monkeypatch.setattr(module["httpx"], "Client", lambda **_kw: client)
    monkeypatch.setattr("sys.argv", ["publish-ai-gateway.py"])
    module["main"]()
    assert len(calls) == 2
    commands = (directory / "vnc-deepseek-download.txt").read_text().splitlines()
    assert commands == ["curl -fsS https://paste.rs/Synthetic1 -o /tmp/ai.py",
                        "python3 /tmp/ai.py --migrate-deepseek"]
    assert "sk-synthetic" not in capsys.readouterr().out
