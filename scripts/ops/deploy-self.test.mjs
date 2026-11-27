import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';

const DEPLOY = join(import.meta.dirname, 'deploy-self.sh');
const WATCH = join(import.meta.dirname, 'deploy-watch.sh');
const INSTALL = join(import.meta.dirname, 'install-self-deploy.sh');
const SYSTEM_PATH = '/usr/bin:/bin';
const NODE_BIN = dirname(process.execPath);
const OWNER_TOKEN = 'fixture-owner-token';
const ZERO = '0'.repeat(40);

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

function commit(work, message, files = {}) {
  writeFileSync(join(work, 'package.json'), '{"type":"module","packageManager":"pnpm@12.5.1"}\n');
  writeFileSync(
    join(work, 'pnpm-workspace.yaml'),
    'packages:\n  - apps/*\n\nallowBuilds:\n  esbuild: true\n',
  );
  writeFileSync(join(work, 'marker.txt'), `${message}\n`);
  mkdirSync(join(work, 'apps/server/src/db'), { recursive: true });
  writeFileSync(
    join(work, 'apps/server/src/db/client.ts'),
    `import { execFileSync } from 'node:child_process';
export function openDbWithHandle(path) {
  execFileSync('sqlite3', [path, "insert into __drizzle_migrations(hash) values ('rehearsed')"]);
  return { close() {} };
}
`,
  );
  writeFileSync(
    join(work, 'apps/server/build.mjs'),
    `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
if (!existsSync('src/index.ts')) throw new Error('Could not resolve "src/index.ts"');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.mjs', 'artifact:' + readFileSync('../../marker.txt', 'utf8'));
writeFileSync('dist/index.mjs.map', '{}');
writeFileSync('dist/photon_rs_bg.wasm', 'wasm');
const config = { external: ['better-sqlite3'] };
void config;
`,
  );
  mkdirSync(join(work, 'apps/server/src'), { recursive: true });
  writeFileSync(join(work, 'apps/server/src/index.ts'), 'export const ok = true;\n');
  mkdirSync(join(work, 'apps/daemon/src'), { recursive: true });
  writeFileSync(join(work, 'apps/daemon/src/cli.ts'), `// ${message}\n`);
  mkdirSync(join(work, 'apps/server/drizzle/meta'), { recursive: true });
  mkdirSync(join(work, 'scripts/ops'), { recursive: true });
  writeFileSync(join(work, 'scripts/ops/deploy-watch.sh'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(join(work, 'apps/server/drizzle/meta/_journal.json'), '{"entries":[]}');
  for (const [rel, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(work, rel)), { recursive: true });
    writeFileSync(join(work, rel), contents);
  }
  git(work, 'add', '.');
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: work,
    env: {
      PATH: SYSTEM_PATH,
      HOME: work,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });
  return git(work, 'rev-parse', 'HEAD');
}

function writeRelease(releases, sha, label) {
  const release = join(releases, `${label}-${sha.slice(0, 12)}`);
  mkdirSync(join(release, 'dist'), { recursive: true });
  mkdirSync(join(release, 'web'), { recursive: true });
  mkdirSync(join(release, 'drizzle', 'meta'), { recursive: true });
  mkdirSync(join(release, 'node_modules', 'better-sqlite3'), { recursive: true });
  writeFileSync(join(release, 'dist', 'index.mjs'), `artifact:${sha}\n`);
  writeFileSync(join(release, 'dist', 'photon_rs_bg.wasm'), 'wasm');
  writeFileSync(join(release, 'web', 'index.html'), `<html>${sha}</html>`);
  writeFileSync(join(release, 'drizzle', 'meta', '_journal.json'), '{"entries":[]}');
  writeFileSync(join(release, 'node_modules', 'better-sqlite3', 'package.json'), '{}');
  writeFileSync(join(release, 'DEPLOYED_SHA'), `${sha}\n`);
  writeFileSync(join(release, 'tsnet-sidecar-fixture'), 'sidecar');
  return release;
}

