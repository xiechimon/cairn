import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/merge-route.mjs');
const prGate = resolve('.claude/workflows/pr-gate.js');
const gatePaths = resolve('packages/shared/merge-gate-paths.json');

function repoWith(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-route-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  mkdirSync(join(dir, '.claude/workflows'), { recursive: true });
  copyFileSync(prGate, join(dir, '.claude/workflows/pr-gate.js'));
  mkdirSync(join(dir, 'packages/shared'), { recursive: true });
  copyFileSync(gatePaths, join(dir, 'packages/shared/merge-gate-paths.json'));
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git('add', '.claude/workflows/pr-gate.js', 'packages/shared/merge-gate-paths.json', 'README.md');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-q', '-c', 'topic');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    git('add', path);
  }
  git('commit', '-q', '-m', 'change');
  return { dir, head: git('rev-parse', 'HEAD') };
}

const route = ({ dir, head }) =>
  spawnSync(process.execPath, [script, head], { cwd: dir, encoding: 'utf8' });

test('product source with text changes may enter the queue', (t) => {
  const result = route(repoWith(t, { 'apps/web/src/a.ts': 'export const a = 1;\n' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /may enter the merge queue/);
});

test('a binary file outside docs/verify may enter the queue', (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const result = route(repoWith(t, { 'apps/web/src/logo.png': png }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /may enter the merge queue/);
});

test('a source file with a NUL byte may enter the queue', (t) => {
  const result = route(repoWith(t, { 'apps/web/src/a.ts': 'export const a = 1;\0\n' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /may enter the merge queue/);
});

test('binary evidence under docs/verify may enter the queue', (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const result = route(
    repoWith(t, { 'docs/verify/1/shot.png': png, 'apps/web/src/a.ts': 'export const a = 1;\n' }),
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('gallery snapshot baselines may enter the queue', (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const result = route(
    repoWith(t, {
      'apps/web/e2e/gallery-snapshots.spec.ts-snapshots/side-panel-dark-linux.png': png,
      'apps/web/src/a.ts': 'export const a = 1;\n',
    }),
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a PNG in another spec snapshot folder may enter the queue', (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const result = route(
    repoWith(t, { 'apps/web/e2e/visual-polish.spec.ts-snapshots/rail-linux.png': png }),
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /may enter the merge queue/);
});

test('protected paths may enter the queue', (t) => {
  const result = route(repoWith(t, { 'scripts/x.mjs': 'export {};\n' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /may enter the merge queue/);
});

test('each owner-route class exits for the owner', (t) => {
  for (const [path, reason] of [
    ['.github/workflows/ci.yml', /owner route \(ci and merge machinery\)/],
    ['integration/eval/owner-route.txt', /owner route \(eval ruler\)/],
    ['apps/server/src/services/secrets.ts', /owner route \(credentials\)/],
    ['apps/server/src/routes-machine.ts', /owner route \(machineAndCommandBoundary\)/],
    ['apps/server/src/services/mcp-face.ts', /owner route \(externalEntryAuth\)/],
  ]) {
    const result = route(repoWith(t, { [path]: 'export {};\n' }));
    assert.equal(result.status, 1, `${path}\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, reason, path);
  }
});

test('a non-sensitive protected path may enter the queue', (t) => {
  const result = route(repoWith(t, { 'apps/server/src/db/client.ts': 'export const db = 1;\n' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /may enter the merge queue/);
});

test('a malformed head sha is refused', () => {
  const result = spawnSync(process.execPath, [script, 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

function fakeGh(t, { labels = [], failWrites = false } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'merge-route-gh-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const log = join(bin, 'calls.log');
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"--method"*) ${failWrites ? 'echo denied >&2; exit 1' : 'exit 0'} ;;
  *"/pulls/"*) printf '%s\\n' "$FAKE_LIVE_HEAD" ;;
  *) printf '%s\\n' ${labels.map((name) => `'${name}'`).join(' ')} ;;
esac
`,
    { mode: 0o755 },
  );
  const writes = () =>
    (existsSync(log) ? readFileSync(log, 'utf8') : '')
      .split('\n')
      .filter((line) => line.includes('--method'));
  return { bin, writes };
}

const routeLabelling = ({ dir, head }, gh, liveHead = head) =>
  spawnSync(process.execPath, [script, head, '--label-pr', '7'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${gh.bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'o/r',
      FAKE_LIVE_HEAD: liveHead,
    },
  });

const protectedChange = { 'scripts/x.mjs': 'export {};\n' };
const queueableChange = { 'apps/web/src/a.ts': 'export const a = 1;\n' };

test('a protected path does not get the owner-route label', (t) => {
  const gh = fakeGh(t);
  const result = routeLabelling(repoWith(t, protectedChange), gh);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /may enter the merge queue/);
  assert.deepEqual(gh.writes(), []);
});

test('an owner-route path gets the owner-route label', (t) => {
  const gh = fakeGh(t);
  const result = routeLabelling(
    repoWith(t, { 'apps/server/src/services/secrets.ts': 'export const seal = 1;\n' }),
    gh,
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(gh.writes().length, 1);
  assert.match(gh.writes()[0], /--method POST repos\/o\/r\/issues\/7\/labels/);
  assert.match(gh.writes()[0], /owner-route/);
});

test('a protected path loses a stale owner-route label', (t) => {
  const gh = fakeGh(t, { labels: ['owner-route', 'bug'] });
  const result = routeLabelling(repoWith(t, protectedChange), gh);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(gh.writes().length, 1);
  assert.match(gh.writes()[0], /--method DELETE repos\/o\/r\/issues\/7\/labels\/owner-route/);
});

test('a queueable head loses a stale owner-route label', (t) => {
  const gh = fakeGh(t, { labels: ['owner-route'] });
  const result = routeLabelling(repoWith(t, queueableChange), gh);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(gh.writes().length, 1);
  assert.match(gh.writes()[0], /--method DELETE repos\/o\/r\/issues\/7\/labels\/owner-route/);
});

test('a queueable head without the label is not written', (t) => {
  const gh = fakeGh(t, { labels: ['bug'] });
  const result = routeLabelling(repoWith(t, queueableChange), gh);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(gh.writes(), []);
});

test('a run for a superseded head leaves the label alone', (t) => {
  const newerHead = 'f'.repeat(40);
  const owner = fakeGh(t, { labels: [] });
  assert.equal(routeLabelling(repoWith(t, protectedChange), owner, newerHead).status, 0);
  assert.deepEqual(owner.writes(), []);
  const queueable = fakeGh(t, { labels: ['owner-route'] });
  assert.equal(routeLabelling(repoWith(t, queueableChange), queueable, newerHead).status, 0);
  assert.deepEqual(queueable.writes(), []);
});

test('a failed label clear still lets the head enter the queue', (t) => {
  const gh = fakeGh(t, { labels: ['owner-route'], failWrites: true });
  const owner = routeLabelling(repoWith(t, protectedChange), gh);
  assert.equal(owner.status, 0, owner.stdout + owner.stderr);
  assert.match(owner.stdout, /may enter the merge queue/);
  assert.match(owner.stderr, /owner-route label/);
});

test('--label-pr without a repository is refused', (t) => {
  const { dir, head } = repoWith(t, queueableChange);
  const result = spawnSync(process.execPath, [script, head, '--label-pr', '7'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: '' },
  });
  assert.equal(result.status, 2);
});
