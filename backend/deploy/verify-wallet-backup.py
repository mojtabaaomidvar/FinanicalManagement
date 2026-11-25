"""Compare restored backup to stopped live DB; no record contents leave the server."""
import importlib.util
import re
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

spec = importlib.util.spec_from_file_location("wallet_migrator", Path(__file__).with_name("migrate-wallet-release.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def verify(name):
    live, _ = module.checker.database_engine()
    if not re.fullmatch(r"khaneyar_wallet_restore_[0-9_]+", name) or name == live.url.database:
        raise RuntimeError("Unsafe restore-check database name.")
    restored = create_engine(live.url.set(database=name), hide_parameters=True)
    try:
        with live.connect() as a, restored.connect() as b:
            a.exec_driver_sql("SET TRANSACTION READ ONLY")
            b.exec_driver_sql("SET TRANSACTION READ ONLY")
            names = module.tables(a)
            if (module.tables(b) != names or
                    module.fingerprint(a, names, omit_new_revision=False) != module.fingerprint(b, names, omit_new_revision=False)
                    or a.scalar(text("SELECT version_num FROM alembic_version")) != b.scalar(text("SELECT version_num FROM alembic_version"))
                    or module.checker.schema_digest(a) != module.checker.schema_digest(b)):
                raise RuntimeError("Restored database differs; live migration must not start.")
    finally:
        restored.dispose()
        live.dispose()
    print("DATABASE BACKUP RESTORE VERIFIED: historical rows and financial schema match.")


if __name__ == "__main__":
    try:
        verify(sys.argv[1])
    except Exception:
        raise SystemExit("Backup restore verification failed; live database untouched; no secret diagnostics printed.") from None
