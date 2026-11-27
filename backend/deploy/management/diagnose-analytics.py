"""Read-only diagnostics for the checksum-pinned management 0.3.0 preflight."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import runpy
import sqlite3
import subprocess
from pathlib import Path

BUNDLE = Path("/opt/khaneyar-management/releases/analytics-0.3.0")
MANIFEST_SHA256 = "904ffda0740cb7de95ddf2ec2f38e28c90beb5090702b5ec358cd57f0440fa4f"
LOCATIONS = {
    "base": Path("/opt/khaneyar-management"),
    "deploy": Path("/opt/khaneyar/backend/deploy"),
    "config": Path("/etc/khaneyar-management/config.json"),
    "state": Path("/var/lib/khaneyar/releases/management-0.3.0"),
    "backups": Path("/var/backups/khaneyar/management-analytics"),
    "pwa": Path("/var/www/khaneyar"),
    "identity": Path("/var/lib/khaneyar-management"),
    "release_lock_parent": Path("/var/lock"),
}


def digest(path, *, code=False):
    data = path.read_bytes()
    return hashlib.sha256(data.replace(b"\r\n", b"\n") if code else data).hexdigest()


def plain(path):
    return not any(p.is_symlink() for p in (path, *path.parents))


def diagnose(bundle=BUNDLE, locations=None, runner=None, manifest_sha256=MANIFEST_SHA256):
    locations = LOCATIONS if locations is None else locations
    runner = subprocess.run if runner is None else runner
    base, deploy = locations["base"], locations["deploy"]
    results = []

    def record(name, ok, detail=""):
        results.append({"check": name, "ok": bool(ok), "detail": detail})

    manifest_path = bundle / "validation.json"
    if not plain(bundle) or not manifest_path.is_file() or digest(manifest_path) != manifest_sha256:
        record("MANIFEST", False, "missing, linked or checksum differs")
        return results
    manifest = json.loads(manifest_path.read_bytes())
    expected = manifest["files_sha256"] | {"validation.json": manifest_sha256}
    actual = {p.relative_to(bundle).as_posix() for p in bundle.rglob("*") if p.is_file()}
    bad = [name for name, sha in expected.items() if not plain(bundle / name)
           or not (bundle / name).is_file() or digest(bundle / name) != sha]
    extras = sorted(actual - set(expected))
    record("BUNDLE", not bad and not extras, "; ".join((bad + extras)[:3]))
    if bad or extras:
        return results
    # The pinned module is imported under <run_path>; its main/installer are never called.
    module = runpy.run_path(str(bundle / "upgrade-analytics.py"))
    linked = [name for name, path in locations.items() if not plain(path)]
    record("PATHS", not linked, ", ".join(linked))
    if linked:
        return results
    config = {}
    try:
        config = json.loads(locations["config"].read_bytes())
        ok = (config.get("mode"), config.get("origin"), config.get("web_root"), config.get("state_dir")) == (
            "production", "https://supp.khaanehyar.ir", str(base / "web"), str(locations["identity"]))
        record("CONFIG", ok, "expected mode/origin/web/identity paths" if not ok else "")
    except (OSError, ValueError):
        record("CONFIG", False, "missing or invalid JSON")
    for name, path, version in (("PWA", locations["pwa"] / "version.json", "0.12.0"),
                                ("MANAGEMENT_VERSION", base / "web/version.json", "0.2.0")):
        try:
            record(name, json.loads(path.read_bytes()).get("version") == version, "expected " + version)
        except (OSError, ValueError):
            record(name, False, "metadata missing or invalid")
    runtime = deploy / "management/runtime.json"
    try:
        readable = plain(runtime) and runtime.is_file() and runtime.stat().st_size <= 4096 and bool(runtime.stat().st_mode & 0o004)
        policy = runpy.run_path(str(bundle / "source/backend/app/core/feature_policy.py"))
        flags = json.loads(runtime.read_bytes()) if readable else None
        valid = isinstance(flags, dict) and all(
            key in {"maintenance", "registration_enabled", "assistant_enabled"} and type(value) is bool
            or key in policy["FEATURE_KEYS"] and isinstance(value, str) and value in policy["FEATURE_STATES"]
            for key, value in (flags or {}).items())
        record("RUNTIME", readable and valid, "missing, unreadable or unsupported policy" if not (readable and valid) else "")
    except (OSError, ValueError, TypeError):
        record("RUNTIME", False, "file or policy could not be validated")
    mismatches = []
    for name, sha in manifest["management_baseline_sha256"].items():
        path = base / "source" / name
        if not plain(path) or not path.is_file() or digest(path, code=True) != sha:
            mismatches.append(name)
    record("MANAGEMENT_SOURCE", not mismatches, "; ".join(mismatches[:3])
           + (" (+more)" if len(mismatches) > 3 else ""))
    try:
        with contextlib.closing(sqlite3.connect((locations["identity"] / "management.sqlite3").as_uri() + "?mode=ro", uri=True)) as db:
            busy = db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]
            for table in ("accounts", "metadata"):
                db.execute("SELECT 1 FROM " + table + " LIMIT 0")
        record("MANAGEMENT_JOBS", not busy, "busy" if busy else "idle")
    except (OSError, sqlite3.Error):
        record("MANAGEMENT_JOBS", False, "identity state not readable")
    journal = locations["state"] / "journal.json"
    if journal.is_file() and plain(journal):
        try:
            value = json.loads(journal.read_bytes())
            record("JOURNAL", False, "retained attempt; activated=" + str(bool(value.get("activated"))))
        except (OSError, ValueError):
            record("JOURNAL", False, "retained journal not readable")
    else:
        record("JOURNAL", True, "no prior attempt")
    for name, path in (("RELEASE_LOCK_PARENT", locations["release_lock_parent"]),
                       ("HOST_LOCK_PARENT", Path(config.get("backup_dir", "/var/backups/khaneyar/management")))):
        record(name, path.is_dir() and plain(path), "")
    try:
        result = runner(["systemctl", "is-active", "khaneyar-management.service"], capture_output=True, timeout=15)
        record("MANAGEMENT_SERVICE", result.returncode == 0, "active" if result.returncode == 0 else "not active")
    except (OSError, subprocess.SubprocessError):
        record("MANAGEMENT_SERVICE", False, "status unavailable")
    helper = (bundle / "analytics-container.py").read_text(encoding="utf-8")
    command = helper + "\ncontract=json.loads(" + repr(json.dumps(manifest["container"])) + ")\n" + '''
result={}
try:
 result['source']=source_state(contract)
except Exception:
 try:
  app=tree(Path.cwd()/'app')
  variants=contract['baseline_app_variants']
  def changed(candidate):
   return sorted(k for k in set(app)|set(candidate) if app.get(k)!=candidate.get(k))
  differences=min((changed(v) for v in variants),key=len)
  result['source']='DIFFERS'
  result['changed_app_files']=differences[:3]
  result['changed_app_count']=len(differences)
  result['alembic_matches']=tree(Path.cwd()/'alembic')==contract['baseline_alembic_sha256']
  result['dependencies_match']=hashlib.sha256((Path.cwd()/'pyproject.toml').read_bytes().replace(b'\\r\\n',b'\\n')).hexdigest()==contract['pyproject_sha256']
 except Exception:
  result['source']='UNREADABLE'
try:
 from sqlalchemy import text
 engine,role=database_engine()
 try:
  with engine.connect() as connection:
   connection.exec_driver_sql('SET TRANSACTION READ ONLY')
   result['revision']=connection.execute(text('SELECT version_num FROM public.alembic_version')).scalar_one()
   restricted(connection,role)
   result['restricted_role']=True
 finally:
  engine.dispose()
except Exception:
 result['database']='UNREADABLE'
print(json.dumps(result))
'''
    try:
        process = runner(["docker", "compose", "exec", "-T", "api", "python", "-"],
                         input=command.encode(), capture_output=True, cwd=deploy, timeout=45)
        if process.returncode:
            raise ValueError("container check failed")
        data = json.loads(process.stdout)
        record("API_SOURCE", data.get("source") == "BASELINE", json.dumps({key: data[key] for key in (
            "source", "changed_app_files", "changed_app_count", "alembic_matches", "dependencies_match") if key in data}, separators=(",", ":")))
        record("DATABASE", data.get("revision") == "0037_wallet_corrections" and data.get("restricted_role") is True,
               data.get("revision", "unavailable"))
    except (OSError, ValueError, subprocess.SubprocessError):
        record("API_SOURCE", False, "container check unavailable; raw output withheld")
    return results


if __name__ == "__main__":
    print("Read-only diagnostics. No installation or configuration changes.")
    try:
        for item in diagnose():
            print(item["check"] + ": " + ("OK" if item["ok"] else "FAIL") + (" - " + item["detail"] if item["detail"] else ""))
    except Exception:
        print("DIAGNOSTIC: FAILED; private error details withheld.")
