import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { conversationBranch } from '../src/brand.js';

const root = resolve(import.meta.dirname, '../../..');

test('the standalone trial checker pins the shared Thread branch rule', () => {
  const id = '019a35f4-55ac-7000-a123-456789abcdef';
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { conversationBranch } from './scripts/ops/orb/trial-evidence-check.mjs'; process.stdout.write(conversationBranch(${JSON.stringify(id)}));`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(conversationBranch(id));
});

test('trial evidence regressions pass through the standalone Node runner', () => {
  const result = spawnSync(
    process.execPath,
    ['--test', 'scripts/ops/orb/trial-evidence-check.test.mjs'],
    { cwd: root, encoding: 'utf8', timeout: 30_000 },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 40_000);
