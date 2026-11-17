"""Deployment settings must preserve existing secrets and unrelated server overrides."""

from __future__ import annotations

import base64
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "release_server", Path(__file__).with_name("release-server.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReleaseSettingsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="khaneyar-release-settings-")
        self.previous_cwd = Path.cwd()
        os.chdir(self.directory.name)

    def tearDown(self):
        os.chdir(self.previous_cwd)
        self.directory.cleanup()

    def prepare(self, environment):
        with patch.object(module, "compose_config", return_value={
            "services": {"api": {"environment": environment}}
        }), contextlib.redirect_stdout(io.StringIO()) as output:
            module.prepare(Path.cwd() / "source", "khaneyar-api:test")
        return output.getvalue().strip()

    def test_existing_key_and_custom_settings_are_preserved(self):
        key = base64.b64encode(b"x" * 32).decode()
        before = b"# manual settings\nOTHER_SETTING=keep\nDOCUMENT_ENCRYPTION_KEY=" + key.encode()
        Path(".env").write_bytes(before)
        Path("docker-compose.override.yml").write_text("services: {}\n")
        self.assertEqual(self.prepare({"DOCUMENT_ENCRYPTION_KEY": key}), "0")
        after = Path(".env").read_bytes()
        self.assertTrue(after.startswith(before))
        self.assertEqual(after.count(key.encode()), 1)
        self.assertIn(b"docker-compose.override.yml", after)
        self.assertEqual(Path("docker-compose.override.yml").read_text(), "services: {}\n")
        override = json.loads(Path("docker-compose.release.json").read_text())
        self.assertEqual(set(override["services"]), {"api"})
        self.assertNotIn(key, json.dumps(override))

    def test_new_key_is_not_regenerated_on_retry(self):
        Path(".env").write_text("DATABASE_URL=secret-test-value\n")
        self.assertEqual(self.prepare({}), "1")
        lines = Path(".env").read_text().splitlines()
        key = next(line.split("=", 1)[1] for line in lines if line.startswith("DOCUMENT_ENCRYPTION_KEY="))
        self.assertEqual(len(base64.b64decode(key, validate=True)), 32)
        self.assertEqual(self.prepare({"DOCUMENT_ENCRYPTION_KEY": key}), "0")
        self.assertEqual(Path(".env").read_text().count(key), 1)
        self.assertNotIn("secret-test-value", Path("docker-compose.release.json").read_text())

    def test_invalid_existing_key_changes_no_files(self):
        before = b"DOCUMENT_ENCRYPTION_KEY=invalid\nOTHER_SETTING=keep\n"
        Path(".env").write_bytes(before)
        with self.assertRaises(Exception):
            self.prepare({"DOCUMENT_ENCRYPTION_KEY": "invalid"})
        self.assertEqual(Path(".env").read_bytes(), before)
        self.assertFalse(Path("docker-compose.release.json").exists())


if __name__ == "__main__":
    unittest.main()
