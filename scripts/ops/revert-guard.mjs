#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { scrubGitEnv } from '../scrub-git-env.mjs';

export const LOOKBACK_COMMITS = 50;

const FOUND = 1;
const COULD_NOT_RUN = 2;
const BUFFER = 64 * 1024 * 1024;
const PATH_CHUNK_SIZE = 200;
const MIN_REASON_CHARS = 10;
const HOLLOW_REASONS = new Set([
  'none',
  'n/a',
  'na',
  'ok',
  'todo',
  'fix',
  'revert',
  'intentional',
  'requested',
  'yes',
  'true',
]);

function git(cwd, args) {
  return execFileSync(
    'git',
    ['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=utf-8', ...args],
    {
      cwd,
      env: scrubGitEnv({ ...process.env }),
      encoding: 'utf8',
      maxBuffer: BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function isSafeDeclaredPath(filePath) {
  if (!filePath || filePath === '.' || filePath === '..') return false;
  if (filePath.startsWith('/') || filePath.startsWith('../')) return false;
  return !/[*?[\]]/.test(filePath);
}

function isMeaningfulReason(reason) {
  const trimmed = reason.trim();
  if (trimmed.length < MIN_REASON_CHARS) return false;
  if (!/\S+\s+\S+/.test(trimmed)) return false;
  return !HOLLOW_REASONS.has(trimmed.toLowerCase());
}

export function parseDeclaredReverts(messages) {
  const revertedCommits = new Set();
  const declaredPaths = new Map();
  for (const message of messages) {
    for (const rawLine of message.split(/\r?\n/)) {
      const line = rawLine.trim();
      const commitMatch = /^This reverts commit ([0-9a-f]{7,40})\b/i.exec(line);
      if (commitMatch) {
        revertedCommits.add(commitMatch[1].toLowerCase());
        continue;
      }
      const pathMatch = /^Revert-landed:\s+(\S+)\s+-\s+(.+)$/i.exec(line);
      if (pathMatch && isSafeDeclaredPath(pathMatch[1]) && isMeaningfulReason(pathMatch[2])) {
        declaredPaths.set(pathMatch[1], pathMatch[2].trim());
      }
    }
  }
  return { revertedCommits, declaredPaths };
}

function parseRawEntry(metaLine, filePath) {
  const fields = metaLine.slice(1).split(/\s+/);
  if (fields.length < 5 || !filePath) return null;
  const status = fields[4][0];
  return {
    path: filePath,
    status,
    oldOid: status === 'A' ? null : fields[2],
    newOid: status === 'D' ? null : fields[3],
  };
}

function parseDiffRaw(raw) {
  const tokens = raw.split('\0');
  const entries = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const metaLine = tokens[index].replace(/^\n+/, '');
    if (!metaLine.startsWith(':')) continue;
    const entry = parseRawEntry(metaLine, tokens[index + 1]);
    if (entry && entry.oldOid !== entry.newOid) entries.push(entry);
  }
  return entries;
}

function parseLogRaw(raw) {
  const tokens = raw.split('\0');
  const commits = [];
  let current = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('COMMIT:')) {
      const sha = token.slice(7);
      const parents = tokens[++index] ?? '';
      const subject = tokens[++index] ?? '';
      current = { sha, hasParents: parents.trim().length > 0, subject, entries: [] };
      commits.push(current);
      continue;
    }
    const metaLine = token.replace(/^\n+/, '');
    if (metaLine.startsWith(':') && current) {
      const entry = parseRawEntry(metaLine, tokens[++index]);
      if (entry && current.hasParents) current.entries.push(entry);
    }
  }
  return commits;
}

function historyRange(cwd, base, lookback) {
  const ancestors = git(cwd, ['rev-list', '--first-parent', '-n', String(lookback), base])
    .trim()
    .split('\n')
    .filter(Boolean);
  if (ancestors.length === 0) return null;
  const oldest = ancestors[ancestors.length - 1];
  try {
    const parent = git(cwd, ['rev-parse', '--verify', `${oldest}^`]).trim();
    return `${parent}..${base}`;
  } catch {
    return base;
  }
}

function collectPathHistory(cwd, range, paths) {
  const byPath = new Map();
  for (let start = 0; start < paths.length; start += PATH_CHUNK_SIZE) {
    const chunk = paths.slice(start, start + PATH_CHUNK_SIZE);
    const raw = git(cwd, [
      'log',
      '--first-parent',
      '-m',
      '--no-ext-diff',
      '--abbrev=40',
      '--format=%x00COMMIT:%H%x00%P%x00%s',
      '--raw',
      '--no-renames',
      '-z',
      range,
      '--',
      ...chunk,
    ]);
    for (const commit of parseLogRaw(raw)) {
      for (const entry of commit.entries) {
        let list = byPath.get(entry.path);
        if (!list) {
          list = [];
          byPath.set(entry.path, list);
        }
        list.push({
          sha: commit.sha,
          subject: commit.subject,
          oldOid: entry.oldOid,
          newOid: entry.newOid,
        });
      }
    }
  }
  return byPath;
}

