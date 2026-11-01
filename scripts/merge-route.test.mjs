import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/merge-route.mjs');
const prGate = resolve('.claude/workflows/pr-gate.js');

function repoWith(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-route-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  mkdirSync(join(dir, '.claude/workflows'), { recursive: true });
  copyFileSync(prGate, join(dir, '.claude/workflows/pr-gate.js'));
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git('add', '.claude/workflows/pr-gate.js', 'README.md');
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

test('protected paths route to the owner', (t) => {
  const result = route(repoWith(t, { 'scripts/x.mjs': 'export {};\n' }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /protected paths: scripts\/x\.mjs/);
});

test('a malformed head sha is refused', () => {
  const result = spawnSync(process.execPath, [script, 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