async function fixture({
  manager = 'systemd',
  claimedCoordinator = 0,
  claimedRunner = 0,
  openComputerCalls = 0,
  runner = false,
  journalMode = 'WAL',
} = {}) {
  const dir = makeTestTempDir('artifact-deploy-');
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  const checkout = join(dir, 'build-checkout');
  const runnerCheckout = join(dir, 'runner-checkout');
  const data = join(dir, 'data');
  const state = join(dir, 'state');
  const backups = join(dir, 'backups');
  const releases = join(dir, 'releases');
  const fake = join(dir, 'fake');
  const bin = join(dir, 'bin');
  const root = join(dir, 'app-root');
  const tokenFile = join(dir, 'token');
  for (const path of [work, data, fake, bin, releases]) mkdirSync(path, { recursive: true });
  writeFileSync(tokenFile, `CAIRN_TOKEN=${OWNER_TOKEN}\n`, { mode: 0o600 });
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(work, 'init', '-q', '-b', 'main');
  const previous = commit(work, 'previous');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '-q', origin, checkout);
  git(checkout, 'checkout', '-q', '--detach', previous);
  if (runner) {
    git(dir, 'clone', '-q', origin, runnerCheckout);
    git(runnerCheckout, 'checkout', '-q', '--detach', previous);
  }

  const previousRelease = writeRelease(releases, previous, 'previous');
  symlinkSync(previousRelease, root, 'dir');

  const db = join(data, 'server.db');
  sqlite(
    db,
    `pragma journal_mode=${journalMode};
     create table step(id text primary key, kind text default 'build', status text, machineId text, note text);
     create table machine(id text primary key, name text, lastSeenAt integer, maxConcurrent integer default 1);
     create table deploy_lease(id text primary key, owner text not null, status text not null, expiresAt integer not null);
     create table computer_call(id text primary key, tool text not null, state text not null);
     create table __drizzle_migrations(id integer primary key, hash text);
     insert into machine values ('m1', 'fixture', 0, 1);
     insert into __drizzle_migrations(hash) values ('m0');`,
  );
  for (let i = 0; i < claimedCoordinator; i++)
    sqlite(db, `insert into step values ('c${i}', 'chief', 'claimed', null, null)`);
  for (let i = 0; i < claimedRunner; i++)
    sqlite(db, `insert into step values ('r${i}', 'build', 'claimed', 'm1', null)`);
  for (let i = 0; i < openComputerCalls; i++)
    sqlite(db, `insert into computer_call values ('cc${i}', 'click', 'running')`);

  fakeTool(
    bin,
    'npx',
    `echo "npx $* @ $(pwd)" >> "${fake}/npx.log"
if [[ "$*" == *install* ]]; then
  if [ -f "${fake}/fail-install-$(basename "$(pwd)")" ] || [ -f "${fake}/fail-install-$(git rev-parse HEAD 2>/dev/null || true)" ]; then
    echo "simulated install failure" >&2
    exit 1
  fi
  mkdir -p node_modules/tsx apps/server/node_modules/better-sqlite3/lib
  printf '{"type":"module","exports":"./index.mjs"}' > node_modules/tsx/package.json
  printf 'export {};\n' > node_modules/tsx/index.mjs
  printf '{"name":"better-sqlite3","version":"13.0.3"}' > apps/server/node_modules/better-sqlite3/package.json
  printf 'native fixture' > apps/server/node_modules/better-sqlite3/lib/native.fixture
fi
if [[ "$*" == *"@cairn/web"* && "$*" == *build* ]]; then
  mkdir -p apps/web/dist
  printf '<html>%s</html>' "$(cat marker.txt)" > apps/web/dist/index.html
fi
exit 0`,
  );

  writeFileSync(
    join(fake, 'lease-api.mjs'),
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const method = args.includes('-X') ? value('-X') : 'GET';
const sql = (query) => execFileSync('sqlite3', ['${db}', query], { encoding: 'utf8' }).trim();
const authorized = readFileSync(0, 'utf8').includes('header = "Authorization: Bearer ${OWNER_TOKEN}"');
appendFileSync('${fake}/lease-requests.log', method + ' ' + (authorized ? 'owner' : 'anonymous') + '\\n');
let status = 200;
let row = JSON.parse(sql("select json_object('owner',owner,'status',status,'expiresAt',expiresAt) from deploy_lease where id='server'") || '{"owner":null,"status":"accepting","expiresAt":0}');
if (!authorized) status = 401;
else if (method === 'DELETE' && row.owner === JSON.parse(value('--data-binary')).owner) {
  row = { ...row, status: 'accepting', expiresAt: 0 };
  sql("update deploy_lease set status='accepting',expiresAt=0 where id='server'");
} else if (method === 'PUT') {
  const body = JSON.parse(value('--data-binary'));
  row = { owner: body.owner, status: 'draining', expiresAt: Date.now() + body.ttlMs };
  sql("insert or replace into deploy_lease values ('server','" + row.owner + "','draining'," + row.expiresAt + ")");
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

  const serviceBody = `echo "$1 $2 $3 $4" >> "${fake}/service.log"
if [[ " $* " == *" is-active "* ]]; then
  if [[ " $* " == *" cairn-daemon"* ]]; then
    [ -f "${fake}/runner-up" ] && exit 0 || exit 3
  fi
  [ -f "${fake}/up" ] && exit 0 || exit 3
fi
if [[ " $* " == *" stop "* ]]; then
  if [[ " $* " == *" cairn-daemon"* ]]; then
    rm -f "${fake}/runner-up"
  else
    rm -f "${fake}/up"
    sqlite3 "${db}" "pragma wal_checkpoint(truncate);" >/dev/null 2>&1 || true
    rm -f "${db}-shm" "${db}-wal"
  fi
fi
if [[ " $* " == *" start "* ]]; then
  if [[ " $* " == *" cairn-daemon"* ]]; then
    rsha=$(git -C "${runnerCheckout}" rev-parse HEAD 2>/dev/null || true)
    if [ -n "$rsha" ] && [ ! -f "${fake}/runner-broken-$rsha" ]; then
      touch "${fake}/runner-up"
    else rm -f "${fake}/runner-up"; fi
  else
    sha=$(cat "${root}/DEPLOYED_SHA" 2>/dev/null || true)
    if [ -n "$sha" ] && [ ! -f "${fake}/broken-$sha" ]; then
      touch "${fake}/up"
    else rm -f "${fake}/up"; fi
    [ ! -f "${fake}/write-on-start-$sha" ] || sqlite3 "${db}" "insert into step values ('written-after', 'build', 'done', null, null)"
  fi
fi
exit 0`;
  fakeTool(bin, 'systemctl', serviceBody);
  if (manager === 'launchd') {
    writeFileSync(join(fake, 'launchd-loaded-server'), '');
    if (runner) {
      writeFileSync(join(fake, 'launchd-loaded-daemon'), '');
      writeFileSync(join(fake, 'runner-up'), '');
    }
  } else if (runner) {
    writeFileSync(join(fake, 'runner-up'), '');
  }
  fakeTool(
    bin,
    'launchctl',
    `echo "$1 $2 $3 $4" >> "${fake}/service.log"
kind="server"
if [[ "$*" == *"cairn-daemon"* ]]; then kind="daemon"; fi
case "$1" in
  print)
    if [ -f "${fake}/launchd-loaded-$kind" ]; then
      if [ "$kind" = "daemon" ] && [ ! -f "${fake}/runner-up" ]; then
        echo "state = not running"
      else
        echo "state = running"
      fi
      exit 0
    fi
    exit 113
    ;;
  bootout)
    rm -f "${fake}/launchd-loaded-$kind"
    if [ "$kind" = "daemon" ]; then
      rm -f "${fake}/runner-up"
    else
      rm -f "${fake}/up"
      sqlite3 "${db}" "pragma wal_checkpoint(truncate);" >/dev/null 2>&1 || true
      rm -f "${db}-shm" "${db}-wal"
    fi
    ;;
  bootstrap)
    touch "${fake}/launchd-loaded-$kind"
    if [ "$kind" = "daemon" ]; then
      rsha=$(git -C "${runnerCheckout}" rev-parse HEAD 2>/dev/null || true)
      if [ -n "$rsha" ] && [ ! -f "${fake}/runner-broken-$rsha" ]; then
        touch "${fake}/runner-up"
      else rm -f "${fake}/runner-up"; fi
    else
      sha=$(cat "${root}/DEPLOYED_SHA" 2>/dev/null || true)
      if [ -n "$sha" ] && [ ! -f "${fake}/broken-$sha" ]; then
        touch "${fake}/up"
      else rm -f "${fake}/up"; fi
      [ ! -f "${fake}/write-on-start-$sha" ] || sqlite3 "${db}" "insert into step values ('written-after', 'build', 'done', null, null)"
    fi
    ;;
  kickstart)
    if [ "$kind" = "daemon" ]; then
      rsha=$(git -C "${runnerCheckout}" rev-parse HEAD 2>/dev/null || true)
      if [ -n "$rsha" ] && [ ! -f "${fake}/runner-broken-$rsha" ]; then
        touch "${fake}/runner-up"
      else rm -f "${fake}/runner-up"; fi
    else
      sha=$(cat "${root}/DEPLOYED_SHA" 2>/dev/null || true)
      if [ -n "$sha" ] && [ ! -f "${fake}/broken-$sha" ]; then
        touch "${fake}/up"
      else rm -f "${fake}/up"; fi
    fi
    ;;
esac
exit 0`,
  );

  const evidenceRequests = [];
  const evidenceState = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    evidenceRequests.push(`${url.pathname}${url.search}`);
    const sha =
      url.searchParams.get('head_sha') ??
      url.pathname.match(/commits\/([0-9a-f]{40})\/check-runs/)?.[1];
    if (url.pathname.includes('/actions/workflows/ci.yml/runs')) {
      const override = evidenceState.get(`ci:${sha}`);
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          workflow_runs:
            override === undefined
              ? [
                  {
                    head_sha: sha,
                    head_branch: 'main',
                    event: 'push',
                    status: 'completed',
                    conclusion: 'success',
                  },
                ]
              : override,
        }),
      );
      return;
    }
    if (url.pathname.includes('/check-runs')) {
      const checks = evidenceState.get(`checks:${sha}`) ?? [
        { name: 'check', conclusion: 'success' },
        { name: 'pack-smoke', conclusion: 'success' },
        { name: 'e2e-gate', conclusion: 'success' },
      ];
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ check_runs: checks, total_count: checks.length }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}`;

  const env = {
    PATH: `${bin}:${NODE_BIN}:${SYSTEM_PATH}`,
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    CAIRN_DEPLOY_BUILD_CHECKOUT: checkout,
    CAIRN_DEPLOY_APP_ROOT: root,
    CAIRN_DEPLOY_RELEASES: releases,
    CAIRN_DATA_DIR: data,
    CAIRN_DEPLOY_STATE: state,
    CAIRN_DEPLOY_BACKUPS: backups,
    CAIRN_DEPLOY_SCRATCH: join(dir, 'scratch'),
    CAIRN_REPO: 'fixture/cairn',
    CAIRN_GITHUB_API_BASE: apiBase,
    CAIRN_HEALTH_URL: 'http://127.0.0.1:8787',
    CAIRN_HEALTH_TRIES: '3',
    CAIRN_HEALTH_INTERVAL: '0',
    CAIRN_DEPLOY_TOKEN_FILE: tokenFile,
    CAIRN_DEPLOY_MACHINE_NAME: 'fixture-host',
    CAIRN_DEPLOY_SERVICE_MANAGER: manager,
    CAIRN_DEPLOY_SYSTEMD_UNIT: 'cairn-server.service',
    CAIRN_DEPLOY_LAUNCHD_LABEL: 'com.fixture.cairn-server',
    CAIRN_DEPLOY_LAUNCHD_PLIST: join(dir, 'com.fixture.cairn-server.plist'),
    CAIRN_DEPLOY_COORDINATOR_WAIT_SECONDS: '0',
    CAIRN_RUNNER_HEALTH_TRIES: '2',
    CAIRN_RUNNER_HEALTH_INTERVAL: '0',
    ...(runner
      ? {
          CAIRN_DEPLOY_RUNNER_CHECKOUT: runnerCheckout,
          CAIRN_DEPLOY_RUNNER_SYSTEMD_UNIT: 'cairn-daemon.service',
          CAIRN_DEPLOY_RUNNER_LAUNCHD_LABEL: 'com.fixture.cairn-daemon',
          CAIRN_DEPLOY_RUNNER_LAUNCHD_PLIST: join(dir, 'com.fixture.cairn-daemon.plist'),
        }
      : {}),
  };
  writeFileSync(env.CAIRN_DEPLOY_LAUNCHD_PLIST, 'plist');
  if (runner) writeFileSync(env.CAIRN_DEPLOY_RUNNER_LAUNCHD_PLIST, 'daemon-plist');
  const run = (script, args = [], extra = {}) =>
    new Promise((resolve) => {
      const child = spawn('/bin/bash', [script, ...args], { env: { ...env, ...extra } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  const log = (name) =>
    existsSync(join(fake, name)) ? readFileSync(join(fake, name), 'utf8') : '';
  const close = () => {
    server.close();
    releaseTestTempDir(dir);
  };
  return {
    dir,
    work,
    checkout,
    runnerCheckout,
    data,
    db,
    state,
    backups,
    releases,
    fake,
    bin,
    root,
    previous,
    previousRelease,
    evidenceState,
    evidenceRequests,
    env,
    run,
    log,
    close,
  };
}

function pushTarget(f, message = 'target', files) {
  const sha = commit(f.work, message, files);
  git(f.work, 'push', '-q', 'origin', 'main');
  return sha;
}

function serviceLog(f) {
  return f.log('service.log');
}

test('refuses a malformed SHA and a SHA outside main before touching the service', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.run(DEPLOY, ['abc'])).status, 2);
    git(f.work, 'checkout', '-q', '-b', 'side');
    const side = commit(f.work, 'side');
    git(f.work, 'push', '-q', 'origin', 'side');
    const result = await f.run(DEPLOY, [side]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /not on origin\/main/);
    assert.equal(serviceLog(f), '');
    assert.equal(readlinkSync(f.root), f.previousRelease);
  } finally {
    f.close();
  }
});

test('admits only exact main push CI success with every required check green', async () => {
  for (const run of [
    null,
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { head_branch: 'feature' },
    { head_sha: ZERO },
  ]) {
    const f = await fixture();
    try {
      const target = pushTarget(f);
      const success = {
        head_sha: target,
        head_branch: 'main',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
      };
      f.evidenceState.set(`ci:${target}`, run === null ? [] : [{ ...success, ...run }]);
      const result = await f.run(DEPLOY, [target]);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /main push CI is not successful/);
      assert.equal(serviceLog(f), '');
    } finally {
      f.close();
    }
  }
  const f = await fixture();
  try {
    const target = pushTarget(f);
    f.evidenceState.set(`checks:${target}`, [
      { name: 'check', conclusion: 'success' },
      { name: 'pack-smoke', conclusion: 'failure' },
      { name: 'e2e-gate', conclusion: 'success' },
    ]);
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /required check pack-smoke is not green/);
    assert.equal(serviceLog(f), '');
  } finally {
    f.close();
  }
});

test('deploys a green target into an immutable release and records it', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'target');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const active = readlinkSync(f.root);
    assert.notEqual(active, f.previousRelease);
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), target);
    assert.match(readFileSync(join(f.root, 'dist', 'index.mjs'), 'utf8'), /artifact:target/);
    assert.ok(existsSync(join(f.root, 'web', 'index.html')));
    assert.ok(existsSync(join(f.root, 'drizzle', 'meta', '_journal.json')));
    assert.ok(existsSync(join(f.root, 'node_modules', 'better-sqlite3', 'lib', 'native.fixture')));
    assert.ok(existsSync(join(f.root, 'tsnet-sidecar-fixture')));
    assert.match(serviceLog(f), /stop/);
    assert.match(serviceLog(f), /start/);
    assert.match(f.log('lease-requests.log'), /PUT owner/);
    assert.match(f.log('lease-requests.log'), /DELETE owner/);
    const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
    assert.equal(record.sha, target);
    assert.equal(record.previous, f.previous);
    assert.equal(record.result, 'deployed');
    assert.ok(readdirSync(f.backups).some((name) => name.endsWith('.db')));
    assert.ok(f.evidenceRequests.some((line) => line.includes(`head_sha=${target}`)));
  } finally {
    f.close();
  }
});

test('the watcher deploys the newest green main commit and skips failed commits', async () => {
  const f = await fixture();
  try {
    const broken = pushTarget(f, 'broken');
    mkdirSync(join(f.state, 'failed'), { recursive: true });
    writeFileSync(join(f.state, 'failed', broken), 'health check failed');
    const target = pushTarget(f, 'newest');
    const result = await f.run(WATCH, []);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), target);
  } finally {
    f.close();
  }
});

test('a failed health check rolls back to the previous release and restores an untouched snapshot', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'broken target');
    writeFileSync(join(f.fake, `broken-${target}`), '');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(realpathSync(f.root), realpathSync(f.previousRelease));
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), f.previous);
    const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
    assert.equal(record.result, 'rolled-back');
    assert.equal(record.failed, target);
    assert.equal(sqlite(f.db, "select count(*) from step where id='written-after'"), '0');
    assert.ok(existsSync(join(f.state, 'failed', target)));
  } finally {
    f.close();
  }
});

test('a failed health check keeps a database that received writes after the snapshot', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'broken target');
    writeFileSync(join(f.fake, `broken-${target}`), '');
    writeFileSync(join(f.fake, `write-on-start-${target}`), '');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(realpathSync(f.root), realpathSync(f.previousRelease));
    const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
    assert.equal(record.result, 'rolled-back-code');
    assert.equal(sqlite(f.db, "select count(*) from step where id='written-after'"), '1');
  } finally {
    f.close();
  }
});

test('an active in-server Coordinator turn makes the attempt busy before any snapshot or restart', async () => {
  const f = await fixture({ claimedCoordinator: 1 });
  try {
    const target = pushTarget(f);
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 75, result.stderr + result.stdout);
    assert.match(result.stderr, /Coordinator|computer|busy|starved/);
    assert.equal(serviceLog(f), '');
    assert.equal(readdirSync(f.backups).length, 0);
    assert.equal(readlinkSync(f.root), f.previousRelease);
  } finally {
    f.close();
  }
});

test('open computer calls other than takeover requests block the restart', async () => {
  const f = await fixture({ openComputerCalls: 1 });
  try {
    const target = pushTarget(f);
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 75, result.stderr + result.stdout);
    assert.equal(serviceLog(f), '');
  } finally {
    f.close();
  }
});

test('the launchd adapter boots the configured plist instead of using systemd', async () => {
  const f = await fixture({ manager: 'launchd' });
  try {
    const target = pushTarget(f);
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(serviceLog(f), /bootout gui\/\d+\/com\.fixture\.cairn-server/);
    assert.match(serviceLog(f), /bootstrap gui\/\d+ .*com\.fixture\.cairn-server\.plist/);
  } finally {
    f.close();
  }
});

test('a legacy application directory is preserved and replaced by the release symlink', async () => {
  const f = await fixture();
  try {
    rmSync(f.root, { force: true });
    cpSync(f.previousRelease, f.root, { recursive: true });
    const target = pushTarget(f);
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), target);
    assert.ok(readlinkSync(f.root).includes(target.slice(0, 12)));
    assert.ok(existsSync(join(f.state, 'legacy-root', 'tsnet-sidecar-fixture')));
    assert.ok(
      readdirSync(f.releases).some(
        (name) => name.startsWith('legacy-') && existsSync(join(f.releases, name, 'DEPLOYED_SHA')),
      ),
    );
  } finally {
    f.close();
  }
});

test('recovery finishes an interrupted healthy target before any newer deployment', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f);
    const targetRelease = writeRelease(f.releases, target, 'target');
    rmSync(f.root, { force: true });
    symlinkSync(targetRelease, f.root, 'dir');
    mkdirSync(f.state, { recursive: true });
    mkdirSync(f.backups, { recursive: true });
    const snapshot = join(f.backups, 'predeploy-recovery.db');
    cpSync(f.db, snapshot);
    writeFileSync(
      join(f.state, 'in-progress'),
      [
        'phase=switched',
        `target=${target}`,
        `previous=${f.previous}`,
        `snapshot=${snapshot}`,
        `release=${targetRelease}`,
        `previous_release=${realpathSync(f.previousRelease)}`,
        '',
      ].join('\n'),
    );
    const result = await f.run(DEPLOY, ['--recover']);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
    assert.equal(record.sha, target);
    assert.equal(record.result, 'deployed');
    assert.match(serviceLog(f), /start/);
    assert.ok(!existsSync(join(f.state, 'in-progress')));
  } finally {
    f.close();
  }
});

test('the installer writes a two-minute launchd watcher and a systemd timer without host values in repo files', async () => {
  const f = await fixture();
  try {
    const envFile = join(f.dir, 'deploy.env');
    writeFileSync(envFile, 'CAIRN_DEPLOY_SERVICE_MANAGER=launchd\n');
    const launchdHome = join(f.dir, 'launchd-home');
    const systemdHome = join(f.dir, 'systemd-home');
    const first = await f.run(INSTALL, ['--env-file', envFile, '--launchd', '--no-load'], {
      HOME: launchdHome,
      CAIRN_DEPLOY_BUILD_CHECKOUT: f.checkout,
    });
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const plist = readdirSync(join(launchdHome, 'Library', 'LaunchAgents')).find((name) =>
      name.endsWith('.plist'),
    );
    const plistText = readFileSync(join(launchdHome, 'Library', 'LaunchAgents', plist), 'utf8');
    assert.match(plistText, /<integer>120<\/integer>/);
    assert.match(plistText, /deploy-watch\.sh/);
    mkdirSync(systemdHome, { recursive: true });
    const second = await f.run(INSTALL, ['--env-file', envFile, '--systemd', '--no-load'], {
      HOME: systemdHome,
      CAIRN_DEPLOY_BUILD_CHECKOUT: f.checkout,
    });
    assert.equal(second.status, 0, second.stderr + second.stdout);
    const timer = readFileSync(
      join(systemdHome, '.config', 'systemd', 'user', 'cairn-self-deploy.timer'),
      'utf8',
    );
    assert.match(timer, /OnUnitActiveSec=2min/);
    assert.match(timer, /AccuracySec=30s/);
  } finally {
    f.close();
  }
});

test('watcher does not mark a SHA failed on GitHub API outage and reuses cached green evidence offline', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'offline-target');
    const outage = await f.run(WATCH, [], { CAIRN_GITHUB_API_BASE: 'http://127.0.0.1:9' });
    assert.equal(outage.status, 0, outage.stderr + outage.stdout);
    assert.ok(!existsSync(join(f.state, 'failed', target)));
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), f.previous);
    const cacheDir = join(f.state, 'github-evidence');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, `${target}.json`),
      JSON.stringify({ green: true, sha: target, at: new Date().toISOString() }),
    );
    const cached = await f.run(WATCH, [], { CAIRN_GITHUB_API_BASE: 'http://127.0.0.1:9' });
    assert.equal(cached.status, 0, cached.stderr + cached.stdout);
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), target);
  } finally {
    f.close();
  }
});

test('build_target runs from apps/server and aborts before snapshot or restart when server build fails', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'bad-server-build', {
      'apps/server/build.mjs': "console.error('broken build'); process.exit(1);\n",
    });
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(serviceLog(f), '');
    assert.equal(readdirSync(f.backups).length, 0);
    assert.ok(existsSync(join(f.state, 'failed', target)));
    assert.ok(!existsSync(join(f.state, 'in-progress')));
  } finally {
    f.close();
  }
});

test('snapshots and rolls back a WAL-mode database when snapshot and stopped DB lack shm files', async () => {
  const f = await fixture({ journalMode: 'WAL' });
  try {
    const target = pushTarget(f, 'wal-broken');
    writeFileSync(join(f.fake, `broken-${target}`), '');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(realpathSync(f.root), realpathSync(f.previousRelease));
    const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
    assert.equal(record.result, 'rolled-back');
    assert.equal(record.failed, target);
  } finally {
    f.close();
  }
});

test('pre-switch failure on a legacy real directory restarts it in place without EISDIR', async () => {
  const f = await fixture();
  try {
    rmSync(f.root, { force: true });
    cpSync(f.previousRelease, f.root, { recursive: true });
    const target = pushTarget(f, 'legacy-pre-switch-fail');
    fakeTool(
      f.bin,
      'sqlite3',
      `for a in "$@"; do
  if [[ "$a" == *".backup"* ]]; then exit 1; fi
