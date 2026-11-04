import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DESTINATIONS = new Set(['phase-2', 'phase-3', 'hold', 'existing-executors', 'close']);
const CLOSE_GRACE_DAYS = 7;
const DAY_MS = 86400000;

export function manifestIssues(filesByName) {
  const byEpic = {};
  for (const [name, text] of Object.entries(filesByName)) {
    const manifest = JSON.parse(text);
    const issues = manifest.items ? manifest.items.map((item) => item.issue) : manifest.issues;
    byEpic[manifest.epic ?? name.replace(/\.json$/, '')] = issues ?? [];
  }
  return byEpic;
}

function destinationProblem(entry, manifests) {
  const destination = entry?.destination;
  if (DESTINATIONS.has(destination)) return null;
  if (typeof destination === 'string' && destination.startsWith('batch:')) {
    return destination.slice('batch:'.length) in manifests
      ? null
      : `no manifest named ${destination.slice('batch:'.length)}`;
  }
  return `unknown destination ${JSON.stringify(destination)}`;
}

export function evaluateCoverage({ open, manifests, coverage, today }) {
  const inManifest = new Set(Object.values(manifests).flat());
  const openNumbers = new Set(open.map((issue) => issue.number));
  const report = { uncovered: [], badDestination: [], staleClose: [], prunable: [] };
  for (const issue of open) {
    if (inManifest.has(issue.number)) continue;
    const entry = coverage[issue.number];
    if (!entry) {
      report.uncovered.push(issue);
      continue;
    }
    const problem = destinationProblem(entry, manifests);
    if (problem) {
      report.badDestination.push({ ...issue, problem });
      continue;
    }
    if (entry.destination !== 'close') continue;
    const since = Date.parse(entry.since ?? '');
    if (Number.isNaN(since) || Date.parse(today) - since >= CLOSE_GRACE_DAYS * DAY_MS)
      report.staleClose.push(issue);
  }
  report.prunable = Object.keys(coverage)
    .map(Number)
    .filter((number) => !openNumbers.has(number));
  report.ok =
    report.uncovered.length + report.badDestination.length + report.staleClose.length === 0;
  return report;
}

export function renderReport(report) {
  const lines = [];
  const list = (title, issues, detail = () => '') => {
    if (issues.length === 0) return;
    lines.push(`${title}:`);
    for (const issue of issues) lines.push(`- #${issue.number} ${issue.title}${detail(issue)}`);
  };
  list('Open issues with no destination', report.uncovered);
  list('Open issues with an invalid destination', report.badDestination, (i) => ` (${i.problem})`);
  list('Issues marked close and still open after 7 days', report.staleClose);
  if (report.prunable.length > 0)
    lines.push(
      `Coverage entries for issues no longer open: ${report.prunable.map((n) => `#${n}`).join(', ')}`,
    );
  if (lines.length === 0) lines.push('Every open issue has a destination.');
  return lines.join('\n');
}

function readManifests(dir) {
  const files = {};
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json')))
    files[name] = readFileSync(join(dir, name), 'utf8');
  return manifestIssues(files);
}

function listOpenIssues() {
  const out = execFileSync(
    'gh',
    ['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(import.meta.dirname, '..');
  const coverage = JSON.parse(readFileSync(join(root, 'docs/ops/issue-coverage.json'), 'utf8'));
  const report = evaluateCoverage({
    open: listOpenIssues(),
    manifests: readManifests(join(root, '.claude/epics')),
    coverage: coverage.issues,
    today: new Date().toISOString().slice(0, 10),
  });
  const text = renderReport(report);
  console.log(text);
  process.exit(report.ok ? 0 : 1);
}
