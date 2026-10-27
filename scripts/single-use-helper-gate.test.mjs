import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/single-use-helper-gate.mjs');

test('checks added helpers with symbol references and named exemptions', () => {
  const cwd = mkdtempSync(resolve(tmpdir(), 'single-use-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const run = () =>
    spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, SINGLE_USE_HELPER_BASE_SHA: '' },
    });
  try {
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(resolve(cwd, 'apps/demo'), { recursive: true });
    mkdirSync(resolve(cwd, 'packages/demo'), { recursive: true });
    mkdirSync(resolve(cwd, 'scripts'));
    const allowlist = resolve(cwd, 'scripts/single-use-helper-allowlist.json');
    writeFileSync(allowlist, '[]');
    const file = resolve(cwd, 'apps/demo/code.ts');
    const baseline = 'function existing() { return 1; }\nexisting();\n';
    writeFileSync(file, baseline);
    git('add', 'apps/demo/code.ts', 'scripts/single-use-helper-allowlist.json');
    git('commit', '-m', 'baseline');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.equal(run().status, 0);
    for (const name of ['existing', 'missing']) {
      writeFileSync(
        allowlist,
        JSON.stringify([{ path: 'apps/demo/code.ts', name, reason: 'Deliberate boundary' }]),
      );
      assert.equal(run().status, name === 'existing' ? 0 : 2);
    }
    writeFileSync(allowlist, '[]');
    for (const source of [
      'function once() { return 1; }\nonce();',
      'const once = () => 1;\nonce();',
      'const once = function () { return 1; };\nonce();',
      'function once() { return 1; }\nconst object = { once };',
      'export function outer() { function once() {} once(); }',
      'function once() { return 1; }\nonce();\nconst object = { once: 2 }; object.once;',
      'function once() { return 1; }\nonce();\nfunction other(once: number) { return once; }',
    ]) {
      writeFileSync(file, `${baseline}${source}\n`);
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /apps\/demo\/code.ts:3:.*once/);
      console.log(`Rejected: ${result.stderr.trim()}`);
    }
    for (const source of [
      'function twice() {}\ntwice(); twice();',
      'export function once() {}\nonce();',
      'export const once = () => 1;\nonce();',
      'function once() {}\nexport { once as publicName };\nonce();',
      'const once = () => 1;\nexport default once;',
      'function unused() {}',
      'const text = "function once() {} once()";',
    ]) {
      writeFileSync(file, `${baseline}${source}\n`);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      console.log(`Accepted: ${source.replaceAll('\n', ' ')}`);
    }
    const declaration = 'function once() { return 1; }';
    for (const path of ['packages/demo/code.tsx', 'scripts/demo.mjs']) {
      writeFileSync(file, baseline);
      writeFileSync(resolve(cwd, path), `${declaration}\nonce();\n`);
      git('add', path);
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(`${path}:1:`));
      writeFileSync(resolve(cwd, path), 'export {};\n');
    }
    writeFileSync(file, `${baseline}${declaration}\nonce();\n`);
    writeFileSync(
      allowlist,
      JSON.stringify([{ path: 'apps/demo/code.ts', name: 'once', reason: 'Deliberate boundary' }]),
    );
    assert.equal(run().status, 0);
    writeFileSync(file, `${baseline}function once() { return 2; }\nonce();\n`);
    assert.equal(run().status, 0);
    for (const entry of [
      { path: 'apps/demo/code.ts', name: 'once', reason: ' ' },
      { path: 'apps/demo/code.ts', name: 'missing', reason: 'Deliberate boundary' },
    ]) {
      writeFileSync(allowlist, JSON.stringify([entry]));
      assert.equal(run().status, 2);
    }
    writeFileSync(allowlist, '[{}]');
    assert.equal(run().status, 2);
    writeFileSync(allowlist, '[]');
    git('add', 'apps/demo/code.ts');
    git('commit', '-m', 'candidate');
    assert.equal(run().status, 1);
    git('update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal(run().status, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('does not flag an existing large function when a parameter or body changes', () => {
  const cwd = mkdtempSync(resolve(tmpdir(), 'single-use-gate-runner-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const baseline = readFileSync('apps/daemon/src/runner.ts', 'utf8');
  try {
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(resolve(cwd, 'apps/daemon/src'), { recursive: true });
    mkdirSync(resolve(cwd, 'scripts'));
    const file = resolve(cwd, 'apps/daemon/src/runner.ts');
    writeFileSync(file, baseline);
    writeFileSync(resolve(cwd, 'scripts/single-use-helper-allowlist.json'), '[]');
    git('add', 'apps/daemon/src/runner.ts', 'scripts/single-use-helper-allowlist.json');
    git('commit', '-m', 'baseline');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    for (const changed of [
      baseline.replace('  stop: RunStop,', '  stop: RunStop,\n  extra?: unknown,'),
      baseline.replace(
        '  const stepId = claimed.step.id;',
        '  const stepId = String(claimed.step.id);',
      ),
    ]) {
      assert.notEqual(changed, baseline);
      writeFileSync(file, changed);
      const result = spawnSync(process.execPath, [script], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, SINGLE_USE_HELPER_BASE_SHA: '' },
      });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a moved file is judged by its changed lines, not as a new file', () => {
  const cwd = mkdtempSync(resolve(tmpdir(), 'single-use-gate-move-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const source = [
    'function helper(value: number) {',
    '  return value + 1;',
    '}',
    'export const answer = helper(41);',
    '',
  ].join('\n');
  try {
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    mkdirSync(resolve(cwd, 'apps/web/src/overlays'), { recursive: true });
    mkdirSync(resolve(cwd, 'scripts'));
    writeFileSync(resolve(cwd, 'apps/web/src/overlays/panel.ts'), source);
    writeFileSync(resolve(cwd, 'scripts/single-use-helper-allowlist.json'), '[]');
    git('add', '.');
    git('commit', '-m', 'baseline');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(resolve(cwd, 'apps/web/src/overlay'));
    git('mv', 'apps/web/src/overlays/panel.ts', 'apps/web/src/overlay/panel.ts');
    git('commit', '-m', 'move');
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, SINGLE_USE_HELPER_BASE_SHA: '' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
