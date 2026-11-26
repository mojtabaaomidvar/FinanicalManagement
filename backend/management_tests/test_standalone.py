"""The independent management installation must not acquire application/DB dependencies."""

import shutil
import subprocess
import sys
from pathlib import Path


def test_installed_management_tree_boots_without_application_dependencies(tmp_path):
    backend = Path(__file__).resolve().parents[1]
    app = tmp_path / "source" / "app"
    (app / "management").mkdir(parents=True)
    (app / "core").mkdir()
    shutil.copy2(backend / "app/__init__.py", app / "__init__.py")
    for module in (backend / "app/management").glob("*.py"):
        shutil.copy2(module, app / "management" / module.name)
    for name in ("__init__.py", "feature_policy.py"):
        shutil.copy2(backend / "app/core" / name, app / "core" / name)
    script = """
import importlib.abc, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
class NoApplicationDependencies(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        blocked = ('app.db', 'app.models', 'app.services', 'app.core.config', 'sqlalchemy')
        if fullname.startswith(blocked):
            raise AssertionError('Management imported an application dependency: ' + fullname)
sys.meta_path.insert(0, NoApplicationDependencies())
from app.management.contracts import Config
from app.management.main import create_app
base = Path(sys.argv[2])
application = create_app(Config(mode='demo', origin='http://127.0.0.1:5710',
                               state_dir=base/'state', web_root=base/'web'))
assert application.state.driver.read('ai-analytics', {'days': 7})['available'] is True
assert application.state.driver.read('settings', {})['feature_controls_supported'] is True
application.state.executor.shutdown()
"""
    result = subprocess.run(  # noqa: S603 -- fixed interpreter and inline script; temporary local paths
        [sys.executable, "-X", "utf8", "-c", script, str(app.parent), str(tmp_path)],
        capture_output=True, text=True, check=False, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    installer = (backend / "deploy/management/install-management.sh").read_text(encoding="utf-8")
    assert '"$source_root/backend/app/core/feature_policy.py"' in installer
