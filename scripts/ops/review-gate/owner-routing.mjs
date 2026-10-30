import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../../.claude/workflows/pr-gate.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('const AUTO_MERGE = [');
const end = source.indexOf('const FILES_CMD =');
if (start < 0 || end <= start)
  throw new Error('Cannot load the standalone workflow routing policy');
const policy = new Function(
  `${source.slice(start, end)}; return { ownerRouting, isProtected, globToRegExp };`,
)();
export const { ownerRouting, isProtected, globToRegExp } = policy;
