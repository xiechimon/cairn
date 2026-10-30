import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const sourceSnapshot = makeTestTempDir('deploy-source-');
const script = join(sourceSnapshot, 'deploy-self.sh');
const pythonScript = join(sourceSnapshot, 'deploy-self.py');
copyFileSync(
  process.env.CAIRN_TEST_DEPLOY_SCRIPT || resolve(import.meta.dirname, 'deploy-self.sh'),
  script,
);
copyFileSync(
  process.env.CAIRN_TEST_DEPLOY_PYTHON || resolve(import.meta.dirname, 'deploy-self.py'),
  pythonScript,
);
copyFileSync(
  resolve(import.meta.dirname, 'backup-server-db.sh'),
  join(sourceSnapshot, 'backup-server-db.sh'),
);
function command(tool, args, options = {}) {
  const result = spawnSync(tool, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(mode = 'good', overrides = {}) {
  const root = realpathSync(makeTestTempDir('deploy-self-'));
  const repo = join(root, 'repo');
  const state = join(root, 'deploy');
  const bin = join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(state);
  mkdirSync(bin);
  const git = (...args) => command('git', ['-C', repo, ...args]);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(repo, 'version'), 'old');
  mkdirSync(join(repo, 'apps/server'), { recursive: true });
  writeFileSync(join(repo, 'apps/server/placeholder'), 'fixture');
  git('add', 'version', 'apps/server/placeholder');
  git('commit', '-m', 'old');
  const old = git('rev-parse', 'HEAD');
  git('worktree', 'add', '--detach', join(state, 'releases', old), old);
  writeFileSync(join(repo, 'version'), 'new');
  git('add', 'version');
  git('commit', '-m', 'new');
  const sha = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', mode === 'off-main' ? old : sha);
  command('ln', ['-s', join(state, 'releases', old), join(state, 'current')]);
  writeFileSync(join(state, 'last-good'), `${old}\n`);
  const db = join(root, 'server.db');
  command('sqlite3', [
    db,
    "create table team(id text, autonomyPaused integer); insert into team values('a',0),('b',1); create table step(id text,status text); create table machine(id text,lastSeenAt integer); insert into machine values('daemon',1); create table todo(id text); insert into todo values('before');",
  ]);
  if (mode === 'drain') command('sqlite3', [db, "insert into step values('busy','claimed');"]);
  const realGit = command('sh', ['-c', 'command -v git']);
  const fake = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env python3\n${body}\n`);
    chmodSync(path, 0o755);
  };
  fake(
    'git',
    `import os,sys
if len(sys.argv)>3 and sys.argv[3]=='fetch':
 with open(os.environ['EVENTS'],'a') as f: f.write('fetch\\n')
 sys.exit(0)
if os.environ.get('REQUIRE_FETCH') and 'worktree' in sys.argv and 'fetch' not in open(os.environ['EVENTS']).read(): sys.exit(1)
os.execv('${realGit}', ['${realGit}']+sys.argv[1:])`,
  );
  fake(
    'gh',
    `import json,os,sys
p=sys.argv[-1]; sha=os.environ['SHA']; mode=os.environ['MODE']
if '/compare/' in p: value={'status':('diverged' if mode=='off-main' else 'ahead')}
elif p.endswith('/pulls'): value=[[{'merged_at':'now','merge_commit_sha':sha,'base':{'ref':'main','repo':{'full_name':'xiechimon/cairn'}},'head':{'sha':'f'*40}}]]
else:
 names=['pr-evidence'] if '/'+('f'*40)+'/' in p else ['check','pack-smoke','e2e-gate']
 value=[{'check_runs':[{'id':i,'name':n,'head_sha':('f'*40 if n=='pr-evidence' else sha),'app':{'slug':'github-actions'},'status':'completed','conclusion':('failure' if mode=='red' and n=='check' else 'success')} for i,n in enumerate(names) if not((mode=='evidence' and n=='pr-evidence') or (mode=='missing-check' and n=='check'))]}]
if 'check-runs?' in p and mode=='pending-check': value[0]['check_runs'][0]['status']='in_progress'
if 'check-runs?' in p and mode=='wrong-sha': value[0]['check_runs'][0]['head_sha']='0'*40
if 'check-runs?' in p and mode=='superseded': value[0]['check_runs'].append(dict(value[0]['check_runs'][0], id=999, conclusion='failure'))
print(json.dumps(value))`,
  );
  fake(
    'pnpm',
    `import os,sys
with open(os.environ['EVENTS'],'a') as f: f.write('pnpm '+' '.join(sys.argv[1:])+'\\n')
sys.exit(1 if os.environ['MODE']=='install' else 0)`,
  );
  fake(
    'node',
    `import os,sys,time,sqlite3
from pathlib import Path
if '-e' in sys.argv:
 with open(os.environ['EVENTS'],'a') as f: f.write('native '+str(Path.cwd())+' '+sys.argv[-1]+'\\n')
 sys.exit(1 if os.environ['MODE']=='native' else 0)
with open(os.environ['EVENTS'],'a') as f: f.write('scratch PORT='+os.environ['PORT']+'\\n')
version=(Path.cwd().parents[1]/'version').read_text()
mode=os.environ['MODE']
db=sqlite3.connect(Path(os.environ['CAIRN_HOME'])/'server/server.db')
if mode=='migration' and version=='new': sys.exit(1)
if version=='new': db.execute('create table if not exists migrated(id text)'); db.commit()
if version=='old' and mode=='incompatible' and db.execute("select count(*) from sqlite_master where name='migrated'").fetchone()[0]: sys.exit(1)
while True: time.sleep(1)`,
  );
  fake(
    'curl',
    `import os,sys,json,sqlite3
if ':18787/' not in sys.argv[-1] and ':28888/' not in sys.argv[-1] and os.environ['MODE'] not in ('heartbeat','old-heartbeat'):
 db=sqlite3.connect(os.environ['DB']); db.execute('update machine set lastSeenAt=lastSeenAt+1'); db.commit()
with open(os.environ['EVENTS'],'a') as f: f.write('curl '+sys.argv[-1]+'\\n')
if os.environ['MODE']=='health' and (':'+os.environ.get('CAIRN_DEPLOY_SCRATCH_PORT','18787')+'/') not in sys.argv[-1]: sys.exit(22)
print(json.dumps([{'id':'a'}] if sys.argv[-1].endswith('/api/teams') else {'id':'user'}))`,
  );
  fake(
    'systemctl',
    `import os,sys,sqlite3
if 'show' in sys.argv and 'Environment' in sys.argv:
 print('Environment=CAIRN_HOME='+os.path.dirname(os.environ['DB'])); sys.exit(0)
if 'show' in sys.argv:
 print('/wrong' if os.environ['MODE']=='unit-path' else os.environ['CAIRN_DEPLOY_ROOT']+'/current/apps/'+('server' if os.environ.get('CAIRN_DEPLOY_UNITS','cairn-server.service cairn-daemon.service').split()[0] in sys.argv else 'daemon')); sys.exit(0)
if 'stop' in sys.argv and os.environ['MODE']=='restore-late':
 db=sqlite3.connect(os.environ['DB']); db.execute("insert into todo values(?)",('late-write-'+str(db.execute("select count(*) from todo").fetchone()[0]),)); db.commit()
with open(os.environ['EVENTS'],'a') as f: f.write(' '.join(sys.argv[1:])+'\\n')
if 'restart' in sys.argv and os.environ['MODE']=='rebuild' and 'server' in sys.argv[-1]:
 db=sqlite3.connect(os.environ['DB']); db.executescript('create table new_step as select * from step; drop table step; alter table new_step rename to step;'); db.close()
if 'restart' in sys.argv and os.environ['MODE']=='rebuild' and 'daemon' in sys.argv[-1]:
 db=sqlite3.connect(os.environ['DB']); db.execute("insert into step values('migration-claim','claimed')"); db.commit(); assert not db.execute("select 1 from step where id='migration-claim'").fetchone(); db.close()
if 'restart' in sys.argv:
 db=sqlite3.connect(os.environ['DB']); db.execute("insert into todo values('after')"); db.execute("update machine set lastSeenAt=lastSeenAt+1" if os.environ['MODE']!='heartbeat' else 'select 1'); db.commit()`,
  );
  if (mode === 'backup') writeFileSync(join(state, 'backups'), 'fixture');
  const events = join(root, 'events');
  writeFileSync(events, '');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MODE: mode,
    SHA: sha,
    DB: db,
    EVENTS: events,
    CAIRN_DEPLOY_REPO: repo,
    CAIRN_DEPLOY_ROOT: state,
    CAIRN_DEPLOY_DB: db,
    CAIRN_DEPLOY_MACHINE: 'daemon',
    CAIRN_DEPLOY_TOKEN: 'fixture-token',
    CAIRN_DEPLOY_TIMEOUT: '1',
    ...overrides,
  };
  return {
    root,
    repo,
    state,
    old,
    sha,
    db,
    events,
    env,
    run: (...args) =>
      spawnSync('bash', [script, ...(args.length ? args : [sha])], { env, encoding: 'utf8' }),
    sql: (sql) => command('sqlite3', [db, sql]),
  };
}
for (const [mode, message] of [
  ['red', 'check'],
  ['evidence', 'pr-evidence'],
  ['off-main', 'main'],
  ['install', 'install'],
  ['migration', 'scratch'],
  ['incompatible', 'scratch'],
  ['drain', 'drain'],
  ['missing-check', 'check'],
  ['pending-check', 'check'],
  ['wrong-sha', 'check'],
  ['superseded', 'check'],
  ['backup', 'backup'],
  ['unit-path', 'WorkingDirectory'],
]) {
  test(`${mode} refuses before restarting units`, () => {
    const f = fixture(mode);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(message));
    assert.doesNotMatch(readFileSync(f.events, 'utf8'), /restart|stop/);
    assert.equal(realpathSync(join(f.state, 'current')), join(f.state, 'releases', f.old));
    assert.equal(f.sql('select autonomyPaused from team order by id'), '0\n1');
  });
}
test('good deploy points current and last-good to the exact new SHA', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(realpathSync(join(f.state, 'current')), join(f.state, 'releases', f.sha));
  assert.equal(readFileSync(join(f.state, 'last-good'), 'utf8').trim(), f.sha);
  assert.equal(f.sql('select autonomyPaused from team order by id'), '0\n1');
  assert.match(
    readFileSync(f.events, 'utf8'),
    /stop cairn-daemon.service[\s\S]*restart cairn-server.service[\s\S]*restart cairn-daemon.service/,
  );
});
test('failed health rolls code back and keeps rows written after the backup', () => {
  const f = fixture('health');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(realpathSync(join(f.state, 'current')), join(f.state, 'releases', f.old));
  assert.match(f.sql('select id from todo'), /after/);
  const log = readFileSync(join(f.state, 'deploy.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.ok(log.some((entry) => entry.action === 'rollback'));
});
test('restore previews discarded rows and refuses without explicit confirmation', () => {
  const f = fixture();
  const snapshot = join(f.root, 'snapshot.db');
  copyFileSync(f.db, snapshot);
  f.sql("insert into todo values('discard-me')");
  const result = f.run('restore', snapshot);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /discard-me/);
  assert.match(f.sql('select id from todo'), /discard-me/);
  assert.match(
    readFileSync(f.events, 'utf8'),
    /stop cairn-daemon.service[\s\S]*stop cairn-server.service[\s\S]*stop cairn-db-backup.timer/,
  );
  assert.doesNotMatch(readFileSync(f.events, 'utf8'), /start /);
});
test('confirmed restore includes writes made while stopping units in its discard report', () => {
  const f = fixture('restore-late');
  const snapshot = join(f.root, 'snapshot.db');
  copyFileSync(f.db, snapshot);
  const preview = f.run('restore', snapshot);
  const digest = preview.stdout.match(/DISCARD_DIGEST ([a-f0-9]{64})/)[1];
  const result = f.run('restore', snapshot, '--confirm-discard', digest);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /discard set changed/);
  assert.match(f.sql('select id from todo'), /late-write/);
  assert.match(readFileSync(f.events, 'utf8'), /start cairn-db-backup.timer/);
});
test('a stale daemon heartbeat causes code rollback', () => {
  const f = fixture('heartbeat');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /health/);
  assert.equal(realpathSync(join(f.state, 'current')), join(f.state, 'releases', f.old));
});

test('drain blocks both claim insertion and transition, then restores prior pause values', () => {
  const f = fixture();
  const program = `import runpy,sqlite3,sys,os
m=runpy.run_path(sys.argv[1]); db=sqlite3.connect(sys.argv[2])
db.execute("insert into step values('pending','pending')"); db.commit()
m['drain'](db)
if os.environ.get('CAIRN_NEGATIVE_CONTROL'):
 db.execute('drop trigger deploy_claim_barrier'); db.execute('drop trigger deploy_claim_insert_barrier')
db.execute("update step set status='claimed' where id='pending'")
db.execute("insert into step values('new','claimed')"); db.commit()
assert db.execute("select count(*) from step where status='claimed'").fetchone()[0]==0
m['resume'](db)
assert db.execute('select autonomyPaused from team order by id').fetchall()==[(0,),(1,)]
db.execute("update step set status='claimed' where id='pending'"); db.commit()
assert db.execute("select count(*) from step where status='claimed'").fetchone()[0]==1`;
  command('python3', ['-c', program, pythonScript, f.db]);
});
test('a drain setup error leaves neither a partial pause record nor changed pause values', () => {
  const f = fixture();
  const program = `import runpy,sqlite3,sys
m=runpy.run_path(sys.argv[1]); db=sqlite3.connect(sys.argv[2])
db.execute("create trigger deploy_claim_barrier before update on step begin select raise(ignore); end")
try: m['drain'](db)
except sqlite3.Error: pass
else: raise AssertionError('drain unexpectedly succeeded')
assert db.execute("select count(*) from sqlite_master where name='deploy_pause_state'").fetchone()[0]==0
assert db.execute('select autonomyPaused from team order by id').fetchall()==[(0,),(1,)]`;
  command('python3', ['-c', program, pythonScript, f.db]);
});
test('restoring a drained snapshot removes its saved deployment barrier before restart', () => {
  const f = fixture();
  const snapshot = join(f.root, 'snapshot.db');
  copyFileSync(f.db, snapshot);
  command('python3', [
    '-c',
    "import runpy,sqlite3,sys; m=runpy.run_path(sys.argv[1]); db=sqlite3.connect(sys.argv[2]); m['drain'](db)",
    pythonScript,
    snapshot,
  ]);
  const preview = f.run('restore', snapshot);
  const digest = preview.stdout.match(/DISCARD_DIGEST ([a-f0-9]{64})/)[1];
  const result = f.run('restore', snapshot, '--confirm-discard', digest);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.sql("select count(*) from sqlite_master where name like 'deploy_%'"), '0');
  assert.equal(f.sql('select autonomyPaused from team order by id'), '0\n1');
});

test('install honors allowBuilds and probes native SQLite before scratch startup', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const events = readFileSync(f.events, 'utf8');
  assert.match(events, /pnpm install --frozen-lockfile\n/);
  assert.doesNotMatch(events, /--ignore-scripts/);
  assert.match(events, /native .*apps\/server .*require\('better-sqlite3'\).*:memory:/);
});
test('native probe failure refuses before scratch, drain or restart', () => {
  const f = fixture('native');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(readFileSync(f.events, 'utf8'), /restart/);
  assert.equal(f.sql('select autonomyPaused from team order by id'), '0\n1');
  assert.equal(existsSync(join(f.state, 'new-scratch.log')), false);
});
test('check needs no bootstrap and leaves no deployment files or database', () => {
  const f = fixture();
  rmSync(f.state, { recursive: true });
  rmSync(f.db);
  f.env.CAIRN_DEPLOY_TOKEN = '';
  f.env.CAIRN_DEPLOY_MACHINE = '';
  const result = f.run('check', f.sha);
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['main', 'check', 'pack-smoke', 'e2e-gate', 'pr-evidence'])
    assert.match(result.stdout, new RegExp('PASS ' + name + ' '));
  assert.equal(existsSync(f.state), false);
  assert.equal(existsSync(f.db), false);
  assert.equal(readFileSync(f.events, 'utf8'), '');
});
for (const mode of [
  'red',
  'evidence',
  'off-main',
  'missing-check',
  'pending-check',
  'wrong-sha',
  'superseded',
]) {
  test('check refuses ' + mode + ' without writes', () => {
    const f = fixture(mode);
    const before = readFileSync(f.db);
    const result = f.run('check', f.sha);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(
        mode === 'off-main'
          ? 'not on origin/main'
          : mode === 'evidence'
            ? 'pr-evidence is not success'
            : 'check is not success',
      ),
    );
    assert.deepEqual(readFileSync(f.db), before);
    assert.equal(existsSync(join(f.state, 'lock')), false);
    assert.equal(readFileSync(f.events, 'utf8'), '');
  });
}
for (const action of ['deploy', 'check', 'restore']) {
  test(action + ' refuses leftover drain state and names explicit recovery', () => {
    const f = fixture();
    command('python3', [
      '-c',
      "import runpy,sqlite3,sys; runpy.run_path(sys.argv[1])['drain'](sqlite3.connect(sys.argv[2]))",
      pythonScript,
      f.db,
    ]);
    const before = readFileSync(f.db);
    const result = action === 'deploy' ? f.run() : f.run(action, action === 'check' ? f.sha : f.db);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deploy-self.sh resume/);
    assert.deepEqual(readFileSync(f.db), before);
    assert.equal(readFileSync(f.events, 'utf8'), '');
    const resumed = f.run('resume');
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /"id": "a", "autonomyPaused": 0/);
    assert.match(resumed.stdout, /claim barriers removed/);
    assert.equal(f.sql('select autonomyPaused from team order by id'), '0\n1');
  });
}
test('custom instance uses only its units, URL, scratch port and backup directory', () => {
  const f = fixture();
  Object.assign(f.env, {
    CAIRN_DEPLOY_UNITS: 'scratch-server.service scratch-daemon.service',
    CAIRN_DEPLOY_BACKUP_TIMER: 'scratch-backup.timer',
    CAIRN_DEPLOY_URL: 'http://127.0.0.1:28887',
    CAIRN_DEPLOY_SCRATCH_PORT: '28888',
    CAIRN_DEPLOY_BACKUP_OUT: join(f.root, 'private-backups'),
  });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const events = readFileSync(f.events, 'utf8');
  assert.match(events, /restart scratch-server.service/);
  assert.match(events, /restart scratch-daemon.service/);
  assert.doesNotMatch(events, /cairn-server.service|cairn-daemon.service|18787|127.0.0.1:8787/);
  assert.match(events, /PORT=28888/);
  assert.match(events, /127.0.0.1:28887/);
  assert.ok(existsSync(join(f.root, 'private-backups')));
  const snapshot = join(f.root, 'snapshot.db');
  copyFileSync(f.db, snapshot);
  const digest = f.run('restore', snapshot).stdout.match(/DISCARD_DIGEST ([a-f0-9]{64})/)[1];
  assert.equal(f.run('restore', snapshot, '--confirm-discard', digest).status, 0);
  const restored = readFileSync(f.events, 'utf8');
  assert.match(restored, /stop scratch-backup.timer/);
  assert.match(restored, /start scratch-backup.timer/);
  assert.doesNotMatch(restored, /cairn-db-backup.timer/);
});
for (const units of ['', 'one.service', 'one.service two.service three.service']) {
  test('invalid unit inventory refuses ' + JSON.stringify(units), () => {
    const f = fixture('good', { CAIRN_DEPLOY_UNITS: units });
    assert.notEqual(f.run().status, 0);
    assert.equal(readFileSync(f.events, 'utf8'), '');
  });
}
test('custom instance health failure rolls back only its units', () => {
  const f = fixture('health', {
    CAIRN_DEPLOY_UNITS: 'scratch-server.service scratch-daemon.service',
    CAIRN_DEPLOY_BACKUP_TIMER: 'scratch-backup.timer',
    CAIRN_DEPLOY_URL: 'http://127.0.0.1:28887',
    CAIRN_DEPLOY_SCRATCH_PORT: '28888',
  });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(realpathSync(join(f.state, 'current')), join(f.state, 'releases', f.old));
  assert.match(readFileSync(f.events, 'utf8'), /restart scratch-server.service/);
  assert.doesNotMatch(readFileSync(f.events, 'utf8'), /cairn-server.service|cairn-daemon.service/);
});

test('deploy fetches the gated release before creating its checkout', () => {
  const f = fixture('good', { REQUIRE_FETCH: '1' });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
});
test('check refuses an uncheckpointed drain without changing WAL sidecars', () => {
  const f = fixture();
  command(
    'python3',
    [
      '-c',
      `import os,runpy,sqlite3,subprocess,sys
from pathlib import Path
db=Path(sys.argv[2]); connection=sqlite3.connect(db)
connection.execute('pragma journal_mode=wal')
runpy.run_path(sys.argv[1])['drain'](connection)
paths=[db,Path(str(db)+'-wal'),Path(str(db)+'-shm')]
before=[path.read_bytes() for path in paths]
result=subprocess.run(['bash',sys.argv[3],'check',os.environ['SHA']],capture_output=True,text=True)
assert result.returncode != 0 and 'deploy-self.sh resume' in result.stderr, result.stderr
assert [path.read_bytes() for path in paths] == before, 'read-only check changed WAL sidecars'
connection.close()`,
      pythonScript,
      f.db,
      script,
    ],
    { env: f.env },
  );
});

for (const mode of ['rebuild', 'old-heartbeat']) {
  test(mode + ' migration and heartbeat regression', () => {
    const f = fixture(mode);
    const result = f.run();
    assert.equal(result.status, mode === 'rebuild' ? 0 : 1, result.stderr);
    assert.equal(f.sql('select autonomyPaused from team order by id'), '0\n1');
    assert.equal(f.sql("select count(*) from sqlite_master where name like 'deploy_%'"), '0');
  });
}
function pythonFixture(program) {
  const f = fixture();
  command(
    'python3',
    [
      '-c',
      `import runpy,sqlite3,sys,time,contextlib,io
m=runpy.run_path(sys.argv[1]); db=sqlite3.connect(sys.argv[2])
assert str(m['DB'])==sys.argv[2]
${program}`,
      pythonScript,
      f.db,
    ],
    { env: f.env },
  );
}
test('expired drain permits claims after an unclean exit and refusal names its deadline', () => {
  pythonFixture(`m['drain'](db)
assert db.execute('select deadline from deploy_pause_state').fetchone()[0] > time.time()
db.execute('update deploy_pause_state set deadline=0'); db.commit()
db.execute("insert into step values('expired','claimed')"); db.commit()
assert db.execute("select count(*) from step where status='claimed'").fetchone()[0]==1
try: m['refuse_paused']()
except RuntimeError as error: assert 'deadline' in str(error)
else: raise AssertionError('leftover drain accepted')`);
});
test('resume preserves changed pause values and survives missing migration triggers', () => {
  pythonFixture(`m['drain'](db)
db.execute('drop trigger deploy_claim_barrier'); db.execute('drop trigger deploy_claim_insert_barrier')
db.execute("update team set autonomyPaused=0 where id='b'"); db.commit()
output=io.StringIO()
with contextlib.redirect_stdout(output): m['resume'](db)
assert db.execute('select autonomyPaused from team order by id').fetchall()==[(0,),(0,)]
assert 'left unchanged' in output.getvalue()`);
});
test('in-flight step completes while new claims remain blocked', () => {
  pythonFixture(`db.execute("insert into step values('flight','claimed')"); db.commit()
m['drain'](db)
if __import__('os').environ.get('CAIRN_INFLIGHT_NEGATIVE_CONTROL'): db.execute("delete from step where id='flight'"); db.commit()
assert db.execute("select status from step where id='flight'").fetchone()[0]=='claimed'
db.execute("update step set status='done' where id='flight'")
db.execute("insert into step values('blocked','claimed')"); db.commit()
assert db.execute('select id,status from step').fetchall()==[('flight','done')]
m['resume'](db)`);
});
test('confirmed restore failure restarts every configured service and timer', () => {
  pythonFixture(`from pathlib import Path
snapshot=Path(sys.argv[2]+'.snapshot'); destination=sqlite3.connect(snapshot); db.backup(destination); destination.close()
events=[]
def fake_run(args, **kwargs):
 events.append(args)
 if args==['systemctl','--user','start',m['UNITS'][0]]: raise RuntimeError('injected start failure')
 return ''
class BrokenBackup:
 def __getattr__(self,key): return getattr(db,key)
 def backup(self,destination): raise RuntimeError('injected backup failure')
original=m['restore'].__globals__
original['run']=fake_run
original['sqlite3']=type('Sqlite',(),{'connect':staticmethod(lambda path,**kwargs: BrokenBackup() if str(path).endswith('restore.db') else sqlite3.connect(path,**kwargs)), 'Error':sqlite3.Error})
db.execute('attach database ? as snapshot',(str(snapshot),))
digest=m['discard_report'](db) if 'discard_report' in m else '0'*64
try: m['restore'](snapshot, digest)
except RuntimeError: pass
else: raise AssertionError('restore succeeded')
for unit in [*m['UNITS'],m['BACKUP_TIMER']]: assert ['systemctl','--user','start',unit] in events,events`);
});
test('interrupt immediately after drain still restores pause state', () => {
  const f = fixture();
  command(
    'python3',
    [
      '-c',
      `import runpy,sqlite3,sys
m=runpy.run_path(sys.argv[1]); original=m['drain']
def interrupted(db):
 original(db)
 raise KeyboardInterrupt('injected SIGTERM')
m['deploy'].__globals__['drain']=interrupted
try: m['deploy'](sys.argv[3])
except KeyboardInterrupt: pass
else: raise AssertionError('deploy succeeded')
db=sqlite3.connect(sys.argv[2])
assert db.execute('select autonomyPaused from team order by id').fetchall()==[(0,),(1,)]
assert not db.execute("select 1 from sqlite_master where name='deploy_pause_state'").fetchone()`,
      pythonScript,
      f.db,
      f.sha,
    ],
    { env: f.env },
  );
});

test('trigger cleanup failure cannot roll back committed pause restoration', () => {
  pythonFixture(`m['drain'](db)
class CleanupFailure:
 def __enter__(self): db.__enter__(); return self
 def __exit__(self,*args): return db.__exit__(*args)
 def execute(self,sql,*args):
  if sql.startswith('drop trigger'): raise sqlite3.OperationalError('injected cleanup failure')
  return db.execute(sql,*args)
try: m['resume'](CleanupFailure())
except sqlite3.Error: pass
else: raise AssertionError('cleanup succeeded')
assert db.execute('select autonomyPaused from team order by id').fetchall()==[(0,),(1,)]`);
});

test('barriers are reinstalled after asynchronous server migration readiness', () => {
  pythonFixture(`m['drain'](db)
state={'migrated':False}
def fake_run(args,**kwargs):
 if args==['systemctl','--user','restart',m['UNITS'][1]]:
  assert state['migrated'],'daemon restarted before migration readiness'
  db.execute("insert into step values('blocked','claimed')"); db.commit()
  assert not db.execute("select 1 from step where id='blocked'").fetchone()
 return ''
def ready(url,path):
 if not state['migrated']:
  db.executescript('create table new_step as select * from step; drop table step; alter table new_step rename to step;')
  state['migrated']=True
 return [] if path.endswith('/teams') else {'id':'user'}
m['restart'].__globals__['run']=fake_run
m['restart'].__globals__['read_api']=ready
m['restart'](db)
m['resume'](db)`);
});

for (const action of ['restore', 'resume']) {
  for (const setting of ['CAIRN_DEPLOY_DB', 'CAIRN_DEPLOY_URL', 'CAIRN_DEPLOY_BACKUP_TIMER']) {
    test(action + ' refuses custom units with live default ' + setting, () => {
      const f = fixture('good', {
        CAIRN_DEPLOY_UNITS: 'drill-server.service drill-daemon.service',
        CAIRN_DEPLOY_URL: 'http://127.0.0.1:28887',
        CAIRN_DEPLOY_BACKUP_TIMER: 'drill-backup.timer',
      });
      delete f.env[setting];
      const result = f.run(action, ...(action === 'restore' ? [f.db] : []));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /live default/);
      assert.doesNotMatch(readFileSync(f.events, 'utf8'), /stop|start|restart/);
    });
  }
}
test('instance guard requires effective server home containment', () => {
  pythonFixture(`g=m['main'].__globals__
linked_home=m['DB'].parent/'linked-home'
linked_home.symlink_to(m['DB'].parent/'outside-home',target_is_directory=True)
for home in ['', str(m['DB'].parent)+'-sibling', str(m['DB'].parent/'other'),str(linked_home)]:
 g['run']=lambda args: 'Environment='+('CAIRN_HOME='+home if home else '')
 try: g['validate_instance']()
 except RuntimeError: pass
 else: raise AssertionError('unsafe home accepted: '+home)
g['run']=lambda args: 'Environment="CAIRN_HOME='+str(m['DB'].parent)+'"'
g['validate_instance']()
spaced=m['DB'].parent/'home with spaces'; spaced.mkdir()
g['DB']=spaced/'server.db'
g['run']=lambda args: 'Environment=OTHER=value "CAIRN_HOME='+str(spaced)+'"'
g['validate_instance']()`);
});
test('slow health barrier reinstallation renews the deadline', () => {
  pythonFixture(`m['drain'](db)
g=m['install_barriers'].__globals__
initial=db.execute('select max(deadline) from deploy_pause_state').fetchone()[0]
clock=time.time()+1200
g['time']=type('Clock',(),{'time':staticmethod(lambda: clock),'monotonic':staticmethod(time.monotonic),'sleep':staticmethod(time.sleep)})
def fake_run(args,**kwargs):
 if args==['systemctl','--user','restart',m['UNITS'][1]]:
  assert db.execute('select min(deadline) from deploy_pause_state').fetchone()[0]>clock
 return ''
def slow_health(url,path):
 return [] if path.endswith('/teams') else {'id':'user'}
g['run']=fake_run; g['read_api']=slow_health
m['restart'](db)
assert db.execute('select min(deadline) from deploy_pause_state').fetchone()[0]>clock
assert db.execute('select min(deadline) from deploy_pause_state').fetchone()[0]>initial
m['resume'](db)`);
});
test('SIGHUP after drain restores pause state through the real handler', () => {
  const f = fixture();
  command(
    'python3',
    [
      '-c',
      `import runpy,sqlite3,sys,os,signal
m=runpy.run_path(sys.argv[1]); g=m['main'].__globals__; original=g['drain']
def hangup(db):
 original(db)
 os.kill(os.getpid(),signal.SIGHUP)
g['drain']=hangup
sys.argv=[sys.argv[1],os.environ['SHA']]
try: m['main']()
except KeyboardInterrupt: pass
else: raise AssertionError('SIGHUP did not interrupt')
db=sqlite3.connect(os.environ['DB'])
assert db.execute('select autonomyPaused from team order by id').fetchall()==[(0,),(1,)]
assert not db.execute("select 1 from sqlite_master where name='deploy_pause_state'").fetchone()`,
      pythonScript,
    ],
    { env: f.env },
  );
});
test('restore preview stops heartbeat writers before computing a stable digest', () => {
  pythonFixture(`from pathlib import Path
snapshot=Path(str(m['DB'])+'.snapshot'); target=sqlite3.connect(snapshot); db.backup(target); target.close()
g=m['restore'].__globals__; events=[]; original=g['discard_report']
def fake_run(args,**kwargs):
 events.append(args)
 return ''
def report(live):
 for unit in [*reversed(m['UNITS']),m['BACKUP_TIMER']]: assert ['systemctl','--user','stop',unit] in events
 return original(live)
g['run']=fake_run; g['discard_report']=report
output=io.StringIO()
with contextlib.redirect_stdout(output):
 try: m['restore'](snapshot,None)
 except RuntimeError as error: assert 'confirm-discard' in str(error)
assert not any('start' in args for args in events)
digest=output.getvalue().split('DISCARD_DIGEST ')[1].split()[0]
m['restore'](snapshot,digest)
for unit in [*m['UNITS'],m['BACKUP_TIMER']]: assert ['systemctl','--user','start',unit] in events`);
});
