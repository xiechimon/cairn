import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

test.each([
  ['wrong-arguments', 'expected read Project'],
  ['unexpected', 'Unexpected tool call write'],
  ['unconsumed', 'Unconsumed model steps: read Project'],
  ['required-real', 'Required-real suite incomplete: real Claude smoke'],
])(
  '%s negative control fails the actual Vitest process',
  (fixture, message) => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-fakes-negative-'));
    try {
      const config = join(dir, 'vitest.config.mjs');
      writeFileSync(
        config,
        `export default { test: { include: [${JSON.stringify(join(import.meta.dirname, 'fixtures/fakes', `${fixture}.fixture.ts`))}], fileParallelism: false } };`,
      );
      const result = spawnSync(
        process.execPath,
        [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config],
        { cwd: root, encoding: 'utf8', timeout: 30_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(message);
      if (fixture === 'required-real') expect(result.stdout).toMatch(/1 skipped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  40_000,
);

test('smoke runner lifecycle fixtures pass without invoking a real model', () => {
  const result = spawnSync(process.execPath, ['--test', 'scripts/ops/real-smoke.test.mjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 40_000);
