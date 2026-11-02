import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/merge-route.mjs');
const prGate = resolve('.claude/workflows/pr-gate.js');
const gatePaths = resolve('packages/shared/merge-gate-paths.json');

function repoWith(t, files, { gatePathsJson = readFileSync(gatePaths, 'utf8') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-route-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  mkdirSync(join(dir, '.claude/workflows'), { recursive: true });
  copyFileSync(prGate, join(dir, '.claude/workflows/pr-gate.js'));
  mkdirSync(join(dir, 'packages/shared'), { recursive: true });
  writeFileSync(join(dir, 'packages/shared/merge-gate-paths.json'), gatePathsJson);
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

test('a binary file outside docs/verify routes to the owner', (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const result = route(repoWith(t, { 'apps/web/src/logo.png': png }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /binary files outside docs\/verify.*apps\/web\/src\/logo\.png/);
});

test('a source file with a NUL byte counts as binary', (t) => {
  const result = route(repoWith(t, { 'apps/web/src/a.ts': 'export const a = 1;\0\n' }));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /binary files outside docs\/verify/);
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

test('a PNG in another spec snapshot folder routes to the owner', (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const result = route(
    repoWith(t, { 'apps/web/e2e/visual-polish.spec.ts-snapshots/rail-linux.png': png }),
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /binary files outside docs\/verify/);
});

test('protected paths route to the owner', (t) => {
  const result = route(repoWith(t, { 'scripts/x.mjs': 'export {};\n' }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /protected paths: scripts\/x\.mjs/);
});

test('a human-queue path routes to the owner and names its category', (t) => {
  const result = route(repoWith(t, { 'apps/server/src/services/secrets.ts': 'export {};\n' }));
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /human queue \(credentials\): apps\/server\/src\/services\/secrets\.ts/,
  );
  assert.match(result.stdout, /protected paths: apps\/server\/src\/services\/secrets\.ts/);
});

test('a path in two human-queue categories is named under both', (t) => {
  const result = route(repoWith(t, { 'scripts/ops/deploy-self.sh': 'exit 0\n' }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /human queue \(dataDestruction\): scripts\/ops\/deploy-self\.sh/);
  assert.match(
    result.stdout,
    /human queue \(releaseAndControlPlane\): scripts\/ops\/deploy-self\.sh/,
  );
});

test('a protected path outside the human queue is not queued for a human', (t) => {
  const result = route(repoWith(t, { 'scripts/x.mjs': 'export {};\n' }));
  assert.doesNotMatch(result.stdout, /human queue/);
});

test('a malformed human queue fails closed', (t) => {
  const malformed = JSON.stringify({
    ...JSON.parse(readFileSync(gatePaths, 'utf8')),
    humanQueue: ['apps/server/src/services/secrets.ts'],
  });
  const result = route(
    repoWith(t, { 'apps/web/src/a.ts': 'export const a = 1;\n' }, { gatePathsJson: malformed }),
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /may enter the merge queue/);
});

test('a malformed head sha is refused', () => {
  const result = spawnSync(process.execPath, [script, 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
