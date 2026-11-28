import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PilotResult } from './pilot.js';

/**
 * A static scorecard for the operator: the calibration's budget, the paired
 * decisions and the power picture. It carries aggregates only, never case
 * names, prompts, patches or credentials, and it opens no listener.
 */
export function renderScorecard(result: PilotResult): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const decisionRow = (label: string, decision: PilotResult['aa']) => `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td>${decision.kind}</td>
      <td>${decision.n}</td>
      <td>${decision.wins}</td>
      <td>${decision.losses}</td>
      <td>${decision.ties}</td>
      <td>${pct(decision.effect)}</td>
      <td>${decision.p.toFixed(4)}</td>
      <td>${escapeHtml(decision.reason)}</td>
    </tr>`;
  const rows = result.power.scenarios
    .map(
      (row) => `
    <tr><td>${row.pairs}</td><td>${pct(row.discordance)}</td><td>${pct(row.candidateShare)}</td><td>${pct(row.power)}</td></tr>`,
    )
    .join('');
  const stops = result.stopReason === null ? 'not stopped by a cap' : escapeHtml(result.stopReason);
  const missing =
    result.missing === null
      ? ''
      : `<p class="warn"><strong>Not measured:</strong> ${escapeHtml(result.missing)}</p>`;

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Cairn harness calibration — ${escapeHtml(result.startedAt.slice(0, 10))}</title>
<style>
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px auto; max-width: 900px; color: #1c1c1e; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  h2 { font-size: 17px; margin-top: 28px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  th { font-weight: 600; color: #555; }
  .warn { background: #fff5e5; border-left: 3px solid #f0a020; padding: 10px 12px; }
  .meta { color: #666; font-size: 13px; }
  code { background: #f4f4f6; padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
<h1>Harness self-improvement — calibration scorecard</h1>
<p class="meta">${escapeHtml(result.topic)} · ${escapeHtml(result.startedAt)} · mode <code>${escapeHtml(result.mode)}</code> · model <code>${escapeHtml(result.model)}</code></p>

<h2>What this run measured</h2>
<p>${escapeHtml(result.conclusion)}</p>
${missing}

<h2>Budget</h2>
<table>
  <tr><th>Cap</th><th>Used</th><th>Stop reason</th></tr>
  <tr><td>${result.cap.maxStarts} starts / ${result.cap.maxWallMinutes} min</td><td>${result.starts} starts / ${(result.wallMs / 60_000).toFixed(1)} min</td><td>${stops}</td></tr>
</table>
<p class="meta">Cap proof in code: ${result.capProof.attempted} reservations attempted, ${result.capProof.admitted} admitted, the next refused with “${escapeHtml(result.capProof.refused)}”.</p>

<h2>Arms</h2>
<table>
  <tr><th>Arm</th><th>Passed</th><th>Graded</th></tr>
  ${result.arms.map((arm) => `<tr><td>${escapeHtml(arm.arm)}</td><td>${arm.passed}</td><td>${arm.graded}</td></tr>`).join('\n  ')}
</table>

<h2>Paired decisions</h2>
<table>
  <tr><th>Comparison</th><th>Verdict</th><th>n</th><th>W</th><th>L</th><th>Ties</th><th>Effect</th><th>p (one-sided)</th><th>Reason</th></tr>
  ${decisionRow('A/A (same policy twice)', result.aa)}
  ${decisionRow('Injected defect vs honest arm', result.damage)}
</table>
<p class="meta">A/A discordance ${pct(result.aaDiscordance)}: the noise two identical arms carry on this sample.</p>

<h2>Can this sample detect a ${result.power.targetPoints}-point improvement?</h2>
<p>Confirmation size ${result.power.confirmationPairs} pairs reaches ${pct(result.power.atReference)} power at the ${result.power.targetPoints}-point target with all disagreement favouring the candidate; the plan needs 80%.</p>
<table>
  <tr><th>Pairs</th><th>Discordance</th><th>Share favouring candidate</th><th>Power</th></tr>
  ${rows}
</table>
<p class="meta">${result.power.reach80 === null ? 'No sample up to 200 pairs reached 80% under these scenarios.' : `80% first appears at ${result.power.reach80.pairs} pairs with ${pct(result.power.reach80.discordance)} discordance and every discordant pair favouring the candidate.`}</p>

<h2>Stop and scope</h2>
<ul>
  <li>Nothing here edits shipped prompt defaults, the exam, or production.</li>
  <li>Candidate runs never see hidden tests, other cases or credentials; the grader runs from its own copy.</li>
  <li>Unattended paid search is not enabled; it needs the owner's separate approval.</li>
</ul>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Writes the scorecard owner-only: no group or world read, no listener, no upload. */
export function writeScorecard(path: string, result: PilotResult, mode = 0o600): string {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderScorecard(result), { mode });
  return target;
}
