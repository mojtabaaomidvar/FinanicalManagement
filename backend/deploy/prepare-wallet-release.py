"""Change only deployment-owned image/build; preserve resolved private settings."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def compose_config():
    result = subprocess.run([shutil.which("docker") or "/usr/bin/docker", "compose", "config", "--format", "json"],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def invariant(config):
    value = json.loads(json.dumps(config))
    api = value["services"]["api"]
    api.pop("image", None)
    api.pop("build", None)
    api.get("environment", {}).pop("COMPOSE_FILE", None)
    return value


def replace(path, value):
    temporary = path.with_name(path.name + ".wallet-next")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError("Unexpected staging configuration; preserved.")
    with temporary.open("x", encoding="utf-8", newline="\n") as target:
        target.write(value)
    temporary.chmod(0o600)
    os.replace(temporary, path)


def prepare(source, image):
    if image != "khaneyar-api:v0.11.0" or not source.is_dir() or source.is_symlink():
        raise RuntimeError("Unexpected wallet deployment target.")
    env = Path(".env")
    override = Path("docker-compose.release.json")
    if env.is_symlink() or not env.is_file() or override.is_symlink():
        raise RuntimeError("Configuration must be existing regular files.")
    before = compose_config()
    old = json.loads(override.read_text(encoding="utf-8")) if override.exists() else {}
    api = old.setdefault("services", {}).setdefault("api", {})
    api["image"] = image
    api["build"] = {"context": str(source / "backend")}
    files = before["services"]["api"]["environment"].get("COMPOSE_FILE", "").split(":")
    if files == [""]:
        files = ["docker-compose.yml"]
        if Path("docker-compose.override.yml").exists():
            files.append("docker-compose.override.yml")
    files = [str(Path(name).resolve()) for name in files]
    if str(override.resolve()) not in files:
        files.append(str(override.resolve()))
    content = env.read_text(encoding="utf-8")
    replace(override, json.dumps(old))
    replace(env, content + "\nCOMPOSE_FILE=" + ":".join(files) + "\n")
    after = compose_config()
    if (invariant(before) != invariant(after) or after["services"]["api"].get("image") != image or
            Path(after["services"]["api"].get("build", {}).get("context", "")).resolve() != source / "backend"):
        raise RuntimeError("Private/unrelated Compose settings changed; restore saved configuration.")
    print("Private settings and unrelated services preserved; API image/build prepared.")


if __name__ == "__main__":
    try:
        prepare(Path(sys.argv[1]).resolve(), sys.argv[2])
    except Exception:
        raise SystemExit("Wallet configuration preparation failed; no secret diagnostics printed.") from None
