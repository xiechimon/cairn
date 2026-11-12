import { execFileSync } from 'node:child_process';
import { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIZE_LABELS = [
  { name: 'size:XS', max: 9, color: '0e8a16' },
  { name: 'size:S', max: 29, color: '5ebd3e' },
  { name: 'size:M', max: 99, color: 'fbca04' },
  { name: 'size:L', max: 499, color: 'fe7d37' },
  { name: 'size:XL', max: 999, color: 'd93f0b' },
  { name: 'size:XXL', max: Number.POSITIVE_INFINITY, color: 'b60205' },
];

export const SIZE_CAP = 3000;
export const SIZE_CHECK = 'pr-size';
const MERGE_QUEUE_PREFIX = 'mergify/merge-queue/';
const TOP_CONTRIBUTORS = 10;

export const GENERATED_PATHS = [
  'docs/feature-map.md',
  '.claude/skills/verify-cairn/feature-map.md',
  '.mergify.yml',
  '**/pnpm-lock.yaml',
  '**/*.snap',
  '**/*-snapshots/**',
  'apps/server/drizzle/meta/**',
  'docs/verify/**',
];

const TEST_PATHS = [
  /(^|\/)(test|tests|__tests__|e2e)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.test\.py$/,
];

const isGenerated = (path) => GENERATED_PATHS.some((glob) => matchesGlob(path, glob));
const isTest = (path) => TEST_PATHS.some((re) => re.test(path));
export const countsTowardSize = (path) => !isGenerated(path) && !isTest(path);
const changedLines = (file) => file.additions + file.deletions;
const sum = (rows) => rows.reduce((total, file) => total + changedLines(file), 0);

export function sizeOf(files) {
  const kept = files.filter((f) => countsTowardSize(f.filename));
  const lines = kept.length > 0 ? sum(kept) : sum(files);
  const { name, color } = SIZE_LABELS.find((entry) => lines <= entry.max);
  return { lines, label: name, color };
}

export function sizeLabelPlan(files, currentLabels) {
  const { lines, label, color } = sizeOf(files);
  const stale = currentLabels.filter((name) => name.startsWith('size:') && name !== label);
  return { lines, label, color, add: currentLabels.includes(label) ? [] : [label], remove: stale };
}

export function sizeCap(files) {
  const counted = files.filter((f) => !isGenerated(f.filename));
  const lines = sum(counted);
  const top = counted
    .map((f) => ({ filename: f.filename, lines: changedLines(f) }))
    .sort((a, b) => b.lines - a.lines || a.filename.localeCompare(b.filename))
    .slice(0, TOP_CONTRIBUTORS);
  return { lines, limit: SIZE_CAP, over: lines > SIZE_CAP, top };
}

export function capReport(cap) {
  if (!cap.over)
    return {
      conclusion: 'success',
      title: `${cap.lines} changed lines (cap ${cap.limit})`,
      summary: `${cap.lines} non-generated changed lines; the cap is ${cap.limit}.`,
    };
  const rows = cap.top.map((row) => `| ${row.lines} | \`${row.filename}\` |`);
  return {
    conclusion: 'failure',
    title: `${cap.lines} changed lines exceed the ${cap.limit}-line cap`,
    summary: [
      `${cap.lines} non-generated changed lines exceed the ${cap.limit}-line cap. Split the PR into independent changes off main.`,
      '',
      `Generated paths left out: ${GENERATED_PATHS.map((glob) => `\`${glob}\``).join(', ')}`,
      '',
      '| Changed lines | Largest contributors |',
      '|---:|---|',
      ...rows,
    ].join('\n'),
  };
}

const gh = (args, input) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
const ghJson = (args) => JSON.parse(gh(args));
const ghWrite = (method, path, payload) =>
  gh(['api', '--method', method, path, '--input', '-'], JSON.stringify(payload));

function reportPull(repo, pull) {
  const files = ghJson([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo}/pulls/${pull.number}/files?per_page=100`,
  ]).flat();
  const labels = ghJson(['api', `repos/${repo}/issues/${pull.number}/labels`]).map((l) => l.name);
  const plan = sizeLabelPlan(files, labels);
  for (const name of plan.remove)
    gh([
      'api',
      '--method',
      'DELETE',
      `repos/${repo}/issues/${pull.number}/labels/${encodeURIComponent(name)}`,
    ]);
  for (const name of plan.add) {
    gh([
      'label',
      'create',
      name,
      '--repo',
      repo,
      '--color',
      plan.color,
      '--description',
      'Changed lines, tests and generated files left out (context only)',
      '--force',
    ]);
    ghWrite('POST', `repos/${repo}/issues/${pull.number}/labels`, { labels: [name] });
  }
  const report = capReport(sizeCap(files));
  ghWrite('POST', `repos/${repo}/check-runs`, {
    name: SIZE_CHECK,
    head_sha: pull.head.sha,
    status: 'completed',
    conclusion: report.conclusion,
    output: { title: report.title, summary: report.summary },
  });
  console.log(`#${pull.number} ${pull.head.sha.slice(0, 9)}: ${report.conclusion} ${report.title}`);
}

export function report(repo, number) {
  const pulls = number
    ? [ghJson(['api', `repos/${repo}/pulls/${number}`])]
    : ghJson([
        'api',
        '--paginate',
        '--slurp',
        `repos/${repo}/pulls?state=open&per_page=100`,
      ]).flat();
  for (const pull of pulls)
    if (pull.state === 'open' && !pull.head.ref.startsWith(MERGE_QUEUE_PREFIX))
      reportPull(repo, pull);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, repo, number] = process.argv.slice(2);
  if (command !== 'report' || !repo) throw new Error('usage: pr-size.mjs report <owner/repo> [pr]');
  report(repo, number);
}
