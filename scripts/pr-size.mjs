import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SIZE_LABELS = [
  { name: 'size:XS', max: 9, color: '0e8a16' },
  { name: 'size:S', max: 29, color: '5ebd3e' },
  { name: 'size:M', max: 99, color: 'fbca04' },
  { name: 'size:L', max: 499, color: 'fe7d37' },
  { name: 'size:XL', max: 999, color: 'd93f0b' },
  { name: 'size:XXL', max: Number.POSITIVE_INFINITY, color: 'b60205' },
];

const NOT_COUNTED = [
  /(^|\/)(test|tests|__tests__|e2e)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.test\.py$/,
  /\.snap$/,
  /^docs\/verify\//,
  /^apps\/server\/drizzle\/meta\//,
  /(^|\/)pnpm-lock\.yaml$/,
];

const counted = (path) => !NOT_COUNTED.some((re) => re.test(path));

export function sizeOf(files) {
  const changed = (rows) => rows.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const kept = files.filter((f) => counted(f.filename));
  const lines = kept.length > 0 ? changed(kept) : changed(files);
  const { name, color } = SIZE_LABELS.find((entry) => lines <= entry.max);
  return { lines, label: name, color };
}

export function sizeLabelPlan(files, currentLabels) {
  const { lines, label, color } = sizeOf(files);
  const stale = currentLabels.filter((name) => name.startsWith('size:') && name !== label);
  return { lines, label, color, add: currentLabels.includes(label) ? [] : [label], remove: stale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [filesPath, labelsPath] = process.argv.slice(2);
  const pages = JSON.parse(readFileSync(filesPath, 'utf8'));
  const files = pages.flat();
  const labels = JSON.parse(readFileSync(labelsPath, 'utf8')).map((l) => l.name);
  process.stdout.write(`${JSON.stringify(sizeLabelPlan(files, labels))}\n`);
}
