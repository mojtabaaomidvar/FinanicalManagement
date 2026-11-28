"""Read-only verification of the exact installed wallet baseline for quick add."""
import hashlib
import io
import json
import subprocess
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".local-test/quick-add-release"
COMMIT = "b794b15ed29dd86a2d5d77830bf1917016508127"
RELEASE = "https://github.com/mojtabaaomidvar/FinanicalManagement/releases/download/"


def get(url):
    result = subprocess.run(["curl.exe", "-4fsSL", "--proto", "=https", "--proto-redir", "=https",
        "--retry", "2", "--connect-timeout", "15", "--max-time", "180",
        "--header", "Cache-Control: no-cache", url], capture_output=True, timeout=550, check=False)
    if result.returncode:
        raise ValueError("Public verification download failed: " + url)
    return result.stdout


def main():
    folder = OUTPUT / "baseline"
    folder.mkdir(parents=True, exist_ok=True)
    metadata = get(RELEASE + "v0.16.0/validation.json")
    if hashlib.sha256(metadata).hexdigest() != "72743fa711ffe8c104285e44ca84c3d7e70c9b9f402830cd54e501c82a846190":
        raise ValueError("Published wallet baseline manifest differs")
    baseline = json.loads(metadata)
    if (baseline["source_commit"], baseline["software_version"], baseline["management_version"]) != (COMMIT, "0.16.0", "0.4.1"):
        raise ValueError("Unexpected published baseline")
    archive = get(RELEASE + "v0.16.0/wallet-0.16.0.tgz")
    if hashlib.sha256(archive).hexdigest() != "4c3b0ec61e876516331e4a946ce47e2011cd880250a459de24b6cfae7bfcb033":
        raise ValueError("Published wallet baseline archive differs")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
        if source.extractfile("validation.json").read() != metadata:
            raise ValueError("Baseline archive metadata differs")
    (folder / "wallet-0.16.0.tgz").write_bytes(archive)
    (folder / "validation.json").write_bytes(metadata)
    history = get(RELEASE + "v0.15.1/validation.json")
    if hashlib.sha256(history).hexdigest() != "6ff7d85556270f374f3332d6e5e0197829f8f6df86357be1afe76430aa48eada":
        raise ValueError("Published management lineage differs")
    history = json.loads(history)
    if history["web_sha256"] != baseline["baseline_web_sha256"]:
        raise ValueError("Management lineage is inconsistent")
    retained = {name: value for name, value in history["baseline_web_sha256"].items() if name.startswith("assets/")}
    (OUTPUT / "retained-management-assets.json").write_text(json.dumps(retained, indent=2), encoding="utf-8")
    tasks = [("https://pwa.khaanehyar.ir/" + name, digest) for name, digest in baseline["pwa_sha256"].items()
             if not name.startswith("meal-library/")]
    tasks += [("https://supp.khaanehyar.ir/management/" + ("" if name == "management.html" else name), digest)
              for name, digest in baseline["baseline_web_sha256"].items()]

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
    report = {"passed": True, "source_commit": COMMIT, "manifest_sha256": hashlib.sha256(metadata).hexdigest(),
        "public_files_checked": len(checked), "api_health": health["status"],
        "pwa_version": "0.16.0", "management_version": "0.4.1",
        "api_source_schema_and_full_recipe_inventory_require_server_preflight": True}
    (OUTPUT / "baseline-check.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
