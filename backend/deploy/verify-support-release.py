"""Verify deployed support metadata without printing credentials or record data."""

import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def run(args, payload=None):
    result=subprocess.run(args,input=payload,capture_output=True,text=True)
    if result.returncode: raise RuntimeError("Verification command failed; private output withheld.")
    return result.stdout


def env_lines(path):
    return {line.partition("=")[0].strip():line for line in path.read_text().splitlines()
            if "=" in line and not line.lstrip().startswith("#")}


def main():
    root=Path(sys.argv[1]).resolve(strict=True)
    source=root/"source"
    manifest=json.loads((root/"validation.json").read_text())
    tag=(root/"release-tag.txt").read_text().strip()
    state=Path("/var/backups/khaneyar")/tag
    os.chdir("/opt/khaneyar/backend/deploy")
    api_id=run(["docker","compose","ps","-q","api"]).strip()
    image=run(["docker","inspect","--format","{{.Config.Image}}",api_id]).strip()
    assert image=="khaneyar-api:"+tag
    paths=["app/main.py","app/core/config.py","app/api/v1/router.py","app/api/v1/routes/support.py",
        "app/api/v1/routes/usage.py","app/models/family.py","app/models/support.py","app/schemas/support.py",
        "app/services/support.py","app/services/usage.py","app/services/auth.py","app/services/family.py","app/services/sessions.py",
        "app/services/transactions.py","app/services/transfer_fees.py"]
    expected={path:hashlib.sha256((source/"backend"/path).read_bytes()).hexdigest() for path in paths}
    code="import hashlib,json;from pathlib import Path;print(json.dumps({p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in "+repr(paths)+"}))"
    actual=json.loads(run(["docker","compose","exec","-T","api","python","-c",code]))
    assert expected==actual
    probe="""import json
from sqlalchemy import text
from app.core.config import settings
from app.db.session import engine
with engine.connect() as db:
 db.execute(text('SET TRANSACTION READ ONLY'))
 role=db.execute(text('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).one()
 revision=db.execute(text('SELECT version_num FROM alembic_version')).scalar_one()
 rls=db.execute(text("SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('accounts','transactions','documents','tasks')")).scalar_one()
 counts=db.execute(text('SELECT * FROM public.support_record_counts()')).mappings().one()
 print(json.dumps({'revision':revision,'restricted_role':not any(role),'rls':rls,'count_fields':list(counts),'counts_valid':all(isinstance(n,int) and n>=0 for n in counts.values()),'origin':settings.support_origins_list==['https://supp.khaanehyar.ir'],'operator':bool(settings.support_username and settings.support_password_hash.startswith('$argon2id$'))}))
"""
    metadata=json.loads(run(["docker","compose","exec","-T","api","python","-c",probe]))
    assert metadata["revision"]=="0029" and all(metadata[key] for key in ["restricted_role","rls","counts_valid","origin","operator"])
    assert set(metadata["count_fields"])=={"transactions","scheduled_plans","open_tasks","completed_tasks","shopping_lists","documents"}
    original=json.loads(Path("/var/backups/khaneyar/support-host/original.json").read_text())
    before=env_lines(Path(original["backup"])/"env")
    current=env_lines(Path(".env"))
    assert all(current.get(key)==value for key,value in before.items() if key not in {"COMPOSE_FILE","SUPPORT_ORIGINS"})
    log=(state/"installation.log").read_text()
    assert "Existing records verified unchanged during the support migration." in log
    backup=Path(re.findall(r"Backup: (/var/backups/khaneyar/releases/[0-9-]+)",log)[-1])
    uploads_backup=backup/"uploads-before.tar.gz"
    if uploads_backup.exists():
        with tarfile.open(uploads_backup) as archive:
            hashes={item.name.removeprefix("uploads/"):hashlib.sha256(archive.extractfile(item).read()).hexdigest() for item in archive.getmembers() if item.isfile()}
        uploads=Path.cwd()/"uploads"
        assert all((uploads/name).is_file() and hashlib.sha256((uploads/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items())
    for attempt in range(15):
        try:
            with urlopen("https://supp.khaanehyar.ir/api/v1/support/session",timeout=5) as response:
                assert response.status==200 and json.load(response)=={"authenticated":False}
            break
        except (URLError,TimeoutError):
            if attempt==14: raise
            time.sleep(2)
    for file,digest in manifest["pwa_sha256"].items():
        with urlopen(Request("https://pwa.khaanehyar.ir/"+file,headers={"Cache-Control":"no-cache"}),timeout=20) as response:
            assert hashlib.sha256(response.read()).hexdigest()==digest,file
    with urlopen("https://supp.khaanehyar.ir/",timeout=20) as response:
        assert hashlib.sha256(response.read()).hexdigest()==manifest["pwa_sha256"]["support.html"]
    with urlopen("https://supp.khaanehyar.ir/support.webmanifest",timeout=20) as response:
        assert hashlib.sha256(response.read()).hexdigest()==manifest["pwa_sha256"]["support.webmanifest"]
    with urlopen("https://pwa.khaanehyar.ir/support",timeout=20) as response:
        assert response.url=="https://supp.khaanehyar.ir/"
    for path,status in [("/api/v1/support/users",401),("/api/v1/transactions",404),("/sw.js",404)]:
        try:
            urlopen("https://supp.khaanehyar.ir"+path,timeout=20)
            raise AssertionError("Unexpected public access.")
        except HTTPError as error: assert error.code==status
    report={"tag":tag,"commit":manifest["commit"],"host":"supp.khaanehyar.ir","revision":"0029","api_files_match":len(paths),
        "pwa_files_match":len(manifest["pwa_sha256"]),"restricted_role_and_rls":True,"anonymous_counts_available":True,
        "migration_records_preserved":True,"previous_settings_preserved":True,"existing_uploads_preserved":True,
        "https_and_redirect_verified":True,"financial_paths_blocked_on_support_host":True,"backup":str(backup)}
    (state/"verification.json").write_text(json.dumps(report,indent=2))
    print("PASS: support HTTPS, redirect, API source, RLS, anonymous counts and retained data/settings verified.")
    print("Verification: "+str(state/"verification.json"))


if __name__=="__main__": main()
