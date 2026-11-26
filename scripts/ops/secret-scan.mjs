#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FOUND = 1;
const COULD_NOT_RUN = 2;
const BUFFER = 64 * 1024 * 1024;
const IGNORE_FILE = '.gitleaksignore';
const PINNED_ENTRY = /^[0-9a-f]{40}:.+:[\w-]+:\d+$/;
const LOGGED_ERROR = /(?:^|\s)ERR\s/m;
const INSTALL =
  'brew install gitleaks (other systems: https://github.com/gitleaks/gitleaks/releases)';
const LEAKED =
  'If a finding is real, treat it as leaked: rotate it first, then remove it from every commit that holds it.';
const FILE_REMEDY = `${LEAKED} For a false positive, commit its Fingerprint line to ${IGNORE_FILE}.`;
const messageRemedy = (commit) =>
  `The finding is in the message of ${commit}. ${LEAKED} For a false positive, reword the message.`;

function isolatedEnv() {
  const inherited = Object.entries(process.env).filter(([key]) => !/^(GIT|GITLEAKS)_/.test(key));
  return {
    ...Object.fromEntries(inherited),
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
  };
}

function git(cwd, args, env = process.env) {
  const options = { cwd, env, encoding: 'utf8', maxBuffer: BUFFER, stdio: 'pipe' };
  return execFileSync('git', args, options).trim();
}

function scan(cwd, args, { range, remedy, input }) {
  const run = spawnSync(
    'gitleaks',
    [...args, '--redact', '--no-banner', '--no-color', '--verbose', '--ignore-gitleaks-allow'],
    { cwd, env: isolatedEnv(), input, encoding: 'utf8', maxBuffer: BUFFER },
  );
  if (run.error?.code === 'ENOENT')
    return { code: COULD_NOT_RUN, message: `gitleaks is not installed: ${INSTALL}` };
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.status === FOUND)
    return { code: FOUND, output, message: `gitleaks found a secret or failed. ${remedy}` };
  if (run.error || run.status !== 0 || LOGGED_ERROR.test(output))
    return {
      code: COULD_NOT_RUN,
      output,
      message: `gitleaks failed or logged an error, so ${range} was not fully scanned`,
    };
  return null;
}

function withBareCopy(source, use) {
  const copy = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  try {
    git(copy, ['init', '--quiet', '--bare', '--template=', '.'], isolatedEnv());
    writeFileSync(join(copy, 'objects', 'info', 'alternates'), `${join(source, 'objects')}\n`);
    const shallow = join(source, 'shallow');
    if (existsSync(shallow)) copyFileSync(shallow, join(copy, 'shallow'));
    return use(copy, (...args) => git(copy, args, isolatedEnv()));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

function scanRange(copy, run, base, head) {
  const committed = run('ls-tree', '--name-only', head, '--', IGNORE_FILE)
    ? run('cat-file', 'blob', `${head}:${IGNORE_FILE}`)
    : '';
  const lines = committed.split('\n');
  const isEntry = (line) => line.trim() && !line.startsWith('#');
  const unpinned = lines.findIndex((line) => isEntry(line) && !PINNED_ENTRY.test(line));
  if (unpinned >= 0)
    return {
      code: COULD_NOT_RUN,
      message: `line ${unpinned + 1} of ${IGNORE_FILE} is not shown: every entry must start with the commit it excuses, or it hides later secrets. If that line holds a secret, treat it as leaked: rotate it first, then remove it from every commit that holds it.`,
    };
  writeFileSync(join(copy, IGNORE_FILE), `${lines.filter(isEntry).join('\n')}\n`);
  const range = `${base}..${head}`;
  const label = `${base.slice(0, 9)}..${head.slice(0, 9)}`;
  if (run('rev-list', '--min-parents=3', range))
    return {
      code: COULD_NOT_RUN,
      message: 'a merge with more than two parents cannot be scanned; merge one branch at a time',
    };
  const diffs = ['git', `--log-opts=--text --diff-merges=remerge ${range}`, '.'];
  const inDiffs = scan(copy, diffs, { range: label, remedy: FILE_REMEDY });
  if (inDiffs) return inDiffs;
  for (const commit of run('rev-list', range).split('\n').filter(Boolean)) {
    const input = run('show', '--no-patch', '--format=%B', commit);
    const options = { range: label, remedy: messageRemedy(commit), input };
    const inMessage = scan(copy, ['stdin'], options);
    if (inMessage) return inMessage;
  }
  return { code: 0, message: `PASS: no secrets in ${label}` };
}

export function scanBranch(cwd) {
  const source = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  return withBareCopy(source, (copy, run) => {
    let base;
    try {
      const main = git(cwd, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
      base = run('merge-base', head, main);
    } catch {
      return { code: COULD_NOT_RUN, message: 'no merge-base with origin/main' };
    }
    return scanRange(copy, run, base, head);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const result = scanBranch(process.cwd());
  if (result.output) process.stdout.write(result.output);
  if (result.code === 0) console.log(`[secret-scan] ${result.message}`);
  else console.error(`[secret-scan] ${result.message}`);
  process.exitCode = result.code;
}
