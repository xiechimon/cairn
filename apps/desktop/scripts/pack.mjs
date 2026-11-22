import { spawnSync } from 'node:child_process';
import { acquireSlot, leaseEnv } from '../../../scripts/heavy-slots.mjs';

const argv = process.argv.slice(2);
const lease = await acquireSlot({ label: 'desktop:pack' });
const env = leaseEnv(lease);
const steps =
  argv[0] === '--start'
    ? [['pnpm', ['exec', 'electron', '.']]]
    : [['pnpm', ['exec', 'electron-builder', ...argv]]];

for (const [command, args] of [['node', ['build.mjs']], ...steps]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
