import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('.');
const phones = ['09000000001', '09000000002'];
const lockPath = resolve('.local-test/home-preferences-fixture.lock');

// Only these two named fake members and only the two Home preference columns.
// The fixed local, non-superuser connection never uses an inherited DB URL.
async function fixture(action, accounts = phones.map(phone => ({ phone }))) {
  const config = JSON.parse(await readFile(resolve('.local-test/config.json'), 'utf8'));
  const source = [
    'import json,sys,psycopg', 'from psycopg.types.json import Jsonb', 'p=json.load(sys.stdin)',
    "assert p['action'] in ('read','restore')",
    "assert len(p['accounts'])==2 and {a['phone'] for a in p['accounts']}=={'09000000001','09000000002'}",
    "with psycopg.connect(host='127.0.0.1',port=55439,dbname='khaneyar_local_sandbox',user='khaneyar_sandbox',password=p['password']) as db:",
    ' with db.cursor() as cur:', "  cur.execute('SELECT current_database()')",
    "  assert cur.fetchone()[0]=='khaneyar_local_sandbox'", '  result=[]', "  for a in p['accounts']:",
    "   cur.execute('SELECT id::text,family_id::text FROM members WHERE phone=%s',(a['phone'],))",
    '   identity=cur.fetchone()', '   assert identity is not None',
    "   if 'id' in a: assert identity==(a['id'],a['family_id'])",
    '   member_id,family_id=identity', "   if p['action']=='restore':",
    "    prefs=Jsonb(a['home_preferences']) if a['home_preferences'] is not None else None",
    "    cur.execute('UPDATE members SET home_preferences=%s,home_preferences_revision=%s WHERE id=%s AND phone=%s AND family_id=%s',(prefs,a['home_preferences_revision'],member_id,a['phone'],family_id))",
    '    assert cur.rowcount==1',
    "   cur.execute('SELECT home_preferences,home_preferences_revision FROM members WHERE id=%s',(member_id,))",
    '   prefs,revision=cur.fetchone()',
    "   result.append({'id':member_id,'family_id':family_id,'phone':a['phone'],'home_preferences':prefs,'home_preferences_revision':revision})",
    '  print(json.dumps(result,ensure_ascii=False))',
  ].join('\n');
  return new Promise((done, reject) => {
    const child = spawn('python.exe', ['-X', 'utf8', '-c', source], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject); child.stdin.on('error', reject);
    child.on('close', code => {
      if (code !== 0) reject(new Error('Local preference fixture failed: ' + error));
      else { try { done(JSON.parse(output)); } catch (cause) { reject(cause); } }
    });
    child.stdin.end(JSON.stringify({ action, accounts, password: config.AppPassword }));
  });
}

/** Backup before any UI navigation; restore only after every test context closed. */
export async function backupHomePreferences(name) {
  assert.match(name, /^[a-z][a-z0-9-]{0,40}$/, 'Use a short fixture name');
  const backupPath = resolve('.local-test/' + name + '-home-preferences-backup.json');
  await writeFile(lockPath, JSON.stringify({ backupPath }), { flag: 'wx' }).catch(error => {
    if (error.code === 'EEXIST') throw new Error('Another Home preference fixture or a previous unfinished backup remains. Restore it before running another test.');
    throw error;
  });
  let rows, priorBackup = false;
  try {
    rows = await fixture('read');
    await writeFile(backupPath, JSON.stringify(rows, null, 2), { flag: 'wx' }).catch(error => {
      priorBackup = error.code === 'EEXIST'; throw error;
    });
  } catch (error) {
    if (!priorBackup) await unlink(lockPath).catch(() => {});
    throw error;
  }
  const original = structuredClone(rows);
  let restored = false;
  return {
    rows,
    backupPath,
    async restore() {
      if (restored) return;
      assert.deepEqual(await fixture('restore', original), original);
      await unlink(backupPath); await unlink(lockPath); restored = true;
    },
  };
}
