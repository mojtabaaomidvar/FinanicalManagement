"""Read only: pin the baseline and check public application/management assets."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".local-test/wallet-compact-release"
BASELINE_COMMIT = "7b4854a97ddaed345f073a23d422500ed6f28fc4"
BASELINE_MANIFEST_SHA = "6ff7d85556270f374f3332d6e5e0197829f8f6df86357be1afe76430aa48eada"
URL = "https://github.com/mojtabaaomidvar/FinanicalManagement/releases/download/v0.15.1/validation.json"


def get(url):
    result = subprocess.run(["curl.exe", "-4fsSL", "--proto", "=https", "--proto-redir", "=https",
                             "--retry", "2", "--connect-timeout", "15", "--max-time", "60",
                             "--header", "Cache-Control: no-cache", url], capture_output=True, timeout=200)
    if result.returncode:
        raise ValueError("Public verification download failed: " + url)
    return result.stdout


def main():
    data = get(URL)
    if hashlib.sha256(data).hexdigest() != BASELINE_MANIFEST_SHA:
        raise ValueError("Published baseline manifest differs")
    baseline = json.loads(data)
    if (baseline["source_commit"], baseline["software_version"], baseline["management_version"]) != (BASELINE_COMMIT, "0.15.1", "0.4.1"):
        raise ValueError("Unexpected published baseline")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "baseline-validation.json").write_bytes(data)
    # The unchanged large recipe corpus is checked against the complete local
    # inventory by server preflight; public checks cover the application assets.
    tasks = [("https://pwa.khaanehyar.ir/" + name, digest) for name, digest in baseline["pwa_sha256"].items()
             if not name.startswith("meal-library/")]
    tasks += [("https://supp.khaanehyar.ir/management/" + ("" if name == "management.html" else name), digest)
              for name, digest in baseline["web_sha256"].items()]
    def check(item):
        url, expected = item
        if hashlib.sha256(get(url)).hexdigest() != expected:
            raise ValueError("Installed public baseline differs: " + url)
        return url
    with ThreadPoolExecutor(max_workers=6) as pool:
        checked = list(pool.map(check, tasks))
    health = json.loads(get("https://api.khaanehyar.ir/api/v1/healthz"))
    if health.get("status") != "ok":
        raise ValueError("Installed API health differs")
    report = {"passed": True, "source_commit": BASELINE_COMMIT, "manifest_sha256": BASELINE_MANIFEST_SHA,
              "pwa_files": len(baseline["pwa_sha256"]), "management_files": len(baseline["web_sha256"]),
              "public_files_checked": len(checked), "api_health": health["status"],
              "unchanged_recipe_corpus_requires_complete_server_inventory_check": True,
              "api_source_and_database_require_server_preflight": True}
    (OUTPUT / "baseline-check.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
