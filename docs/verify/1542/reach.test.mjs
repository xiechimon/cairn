import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const selector = 'scripts/e2e-affected.mjs';
for (const [file, code] of [
  ['apps/web/e2e/unmapped-reach.spec.ts', 1],
  ['apps/web/e2e/board-reach.spec.ts', 0],
  ['apps/web/e2e/a11y-axe.spec.ts', 0],
]) {
  test(file, () => {
    const result = spawnSync(process.execPath, [selector, '--check-coverage', '--', file], { encoding: 'utf8' });
    assert.equal(result.status, code, result.stdout + result.stderr);
    if (code === 1) assert.match(result.stdout, /apps\/web\/e2e\/unmapped-reach.spec.ts/);
  });
}

for (const [file, code] of [
  ['scripts/drive-unregistered.mjs', 1],
  ['docs/verify/1542/drive-unregistered.mts', 1],
  ['.claude/skills/verify-cairn/scripts/drive-hotkeys.mjs', 0],
  ['apps/web/e2e/unmapped-reach.spec.ts', 1],
  ['apps/web/e2e/board-reach.spec.ts', 0],
]) {
  test(`registry reach: ${file}`, () => {
    const result = spawnSync(process.execPath, [
      '.claude/skills/verify-cairn/scripts/vp-registry-gate.mjs', '--check-reach', file,
    ], { encoding: 'utf8' });
    assert.equal(result.status, code, result.stdout + result.stderr);
    if (code === 1) assert.ok(result.stdout.includes(file), result.stdout);
  });
}

test('discovers committed, staged and untracked additions from the base', () => {
  const root = mkdtempSync(join(tmpdir(), 'probe-reach-'));
  const gate = '.claude/skills/verify-cairn/scripts/vp-registry-gate.mjs';
  const registry = '.claude/skills/verify-cairn/vp-registry.json';
  const run = (command, args, env = {}) => spawnSync(command, args, {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
  });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const check = () => run(process.execPath, [gate, '--check-reach'], { VP_REACH_BASE_SHA: base });
  let base;
  try {
    for (const file of [selector, gate, registry]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(resolve(file), join(root, file));
    }
    git('init', '-q');
    git('add', selector, gate, registry);
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base');
    base = git('rev-parse', 'HEAD');
    mkdirSync(join(root, 'apps/web/e2e'), { recursive: true });
    const spec = 'apps/web/e2e/unmapped-reach.spec.ts';
    writeFileSync(join(root, spec), '');
    for (const state of ['untracked', 'staged', 'committed']) {
      if (state === 'staged') git('add', spec);
      if (state === 'committed') git('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'spec');
      const result = check();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(result.stdout.includes(spec), result.stdout);
    }
    writeFileSync(join(root, selector), readFileSync(resolve(selector), 'utf8').replace("prefixes.push('a11y-axe');", "prefixes.push('a11y-axe', 'unmapped-reach');"));
    assert.equal(check().status, 0);
    writeFileSync(join(root, 'scripts/drive-unregistered.mjs'), '');
    const drive = check();
    assert.equal(drive.status, 1, drive.stdout + drive.stderr);
    assert.ok(drive.stdout.includes('scripts/drive-unregistered.mjs'), drive.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
