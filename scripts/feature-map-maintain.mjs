#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ISSUE_TITLE = 'chore: feature-map maintain failed';
export const ISSUE_MARKER = '<!-- feature-map-maintain -->';
export const ISSUE_LABELS = ['documentation', 'batch:next', 'by:cairn'];
export const FEATURES_DIR_REL = '.claude/skills/verify-cairn/features';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const GENERATE_SCRIPT = join(REPO_ROOT, 'scripts', 'generate-feature-map.mjs');

export function parseArgs(argv) {
  const args = { fileIssue: false, dryRun: false, help: false };
  for (const a of argv) {
    if (a === '--file-issue') args.fileIssue = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

export function checkVerifyFeaturesIndex(featuresDir = join(REPO_ROOT, FEATURES_DIR_REL)) {
  const findings = [];
  let entries;
  try {
    entries = readdirSync(featuresDir, { withFileTypes: true });
  } catch (error) {
    return {
      id: 'verify-features-index',
      ok: false,
      summary: `cannot read ${FEATURES_DIR_REL}: ${error.message}`,
      findings: [error.message],
    };
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
  const featureFiles = files.filter((name) => name !== 'README.md');
  if (!files.includes('README.md')) {
    return {
      id: 'verify-features-index',
      ok: false,
      summary: `${FEATURES_DIR_REL}/README.md is missing`,
      findings: ['README.md missing'],
    };
  }
  const readme = readFileSync(join(featuresDir, 'README.md'), 'utf8');
  const linked = new Set();
  for (const match of readme.matchAll(/\[[^\]]*\]\(\.\/([^)#]+\.md)\)/g)) linked.add(match[1]);
  for (const name of featureFiles) {
    if (!linked.has(name)) findings.push(`README.md does not link ./${name}`);
  }
  for (const name of [...linked].sort()) {
    if (name === 'README.md') continue;
    if (!featureFiles.includes(name))
      findings.push(`README.md links ./${name} but the file is missing`);
  }
  return {
    id: 'verify-features-index',
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `${featureFiles.length} feature files indexed in README.md`
        : `${findings.length} verify-cairn features index gap(s)`,
    findings,
  };
}

export function runFeatureMapCheck({
  spawn = spawnSync,
  scriptPath = GENERATE_SCRIPT,
  env = process.env,
} = {}) {
  const result = spawn(process.execPath, [scriptPath, '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error) {
    return {
      id: 'feature-map',
      ok: false,
      summary: `generate-feature-map failed to start: ${result.error.message}`,
      findings: [result.error.message],
      output,
    };
  }
  const ok = result.status === 0;
  return {
    id: 'feature-map',
    ok,
    summary: ok
      ? 'the feature registry, the code and both generated maps agree'
      : 'the feature registry or a generated map drifted from the code',
    findings: ok ? [] : [output || `exit ${result.status}`],
    output,
  };
}

export function aggregateChecks(checks) {
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    checks,
    failed,
    report: renderReport(checks),
  };
}

export function renderReport(checks) {
  const lines = ['# Feature-map maintain report', ''];
  for (const check of checks) {
    lines.push(`## ${check.id}: ${check.ok ? 'ok' : 'FAIL'}`);
    lines.push(check.summary);
    for (const finding of check.findings ?? []) lines.push(`- ${finding}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function buildIssueBody({ report, runUrl }) {
  const lines = [
    ISSUE_MARKER,
    '',
    'Daily feature-map maintain found a gap. `.claude/skills/verify-cairn/feature-map.json` is the feature registry, rendered to `.claude/skills/verify-cairn/feature-map.md` and `docs/feature-map.md`; `.claude/skills/verify-cairn/features/` holds the drive recipes. See `docs/ops/feature-map-maintain.md`.',
    '',
    '```',
    report.trimEnd(),
    '```',
    '',
  ];
  if (runUrl) lines.push(`Workflow run: ${runUrl}`, '');
  lines.push(
    'Suggested fix for feature-map drift: fix the registry rows the check names, run `node scripts/generate-feature-map.mjs`, and open a PR.',
    'Suggested fix for verify-cairn index gaps: update `features/README.md` or restore the missing feature file; do not edit product code to silence the check.',
  );
  return lines.join('\n');
}

export function decideIssueAction({ openIssues, title = ISSUE_TITLE }) {
  const existing = openIssues.find((issue) => issue.title === title);
  if (existing) return { action: 'comment', number: existing.number };
  return { action: 'create', title, labels: ISSUE_LABELS };
}

function ghJson(args, { dryRun, spawn }) {
  if (dryRun) return null;
  const result = spawn('gh', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim() || `exit ${result.status}`;
    throw new Error(`gh ${args[0]} failed: ${detail}`);
  }
  const text = (result.stdout ?? '').trim();
  return text ? JSON.parse(text) : null;
}

function openMaintainIssues({ spawn, listOpenIssues }) {
  return (
    listOpenIssues?.() ??
    ghJson(
      [
        'issue',
        'list',
        '--state',
        'open',
        '--search',
        `in:title "${ISSUE_TITLE}"`,
        '--json',
        'number,title',
        '--limit',
        '20',
      ],
      { dryRun: false, spawn },
    ) ??
    []
  );
}

export function closeMaintainIssues({ runUrl, spawn = spawnSync, listOpenIssues } = {}) {
  const closed = [];
  for (const issue of openMaintainIssues({ spawn, listOpenIssues })) {
    if (issue.title !== ISSUE_TITLE) continue;
    const comment = `Feature-map maintain passed${runUrl ? ` on ${runUrl}` : ''}; closing. The next failure opens a new issue.`;
    const result = spawn(
      'gh',
      ['issue', 'close', String(issue.number), '--reason', 'completed', '--comment', comment],
      { cwd: REPO_ROOT, encoding: 'utf8', env: process.env },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `gh issue close #${issue.number} failed: ${(result.stderr ?? result.stdout ?? '').trim() || result.status}`,
      );
    closed.push(issue.number);
  }
  return closed;
}

export function fileMaintainIssue({
  report,
  runUrl,
  dryRun = false,
  spawn = spawnSync,
  listOpenIssues,
} = {}) {
  const body = buildIssueBody({ report, runUrl });
  const openIssues = openMaintainIssues({ spawn, listOpenIssues });
  const decision = decideIssueAction({ openIssues });
  if (dryRun) {
    return { ...decision, dryRun: true, body };
  }
  if (decision.action === 'comment') {
    const result = spawn('gh', ['issue', 'comment', String(decision.number), '--body', body], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `gh issue comment failed: ${(result.stderr ?? result.stdout ?? '').trim() || result.status}`,
      );
    }
    return { ...decision, url: (result.stdout ?? '').trim() };
  }
  const result = spawn(
    'gh',
    [
      'issue',
      'create',
      '--title',
      decision.title,
      '--body',
      body,
      ...decision.labels.flatMap((label) => ['--label', label]),
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim() || `exit ${result.status}`;
    throw new Error(
      `gh issue create failed (${detail}). Check that the workflow has issues: write and that labels ${ISSUE_LABELS.join(', ')} exist. No extra secret is required for github.token issue filing.`,
    );
  }
  return { ...decision, url: (result.stdout ?? '').trim() };
}

export function runMaintain(args, deps = {}) {
  const checks = [];
  checks.push(deps.runFeatureMapCheck?.() ?? runFeatureMapCheck(deps));
  checks.push(deps.checkVerifyFeaturesIndex?.() ?? checkVerifyFeaturesIndex(deps.featuresDir));
  const aggregated = aggregateChecks(checks);
  process.stdout.write(aggregated.report);
  const runUrl =
    process.env.GITHUB_RUN_URL ||
    (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined);
  if (aggregated.ok && args.fileIssue && !args.dryRun) {
    try {
      const closed = closeMaintainIssues({
        runUrl,
        spawn: deps.spawn,
        listOpenIssues: deps.listOpenIssues,
      });
      for (const number of closed)
        process.stdout.write(`feature-map-maintain: closed #${number}\n`);
    } catch (error) {
      process.stderr.write(
        `feature-map-maintain: could not close the open issue: ${error.message}\n`,
      );
    }
  }
  if (!aggregated.ok && args.fileIssue) {
    try {
      const filed = fileMaintainIssue({
        report: aggregated.report,
        runUrl,
        dryRun: args.dryRun,
        spawn: deps.spawn,
        listOpenIssues: deps.listOpenIssues,
      });
      if (filed.dryRun) {
        process.stdout.write(
          `feature-map-maintain: dry-run would ${filed.action}${filed.number ? ` #${filed.number}` : ''} issue\n`,
        );
      } else if (filed.action === 'comment') {
        process.stdout.write(`feature-map-maintain: commented on #${filed.number}\n`);
      } else {
        process.stdout.write(`feature-map-maintain: opened ${filed.url || 'issue'}\n`);
      }
    } catch (error) {
      process.stderr.write(`feature-map-maintain: issue filing stub/failure: ${error.message}\n`);
      process.stderr.write(
        'feature-map-maintain: checks still failed; fix GH permissions (issues: write) or missing labels. No FEATURE_MAP_* secret is required for issue create with github.token.\n',
      );
    }
  }
  return aggregated;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(
        'usage: node scripts/feature-map-maintain.mjs [--file-issue] [--dry-run]\n',
      );
      process.exit(0);
    }
    const aggregated = runMaintain(args);
    process.exit(aggregated.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`feature-map-maintain: ${error.message}\n`);
    process.exit(2);
  }
}
