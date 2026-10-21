// #1466 round 3b pin check: drop the . / .. segment check from parseGithubRepoRef, run
// apps/server/test/github-reads.test.ts, restore the original bytes. Usage: node docs/verify/1466/r3b-pin-check.mjs "$PWD"
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const root = process.argv[2];
const path = `${root}/packages/shared/src/records/project.ts`;
const original = readFileSync(path, 'utf8');
const from = "  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;\n";
if (original.split(from).length !== 2) throw new Error('anchor');
writeFileSync(path, original.replace(from, ''));
let log = '', status = 0;
try {
  log = execFileSync('pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', 'apps/server/test/github-reads.test.ts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
} catch (e) { status = e.status ?? 1; log = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
finally { writeFileSync(path, original); }
console.log(`mutation: parseGithubRepoRef without the . / .. segment check (packages/shared/src/records/project.ts)`);
console.log(`vitest exit: ${status} (${status === 0 ? 'SURVIVED' : 'KILLED'})`);
for (const l of log.split('\n')) if (/^\s+×|^\s+(Test Files|Tests)\s|^AssertionError/.test(l)) console.log(l.replace(/\s+\d+ms$/, '').trim());
