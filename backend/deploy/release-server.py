"""Upgrade the existing VPS without reading or copying any sandbox data."""

from __future__ import annotations

import base64
import json
import os
import secrets
import shutil
import subprocess
import sys
from pathlib import Path


def compose_config() -> dict:
    result = subprocess.run(  # noqa: S603 -- fixed Docker command in the administrator's environment
        [shutil.which("docker") or "/usr/bin/docker", "compose", "config", "--format", "json"],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)


def prepare(source: Path, image: str) -> None:
    config = compose_config()
    environment = config["services"]["api"]["environment"]
    key = environment.get("DOCUMENT_ENCRYPTION_KEY", "").strip()
    if key and len(base64.b64decode(key, validate=True)) != 32:
        raise RuntimeError("Existing document encryption key is invalid; it was preserved.")
    generated = not key
    if generated:
        key = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
    directory = Path.cwd()
    previous_files = environment.get("COMPOSE_FILE", "")
    if previous_files:
        files = previous_files.split(":")
    else:
        files = ["docker-compose.yml"]
        if Path("docker-compose.override.yml").exists():
            files.append("docker-compose.override.yml")
    override = directory / "docker-compose.release.json"
    files = [str((directory / item).resolve()) for item in files]
    if str(override) not in files:
        files.append(str(override))
    override.write_text(json.dumps({"services": {"api": {
        "image": image, "build": {"context": str(source / "backend")},
    }}}), encoding="utf-8")
    override.chmod(0o600)
    # Append only deployment-owned settings; preserve every existing value/comment.
    with Path(".env").open("a", encoding="utf-8") as target:
        target.write("\nCOMPOSE_FILE=" + ":".join(files) + "\n")
        if generated:
            target.write("DOCUMENT_ENCRYPTION_KEY=" + key + "\n")
    Path(".env").chmod(0o600)
    print("1" if generated else "0")


def migrate(check_only: bool, generated_key: bool) -> None:
    # Imported only in the release container, which has the backend dependencies.
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import URL, make_url

    app_url = make_url(os.environ["DATABASE_URL"])
    if app_url.host != "db":
        raise RuntimeError("This installer requires the existing Compose database host 'db'.")
    admin_url = URL.create(
        "postgresql+psycopg", username=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"], host="db",
        database=os.environ["POSTGRES_DB"],
    )
    if admin_url.database != app_url.database:
        raise RuntimeError("Application and backup database names differ; upgrade stopped.")
    engine = create_engine(admin_url, hide_parameters=True)
    try:
        with engine.begin() as connection:
            role = connection.execute(text(
                "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = :role"
            ), {"role": app_url.username}).one()
            if any(role):
                raise RuntimeError("Application role must be NOSUPERUSER and NOBYPASSRLS.")
            revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            if revision not in {f"{number:04d}" for number in range(11, 29)}:
                raise RuntimeError("Unexpected database revision; no migration was performed.")
            if generated_key:
                for table in ("documents", "goals"):
                    exists = connection.execute(
                        text("SELECT to_regclass(:table)"), {"table": table}
                    ).scalar()
                    if exists:
                        quoted_table = connection.dialect.identifier_preparer.quote(table)
                        count = connection.exec_driver_sql(
                            "SELECT count(*) FROM " + quoted_table  # noqa: S608 -- fixed, quoted table names
                        ).scalar_one()
                        if count:
                            raise RuntimeError(
                                "Encrypted records exist without their key; upgrade stopped."
                            )
        if check_only:
            print("Database revision and restricted application role verified.")
            return
        starting_revision = revision
        # The installer has stopped the API. Hash every existing table before and
        # after migration; only the additive member support reference is omitted.
        # No record contents or credentials leave the migration process.
        def fingerprint(connection, tables):
            result = {}
            for table in tables:
                quoted = connection.dialect.identifier_preparer.quote(table)
                excluded = ["support_registered_at", "support_last_login_at"] if starting_revision in ("0026", "0027") else []
                if starting_revision == "0026":
                    excluded.append("support_code")
                expression = "to_jsonb(t)"
                if table == "members" and excluded:
                    expression += " - ARRAY[" + ",".join("'" + field + "'" for field in excluded) + "]"
                result[table] = tuple(connection.exec_driver_sql(
                    "SELECT count(*), md5(coalesce(string_agg((" + expression
                    + ")::text, '' ORDER BY (" + expression + ")::text), '')) FROM "
                    + quoted + " t"
                ).one())
            return result
        with engine.connect() as connection:
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            tables = connection.execute(text(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' "
                "AND tablename <> 'alembic_version' ORDER BY tablename"
            )).scalars().all() if revision in ("0026", "0027", "0028") else []
            before = fingerprint(connection, tables)
        os.environ["DATABASE_URL"] = admin_url.render_as_string(hide_password=False)
        from alembic import command  # noqa: I001 -- import after selecting the migration database
        from alembic.config import Config

        command.upgrade(Config("alembic.ini"), "0028")
        with engine.begin() as connection:
            role_name = connection.dialect.identifier_preparer.quote(app_url.username)
            connection.exec_driver_sql(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "
                + role_name
            )
            connection.exec_driver_sql(
                "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO " + role_name
            )
            connection.exec_driver_sql("GRANT EXECUTE ON FUNCTION public.support_record_counts() TO " + role_name)
            revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            if revision != "0028":
                raise RuntimeError("Database migration did not reach 0028.")
            if fingerprint(connection, tables) != before:
                raise RuntimeError("Existing records changed during migration; upgrade stopped.")
        print("Database upgraded to 0028; application permissions granted with RLS retained.")
        if tables:
            print("Existing records verified unchanged during the support migration.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    if sys.argv[1] == "prepare":
        prepare(Path(sys.argv[2]).resolve(), sys.argv[3])
    else:
        migrate(sys.argv[1] == "check", os.environ.get("KHANEYAR_GENERATED_KEY") == "1")
