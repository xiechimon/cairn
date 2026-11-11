import { readFileSync, realpathSync } from 'node:fs';
import { matchesGlob } from 'node:path';

const CATEGORIES = ['credentials', 'machineAndCommandBoundary', 'externalEntryAuth'];
const SHA = /^[0-9a-f]{40}$/;
const MARKER = /^Security review \(([0-9a-f]{40})\): (fixed|recorded)$/;

export function securityPatterns(gatePaths) {
  const queue = gatePaths?.humanQueue ?? {};
  return CATEGORIES.flatMap((key) => (Array.isArray(queue[key]) ? queue[key] : []));
}

export function parseNameStatus(text) {
  const files = [];
  for (const line of text.replace(/\n$/, '').split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0] ?? '';
    if (status.startsWith('R') || status.startsWith('C')) {
      files.push({ filename: parts[2] ?? '', previous: parts[1] ?? '' });
    } else {
      files.push({ filename: parts[1] ?? '', previous: null });
    }
  }
  return files;
}

function matches(path, patterns) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    patterns.some((pattern) => matchesGlob(path, pattern))
  );
}

export function touchesSecurity(files, patterns, pathsFileTouched) {
  return (
    pathsFileTouched ||
    files.some((file) => matches(file.filename, patterns) || matches(file.previous, patterns))
  );
}

export function outsideFences(body) {
  return body
    .split('```')
    .filter((_, index) => index % 2 === 0)
    .join('\n');
}

export function dispositionMatches(body, head) {
  return outsideFences(body)
    .split('\n')
    .some((line) => {
      const match = MARKER.exec(line.trim());
      return match?.[1] === head;
    });
}

export function evaluate({ body, nameStatus, head, gatePaths, pathsFileTouched = false }) {
  if (!SHA.test(head)) return { ok: false, reason: 'head sha is not 40 hex' };
  const patterns = securityPatterns(gatePaths);
  if (patterns.length === 0) return { ok: false, reason: 'security surface list is empty' };
  const files = parseNameStatus(nameStatus);
  if (!touchesSecurity(files, patterns, pathsFileTouched))
    return { ok: true, reason: 'no security surface' };
  if (!dispositionMatches(body, head))
    return {
      ok: false,
      reason: `security surface needs a line outside fenced code: Security review (${head}): fixed or Security review (${head}): recorded`,
    };
  return { ok: true, reason: 'security review disposition matches the head' };
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const bodyPath = arg('--body');
  const statusPath = arg('--name-status');
  const pathsPath = arg('--paths');
  const head = arg('--head') ?? '';
  if (!bodyPath || !statusPath || !pathsPath) {
    console.error(
      'usage: security-review-disposition.mjs --body <file> --name-status <file> --head <sha> --paths <merge-gate-paths.json>',
    );
    process.exit(2);
  }
  const nameStatus = readFileSync(statusPath, 'utf8');
  const pathsFileTouched = parseNameStatus(nameStatus).some(
    (file) =>
      file.filename === 'packages/shared/merge-gate-paths.json' ||
      file.previous === 'packages/shared/merge-gate-paths.json',
  );
  const result = evaluate({
    body: readFileSync(bodyPath, 'utf8'),
    nameStatus,
    head,
    gatePaths: JSON.parse(readFileSync(pathsPath, 'utf8')),
    pathsFileTouched,
  });
  console.log(`security-review-disposition: ${result.ok ? 'GREEN' : 'FAIL'} ${result.reason}`);
  process.exit(result.ok ? 0 : 1);
}
