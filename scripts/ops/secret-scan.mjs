#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from '../diff-base.mjs';

const FOUND = 1;
const COULD_NOT_RUN = 2;
const BUFFER = 64 * 1024 * 1024;
const EVERY_ADDED_LINE =
  '--no-color --no-textconv --no-ext-diff --text --pretty=medium --src-prefix=a/ --dst-prefix=b/ --diff-merges=remerge';
const LOGGED_ERROR = /(?:^|\s)ERR\s/m;
const INSTALL =
  'brew install gitleaks (other systems: https://github.com/gitleaks/gitleaks/releases)';
const REMEDY =
  'If a finding is real, treat it as leaked: rotate it first, then remove it from every commit that holds it. A false positive goes into .gitleaksignore as its Fingerprint line.';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: BUFFER }).trim();
}

function gitleaks(cwd, args, input) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  delete env.GITLEAKS_CONFIG;
  delete env.GITLEAKS_CONFIG_TOML;
  return spawnSync(
    'gitleaks',
    [...args, '--redact', '--no-banner', '--no-color', '--verbose', '--ignore-gitleaks-allow'],
    { cwd, env, input, encoding: 'utf8', maxBuffer: BUFFER },
  );
}

function verdict(run, range) {
  if (run.error?.code === 'ENOENT')
    return { code: COULD_NOT_RUN, message: `gitleaks is not installed: ${INSTALL}` };
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.status === FOUND)
    return { code: FOUND, output, message: `gitleaks found a secret or failed. ${REMEDY}` };
  if (run.error || run.status !== 0 || LOGGED_ERROR.test(output))
    return {
      code: COULD_NOT_RUN,
      output,
      message: `gitleaks failed or logged an error, so ${range} was not fully scanned`,
    };
  return null;
}

export function scanBranch(cwd) {
  const base = mergeBase(cwd, 'origin/main');
  if (!base) return { code: COULD_NOT_RUN, message: 'no merge-base with origin/main' };
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (existsSync(join(root, '.gitleaks.toml')))
    return {
      code: COULD_NOT_RUN,
      message: 'remove .gitleaks.toml: a false positive goes only into .gitleaksignore',
    };
  const range = `${base}..HEAD`;
  if (git(root, ['rev-list', '--min-parents=3', range]))
    return {
      code: COULD_NOT_RUN,
      message: 'a merge with more than two parents cannot be scanned; merge one branch at a time',
    };
  const passes = [
    () => gitleaks(root, ['git', `--log-opts=${EVERY_ADDED_LINE} ${range}`, '.']),
    () => gitleaks(root, ['stdin'], git(root, ['log', '--no-color', '--format=%H%n%B', range])),
  ];
  for (const pass of passes) {
    const failed = verdict(pass(), `${base.slice(0, 9)}..HEAD`);
    if (failed) return failed;
  }
  return { code: 0, message: `PASS: no secrets in ${base.slice(0, 9)}..HEAD` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = scanBranch(process.cwd());
  if (result.output) process.stdout.write(result.output);
  if (result.code === 0) console.log(`[secret-scan] ${result.message}`);
  else console.error(`[secret-scan] ${result.message}`);
  process.exitCode = result.code;
}
