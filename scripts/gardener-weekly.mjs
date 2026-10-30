#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { countMetric, METRICS } from './baseline-ledger.mjs';
import { collectDocDrift, renderDriftSection } from './doc-drift.mjs';

const WINDOW_DAYS = 7;
const MIN_NEW_SITES = 3;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SOURCE_TS = /^(apps|packages)\/.*\.tsx?$/;

export const PATTERNS = [
  {
    id: 'double-cast',
    label: '`as unknown as` double casts',
    regex: String.raw`\bas unknown as\b`,
    scope: SOURCE_TS,
    suggestedRule:
      'Biome GritQL plugin rejecting `as unknown as` outside an explicit allowlist; fix by narrowing with a type guard or fixing the producing type',
  },
  {
    id: 'wait-for-timeout',
    label: 'fixed-delay `waitForTimeout(` in e2e',
    regex: String.raw`\bwaitForTimeout\(`,
    scope: /^(apps\/web\/e2e|integration)\//,
    suggestedRule:
      'Biome GritQL plugin rejecting `waitForTimeout(` under apps/web/e2e and integration; wait on a locator, `expect.poll`, or an event instead',
  },
  {
    id: 'inline-import',
    label: 'inline `import()` expressions',
    regex: String.raw`(^|[^\w.])import\(`,
    scope: SOURCE_TS,
    suggestedRule:
      'Biome GritQL plugin rejecting `import(` call expressions and `import("pkg").Type` (AGENTS.md: top-level imports only)',
  },
  {
    id: 'skipped-test',
    label: 'skipped or fixme tests',
    regex: String.raw`\b(test|it|describe)\.(skip|fixme)\b`,
    scope: /^(apps|packages|integration)\/.*\.[cm]?[jt]sx?$/,
    suggestedRule: 'enable Biome `suspicious/noSkippedTests` at error level',
  },
  {
    id: 'ts-suppress',
    label: '`@ts-ignore` / `@ts-expect-error`',
    regex: String.raw`@ts-(ignore|expect-error)\b`,
    scope: SOURCE_TS,
    gate: 'Biome suspicious/noTsIgnore, held at its warning cap by lint-warning-cap.mjs',
  },
  {
    id: 'explicit-any',
    label: 'explicit `any`',
    regex: String.raw`(:\s*any\b|\bas any\b|<any>)`,
    scope: SOURCE_TS,
    gate: 'Biome suspicious/noExplicitAny, held at its warning cap by lint-warning-cap.mjs',
  },
];

export function rankBaselines(rows) {
  const by = (primary, secondary) =>
    [...rows].sort((a, b) => b[primary] - a[primary] || b[secondary] - a[secondary]);
  return { byGrowth: by('delta', 'count'), byStock: by('count', 'delta') };
}

export function findCandidates(addedLines) {
  return PATTERNS.filter((pattern) => !pattern.gate).flatMap((pattern) => {
    const regex = new RegExp(pattern.regex);
    const sites = addedLines
      .filter(({ path, text }) => pattern.scope.test(path) && regex.test(text))
      .map(({ path, line }) => `${path}:${line}`);
    return sites.length >= MIN_NEW_SITES ? [{ pattern, sites }] : [];
  });
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const option = (name) => {
      const at = args.indexOf(name);
      return at === -1 ? undefined : args[at + 1];
    };
    const now = new Date(option('--now') ?? Date.now());
    const outDir = option('--out') ?? '.gardener';
    const withDrift = args.includes('--drift');
    const git = (...gitArgs) =>
      execFileSync('git', gitArgs, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    if (git('rev-parse', '--is-shallow-repository').trim() === 'true')
      throw new Error('shallow clone: the 7-day history is incomplete; fetch with --unshallow');

    const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString();
    const startCommit = git('rev-list', '-1', `--before=${windowStart}`, 'HEAD').trim();
    const rows = METRICS.map((metric) => {
      let before = 0;
      if (startCommit) {
        try {
          before = countMetric(metric, git('show', `${startCommit}:${metric.file}`));
        } catch {}
      }
      const count = countMetric(metric, readFileSync(metric.file, 'utf8'));
      return { ...metric, count, delta: count - before };
    });
    const { byGrowth, byStock } = rankBaselines(rows);
    const line = (row, rank) => `${rank + 1}. ${row.id} | ${row.count} | ${signed(row.delta)}`;
    const target =
      byGrowth.find((row) => row.delta > 0) ?? byStock.find((row) => row.count > 0) ?? null;

    const added = [];
    let path = null;
    let lineNo = 0;
    for (const patch of git(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--unified=0',
      startCommit || EMPTY_TREE,
      'HEAD',
      '--',
      'apps',
      'packages',
      'integration',
    ).split('\n')) {
      const file = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/.exec(patch);
      const hunk = /^@@ .* \+(\d+)/.exec(patch);
      if (file) path = file[1] ?? null;
      else if (hunk) lineNo = Number(hunk[1]);
      else if (path && patch.startsWith('+')) added.push({ path, line: lineNo++, text: patch });
    }
    const candidates = findCandidates(added);

    const report = [
      `# Gardener weekly sweep ${now.toISOString().slice(0, 10)}`,
      '',
      `Window: ${WINDOW_DAYS} days since ${windowStart}. Format: rank. category | count | ${WINDOW_DAYS}d change.`,
      '',
      '## By growth',
      ...byGrowth.map(line),
      '',
      '## By stock',
      ...byStock.map(line),
      '',
      `Next target: ${target ? `${target.id} (${target.count}, ${signed(target.delta)})` : 'none'}`,
      'Cleanup PR dispatch: not run; it waits on the autonomous merge loop (#1405 P4).',
      '',
      '## Candidate tickets',
      ...(candidates.length === 0
        ? [`none: no ungated pattern was added ${MIN_NEW_SITES}+ times in the window`]
        : candidates.flatMap(({ pattern, sites }) => [
            `### ${pattern.id}`,
            `Title: gardener: ${sites.length} new ${pattern.label} in ${WINDOW_DAYS} days, no gate covers them`,
            `Locations: ${sites.slice(0, 10).join(', ')}${sites.length > 10 ? `, +${sites.length - 10} more` : ''}`,
            `Suggested lint rule: ${pattern.suggestedRule}`,
            'Status: candidate only, not filed',
            '',
          ])),
      '',
    ].join('\n');

    const drift = withDrift ? collectDocDrift() : null;
    const summary = drift ? report + renderDriftSection(drift) : report;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `weekly-${now.toISOString().slice(0, 10)}.md`), summary);
    if (drift) {
      writeFileSync(
        join(outDir, `drift-${now.toISOString().slice(0, 10)}.json`),
        JSON.stringify(drift.rows, null, 2),
      );
    }
    process.stdout.write(summary);
  } catch (error) {
    console.error(`gardener-weekly: ${error.message}`);
    process.exitCode = 2;
  }
}
