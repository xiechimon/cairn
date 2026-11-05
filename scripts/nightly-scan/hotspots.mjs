const SCAN_EXTENSIONS = /\.(ts|tsx|mjs|js|sh)$/;
const EXCLUDED =
  /(^|\/)(node_modules|dist|drizzle|i18n|locales?|e2e|test|tests|__tests__|fixtures|docs|\.claude|\.github)\/|\.(test|spec)\.|\.d\.ts$/;
const DAY_MS = 86400000;

export function countChanges(logText) {
  const changes = new Map();
  for (const file of logText.split('\n').filter(Boolean))
    changes.set(file, (changes.get(file) ?? 0) + 1);
  return changes;
}

export function rankHotspots({ changes, lineCounts }) {
  return [...changes]
    .filter(([file]) => SCAN_EXTENSIONS.test(file) && !EXCLUDED.test(file))
    .map(([file, count]) => {
      const lines = lineCounts.get(file) ?? 0;
      return { file, changes: count, lines, score: count * lines };
    })
    .filter((entry) => entry.lines > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

export function sliceFor(ranked, date, { pool = 60, size = 5 } = {}) {
  const hot = ranked.slice(0, pool);
  if (hot.length === 0) return [];
  const groups = Math.ceil(hot.length / size);
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  const start = (day % groups) * size;
  return hot.slice(start, start + size).map((entry) => entry.file);
}
