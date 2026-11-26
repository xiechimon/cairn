#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from '../diff-base.mjs';

const FOUND = 1;
const COULD_NOT_RUN = 2;
const LOGGED_ERROR = /(?:^|\s)ERR\s/m;
const INSTALL =
  'brew install gitleaks (other systems: https://github.com/gitleaks/gitleaks/releases)';
const REMEDY =
  'If a finding is real, treat it as leaked: rotate it first, then remove it from every commit that holds it. A false positive goes into .gitleaksignore as its Fingerprint line.';

export function scanBranch(cwd) {
  const base = mergeBase(cwd, 'origin/main');
  if (!base) return { code: COULD_NOT_RUN, message: 'no merge-base with origin/main' };
  const run = spawnSync(
    'gitleaks',
    [
      'git',
      '--redact',
      '--no-banner',
      '--no-color',
      '--verbose',
      '--ignore-gitleaks-allow',
      `--log-opts=${base}..HEAD`,
      '.',
    ],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error?.code === 'ENOENT')
    return { code: COULD_NOT_RUN, message: `gitleaks is not installed: ${INSTALL}` };
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.status === FOUND)
    return { code: FOUND, output, message: `gitleaks found a secret or failed. ${REMEDY}` };
  if (run.error || run.status !== 0 || LOGGED_ERROR.test(output))
    return {
      code: COULD_NOT_RUN,
      output,
      message: `gitleaks failed or logged an error, so ${base.slice(0, 9)}..HEAD was not fully scanned`,
    };
  return { code: 0, message: `PASS: no secrets in ${base.slice(0, 9)}..HEAD` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = scanBranch(process.cwd());
  if (result.output) process.stdout.write(result.output);
  if (result.code === 0) console.log(`[secret-scan] ${result.message}`);
  else console.error(`[secret-scan] ${result.message}`);
  process.exitCode = result.code;
}
