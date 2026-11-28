"""API/PWA wallet update on the installed 0.13.0 release, with no migration."""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("wallet_home2_install", HERE / "upgrade-home2.py")
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)
common = home.common
common.STATE = Path("/var/lib/khaneyar/releases/wallet-0.14.0")
common.BACKUPS = Path("/var/backups/khaneyar/wallet-0.14.0")
common.IMAGE = "khaneyar-api:v0.14.0"


class Installer(home.Installer):
    software_version = "0.14.0"
    baseline_revision = home.REVISION
    baseline_pwa_version = "0.13.0"
    release_label = "Wallet"
    staging_suffix = ".wallet014"

    def preflight(self):
        if self.manifest.get("database_migration_required") is not False:
            raise ValueError("Wallet release must not migrate the database")
        for tool in ("docker", "systemctl"):
            if shutil.which(tool) is None:
                raise ValueError("Required installation tool is missing: " + tool)
        self.run(["docker", "compose", "version"], cwd=Path("/"))
        super().preflight()

    def backup_and_migrate(self):
        """Retain the shared installer interface; this release never migrates."""
        print("2/5 Pausing services and taking protected backups...", flush=True)
        self.system("stop")
        self.quiesced = True
        self.compose("stop", "api")
        self.save(identity_sha256=self.snapshot_identity(self.state_dir),
                  runtime_sha256=common.digest(common.DEPLOY / "management/runtime.json"))
        shutil.copytree(self.state_dir, self.backup / "management-state")
        shutil.copyfile(common.CONFIG, self.backup / "management-config.json")
        shutil.copytree(common.PWA, self.backup / "pwa-before")
        shutil.copyfile(common.DEPLOY / ".env", self.backup / "env-before")
        override = common.DEPLOY / "docker-compose.release.json"
        self.save(had_override=override.exists())
        if override.exists():
            shutil.copyfile(override, self.backup / "compose-before.json")
        with (self.backup / "database-before.dump").open("xb") as stream:
            self.compose("exec", "-T", "db", "sh", "-c", 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                         output=stream, timeout=1800)
            stream.flush()
            os.fsync(stream.fileno())
        self.prepare_compose()
        restore = "khaneyar_analytics_restore_" + os.urandom(8).hex()
        self.compose("exec", "-T", "db", "sh", "-c", 'exec createdb -U "$POSTGRES_USER" -T template0 "$1"', "_", restore)
        self.created_restore = restore
        with (self.backup / "database-before.dump").open("rb") as stream:
            result = subprocess.run(["docker", "compose", "exec", "-T", "db", "sh", "-c",
                                     'exec pg_restore --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$1"', "_", restore],
                                    stdin=stream, stdout=self.log, stderr=self.log, cwd=common.DEPLOY, timeout=1800)
        if result.returncode or self.container("database", database=restore) != home.REVISION:
            raise ValueError("Backup restore verification failed")
        self.drop_restore()
        if self.container("database") != home.REVISION:
            raise ValueError("Installed schema differs from the wallet baseline")
        self.save(phase="backed-up-schema-unchanged")
        print("3/5 Backup verified; database revision 0042 is unchanged. No migration.", flush=True)


if __name__ == "__main__":
    try:
        home.main(Installer)
    except Exception as error:
        print("Wallet upgrade stopped: " + type(error).__name__ + ". Inspect the protected install log if created.", file=sys.stderr)
        raise SystemExit(1) from None
