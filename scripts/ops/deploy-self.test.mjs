import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const script = resolve(import.meta.dirname, 'deploy-self.sh');
function command(tool, args, options = {}) {
  const result = spawnSync(tool, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(mode = 'good') {
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
    `import os,sys\nif len(sys.argv)>3 and sys.argv[3]=='fetch': sys.exit(0)\nos.execv('${realGit}', ['${realGit}']+sys.argv[1:])`,
  );
  fake(
    'gh',
    `import json,os,sys
p=sys.argv[-1]; sha=os.environ['SHA']; mode=os.environ['MODE']
if p.endswith('/pulls'): value=[[{'merged_at':'now','merge_commit_sha':sha,'base':{'ref':'main','repo':{'full_name':'xiechimon/cairn'}},'head':{'sha':'f'*40}}]]
else:
 names=['pr-evidence'] if '/'+('f'*40)+'/' in p else ['check','pack-smoke','e2e-gate']
 value=[{'check_runs':[{'id':i,'name':n,'head_sha':('f'*40 if n=='pr-evidence' else sha),'app':{'slug':'github-actions'},'status':'completed','conclusion':('failure' if mode=='red' and n=='check' else 'success')} for i,n in enumerate(names) if not((mode=='evidence' and n=='pr-evidence') or (mode=='missing-check' and n=='check'))]}]
if mode=='pending-check': value[0]['check_runs'][0]['status']='in_progress'
if mode=='wrong-sha': value[0]['check_runs'][0]['head_sha']='0'*40
if mode=='superseded': value[0]['check_runs'].append(dict(value[0]['check_runs'][0], id=999, conclusion='failure'))
print(json.dumps(value))`,
  );
  fake(
    'pnpm',
    `import os,sys
sys.exit(1 if os.environ['MODE']=='install' else 0)`,
  );
  fake(
    'node',
    `import os,sys,time,sqlite3
from pathlib import Path
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
    `import os,sys,json
if os.environ['MODE']=='health' and '18787' not in ' '.join(sys.argv): sys.exit(22)
print(json.dumps([{'id':'a'}] if sys.argv[-1].endswith('/api/teams') else {'id':'user'}))`,
  );
  fake(
    'systemctl',
    `import os,sys,sqlite3
if 'show' in sys.argv:
 print('/wrong' if os.environ['MODE']=='unit-path' else os.environ['CAIRN_DEPLOY_ROOT']+'/current/apps/'+('server' if 'cairn-server.service' in sys.argv else 'daemon')); sys.exit(0)
if 'stop' in sys.argv and os.environ['MODE']=='restore-late':
 db=sqlite3.connect(os.environ['DB']); db.execute("insert into todo values('late-write')"); db.commit()
with open(os.environ['EVENTS'],'a') as f: f.write(' '.join(sys.argv[1:])+'\\n')
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
  };
  return {
    root,
    repo,
    state,
    old,
    sha,
    db,
    events,
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
    assert.equal(readFileSync(f.events, 'utf8'), '');
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
    /restart cairn-server.service\n--user restart cairn-daemon.service/,
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
  assert.equal(readFileSync(f.events, 'utf8'), '');
});
test('confirmed restore includes writes made while stopping units in its discard report', () => {
  const f = fixture('restore-late');
  const snapshot = join(f.root, 'snapshot.db');
  copyFileSync(f.db, snapshot);
  const result = f.run('restore', snapshot, '--confirm-discard');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /late-write/);
  assert.doesNotMatch(f.sql('select id from todo'), /late-write/);
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
  command('python3', ['-c', program, resolve(import.meta.dirname, 'deploy-self.py'), f.db]);
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
  command('python3', ['-c', program, resolve(import.meta.dirname, 'deploy-self.py'), f.db]);
});
test('restoring a drained snapshot removes its saved deployment barrier before restart', () => {
  const f = fixture();
  const snapshot = join(f.root, 'snapshot.db');
  copyFileSync(f.db, snapshot);
  command('python3', [
    '-c',
    "import runpy,sqlite3,sys; m=runpy.run_path(sys.argv[1]); db=sqlite3.connect(sys.argv[2]); m['drain'](db)",
    resolve(import.meta.dirname, 'deploy-self.py'),
    snapshot,
  ]);
  const result = f.run('restore', snapshot, '--confirm-discard');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.sql("select count(*) from sqlite_master where name like 'deploy_%'"), '0');
  assert.equal(f.sql('select autonomyPaused from team order by id'), '0\n1');
});