function revertKind(changed) {
  if (changed.newOid === null) return 'deleted-added-file';
  if (changed.oldOid === null) return 'restored-deleted-file';
  return 'reverted-file-content';
}

function isDeclared(finding, declarations) {
  if (declarations.declaredPaths.has(finding.path)) return true;
  for (const prefix of declarations.revertedCommits) {
    if (finding.revertedCommit.startsWith(prefix)) return true;
  }
  return false;
}

function formatFailureMessage(findings, mainRef) {
  const lines = [
    `undeclared revert of recently landed work on ${mainRef} (often caused by a stale tree after git reset --soft or merge):`,
  ];
  for (const finding of findings) {
    lines.push(
      `  - ${finding.path} (${finding.kind}, reverts ${finding.revertedCommit.slice(0, 9)} "${finding.revertedSubject}")`,
    );
  }
  lines.push(
    'Restore each unintended path from origin/main (for example: git checkout origin/main -- <path>), or declare intentional reverts with `git revert <sha>` or a `Revert-landed: <path> - <reason>` commit trailer.',
  );
  return lines.join('\n');
}

export function checkReverts(
  cwd,
  { mainRef = 'refs/remotes/origin/main', headRef = 'HEAD', lookback = LOOKBACK_COMMITS } = {},
) {
  let head;
  let main;
  let base;
  try {
    head = git(cwd, ['rev-parse', '--verify', `${headRef}^{commit}`]).trim();
    main = git(cwd, ['rev-parse', '--verify', `${mainRef}^{commit}`]).trim();
    base = git(cwd, ['merge-base', head, main]).trim();
  } catch (error) {
    return {
      code: COULD_NOT_RUN,
      findings: [],
      message: `could not resolve ${mainRef} or merge-base with ${headRef}: ${error.message}`,
    };
  }
  let changed;
  let range;
  let messages;
  try {
    changed = parseDiffRaw(
      git(cwd, ['diff', '--no-ext-diff', '--no-renames', '--raw', '--abbrev=40', '-z', base, head]),
    );
    if (changed.length === 0) {
      return { code: 0, findings: [], message: 'PASS: no committed changes against merge-base' };
    }
    range = historyRange(cwd, base, lookback);
    if (!range) {
      return { code: 0, findings: [], message: 'PASS: no ancestor history before merge-base' };
    }
    const historyByPath = collectPathHistory(
      cwd,
      range,
      changed.map((entry) => entry.path),
    );
    const rawMessages = git(cwd, ['log', '--format=%B%x00', `${base}..${head}`]);
    messages = rawMessages.split('\0').filter((msg) => msg.trim().length > 0);
    const declarations = parseDeclaredReverts(messages);
    const rawFindings = [];
    for (const entry of changed) {
      const history = historyByPath.get(entry.path) ?? [];
      for (const prior of history) {
        if (prior.oldOid === entry.newOid) {
          rawFindings.push({
            path: entry.path,
            kind: revertKind(entry),
            revertedCommit: prior.sha,
            revertedSubject: prior.subject,
          });
          break;
        }
      }
    }
    const findings = rawFindings.filter((finding) => !isDeclared(finding, declarations));
    if (findings.length > 0) {
      return {
        code: FOUND,
        findings,
        message: formatFailureMessage(findings, mainRef),
      };
    }
    return {
      code: 0,
      findings: [],
      message: `PASS: no undeclared reverts in ${changed.length} changed path(s) (lookback ${lookback})`,
    };
  } catch (error) {
    return {
      code: COULD_NOT_RUN,
      findings: [],
      message: `revert guard failed to inspect git history: ${error.message}`,
    };
  }
}

function parseCliArgs(argv) {
  const opts = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--main') opts.mainRef = argv[++index];
    else if (arg === '--head') opts.headRef = argv[++index];
    else if (arg === '--lookback') opts.lookback = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  try {
    const opts = parseCliArgs(process.argv.slice(2));
    const result = checkReverts(process.cwd(), opts);
    if (result.code === 0) console.log(`[revert-guard] ${result.message}`);
    else console.error(`[revert-guard] ${result.message}`);
    process.exitCode = result.code;
  } catch (error) {
    console.error(`[revert-guard] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = COULD_NOT_RUN;
  }
}
