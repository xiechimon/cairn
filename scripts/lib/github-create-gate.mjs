import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import {
  acquireGithubCreateSlot,
  parseGithubCreateRateLimit,
} from '../../packages/shared/src/github-create-gate.ts';

const command = process.argv.slice(2);
if (command.length === 0)
  throw new Error(
    'Usage: node scripts/lib/github-create-gate.mjs <bot wrapper> gh <create command>',
  );
for (let attempt = 0; ; attempt++) {
  await acquireGithubCreateSlot();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
  if (result.code === 0) break;
  const status = /429/.test(result.stderr) ? 429 : 403;
  const retry = /retry-after:\s*(\d+)/i.exec(result.stderr)?.[1];
  const delay = parseGithubCreateRateLimit(
    { status, headers: { get: (name) => (name === 'retry-after' ? (retry ?? null) : null) } },
    result.stderr,
  );
  if (delay === null || attempt >= 3) process.exit(result.code ?? 1);
  const wait = delay * 2 ** attempt;
  console.warn(`GitHub create rate limited; retrying in ${wait}ms`);
  await setTimeout(wait);
}
