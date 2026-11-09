import { readFileSync } from 'node:fs';
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
const changedLines = (file) => file.additions + file.deletions;
const sum = (rows) => rows.reduce((total, file) => total + changedLines(file), 0);

export function sizeOf(files) {
  const kept = files.filter((f) => !isGenerated(f.filename) && !isTest(f.filename));
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

function capReport(cap) {
  if (!cap.over) return `pr-size: ${cap.lines} non-generated changed lines (cap ${cap.limit})\n`;
  const rows = cap.top.map((row) => `  ${String(row.lines).padStart(6)}  ${row.filename}`);
  return [
    `pr-size: ${cap.lines} non-generated changed lines exceed the ${cap.limit}-line cap. Split the PR into independent changes off main.`,
    `Generated paths left out: ${GENERATED_PATHS.join(', ')}`,
    'Largest contributors:',
    ...rows,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const readFiles = (path) => JSON.parse(readFileSync(path, 'utf8')).flat();
  if (args[0] === 'cap') {
    const cap = sizeCap(readFiles(args[1]));
    process.stdout.write(capReport(cap));
    process.exitCode = cap.over ? 1 : 0;
  } else {
    const [filesPath, labelsPath] = args;
    const labels = JSON.parse(readFileSync(labelsPath, 'utf8')).map((l) => l.name);
    process.stdout.write(`${JSON.stringify(sizeLabelPlan(readFiles(filesPath), labels))}\n`);
  }
}
