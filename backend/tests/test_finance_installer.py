"""Exercise installer sequencing with fictional commands and a temporary filesystem."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.conftest import BACKEND_DIR


def bash_executable():
    git = shutil.which("git")
    windows = Path(git).resolve().parent.parent / "bin/bash.exe" if git else Path("missing")
    return str(windows) if windows.is_file() else shutil.which("bash")


def test_installer_has_valid_bash_and_bounded_commands():
    bash = bash_executable()
    assert bash, "Bash is required to validate the published Linux installer."
    script = BACKEND_DIR / "deploy/install-finance-release.sh"
    subprocess.run([bash, "-n", str(script)], check=True, capture_output=True)
    source = script.read_text()
    assert "alembic upgrade head" not in source
    assert "downgrade" not in source.replace("No database restore or downgrade was performed.", "")
    assert "migrate-finance-release.py" in source and 'gzip -t "$backup_dir/database-before.sql.gz"' in source
    assert source.index("incoming") < source.index("docker compose stop api")
    assert source.index("database-before.sql.gz") < source.index("api python /tmp/migrate-finance-release.py")


@pytest.mark.parametrize("case", ["success", "preflight-failure", "backup-failure", "migration-failure", "health-failure", "public-health-failure", "rollback-failure"])
def test_installer_temporary_control_flow_preserves_previous_files(tmp_path, case):
    bash = bash_executable()
    assert bash
    root = tmp_path / "root"
    root.mkdir()
    if os.name == "nt":
        posix = subprocess.check_output([bash, "-c", 'cygpath -u "$1"', "_", str(root)], text=True).strip()
    else:
        posix = str(root)
    for relative in ["compose", "web", "backups", "bin", "release/source/backend/deploy", "release/pwa"]:
        (root / relative).mkdir(parents=True)
    (root / "compose/.env").write_text("PRIVATE_TEST_SETTING=keep\n")
    (root / "compose/docker-compose.yml").write_text("services: {}\n")
    (root / "compose/docker-compose.release.json").write_text("previous override\n")
    (root / "web/version.json").write_text("old\n")
    (root / "release/pwa/version.json").write_text("new\n")
    for name in ["check-finance-release.py", "prepare-assistant-release.py", "migrate-finance-release.py"]:
        (root / "release/source/backend/deploy" / name).write_text("# fictional launch fixture\n")
    source = (BACKEND_DIR / "deploy/install-finance-release.sh").read_text()
    replacements = {"compose_dir=/opt/khaneyar/backend/deploy": f'compose_dir="{posix}/compose"',
        "web_dir=/var/www/khaneyar": f'web_dir="{posix}/web"',
        "/var/backups/khaneyar/releases": posix + "/backups",
        "/var/lock/khaneyar-release.lock": posix + "/release.lock",
        "/var/www/khaneyar-next-0.9.0": posix + "/next",
        "[[ $EUID -eq 0 ]]": "true"}
    for old, new in replacements.items():
        assert old in source
        source = source.replace(old, new)
    (root / "installer.sh").write_bytes(source.encode())
    scripts = {
        "docker": r'''#!/usr/bin/env bash
set -eu
printf 'docker %s\n' "$*" >> "$TEST_ROOT/commands.log"
if [[ "$*" == 'compose ps -q api' ]]; then echo fictional-container
elif [[ "$*" == *'{{.Image}}'* ]]; then echo sha256:fictional
elif [[ "$*" == *'{{.Config.Image}}'* ]]; then echo khaneyar-api:v0.8.0
elif [[ "$*" == 'compose exec -T api python - container '* ]]; then
    cat >/dev/null
    [[ "$TEST_CASE" != preflight-failure ]] || exit 20
    if [[ -f "$TEST_ROOT/migrated" && -f "$TEST_ROOT/new-api" ]]; then echo ALREADY
    elif [[ -f "$TEST_ROOT/migrated" ]]; then echo MIGRATED_BASELINE
    else echo BASELINE; fi
elif [[ "$*" == 'compose exec -T db '* ]]; then
    [[ "$TEST_CASE" != backup-failure ]] || exit 21
    echo 'fictional consistent backup'
elif [[ "$*" == *'api python /tmp/migrate-finance-release.py' ]]; then
    [[ "$TEST_CASE" != migration-failure ]] || exit 22
    touch "$TEST_ROOT/migrated"
elif [[ "$*" == *'api python - rollback '* ]]; then
    cat >/dev/null
    [[ "$TEST_CASE" != rollback-failure ]] || exit 23
    echo ROLLBACK_VERIFIED
elif [[ "$*" == 'compose stop api' ]]; then rm -f "$TEST_ROOT/new-api"
elif [[ "$*" == 'compose up '* ]]; then
    if [[ "$(cat "$TEST_ROOT/compose/docker-compose.release.json")" == new ]]; then touch "$TEST_ROOT/new-api"
    else rm -f "$TEST_ROOT/new-api"; fi
elif [[ "$*" == *'python -'* ]]; then cat >/dev/null
fi
''',
        "python3": r'''#!/usr/bin/env bash
set -eu
printf 'python %s\n' "$*" >> "$TEST_ROOT/commands.log"
if [[ "$1" == *prepare-assistant-release.py ]]; then
    printf 'changed temporary settings\n' > "$TEST_ROOT/compose/.env"
    printf 'new\n' > "$TEST_ROOT/compose/docker-compose.release.json"
    echo 0
elif [[ "$1" == *check-finance-release.py ]]; then
    case "$2" in
        incoming) echo VERIFIED ;;
        contract) echo '{}' ;;
        pwa) if [[ "$(cat "$TEST_ROOT/web/version.json")" == new ]]; then echo ALREADY; else echo BASELINE; fi ;;
    esac
else cat >/dev/null; fi
''',
        "curl": r'''#!/usr/bin/env bash
set -eu
printf 'curl %s\n' "$*" >> "$TEST_ROOT/commands.log"
if [[ "$TEST_CASE" == health-failure || "$TEST_CASE" == rollback-failure ]]; then exit 24; fi
if [[ "$TEST_CASE" == public-health-failure && "$*" == *pwa.khaanehyar.ir* ]]; then exit 24; fi
echo '{"version":"0.9.0"}'
''',
        "sleep": "#!/usr/bin/env bash\nexit 0\n",
        "chown": "#!/usr/bin/env bash\nexit 0\n",
        "flock": "#!/usr/bin/env bash\nexit 0\n",
    }
    for name, body in scripts.items():
        (root / "bin" / name).write_bytes(body.encode())
        (root / "bin" / name).chmod(0o755)
    env = os.environ.copy()
    env.update({"TEST_ROOT": posix, "TEST_CASE": case})
    result = subprocess.run([bash, "-c", 'export PATH="$TEST_ROOT/bin:$PATH"; bash "$TEST_ROOT/installer.sh" "$TEST_ROOT/release"'],
        env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    assert (root / "commands.log").is_file(), result.stderr + result.stdout
    log = (root / "commands.log").read_text()
    assert "ssh" not in log and "alembic upgrade" not in log
    if case == "success":
        assert result.returncode == 0, result.stderr
        assert "RELEASE INSTALLED: v0.9.0" in result.stdout
        assert (root / "web/version.json").read_text() == "new\n"
        assert (root / "migrated").is_file()
    else:
        assert result.returncode != 0, result.stdout
        assert (root / "web/version.json").read_text() == "old\n"
        assert (root / "compose/.env").read_text() == "PRIVATE_TEST_SETTING=keep\n"
        assert (root / "compose/docker-compose.release.json").read_text() == "previous override\n"
        if case == "preflight-failure":
            assert "compose stop" not in log and "docker build" not in log
        elif case == "backup-failure":
            assert "api python /tmp/migrate-finance-release.py" not in log
        elif case == "rollback-failure":
            assert "API OFF" in result.stderr
        else:
            assert "Previous verified API restarted" in result.stderr
        assert not (root / "new-api").exists()
