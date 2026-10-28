import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const namedBehaviours = [
  'concurrent claims, repeated requests and restarts dispatch one worker per digest',
  'lost dispatch acknowledgment never retries and recovers completion after restart',
  'independent processes atomically claim one durable attempt',
  'repeated running polls retain the original deadline and dispatch identity',
  'worker-failed is durable and requires human attention',
  'deadline expiry survives restart and rejects late completion',
  'completion authenticates worker identity and fences late callbacks',
  'publication rejection is terminal and cannot be retried',
];

test('durable coordinator lifecycle across independent processes', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
      '--test',
      'scripts/harness-eval-coordinator.test.mjs',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  expect(output).toContain('fail 0');
  for (const name of namedBehaviours) expect(output).toContain(name);
}, 30000);
