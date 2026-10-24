import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { countMetric, METRICS } from './baseline-ledger.mjs';

try {
  const base = process.env.BASELINE_RATCHET_BASE_SHA || 'origin/main';
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  const violations = [];
  for (const metric of METRICS.filter((entry) => entry.ratchet)) {
    let baseText = null;
    try {
      baseText = git('show', `${base}:${metric.file}`);
    } catch {}
    if (baseText === null) continue;
    let branchText = null;
    try {
      branchText = readFileSync(metric.file, 'utf8');
    } catch {}
    if (branchText === null) {
      violations.push(`${metric.file} removed vs base (${metric.id})`);
      continue;
    }
    const before = countMetric(metric, baseText);
    const after = countMetric(metric, branchText);
    if (after > before) violations.push(`${metric.id} raised vs base: ${before} -> ${after}`);
  }
  for (const violation of violations) console.error(`baseline-ratchet-gate: ${violation}`);
  console.log(`baseline-ratchet-gate: ${violations.length} raised baseline(s)`);
  process.exitCode = violations.length ? 1 : 0;
} catch (error) {
  console.error(`baseline-ratchet-gate: ${error.message}`);
  process.exitCode = 2;
}