done
exec /usr/bin/sqlite3 "$@"`,
    );
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.doesNotMatch(result.stderr, /EISDIR/);
    assert.ok(!existsSync(join(f.state, 'in-progress')));
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), f.previous);
  } finally {
    f.close();
  }
});

test('an unhealthy rollback records rollback-unhealthy, preserves DB backups, releases lease, and exits 3', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'double-broken');
    writeFileSync(join(f.fake, `broken-${target}`), '');
    writeFileSync(join(f.fake, `broken-${f.previous}`), '');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 3, result.stderr + result.stdout);
    assert.match(result.stderr, /CRITICAL:/);
    const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
    assert.equal(record.result, 'rollback-unhealthy');
    assert.equal(record.failed, target);
    assert.ok(readdirSync(f.backups).some((name) => name.startsWith('predeploy-')));
    assert.ok(readdirSync(f.backups).some((name) => name.startsWith('failed-')));
    assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
  } finally {
    f.close();
  }
});

test('a failed migration rehearsal marks target failed without touching running service or DB', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'bad-migration', {
      'apps/server/src/db/client.ts':
        "export function openDbWithHandle() { throw new Error('migration failed'); }\n",
    });
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(serviceLog(f), '');
    assert.equal(readdirSync(f.backups).length, 0);
    assert.ok(existsSync(join(f.state, 'failed', target)));
    assert.ok(!existsSync(join(f.state, 'in-progress')));
  } finally {
    f.close();
  }
});

test('recovery clears an interrupted building phase without stopping the running server', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f);
    mkdirSync(f.state, { recursive: true });
    writeFileSync(
      join(f.state, 'in-progress'),
      `phase=building\ntarget=${target}\nprevious=${f.previous}\nsnapshot=\nrelease=\nprevious_release=${realpathSync(f.previousRelease)}\n`,
    );
    const result = await f.run(DEPLOY, ['--recover']);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(serviceLog(f), '');
    assert.ok(!existsSync(join(f.state, 'in-progress')));
  } finally {
    f.close();
  }
});

test('recovery rolls back interrupted switching, unhealthy switched, and restoring phases', async () => {
  for (const phase of ['switching', 'switched', 'restoring']) {
    const f = await fixture();
    try {
      const target = pushTarget(f, `interrupted-${phase}`);
      const targetRelease = writeRelease(f.releases, target, 'target');
      writeFileSync(join(f.fake, `broken-${target}`), '');
      rmSync(f.root, { force: true });
      symlinkSync(targetRelease, f.root, 'dir');
      mkdirSync(f.state, { recursive: true });
      mkdirSync(f.backups, { recursive: true });
      const snapshot = join(f.backups, `predeploy-${phase}.db`);
      cpSync(f.db, snapshot);
      writeFileSync(
        join(f.state, 'in-progress'),
        [
          `phase=${phase}`,
          `target=${target}`,
          `previous=${f.previous}`,
          `snapshot=${snapshot}`,
          `release=${targetRelease}`,
          `previous_release=${realpathSync(f.previousRelease)}`,
          '',
        ].join('\n'),
      );
      const result = await f.run(DEPLOY, ['--recover']);
      assert.equal(result.status, 1, `${phase}: ${result.stderr}${result.stdout}`);
      assert.equal(realpathSync(f.root), realpathSync(f.previousRelease));
      const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
      assert.equal(record.result, 'rolled-back');
      assert.ok(!existsSync(join(f.state, 'in-progress')));
    } finally {
      f.close();
    }
  }
});

test('refuses before snapshot or restart when server lacks /api/server/deploy/lease (404)', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f);
    fakeTool(
      f.bin,
      'curl',
      `url="\${@: -1}"
