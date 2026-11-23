"""Private gateway configuration is preserved and never appears in diagnostics."""
import base64
import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def helper():
    path = Path(__file__).resolve().parents[1] / 'deploy/prepare-assistant-release.py'
    spec = importlib.util.spec_from_file_location('release_assistant_config', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_existing_gateway_bytes_and_keys_are_preserved(helper, tmp_path):
    env = tmp_path / 'gateway.env'
    data = (b'# private\r\nDEEPSEEK_API_KEY=sk-fictional-secret\r\nAI_GATEWAY_TOKEN='
            + b't' * 43 + b'\r\nAI_SMS_MODEL=deepseek-flash\r\n')
    env.write_bytes(data)
    assert helper.gateway_token(env) == 't' * 43
    assert env.read_bytes() == data


@pytest.mark.parametrize('data', [
    'AI_GATEWAY_TOKEN=short',
    'AI_GATEWAY_TOKEN=' + 't' * 43 + '\nAI_GATEWAY_TOKEN=' + 'v' * 43,
    'AI_GATEWAY_TOKEN=' + 't' * 43 + '\nAI_SMS_MODEL=other-model',
])
def test_invalid_private_config_is_refused_without_echo_or_replacement(helper, tmp_path, data):
    env = tmp_path / 'gateway.env'
    env.write_text(data)
    before = env.read_bytes()
    with pytest.raises(RuntimeError) as error:
        helper.gateway_token(env)
    assert data not in str(error.value)
    assert env.read_bytes() == before


def test_prepare_reuses_encryption_key_and_only_adds_private_gateway_override(
    helper, tmp_path, monkeypatch, capsys,
):
    source = Path(__file__).resolve().parents[2]
    env = tmp_path / '.env'
    original = b'# preserve\r\nDB_PASSWORD=fictional-value\r\nDOCUMENT_ENCRYPTION_KEY=existing\r\n'
    env.write_bytes(original)
    key = base64.b64encode(b'k' * 32).decode()
    config = {'services': {'api': {'environment': {'DOCUMENT_ENCRYPTION_KEY': key}}}}
    def process(*_args, **_kwargs):
        class Result:
            stdout = json.dumps(config)
        return Result()
    monkeypatch.setattr('subprocess.run', process)
    monkeypatch.setattr(helper, 'gateway_token', lambda: 't' * 43)
    monkeypatch.chdir(tmp_path)
    helper.prepare(source, 'khaneyar-api:v0.7.0')
    assert capsys.readouterr().out == '0\n'
    assert env.read_bytes().startswith(original)
    appended = env.read_bytes()[len(original):]
    assert b'COMPOSE_FILE=' in appended and b'DOCUMENT_ENCRYPTION_KEY=' not in appended
    value = json.loads((tmp_path / 'docker-compose.release.json').read_text())['services']['api']
    assert value['image'] == 'khaneyar-api:v0.7.0'
    assert value['environment'] == {
        'AI_SMS_GATEWAY_URL': 'https://api.khaanehyar.ir/ai-gateway',
        'AI_SMS_GATEWAY_TOKEN': 't' * 43, 'AI_SMS_MODEL': 'deepseek-flash', 'DEEPSEEK_API_KEY': '',
    }
