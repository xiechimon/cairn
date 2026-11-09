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
const quotaPercent = new RegExp(
  `${quota}[^\\n;.!?%]{0,24}${percent}|${percent}[^\\n;.!?%]{0,24}${quota}`,
  'i',
);
const reset =
  /\bresets?\s+(?:at\s+(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm)\b|\d{4}-\d{2}-\d{2})|in\s+\d+(?:\.\d+)?\s*(?:s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:ours?|rs?)?|days?)\b)/i;
const rateLimit =
  /\b(?:x-ratelimit-(?:remaining|limit|reset)\s*[:=]\s*\d|rate[- ]limit\s+(?:status\s*[:=]\s*\S+|(?:remaining|reset|used)\s*[:=]\s*\d|(?:exceeded|exhausted|reached)\b))/i;
const identifier =
  /\b(?:team|project|machine|thread|build|trace|session)(?:[_ -]?id)?\b(?:["'`\s]*[:=]["'`\s]*|\s+["'`]?)([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/gi;
const idShape =
  /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-7][0-9A-HJKMNP-TV-Z]{25}|[A-Za-z0-9_-]{21})$/i;

export function fileViolations(path, content) {
  if (content.includes('\0')) return [];
  const fixture = allowlist.some((pattern) => matchesGlob(path, pattern));
  return content.split('\n').flatMap((text, index) => {
    const kind =
      quotaPercent.test(text) || reset.test(text) || rateLimit.test(text)
        ? 'quota/usage'
        : !fixture && [...text.matchAll(identifier)].some((match) => idShape.test(match[1]))
          ? 'identifier'
          : null;
    return kind ? [{ line: index + 1, kind }] : [];
  });
}

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

export function scanDiff({ staged = false, base } = {}) {
  const ancestor = staged
    ? null
    : git('merge-base', 'HEAD', base && !/^0{40}$/.test(base) ? base : 'origin/main').trim();
  const range = staged ? ['--cached'] : [ancestor, 'HEAD'];
  const files = git('diff', '--no-renames', '--name-only', '-z', '--diff-filter=ACMT', ...range)
    .split('\0')
    .filter(Boolean);
  const hits = [];
  for (const path of files) {
    const patch = git(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--unified=0',
      ...range,
      '--',
      path,
    );
    const added = new Set();
    let line = 0;
    for (const text of patch.split('\n')) {
      const hunk = /^@@ .* \+(\d+)/.exec(text);
      if (hunk) line = Number(hunk[1]);
      else if (line && text.startsWith('+')) added.add(line++);
      else if (line && text.startsWith(' ')) line++;
    }
    if (!added.size) continue;
    const content = git('show', staged ? `:${path}` : `HEAD:${path}`);
    for (const hit of fileViolations(path, content)) {
      if (added.has(hit.line)) hits.push({ path, ...hit });
    }
  }
  return hits;
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
        `${JSON.stringify(hit.path)}:${hit.line}: public-content ${hit.kind} disclosure; remove private content or use an approved synthetic fixture path`,
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
