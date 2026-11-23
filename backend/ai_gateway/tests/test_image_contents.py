"""Exercise only Dockerfile COPY contents, never the host application's source tree."""
from __future__ import annotations

import ast
import os
import shlex
import shutil
import site
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture
def image_files(tmp_path):
    image = tmp_path / "image"
    image.mkdir()
    for line in (BACKEND / "ai_gateway/Dockerfile").read_text(encoding="utf-8").splitlines():
        if not line.startswith("COPY "):
            continue
        fields = shlex.split(line)[1:]
        sources, destination = fields[:-1], fields[-1]
        target = image / destination.removeprefix("./")
        if destination.endswith("/"):
            target.mkdir(parents=True, exist_ok=True)
            for source in sources:
                shutil.copyfile(BACKEND / source, target / Path(source).name)
        else:
            assert len(sources) == 1
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(BACKEND / sources[0], target)
    return image


def test_every_direct_internal_import_is_present_in_image(image_files):
    for path in image_files.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.ImportFrom) or not node.module:
                continue
            if not node.module.startswith(("app.", "ai_gateway.")):
                continue
            module = image_files.joinpath(*node.module.split("."))
            assert module.with_suffix(".py").is_file() or (module / "__init__.py").is_file(), (
                f"Docker image omits {node.module}, imported by {path.relative_to(image_files)}"
            )


def test_copy_only_image_imports_and_contextual_routes_without_network(image_files):
    dependencies = [*site.getsitepackages(), site.getusersitepackages()]
    code = f"""
import sys, socket
sys.path[:0] = [{str(image_files)!r}, *{dependencies!r}]
def forbidden(*args, **kwargs):
    raise AssertionError("An offline image test attempted external network access")
socket.create_connection = forbidden
import ai_gateway.app
import ai_gateway.check
from ai_gateway.app import GatewaySettings, create_app
from fastapi.testclient import TestClient
app = create_app(GatewaySettings(
    deepseek_api_key="sk-fictional-image-test", ai_gateway_token="t" * 43,
))
headers = {{"Authorization": "Bearer " + "t" * 43}}
with TestClient(app) as client:
    assert client.get("/healthz").status_code == 200
    paths = ["/v1/sms/analyze", "/v1/assistant/analyze",
             "/v1/assistant/plan", "/v1/assistant/report"]
    for path in paths:
        assert client.post(path, json={{}}).status_code == 401
        assert client.post(path, headers=headers, json={{}}).status_code == 422
    result = client.get("/v1/assistant/capabilities", headers=headers).json()
    assert result["contextual"] is True and result["protocol_version"] == 2
    assert result["max_inferences"] == 2
print("COPY-ONLY IMAGE READY; external network and billed inference: zero")
"""
    environment = {name: value for name, value in os.environ.items()
                   if name not in {"DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_TOKEN",
                                   "AI_SMS_GATEWAY_TOKEN", "PYTHONPATH"}}
    result = subprocess.run(  # noqa: S603 -- isolated Python with copied public source
        [sys.executable, "-I", "-B", "-c", code], cwd=image_files,
        env=environment, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "COPY-ONLY IMAGE READY" in result.stdout
