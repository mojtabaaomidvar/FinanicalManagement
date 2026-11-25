"""Temporary-file installer acceptance; Docker/network commands are explicit doubles."""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "backend/deploy"
BASH = str(Path(shutil.which("git")).resolve().parent.parent / "bin/bash.exe") if os.name == "nt" else shutil.which("bash")


def load(name):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = load("check-wallet-release")
prepare = load("prepare-wallet-release")


def sha(data):
    return hashlib.sha256(data).hexdigest()


class WalletReleaseTests(unittest.TestCase):
    def setUp(self):
        directory = ROOT / ".local-test/wallet-installer-tests"
        directory.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=directory)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.release = self.root / "release"
        self.web = self.root / "web"
        for name in ("release/pwa", "release/source/backend/app", "release/source/backend/alembic", "release/source/backend/deploy",
                     "release/source/backend", "web", "deploy/uploads", "backups", "state", "bin"):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        self.old = {"index.html": b"old", "sw.js": b"old-worker", "version.json": b'{"version":"0.10.0"}'}
        self.new = {"index.html": b"new", "sw.js": b"new-worker", "version.json": b'{"version":"0.11.0"}'}
        for root, files in ((self.web, self.old), (self.release / "pwa", self.new)):
            for name, data in files.items():
                (root / name).write_bytes(data)
        for name in ("app/sample.py", "alembic/sample.py", "Dockerfile", "pyproject.toml", "alembic.ini"):
            (self.release / "source/backend" / name).write_bytes(b"verified\n")
        for name in ("check-wallet-release.py", "prepare-wallet-release.py", "migrate-wallet-release.py", "verify-wallet-backup.py"):
            shutil.copyfile(DEPLOY / name, self.release / "source/backend/deploy" / name)
        self.value = {"tag": "v0.11.0", "software_version": "0.11.0", "baseline_tag": "v0.10.0", "deployment_scope": "api-pwa-only",
                      "database_baseline_revision": checker.BASELINE, "database_revision": checker.REVISION,
                      "database_migration_required": True, "money_contract": "decimal-v1",
                      "schema_sha256": {checker.BASELINE: "a" * 64, checker.REVISION: "b" * 64},
                      "pwa_sha256": {name: sha(data) for name, data in self.new.items()},
                      "baseline_pwa_sha256": {name: sha(data) for name, data in self.old.items()},
                      "backend_launch_sha256": {name: sha(b"verified\n") for name in ("Dockerfile", "pyproject.toml", "alembic.ini")}}
        for root, key in (("app", "backend_app_sha256"), ("alembic", "alembic_sha256"), ("deploy", "deploy_sha256")):
            self.value[key] = {p.relative_to(self.release / "source/backend" / root).as_posix(): sha(p.read_bytes())
                               for p in (self.release / "source/backend" / root).rglob("*") if p.is_file()}
        self.value["baseline_backend_app_sha256"] = self.value["backend_app_sha256"]
        self.value["baseline_alembic_sha256"] = self.value["alembic_sha256"]
        self.save_manifest()
        (self.release / "release-tag.txt").write_bytes(b"v0.11.0\n")
        (self.root / "deploy/.env").write_bytes(b"PRIVATE_FIXTURE=preserve\n")
        (self.root / "deploy/docker-compose.yml").write_bytes(b"fixture\n")
        (self.root / "running").touch()

    def save_manifest(self):
        (self.release / "validation.json").write_text(json.dumps(self.value), encoding="utf-8")

    def test_exact_manifest_incoming_and_inventory(self):
        with patch.object(sys, "argv", ["checker", "incoming", str(self.release)]):
            checker.main()
        (self.release / "source/backend/app/sample.py").write_bytes(b"tampered")
        with patch.object(sys, "argv", ["checker", "incoming", str(self.release)]), self.assertRaises(ValueError):
            checker.main()

    def test_unsafe_manifest_and_unknown_files_preserved(self):
        for name in ("../secret", "/absolute", "x/../../secret", "a\\b", "./index.html"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                checker.validate_hashes({name: "a" * 64})
        path = self.web / "manual.txt"
        path.write_bytes(b"preserve")
        self.assertFalse(checker.matches(self.web, self.value["baseline_pwa_sha256"]))
        self.assertEqual(path.read_bytes(), b"preserve")

    def test_wrong_scope_revision_and_contract_refused(self):
        for key, value in (("tag", "v0.10.0"), ("database_revision", "0029"), ("money_contract", "numeric-v0"),
                           ("deployment_scope", "pwa-only"), ("database_migration_required", False)):
            with self.subTest(key=key):
                original = self.value[key]
                self.value[key] = value
                self.save_manifest()
                with self.assertRaises(ValueError):
                    checker.manifest(self.release)
                self.value[key] = original
        self.save_manifest()

    def installer(self, case):
        posix = subprocess.check_output([BASH, "-c", 'cygpath -u "$1"', "_", str(self.root)], text=True).strip() if os.name == "nt" else str(self.root)
        source = (DEPLOY / "install-wallet-release.sh").read_text(encoding="utf-8")
        for before, after in {
            "compose_dir=/opt/khaneyar/backend/deploy": f'compose_dir="{posix}/deploy"',
            "web_dir=/var/www/khaneyar": f'web_dir="{posix}/web"',
            "state_dir=/var/lib/khaneyar/releases/v0.11.0": f'state_dir="{posix}/state"',
            "backup_root=/var/backups/khaneyar/releases": f'backup_root="{posix}/backups"',
            "/var/lock/khaneyar-release.lock": posix + "/release.lock",
            "/var/www/khaneyar-next-0.11.0": posix + "/next",
            "[[ $EUID -eq 0 ]]": "true",
        }.items():
            self.assertIn(before, source)
            source = source.replace(before, after)
        (self.root / "installer.sh").write_bytes(source.encode())
        scripts = {
            "python3": '''#!/usr/bin/env bash
set -eu
echo "python $2" >> "$TEST_ROOT/commands.log"
if [[ "$2" == public ]]; then
    [[ "$TEST_CASE" != public-failure ]] || exit 22
    echo 'PUBLIC VERIFIED: fictional files/contract/CORS'; exit 0
fi
if [[ "$1" == */prepare-wallet-release.py ]]; then
    echo wallet-prepared >> "$TEST_ROOT/deploy/.env"
    echo '{}' > "$TEST_ROOT/deploy/docker-compose.release.json"
    [[ "$TEST_CASE" != prepare-failure ]] || exit 23
    exit 0
fi
exec 'PYTHON' "$@"
'''.replace("PYTHON", Path(sys.executable).as_posix()),
            "docker": '''#!/usr/bin/env bash
set -eu
echo "docker $*" >> "$TEST_ROOT/commands.log"
if [[ "$1" == inspect ]]; then
  if [[ "$3" == '{{.Image}}' ]]; then echo 'sha256:fictional-old-image'; else echo 'fixture-old-api'; fi
  exit 0
fi
if [[ "$1" == image ]]; then exit 0; fi
if [[ "$1" == build ]]; then [[ "$TEST_CASE" != build-failure ]] || exit 24; exit 0; fi
if [[ "$1" == run ]]; then [[ "$TEST_CASE" != image-failure ]] || exit 25; echo VERIFIED; exit 0; fi
[[ "$1" == compose ]]
if [[ "$2" == config ]]; then exit 0; fi
if [[ "$2" == ps ]]; then [[ ! -f "$TEST_ROOT/running" ]] || echo fictional-api; exit 0; fi
if [[ "$2" == stop ]]; then rm -f "$TEST_ROOT/running"; exit 0; fi
if [[ "$2" == up ]]; then
  [[ "$TEST_CASE" != activation-failure || ! -f "$TEST_ROOT/state/activated" ]] || exit 26
  touch "$TEST_ROOT/running"; exit 0
fi
if [[ "$*" == *pg_dump* ]]; then [[ "$TEST_CASE" != dump-failure ]] || exit 27; echo 'fictional dump'; exit 0; fi
if [[ "$*" == *createdb* ]]; then [[ "$TEST_CASE" != restore-create-failure ]] || exit 28; touch "$TEST_ROOT/restore-created"; exit 0; fi
if [[ "$*" == *dropdb* ]]; then rm -f "$TEST_ROOT/restore-created"; exit 0; fi
if [[ "$*" == *psql* ]]; then cat >/dev/null; [[ "$TEST_CASE" != restore-load-failure ]] || exit 29; exit 0; fi
if [[ "$*" == *verify-wallet-backup.py* ]]; then [[ "$TEST_CASE" != restore-check-failure ]] || exit 30; echo 'BACKUP RESTORE VERIFIED'; exit 0; fi
if [[ "$*" == *migrate-wallet-release.py* ]]; then [[ "$TEST_CASE" != migration-failure ]] || exit 31; touch "$TEST_ROOT/migrated"; exit 0; fi
if [[ "$*" == *' - rollback '* ]]; then
  [[ ! -f "$TEST_ROOT/audit-history" ]] || exit 32
  echo ROLLBACK_VERIFIED; exit 0
fi
if [[ "$*" == *' - container '* ]]; then
  if [[ "$TEST_CASE" == activated-source-drift ]]; then echo BASELINE; exit 0; fi
  if grep -q wallet-prepared "$TEST_ROOT/deploy/.env" && [[ -f "$TEST_ROOT/migrated" ]]; then echo ALREADY
  elif [[ -f "$TEST_ROOT/migrated" ]]; then echo MIGRATED_BASELINE
  else echo BASELINE; fi
  exit 0
fi
if [[ "$2" == run ]]; then [[ "$TEST_CASE" != private-health-failure ]] || exit 33; echo 'PRIVATE API VERIFIED'; exit 0; fi
exit 34
''',
            "curl": '''#!/usr/bin/env bash
[[ "$TEST_CASE" != health-failure ]] || exit 35
echo '{}'
''',
            "tar": '''#!/usr/bin/env bash
[[ "$TEST_CASE" != backup-failure ]] || exit 36
exec /usr/bin/tar "$@"
''',
            "mv": '''#!/usr/bin/env bash
if [[ "$2" == "$TEST_ROOT/next."* && "$2" != *.previous && "$3" == "$TEST_ROOT/web" ]]; then
  [[ "$TEST_CASE" != swap-failure ]] || exit 37
fi
exec /usr/bin/mv "$@"
''',
            "cp": '''#!/usr/bin/env bash
if [[ "$*" == *next.* && "$TEST_CASE" == stage-failure ]]; then exit 38; fi
exec /usr/bin/cp "$@"
''',
            "flock": '#!/usr/bin/env bash\n[[ "$TEST_CASE" != lock-failure ]]\n',
            "chown": '#!/usr/bin/env bash\nexit 0\n', "sync": '#!/usr/bin/env bash\nexit 0\n',
            "sleep": '#!/usr/bin/env bash\nexit 0\n',
        }
        for name, body in scripts.items():
            path = self.root / "bin" / name
            path.write_bytes(body.encode())
            path.chmod(0o755)
        if case == "preflight-failure":
            (self.web / "index.html").write_bytes(b"manual change")
        env = os.environ.copy()
        env.update(TEST_ROOT=posix, TEST_CASE=case)
        return subprocess.run([BASH, "-c", 'export PATH="$TEST_ROOT/bin:$PATH"; bash "$TEST_ROOT/installer.sh" "$TEST_ROOT/release"'],
                              env=env, capture_output=True, text=True, timeout=90)

    def test_installer_success_and_verified_idempotence(self):
        result = self.installer("success")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("RELEASE INSTALLED: v0.11.0", result.stdout)
        self.assertTrue(checker.matches(self.web, self.value["pwa_sha256"]))
        self.assertFalse((self.root / "restore-created").exists())
        commands = (self.root / "commands.log").read_text()
        self.assertLess(commands.index("verify-wallet-backup.py"), commands.index("migrate-wallet-release.py"))
        result = self.installer("success")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("RELEASE ALREADY INSTALLED", result.stdout)
        self.assertEqual(len(list((self.root / "backups").iterdir())), 1)

    def test_preactivation_failures_restore_only_safe_old_code(self):
        for case in ("preflight-failure", "lock-failure", "backup-failure", "build-failure", "image-failure", "stage-failure",
                     "dump-failure", "restore-create-failure", "restore-load-failure", "prepare-failure", "restore-check-failure",
                     "migration-failure", "private-health-failure", "swap-failure"):
            with self.subTest(case=case):
                other = WalletReleaseTests()
                other.setUp()
                try:
                    result = other.installer(case)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    for name, data in other.old.items():
                        expected = b"manual change" if case == "preflight-failure" and name == "index.html" else data
                        self.assertEqual((other.web / name).read_bytes(), expected, result.stdout + result.stderr)
                    self.assertTrue((other.root / "running").exists(), result.stderr)
                    self.assertFalse((other.root / "state/activated").exists())
                    self.assertFalse((other.root / "restore-created").exists())
                    self.assertEqual((other.root / "deploy/.env").read_bytes(), b"PRIVATE_FIXTURE=preserve\n")
                finally:
                    other.doCleanups()

    def test_postactivation_failure_preserves_new_code_and_safe_retry(self):
        for case in ("activation-failure", "health-failure", "public-failure"):
            with self.subTest(case=case):
                other = WalletReleaseTests()
                other.setUp()
                try:
                    result = other.installer(case)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn("MAINTENANCE", result.stderr)
                    self.assertTrue(checker.matches(other.web, other.value["pwa_sha256"]))
                    self.assertFalse((other.root / "running").exists())
                    commands = (other.root / "commands.log").read_text()
                    self.assertNotIn(" - rollback ", commands)
                    (other.root / "audit-history").touch()
                    result = other.installer("success")
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertTrue((other.root / "audit-history").exists())
                    self.assertEqual(len(list((other.root / "backups").iterdir())), 1)
                finally:
                    other.doCleanups()

    def test_same_tag_changed_bytes_cannot_resume(self):
        self.assertNotEqual(self.installer("public-failure").returncode, 0)
        self.value["extra"] = "changed release"
        self.save_manifest()
        result = self.installer("success")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("different bytes", result.stderr)

    def test_activated_source_drift_stops_api_instead_of_accepting_old_code(self):
        result = self.installer("success")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        (self.root / "audit-history").touch()
        result = self.installer("activated-source-drift")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("MAINTENANCE", result.stderr)
        self.assertFalse((self.root / "running").exists())
        self.assertTrue((self.root / "audit-history").exists())
        self.assertNotIn(" - rollback ", (self.root / "commands.log").read_text())

    def test_linux_lf_syntax_and_no_database_rewind(self):
        data = (DEPLOY / "install-wallet-release.sh").read_bytes()
        self.assertNotIn(b"\r", data)
        self.assertFalse(data.startswith(b"\xef\xbb\xbf"))
        subprocess.run([BASH, "-n", str(DEPLOY / "install-wallet-release.sh")], check=True, capture_output=True)
        self.assertNotIn(b"alembic downgrade", data)
        self.assertNotIn(b"docker compose down", data)
        self.assertIn(b'sync -f "$state_dir/activated"', data)


class PrepareWalletTests(unittest.TestCase):
    def test_preserves_existing_environment_and_unrelated_override(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".local-test") as temporary:
            root = Path(temporary)
            (root / "source/backend").mkdir(parents=True)
            (root / ".env").write_bytes(b"PRIVATE_FIXTURE=preserve\n")
            old = {"services": {"api": {"environment": {"AI_SMS_GATEWAY_TOKEN": "fictional-private-token"}}, "gateway": {"image": "unchanged"}}}
            (root / "docker-compose.release.json").write_text(json.dumps(old))
            baseline = {"services": {"api": {"environment": {"PRIVATE_FIXTURE": "preserve"}, "ports": ["127.0.0.1:8000:8000"]}, "db": {"image": "unchanged"}}}
            previous = Path.cwd()
            try:
                os.chdir(root)
                resolved = json.loads(json.dumps(baseline))
                resolved["services"]["api"].update(image="khaneyar-api:v0.11.0", build={"context": str(root / "source/backend")})
                with patch.object(prepare, "compose_config", side_effect=[baseline, resolved]):
                    prepare.prepare(root / "source", "khaneyar-api:v0.11.0")
                actual = json.loads((root / "docker-compose.release.json").read_text())
                self.assertEqual(actual["services"]["api"]["environment"], old["services"]["api"]["environment"])
                self.assertEqual(actual["services"]["gateway"], old["services"]["gateway"])
                self.assertEqual(actual["services"]["api"]["image"], "khaneyar-api:v0.11.0")
                self.assertTrue((root / ".env").read_bytes().startswith(b"PRIVATE_FIXTURE=preserve\n"))
            finally:
                os.chdir(previous)


if __name__ == "__main__":
    unittest.main(verbosity=2)
