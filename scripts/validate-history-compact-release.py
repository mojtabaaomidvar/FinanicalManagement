"""Run isolated release checks and retain exact command status and local evidence."""
from __future__ import annotations

import concurrent.futures
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".local-test/history-compact-release"
ENVIRONMENT = os.environ | {
    "PYTHONIOENCODING": "utf-8",
    "VITE_API_URL": "https://api.khaanehyar.ir",
    "VITE_SUPPORT_HOST": "supp.khaanehyar.ir",
    "VITE_APP_URL": "https://pwa.khaanehyar.ir",
}


def run(item):
    name, command = item
    started = time.monotonic()
    with (OUTPUT / (name + ".log")).open("wb") as log:
        result = subprocess.run(command, cwd=ROOT, env=ENVIRONMENT, stdout=log, stderr=subprocess.STDOUT, timeout=1200, check=False)
    report = {"exit_code": result.returncode, "elapsed_seconds": round(time.monotonic() - started, 1), "command": command}
    (OUTPUT / (name + "-result.json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"check": name, **report}), flush=True)
    return result.returncode


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if sys.argv[1:] == ["--browsers"]:
        for name, script in (("history", "check-release-history.mjs"), ("wallet", "check-wallet-access.mjs"),
                             ("management", "check-management.mjs")):
            if run((name, ["node", "scripts/" + script])):
                return 1
        latest = max((ROOT / ".local-test/management-browser").glob("*/results.json"), key=lambda path: path.stat().st_mtime)
        (OUTPUT / "management-browser.json").write_bytes(latest.read_bytes())
        return 0
    if sys.argv[1:]:
        raise ValueError("Use no arguments or --browsers")
    checks = [
        ("frontend", ["node", "node_modules/vitest/vitest.mjs", "run", "--config", "scripts/vitest-release.config.ts",
                      "--reporter=json", "--outputFile=.local-test/history-compact-release/frontend-tests.json"]),
        ("copy", ["cmd.exe", "/d", "/c", "npm run copy:studio:test"]),
        ("installer", [sys.executable, "scripts/test-history-compact-release.py"]),
        ("build", ["cmd.exe", "/d", "/c", "npm run build && npm run management:build"]),
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(run, checks))
    return int(any(results))


if __name__ == "__main__":
    raise SystemExit(main())
