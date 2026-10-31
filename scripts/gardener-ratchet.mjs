import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function ratchetLintBaseline(repo, run = spawnSync) {
  const result = run('pnpm', ['exec', 'biome', 'ci', '.'], { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Lint failed; baseline unchanged');
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  const output = `${result.stdout}\n${result.stderr}`.replace(ansi, '');
  if (!/Checked \d+ files/.test(output)) throw new Error('Lint measurement unavailable');
  const count = /Found\s+(\d+)\s+warnings?/.exec(output);
  if (count === null && /Found[^\n]*warnings?/.test(output))
    throw new Error('Lint warning count unavailable');
  const measured = count ? Number(count[1]) : 0;
  const path = join(repo, 'scripts/lint-warning-baseline.json');
  const baseline = JSON.parse(readFileSync(path, 'utf8'));
  if (![baseline.maxWarnings, measured].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw new Error('Baseline and measurement must be non-negative integers');
  return { before: baseline.maxWarnings, after: baseline.maxWarnings, measured };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(ratchetLintBaseline(resolve(process.env.CAIRN_REPO ?? '.'))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
