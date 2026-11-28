"""Use the existing immutable-asset publisher for quick add 0.17.0."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("quick_add_publisher", ROOT / "scripts/publish-history-release.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
publisher.common.DIRECTORY = ROOT / ".local-test/quick-add-release"
publisher.common.TAG = "v0.17.0"
publisher.common.ASSETS = ("quick-add-0.17.0.tgz", "validation.json", "install.sh", "SHA256SUMS")
publisher.NOTES_PATH = ROOT / "docs/deployment-quick-add-0.17.0.md"
publisher.RELEASE_NAME = "KhanehYar 0.17.0 — Quick add"


if __name__ == "__main__":
    publisher.main()
