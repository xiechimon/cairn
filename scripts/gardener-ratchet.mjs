import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function tightenBaseline(before, measured) {
  if (![before, measured].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw new Error('Baseline and measurement must be non-negative integers');
  return measured < before ? before - 1 : before;
}

export function ratchetLintBaseline(
  repo,
  run = spawnSync,
  { now = new Date(), log = console.log } = {},
) {
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
  const before = baseline.maxWarnings;
  const after = tightenBaseline(before, measured);
  const measurement = { before, after, measured };
  if (after === before) return measurement;
  if (run('gh', ['--version'], { cwd: repo, encoding: 'utf8' }).status !== 0) {
    log(`Proposed lint baseline: ${before} -> ${after} (measured ${measured}); gh unavailable.`);
    return measurement;
  }
  const branch = `gardener/ratchet-${now.toISOString().slice(0, 10)}`;
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-gardener-ratchet-'));
  const worktree = join(scratch, 'checkout');
  const execute = (command, args, cwd = worktree) => {
    const result = run(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr ?? ''}`);
    return result;
  };
  let added = false;
  try {
    execute('git', ['worktree', 'add', '-b', branch, worktree, 'origin/main'], repo);
    added = true;
    execute('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']);
    execute('pnpm', ['exec', 'husky']);
    const target = join(worktree, 'scripts/lint-warning-baseline.json');
    const current = JSON.parse(readFileSync(target, 'utf8'));
    if (current.maxWarnings !== before) throw new Error('Baseline changed; rerun the measurement');
    writeFileSync(target, `${JSON.stringify({ ...current, maxWarnings: after }, null, 2)}\n`);
    execute('git', ['add', 'scripts/lint-warning-baseline.json']);
    execute('git', ['commit', '-m', 'ops(2287): tighten lint warning baseline']);
    execute('git', ['push', '-u', 'origin', branch]);
    execute('gh', [
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      'ops(2287): tighten lint warning baseline',
      '--body',
      `## Proof\nMeasured ${measured} lint warnings.\n\n## What\nTighten the baseline from ${before} to ${after}.\n\n<details><summary>Review</summary>Automated one-step ratchet.</details>\n\n<details><summary>Risk</summary>Only the warning limit changes.</details>`,
    ]);
  } finally {
    if (added) execute('git', ['worktree', 'remove', worktree], repo);
    rmSync(scratch, { recursive: true, force: true });
  }
  return measurement;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(ratchetLintBaseline(resolve(process.env.CAIRN_REPO ?? '.'))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
