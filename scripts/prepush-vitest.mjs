import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { acquireSlot, leaseEnv } from './heavy-slots.mjs';

const root = resolve(import.meta.dirname, '..');

export function unexpectedFailures(report, knownRed, cwd = root) {
  const known = new Set(knownRed.map((entry) => entry.file));
  const failed = report.testResults
    .filter((result) => result.status === 'failed')
    .map((result) => relative(cwd, result.name));
  return {
    unexpected: failed.filter((file) => !known.has(file)),
    knownFailed: failed.filter((file) => known.has(file)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const base = process.env.PREPUSH_BASE_SHA || 'origin/main';
  const outputFile = join(mkdtempSync(join(tmpdir(), 'prepush-vitest-')), 'report.json');
  const lease = await acquireSlot();
  let run;
  try {
    run = spawnSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--changed',
        base,
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${outputFile}`,
      ],
      {
        cwd: root,
        stdio: 'inherit',
        env: leaseEnv(lease),
      },
    );
  } finally {
    lease?.release();
  }
  let report;
  try {
    report = JSON.parse(readFileSync(outputFile, 'utf8'));
  } catch {
    process.exit(run.status ?? 1);
  }
  const knownRed = JSON.parse(readFileSync(join(root, 'scripts/prepush-known-red.json'), 'utf8'));
  const { unexpected, knownFailed } = unexpectedFailures(report, knownRed);
  for (const file of knownFailed)
    console.log(
      `[prepush] known environment red locally (scripts/prepush-known-red.json): ${file}`,
    );
  if (unexpected.length > 0) {
    for (const file of unexpected) console.error(`[prepush] FAIL: ${file}`);
    process.exit(1);
  }
  process.exit(run.status !== 0 && knownFailed.length === 0 ? (run.status ?? 1) : 0);
}
