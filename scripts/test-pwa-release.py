"""Test the PWA checker and Linux installer with temporary files and fictional network."""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "backend/deploy"
spec = importlib.util.spec_from_file_location("pwa_checker", DEPLOY / "check-pwa-release.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
GIT = Path(shutil.which("git")).resolve()
BASH = str(GIT.parent.parent / "bin/bash.exe") if os.name == "nt" else shutil.which("bash")


def sha(data):
    return hashlib.sha256(data).hexdigest()


class PwaReleaseTests(unittest.TestCase):
    def setUp(self):
        directory = ROOT / ".local-test/pwa-installer-tests"
        directory.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=directory)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.release = self.root / "release"
        self.web = self.root / "web"
        for part in ["release/pwa", "release/source/backend/deploy", "web", "backups", "bin"]:
            (self.root / part).mkdir(parents=True)
        self.old = {"index.html": b"old", "sw.js": b"old-worker", "version.json": b'{"version":"0.9.0"}'}
        self.new = {"index.html": b"new", "sw.js": b"new-worker", "version.json": b'{"version":"0.10.0"}'}
        for root, files in [(self.web, self.old), (self.release / "pwa", self.new)]:
            for name, data in files.items():
                (root / name).write_bytes(data)
        self.value = {"tag": "v0.10.0", "baseline_tag": "v0.9.0", "deployment_scope": "pwa-only",
                      "database_migration_required": False,
                      "pwa_sha256": {name: sha(data) for name, data in self.new.items()},
                      "baseline_pwa_sha256": {name: sha(data) for name, data in self.old.items()}}
        self.save_manifest()
        (self.release / "release-tag.txt").write_bytes(b"v0.10.0\n")
        shutil.copyfile(DEPLOY / "check-pwa-release.py", self.release / "source/backend/deploy/check-pwa-release.py")

    def save_manifest(self):
        (self.release / "validation.json").write_text(json.dumps(self.value), encoding="utf-8")

    def test_baseline_and_exact_reinstallation(self):
        self.assertEqual(checker.installed(self.release, self.web), "BASELINE")
        for name, data in self.new.items():
            (self.web / name).write_bytes(data)
        self.assertEqual(checker.installed(self.release, self.web), "ALREADY")

    def test_changed_baseline_refused(self):
        (self.web / "index.html").write_bytes(b"manual change")
        with self.assertRaises(ValueError):
            checker.installed(self.release, self.web)

    def test_unknown_files_refused_without_removal(self):
        path = self.web / "manual.txt"
        path.write_bytes(b"keep")
        with self.assertRaises(ValueError):
            checker.installed(self.release, self.web)
        self.assertEqual(path.read_bytes(), b"keep")

    def test_incoming_changed_or_missing_files_refused(self):
        (self.release / "pwa/sw.js").unlink()
        with self.assertRaises(ValueError):
            checker.verify_tree(self.release / "pwa", self.value["pwa_sha256"])

    def test_manifest_unsafe_paths_refused(self):
        for name in ["../secret", "/absolute", "a/../../file", "a\\file", "./index.html"]:
            with self.subTest(name=name):
                self.value["pwa_sha256"][name] = "a" * 64
                self.save_manifest()
                with self.assertRaises(ValueError):
                    checker.manifest(self.release)
                del self.value["pwa_sha256"][name]

    def test_wrong_tag_or_scope_refused(self):
        for key, value in [("tag", "v0.11.0"), ("deployment_scope", "api-pwa-only"), ("database_migration_required", True)]:
            with self.subTest(key=key):
                old = self.value[key]
                self.value[key] = value
                self.save_manifest()
                with self.assertRaises(ValueError):
                    checker.manifest(self.release)
                self.value[key] = old

    def test_public_checksum_mismatch_refused(self):
        from unittest.mock import MagicMock, patch
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"wrong"
        with patch.object(checker.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(ValueError):
                checker.public(self.release)

    def test_public_every_file_verified(self):
        from unittest.mock import MagicMock, patch
        responses = []
        for name in self.value["pwa_sha256"]:
            response = MagicMock()
            response.__enter__.return_value.read.return_value = self.new[name]
            responses.append(response)
        with patch.object(checker.urllib.request, "urlopen", side_effect=responses) as request:
            self.assertEqual(checker.public(self.release), 3)
            self.assertEqual(request.call_count, 3)

    def installer(self, case):
        if os.name == "nt":
            posix = subprocess.check_output([BASH, "-c", 'cygpath -u "$1"', "_", str(self.root)], text=True).strip()
        else:
            posix = str(self.root)
        source = (DEPLOY / "install-pwa-release.sh").read_text()
        for old, new in {"web_dir=/var/www/khaneyar": f'web_dir="{posix}/web"',
                         "/var/lock/khaneyar-release.lock": posix + "/release.lock",
                         "/var/backups/khaneyar/releases": posix + "/backups",
                         "/var/www/khaneyar-next-0.10.0": posix + "/next",
                         "[[ $EUID -eq 0 ]]": "true"}.items():
            self.assertIn(old, source)
            source = source.replace(old, new)
        (self.root / "installer.sh").write_bytes(source.encode())
        import sys
        scripts = {
            "python3": '''#!/usr/bin/env bash
set -eu
printf 'python %s\n' "$2" >> "$TEST_ROOT/commands.log"
if [[ "$2" == public ]]; then
  [[ "$TEST_CASE" != public-failure ]] || exit 22
  echo 'PUBLIC VERIFIED: fictional network'; exit 0
fi
exec 'PYTHON' "$@"
'''.replace("PYTHON", Path(sys.executable).as_posix()),
            "curl": '''#!/usr/bin/env bash
set -eu
echo curl >> "$TEST_ROOT/commands.log"
if [[ "$TEST_CASE" == health-failure && -f "$TEST_ROOT/swapped" ]]; then exit 23; fi
echo '{}'
''',
            "tar": '''#!/usr/bin/env bash
set -eu
echo tar >> "$TEST_ROOT/commands.log"
[[ "$TEST_CASE" != backup-failure ]] || exit 24
exec /usr/bin/tar "$@"
''',
            "cp": '''#!/usr/bin/env bash
set -eu
echo cp >> "$TEST_ROOT/commands.log"
[[ "$TEST_CASE" != stage-failure ]] || exit 25
exec /usr/bin/cp "$@"
''',
            "mv": '''#!/usr/bin/env bash
set -eu
echo mv >> "$TEST_ROOT/commands.log"
if [[ "$2" == "$TEST_ROOT/next."* && "$2" != *.previous && "$3" == "$TEST_ROOT/web" ]]; then
  [[ "$TEST_CASE" != swap-failure ]] || exit 26
  touch "$TEST_ROOT/swapped"
fi
exec /usr/bin/mv "$@"
''',
            "flock": '#!/usr/bin/env bash\n[[ "$TEST_CASE" != lock-failure ]]\n',
            "chown": "#!/usr/bin/env bash\nexit 0\n",
        }
        for name, body in scripts.items():
            path = self.root / "bin" / name
            path.write_bytes(body.encode())
            path.chmod(0o755)
        if case == "preflight-failure":
            (self.web / "index.html").write_bytes(b"manual change")
        env = os.environ.copy()
        env.update({"TEST_ROOT": posix, "TEST_CASE": case})
        command = 'export PATH="$TEST_ROOT/bin:$PATH"; bash "$TEST_ROOT/installer.sh" "$TEST_ROOT/release"'
        return subprocess.run([BASH, "-c", command], env=env, capture_output=True, text=True, timeout=60)

    def test_installer_success_and_idempotent_repeat(self):
        result = self.installer("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RELEASE INSTALLED: v0.10.0", result.stdout)
        self.assertEqual(checker.installed(self.release, self.web), "ALREADY")
        result = self.installer("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RELEASE ALREADY INSTALLED", result.stdout)
        self.assertEqual(len(list((self.root / "backups").iterdir())), 1)

    def test_installer_failures_preserve_previous_pwa(self):
        for case in ["preflight-failure", "lock-failure", "backup-failure", "stage-failure", "swap-failure", "public-failure", "health-failure"]:
            with self.subTest(case=case):
                # Each simulated failure has a fresh independent filesystem.
                other = PwaReleaseTests()
                other.setUp()
                try:
                    result = other.installer(case)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    for name, data in other.old.items():
                        if case == "preflight-failure" and name == "index.html":
                            data = b"manual change"
                        self.assertEqual((other.web / name).read_bytes(), data)
                    if case in {"swap-failure", "public-failure", "health-failure"}:
                        self.assertIn("Previous verified PWA restored", result.stderr)
                finally:
                    other.doCleanups()

    def test_linux_contract_and_no_backend_commands(self):
        subprocess.run([BASH, "-n", str(DEPLOY / "install-pwa-release.sh")], check=True, capture_output=True)
        source = (DEPLOY / "install-pwa-release.sh").read_bytes()
        self.assertNotIn(b"\r", source)
        for command in [b"docker ", b"alembic ", b"systemctl ", b"nginx ", b"pg_dump", b"rm -"]:
            self.assertNotIn(command, source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
