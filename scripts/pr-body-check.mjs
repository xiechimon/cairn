import { spawnSync } from 'node:child_process';

const body = process.argv[2];
if (!body) {
  console.error('Usage: pnpm pr:check <pr-body-file>');
  process.exit(2);
}
let failed = false;
for (const gate of ['scripts/pr-evidence-gate.py', 'scripts/pr-tasks-gate.py']) {
  const result = spawnSync('python3', [gate, body], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
