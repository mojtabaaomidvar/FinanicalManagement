"""Read each installed web artifact's own metadata, without inferring it from the API."""
import json
import re
from pathlib import Path


def installed_web_version(root: Path) -> str:
    try:
        path = root / "version.json"
        if path.stat().st_size > 4096:
            return ""
        value = json.loads(path.read_text(encoding="utf-8"))
        version = value.get("version") if isinstance(value, dict) else None
        pattern = r"[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,32})?"
        return version if isinstance(version, str) and re.fullmatch(pattern, version) else ""
    except (OSError, UnicodeError, ValueError):
        return ""
