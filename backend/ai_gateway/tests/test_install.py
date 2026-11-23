"""VNC setup keeps credentials out of the command and restores nginx on failure."""

from __future__ import annotations

import base64
import contextlib
import io
import json
import tarfile
from pathlib import Path

import pytest

from ai_gateway import install

CONFIG = """# server { ignored comment }
server {
    listen 80;
    server_name api.khaanehyar.ir;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name api.khaanehyar.ir;
    set $sample "ignore { quoted } braces";
    location / { proxy_pass http://127.0.0.1:8000; }
}
server {
    listen 443 ssl;
    server_name pwa.khaanehyar.ir;
    root /var/www/khaneyar;
}
"""


def credentials():
    return {"api_key": "sk-synthetic-deepseek-key", "token": "t" * 43, "model": "deepseek-flash"}


def archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as target:
        for name, contents, kind in entries:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.size = len(contents)
            target.addfile(info, io.BytesIO(contents))
    return output.getvalue()


def test_route_is_added_to_only_api_https_and_repeated_install_is_stable():
    result = install.add_nginx_route(CONFIG)
    assert result.count(install.INCLUDE) == 1
    assert result == CONFIG.replace(
        "server {\n    listen 443 ssl;\n    server_name api.khaanehyar.ir;",
        "server {\n    " + install.INCLUDE + "\n\n    listen 443 ssl;\n"
        "    server_name api.khaanehyar.ir;",
    )
    assert install.add_nginx_route(result) == result


def test_project_nginx_redirect_fragments_are_not_comments():
    source = (
        Path(__file__).resolve().parents[2] / "deploy/nginx/khaneyar.conf"
    ).read_text(encoding="utf-8")
    source = source.replace(
        "server_name api.khaanehyar.ir;",
        "server_name api.khaanehyar.ir;\n    listen 443 ssl;",
        1,
    )
    assert "location = /web/ { return 301 /download/#ios; }" in source
    result = install.add_nginx_route(source)
    assert result.replace("\n    " + install.INCLUDE + "\n", "", 1) == source
    assert install.add_nginx_route(result) == result


def test_comments_and_escaped_hashes_do_not_change_block_boundaries():
    source = CONFIG.replace(
        'set $sample "ignore { quoted } braces";',
        'set $sample "ignore { quoted } braces"; # ignored closing }\n'
        '    location = /fragment { return 302 /download/#ios; }\n'
        r'    set $escaped \#value;' '\n'
        '    # server { ignored opening\n',
    )
    result = install.add_nginx_route(source)
    assert result.replace("\n    " + install.INCLUDE + "\n", "", 1) == source


@pytest.mark.parametrize("source", [
    CONFIG.replace("api.khaanehyar.ir", "another.example"),
    CONFIG + CONFIG,
    CONFIG.replace("set $sample", "location = /ai-gateway/v1/sms/analyze {}\nset $sample"),
])
def test_ambiguous_or_conflicting_nginx_configuration_is_rejected(source):
    with pytest.raises(install.InstallError):
        install.add_nginx_route(source)


@pytest.mark.parametrize("entry", [
    ("../private", b"secret", tarfile.REGTYPE),
    ("/etc/passwd", b"secret", tarfile.REGTYPE),
    ("backend/ai_gateway/.env", b"secret", tarfile.REGTYPE),
    ("backend/linked", b"", tarfile.SYMTYPE),
    ("backend/app/main.py", b"# not part of this gateway", tarfile.REGTYPE),
])
def test_archive_cannot_write_outside_gateway_or_include_credentials(entry):
    with pytest.raises(install.InstallError):
        install.archive_files(archive([entry]))


def test_invalid_private_input_does_not_echo_secret():
    private = base64.b64encode(json.dumps({"api_key": "secret-value"}).encode()).decode()
    with pytest.raises(install.InstallError) as error:
        install.private_settings(private)
    assert "secret-value" not in str(error.value)
    assert private not in str(error.value)


@pytest.mark.parametrize("public_status", [200, 502])
def test_installation_checks_https_and_restores_nginx_if_analysis_fails(
    tmp_path, monkeypatch, capsys, public_status
):
    nginx = tmp_path / "khaneyar.conf"
    nginx.write_text(CONFIG, encoding="utf-8")
    bundle = tmp_path / "gateway.tgz"
    bundle.write_bytes(archive([(name, b"# synthetic", tarfile.REGTYPE) for name in install.FILES]))
    root = tmp_path / "gateway"
    monkeypatch.setattr(install, "ROOT", root)
    monkeypatch.setattr(install, "NGINX", nginx)
    monkeypatch.setattr(install, "BACKUPS", tmp_path / "backups")
    monkeypatch.setattr(install.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(install.shutil, "which", lambda _name: "synthetic-tool")
    monkeypatch.setattr(install.sys, "argv", ["install.py", str(bundle)])
    encoded = base64.b64encode(json.dumps(credentials()).encode()).decode()
    monkeypatch.setattr(install.getpass, "getpass", lambda _message: encoded)
    monkeypatch.setattr(install, "installation_lock", contextlib.nullcontext)
    monkeypatch.setattr(install, "capture", lambda *_a, **_kw: "DEEPSEEK READY")
    monkeypatch.setattr(install, "check_provider", lambda _config: None)
    commands = []
    monkeypatch.setattr(install, "run", lambda command, cwd=None: commands.append(command))

    def api(url, **options):
        if url.endswith("/healthz"):
            return 200, {"status": "ok"}
        if options.get("key"):
            return public_status, {"transactions": [{"source_index": 0, "amount": "10000",
                                                   "unit": "rial", "type": "income"}]}
        return 401, {"error": "AI_GATEWAY_AUTH_FAILED"}

    monkeypatch.setattr(install, "api", api)
    if public_status == 502:
        with pytest.raises(install.InstallError):
            install.main()
        assert nginx.read_text(encoding="utf-8") == CONFIG
        assert "GATEWAY READY" not in capsys.readouterr().out
    else:
        install.main()
        assert install.INCLUDE in nginx.read_text(encoding="utf-8")
        assert "GATEWAY READY" in capsys.readouterr().out
    assert all(credentials()["api_key"] not in str(command) for command in commands)
    assert all(credentials()["token"] not in str(command) for command in commands)
    assert len(list((tmp_path / "backups").glob("*/khaneyar.conf"))) == 1


def test_installer_package_allowlist_matches_packaging_source():
    import runpy

    project = Path(__file__).resolve().parents[3]
    package = runpy.run_path(str(project / "scripts/package-ai-gateway.py"))
    assert set(install.FILES) == set(package["FILES"])


def test_nginx_exposes_only_exact_bounded_private_routes():
    import re

    source = (Path(__file__).resolve().parents[1] / "nginx-location.conf").read_text()
    paths = ["sms/analyze", "assistant/capabilities", "assistant/analyze",
             "assistant/plan", "assistant/report"]
    assert re.findall(r"location\s+([^\{]+)\{", source) == [
        f"= /ai-gateway/v1/{path} " for path in paths
    ]
    for path in paths:
        assert f"proxy_pass http://127.0.0.1:5810/v1/{path};" in source
    assert source.count("proxy_set_header Authorization $http_authorization;") == len(paths)
    assert source.count('add_header Cache-Control "no-store" always;') == len(paths)
