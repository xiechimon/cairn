import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('durable coordinator lifecycle across independent processes', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
      '--test',
      'scripts/harness-eval-coordinator.test.mjs',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  expect(output).toContain('fail 0');
}, 30000);
