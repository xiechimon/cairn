import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { matchesGlob, resolve } from 'node:path';

const allowlist = JSON.parse(
  readFileSync(new URL('./public-content-allowlist.json', import.meta.url), 'utf8'),
);
if (!Array.isArray(allowlist) || allowlist.some((path) => typeof path !== 'string' || !path))
  throw new Error('Invalid public-content path allowlist');

const percent = String.raw`\b\d+(?:\.\d+)?\s*%`;
const quota = String.raw`(?:\b(?:usage|quota|limit|remaining|weekly(?:\s+window)?|5[- ]hour(?:\s+window)?)\b|\u989d\u5ea6)`;
const adjacent = String.raw`[^\n;.!?%]{0,24}(?:\r?\n[^\n;.!?%]{0,24})?`;
const quotaPercent = new RegExp(
  `${quota}${adjacent}${percent}|${percent}${adjacent}${quota}`,
  'gi',
);
const reset =
  /\bresets?\s+(?:at\s+(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm)\b|\d{4}-\d{2}-\d{2})|in\s+\d+(?:\.\d+)?\s*(?:s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:ours?|rs?)?|days?)\b)/gi;
const rateLimit =
  /\b(?:x-ratelimit-(?:remaining|limit|reset)\s*[:=]\s*\d|rate[- ]limit\s+(?:status\s*[:=]\s*\S+|(?:remaining|reset|used)\s*[:=]\s*\d|(?:exceeded|exhausted|reached)\b))/gi;
const identifier =
  /\b(?:team|project|machine|thread|build|trace|session)(?:[_ -]?id)?\b(?:["'`\s]*[:=]["'`\s]*|\s+["'`]?)([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/gi;
const idShape =
  /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25}|[A-Za-z0-9_-]{21})$/i;
const rules = [
  ['quota/usage', quotaPercent],
  ['quota/usage', reset],
  ['quota/usage', rateLimit],
  ['identifier', identifier],
];

export function fileViolations(path, content, additions) {
  if (content.includes('\0')) return [];
  const fixture = allowlist.some((pattern) => matchesGlob(path, pattern));
  const starts = [0];
  for (
    let offset = content.indexOf('\n');
    offset !== -1;
    offset = content.indexOf('\n', offset + 1)
  )
    starts.push(offset + 1);
  const lineAt = (offset) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= offset) low = middle;
      else high = middle;
    }
    return low + 1;
  };
  const hits = new Map();
  for (const [kind, pattern] of rules) {
    if (fixture && kind === 'identifier') continue;
    for (const match of content.matchAll(pattern)) {
      if (kind === 'identifier' && !idShape.test(match[1])) continue;
      if (/\n[ \t\r]*\n/.test(match[0])) continue;
      const first = lineAt(match.index);
      const last = lineAt(match.index + match[0].length - 1);
      const lines = Array.from({ length: last - first + 1 }, (_, index) => first + index);
      if (additions && !additions.every((added) => lines.some((line) => added.has(line)))) continue;
      for (const line of lines) {
        if ((!additions || additions[0].has(line)) && !hits.has(line))
          hits.set(line, { line, kind });
      }
    }
  }
  return [...hits.values()].sort((a, b) => a.line - b.line);
}

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

function scanSnapshot(commit, parents = []) {
  const ranges = !commit
    ? [['--cached']]
    : parents.length
      ? parents.map((parent) => [parent, commit])
      : [['--root', commit]];
  const command = commit ? ['diff-tree', '-r', '--no-commit-id'] : ['diff'];
  const options = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'];
  const changedByParent = ranges.map(
    (range) =>
      new Set(
        git(...command, ...options, '--name-only', '-z', '--diff-filter=ACMT', ...range)
          .split('\0')
          .filter(Boolean),
      ),
  );
  const hits = [];
  for (const path of changedByParent[0]) {
    if (!changedByParent.every((changed) => changed.has(path))) continue;
    const additions = ranges.map((range) => {
      const patch = git(...command, ...options, '-p', '--unified=0', ...range, '--', path);
      const added = new Set();
      let line = 0;
      for (const text of patch.split('\n')) {
        const hunk = /^@@ .* \+(\d+)/.exec(text);
        if (hunk) line = Number(hunk[1]);
        else if (line && text.startsWith('+')) added.add(line++);
        else if (line && text.startsWith(' ')) line++;
      }
      return added;
    });
    if (additions.some((added) => !added.size)) continue;
    const content = git('show', commit ? `${commit}:${path}` : `:${path}`);
    for (const hit of fileViolations(path, content, additions))
      hits.push({ path, ...hit, ...(commit ? { commit } : {}) });
  }
  return hits;
}

export function scanDiff({ staged = false, base } = {}) {
  if (staged) return scanSnapshot();
  const ref = base && !/^0{40}$/.test(base) ? base : 'origin/main';
  const ancestor = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
  const commits = git('rev-list', '--reverse', '--parents', 'HEAD', `^${ancestor}`)
    .trim()
    .split('\n')
    .filter(Boolean);
  return commits.flatMap((entry) => {
    const [commit, ...parents] = entry.split(' ');
    const message = git('show', '--no-patch', '--no-notes', '--format=%B', commit);
    return [
      ...fileViolations('<commit message>', message).map((hit) => ({
        path: '<commit message>',
        commit,
        ...hit,
      })),
      ...scanSnapshot(commit, parents),
    ];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = process.argv.slice(2);
    if (
      !(
        args.length === 0 ||
        (args.length === 1 && args[0] === '--staged') ||
        (args.length === 2 && args[0] === '--base' && args[1])
      )
    )
      throw new Error('Usage: public-content-gate.mjs [--staged | --base <ref>]');
    const hits = scanDiff({
      staged: args[0] === '--staged',
      base: args[0] === '--base' ? args[1] : process.env.PREPUSH_BASE_SHA,
    });
    for (const hit of hits)
      console.error(
        `${hit.commit ? `${hit.commit.slice(0, 12)} ` : ''}${JSON.stringify(hit.path)}:${hit.line}: public-content ${hit.kind} disclosure; remove private content or use an approved synthetic fixture path`,
      );
    console.log(`public-content-gate: ${hits.length} offending added line(s)`);
    process.exitCode = hits.length ? 1 : 0;
  } catch {
    console.error(
      'public-content-gate: scan failed; verify arguments, Git base and repository access',
    );
    process.exitCode = 2;
  }
}
