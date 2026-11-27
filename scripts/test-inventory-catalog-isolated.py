"""Exercise the real catalog and outbox in a fresh, disposable PostgreSQL cluster."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPORT = Path(os.environ['LOCALAPPDATA']) / 'Temp' / 'opencode'
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
config_path = next((parent / '.local-test/config.json' for parent in [ROOT, *ROOT.parents]
                    if (parent / '.local-test/config.json').is_file()), None)
if config_path is None:
    raise RuntimeError('The isolated PostgreSQL launcher configuration is unavailable.')
pg_bin = Path(json.loads(config_path.read_text(encoding='utf-8-sig'))['PgBin'])
cluster = Path(tempfile.mkdtemp(prefix='inventory-catalog-test-', dir=REPORT))
flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], creationflags=flags,
                          stdin=subprocess.DEVNULL, timeout=60, check=True, **kwargs)


started = False
try:
    # PostgreSQL can inherit pg_ctl's stderr handle on Windows. A PIPE keeps
    # communicate() waiting after pg_ctl has exited, so use a real log file.
    with (cluster / 'bootstrap.log').open('a', encoding='utf-8') as bootstrap_log:
        run([pg_bin / 'initdb.exe', '-D', cluster / 'data', '-U', 'catalog_bootstrap', '--auth=trust',
             '--encoding=UTF8', '--locale=C'], stdout=bootstrap_log, stderr=bootstrap_log)
        run([pg_bin / 'pg_ctl.exe', '-D', cluster / 'data', '-l', cluster / 'postgres.log', '-o',
             f'-h 127.0.0.1 -p {port} -c timezone=UTC', '-w', '-t', '30', 'start'],
            stdout=bootstrap_log, stderr=bootstrap_log)
    started = True
    print('Disposable PostgreSQL ready; preparing the restricted test role.', flush=True)
    base = [pg_bin / 'psql.exe', '-X', '-w', '-h', '127.0.0.1', '-p', str(port), '-U', 'catalog_bootstrap',
            '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    run([*base, '-c', 'CREATE ROLE catalog_app LOGIN NOSUPERUSER NOBYPASSRLS;'], stdout=subprocess.DEVNULL)
    run([*base, '-c', 'CREATE DATABASE inventory_catalog_test OWNER catalog_app;'], stdout=subprocess.DEVNULL)
    environment = {**os.environ, 'APP_ENV':'test', 'DEBUG':'false', 'PYTHONUTF8':'1',
        'TEMP':str(REPORT), 'TMP':str(REPORT),
        'DATABASE_URL':f'postgresql+psycopg://catalog_app@127.0.0.1:{port}/unused',
        'TEST_DATABASE_URL':f'postgresql+psycopg://catalog_app@127.0.0.1:{port}/inventory_catalog_test',
        'TEST_MIGRATION_DATABASE_URL':f'postgresql+psycopg://catalog_bootstrap@127.0.0.1:{port}/inventory_catalog_test',
        'STORAGE_ENDPOINT':'', 'STORAGE_BUCKET':'', 'SMS_API_KEY':'', 'SMS_PROVIDER':'',
        'BRSAPI_KEY':'', 'OPENROUTER_API_KEY':'', 'AI_SMS_GATEWAY_URL':'', 'AI_SMS_GATEWAY_TOKEN':'',
        'DEEPSEEK_API_KEY':'', 'FILE_SIGNING_SECRET':'test-only-signing-secret', 'RATE_LIMIT_SALT':'test-only-rate-salt'}
    tests = sys.argv[1:] or ['tests/test_inventory_catalog.py', 'tests/test_shopping.py',
                            'tests/test_shopping_offline.py', 'tests/test_support_panel.py']
    print('Running: ' + ', '.join(tests), flush=True)
    result = subprocess.run([sys.executable, '-u', '-m', 'pytest', *tests, '-q', '--tb=short'],
                            cwd=ROOT / 'backend', env=environment, creationflags=flags,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding='utf-8', errors='replace', timeout=900)
    (REPORT / 'inventory-catalog-backend.log').write_text(result.stdout, encoding='utf-8')
    print(result.stdout, flush=True)
    (REPORT / 'inventory-catalog-backend-result.json').write_text(
        json.dumps({'exit_code':result.returncode, 'isolated_postgres':True, 'tests':tests}), encoding='utf-8')
    sys.exit(result.returncode)
finally:
    if started:
        subprocess.run([str(pg_bin / 'pg_ctl.exe'), '-D', str(cluster / 'data'), '-m', 'fast', '-w', '-t', '30', 'stop'],
                       creationflags=flags, stdin=subprocess.DEVNULL, timeout=45,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('Disposable PostgreSQL stopped; manual sandbox and production were not used.', flush=True)
