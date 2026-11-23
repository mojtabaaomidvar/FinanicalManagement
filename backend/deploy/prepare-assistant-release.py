"""Attach the existing private gateway without exposing or replacing its key/token."""
from __future__ import annotations

import contextlib
import io
import json
import re
import runpy
import sys
from pathlib import Path

GATEWAY = Path('/opt/khaneyar-ai-gateway/backend/ai_gateway/.env')


def gateway_token(path: Path = GATEWAY) -> str:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8192:
        raise RuntimeError('Expected existing private gateway settings; nothing replaced.')
    values = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        name, separator, value = line.partition('=')
        if not separator or name in values:
            raise RuntimeError('Gateway settings need administrator review; preserved.')
        values[name] = value
    token = values.get('AI_GATEWAY_TOKEN', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', token):
        raise RuntimeError('Expected valid existing private token; preserved.')
    if values.get('AI_SMS_MODEL', 'deepseek-flash') != 'deepseek-flash':
        raise RuntimeError('Only the approved DeepSeek model is supported.')
    return token


def prepare(source: Path, image: str) -> None:
    token = gateway_token()
    helper = runpy.run_path(str(source / 'backend/deploy/release-server.py'))
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        helper['prepare'](source, image)
    if output.getvalue().strip() != '0':
        raise RuntimeError('Existing encryption key required; installer will restore settings.')
    path = Path.cwd() / 'docker-compose.release.json'
    value = json.loads(path.read_text(encoding='utf-8'))
    value['services']['api']['environment'] = {
        'AI_SMS_GATEWAY_URL': 'https://api.khaanehyar.ir/ai-gateway',
        'AI_SMS_GATEWAY_TOKEN': token,
        'AI_SMS_MODEL': 'deepseek-flash',
        'DEEPSEEK_API_KEY': '',
    }
    path.write_text(json.dumps(value), encoding='utf-8')
    path.chmod(0o600)
    print('0')


if __name__ == '__main__':
    try:
        prepare(Path(sys.argv[1]).resolve(), sys.argv[2])
    except (OSError, ValueError, RuntimeError):
        raise SystemExit(
            'Private release configuration failed; no secret diagnostics printed.'
        ) from None
