import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baselinePath = resolve(import.meta.dirname, 'import-cycle-baseline.json');
const scanTargets = ['apps', 'packages', 'scripts', 'ops'];

export function violationKeys(violations) {
  const keys = violations.map((v) => `${v.from} → ${v.cycle.map((node) => node.name).join(' → ')}`);
  return [...new Set(keys)].sort();
}

export function diffViolations(current, baseline) {
  const baselineSet = new Set(baseline);
  const currentSet = new Set(current);
  return {
    added: current.filter((key) => !baselineSet.has(key)),
    fixed: baseline.filter((key) => !currentSet.has(key)),
  };
}

function cruise() {
  const run = spawnSync(
    'pnpm',
    [
      'exec',
      'dependency-cruiser',
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'json',
      ...scanTargets,
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error) throw run.error;
  try {
    return JSON.parse(run.stdout);
  } catch {
    process.stderr.write(run.stderr || run.stdout || '');
    throw new Error(`dependency-cruiser exited ${run.status} without JSON output`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const report = cruise();
  const current = violationKeys(report.summary.violations ?? []);
  if (process.argv.includes('--update-baseline')) {
    writeFileSync(baselinePath, `${JSON.stringify({ violations: current }, null, 2)}\n`);
    console.log(`[import-cycle-gate] baseline written: ${current.length} known cycle edges`);
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).violations;
  const { added, fixed } = diffViolations(current, baseline);
  if (added.length > 0) {
    console.error(`[import-cycle-gate] ${added.length} new import cycle edge(s):`);
    for (const key of added) console.error(`  ${key}`);
    console.error(
      '[import-cycle-gate] break the cycle or, if it predates your change, regenerate the baseline: node scripts/import-cycle-gate.mjs --update-baseline',
    );
    process.exit(1);
  }
  if (fixed.length > 0) {
    console.log(
      `[import-cycle-gate] ${fixed.length} baseline cycle edge(s) resolved — regenerate the baseline to bank the fix`,
    );
  }
  console.log(`[import-cycle-gate] no new import cycles (${current.length} known baseline edges)`);
}