if [[ "$url" == */api/server/deploy/lease ]]; then printf 404; exit 0; fi
printf 200`,
    );
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 2, result.stderr + result.stdout);
    assert.match(result.stderr, /deployment lease endpoint/);
    assert.equal(serviceLog(f), '');
    assert.equal(readdirSync(f.backups).length, 0);
  } finally {
    f.close();
  }
});

test('failed or older target deployment restores build checkout to origin/main for subsequent watcher ticks', async () => {
  const f = await fixture();
  try {
    const target = pushTarget(f, 'bad-target-checkout', {
      'apps/server/build.mjs': 'process.exit(1);\n',
    });
    const newer = pushTarget(f, 'newer-good');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), newer);
  } finally {
    f.close();
  }
});

test('deploys runner checkout to the exact target SHA alongside the server', async () => {
  const f = await fixture({ runner: true, manager: 'launchd' });
  try {
    const target = pushTarget(f, 'with-runner');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(join(f.root, 'DEPLOYED_SHA'), 'utf8').trim(), target);
    assert.equal(git(f.runnerCheckout, 'rev-parse', 'HEAD'), target);
    assert.match(serviceLog(f), /bootout gui\/\d+\/com\.fixture\.cairn-daemon/);
    assert.match(serviceLog(f), /bootstrap gui\/\d+ .*com\.fixture\.cairn-daemon\.plist/);
  } finally {
    f.close();
  }
});

test('a failed runner install aborts before touching the running server or runner', async () => {
  const f = await fixture({ runner: true });
  try {
    const target = pushTarget(f, 'runner-install-fail');
    writeFileSync(join(f.fake, `fail-install-runner-checkout`), '');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(serviceLog(f), '');
    assert.equal(readdirSync(f.backups).length, 0);
    assert.equal(git(f.runnerCheckout, 'rev-parse', 'HEAD'), f.previous);
    assert.ok(existsSync(join(f.state, 'failed', target)));
  } finally {
    f.close();
  }
});

test('a failed runner restart rolls back both the runner checkout and the server release', async () => {
  const f = await fixture({ runner: true });
  try {
    const target = pushTarget(f, 'runner-crash');
    writeFileSync(join(f.fake, `runner-broken-${target}`), '');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.equal(realpathSync(f.root), realpathSync(f.previousRelease));
    assert.equal(git(f.runnerCheckout, 'rev-parse', 'HEAD'), f.previous);
    assert.ok(existsSync(join(f.fake, 'runner-up')));
    const record = JSON.parse(readFileSync(join(f.data, 'deploy.json'), 'utf8'));
    assert.equal(record.result, 'rolled-back');
  } finally {
    f.close();
  }
});

test('an active claimed runner step makes runner-coupled self-deploy wait and exit busy on timeout without restarting', async () => {
  const f = await fixture({ runner: true, claimedRunner: 1 });
  try {
    const target = pushTarget(f, 'runner-busy');
    const result = await f.run(DEPLOY, [target]);
    assert.equal(result.status, 75, result.stderr + result.stdout);
    assert.equal(serviceLog(f), '');
    assert.equal(readdirSync(f.backups).length, 0);
    assert.equal(git(f.runnerCheckout, 'rev-parse', 'HEAD'), f.previous);
    assert.equal(sqlite(f.db, "select status from deploy_lease where id='server'"), 'accepting');
  } finally {
    f.close();
  }
});

test('check_out_target fetches tags so build.mjs sees the latest desktop-v tag', async () => {
  const f = await fixture();
  try {
    const tagged = pushTarget(f, 'tagged-release', {
      'apps/server/build.mjs': `import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const desc = execFileSync('git', ['describe', '--tags', '--match', 'desktop-v*'], { encoding: 'utf8' }).trim();
if (!desc.startsWith('desktop-v0.1.999')) throw new Error('missing desktop tag: ' + desc);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.mjs', desc + ':' + readFileSync('../../marker.txt', 'utf8'));
writeFileSync('dist/index.mjs.map', '{}');
writeFileSync('dist/photon_rs_bg.wasm', 'wasm');
const config = { external: ['better-sqlite3'] };
void config;
`,
    });
    git(f.work, 'tag', 'desktop-v0.1.999');
    git(f.work, 'push', '-q', 'origin', 'tag', 'desktop-v0.1.999');
    const result = await f.run(DEPLOY, [tagged]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(readFileSync(join(f.root, 'dist', 'index.mjs'), 'utf8'), /^desktop-v0\.1\.999/);
  } finally {
    f.close();
  }
});
