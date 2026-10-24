const entryCount = (json) => json.length;

export const METRICS = [
  {
    id: 'lint-warning/warnings',
    file: 'scripts/lint-warning-baseline.json',
    ratchet: true,
    count: (json) => json.maxWarnings,
  },
  {
    id: 'ui-debt/per-face-css-lines',
    file: 'scripts/ui-debt-baseline.json',
    ratchet: true,
    count: (json) => Object.values(json.perFaceCss).reduce((sum, lines) => sum + lines, 0),
  },
  {
    id: 'ui-debt/bare-controls',
    file: 'scripts/ui-debt-baseline.json',
    ratchet: true,
    count: (json) => json.rawControls.total,
  },
  {
    id: 'ui-debt/arbitrary-text',
    file: 'scripts/ui-debt-baseline.json',
    ratchet: true,
    count: (json) => json.arbitraryValues.textTotal,
  },
  {
    id: 'ui-debt/arbitrary-spacing',
    file: 'scripts/ui-debt-baseline.json',
    ratchet: true,
    count: (json) => json.arbitraryValues.spacingTotal,
  },
  {
    id: 'feature-map-staleness/entries',
    file: 'scripts/feature-map-staleness-baseline.json',
    ratchet: true,
    count: (json) => json.entries.length,
  },
  {
    id: 'comment-discipline-allowlist/entries',
    file: 'scripts/comment-discipline-allowlist.json',
    ratchet: false,
    count: entryCount,
  },
  {
    id: 'single-use-helper-allowlist/entries',
    file: 'scripts/single-use-helper-allowlist.json',
    ratchet: false,
    count: entryCount,
  },
];

export function countMetric(metric, text) {
  const count = metric.count(JSON.parse(text));
  if (!Number.isInteger(count) || count < 0)
    throw new Error(`${metric.id}: ${metric.file} did not yield a non-negative integer`);
  return count;
}
