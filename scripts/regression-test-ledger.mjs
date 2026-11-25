#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const LEDGER_PATH = 'scripts/regression-test-ledger.json';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

export function parseRegressionLedger(text, label = LEDGER_PATH) {
  const parsed = JSON.parse(text);
  if (parsed?.version !== 1 || !Array.isArray(parsed.regressions)) {
    throw new Error(`${label}: must be {version:1,regressions:[...]}`);
  }
  const ids = new Set();
  return parsed.regressions.map((entry, index) => {
    const row = `${label} row ${index + 1}`;
    for (const key of ['id', 'owner', 'regression', 'file', 'testTitle']) {
      if (typeof entry?.[key] !== 'string' || entry[key].trim() === '') {
        throw new Error(`${row}: ${key} is required`);
      }
    }
    if (ids.has(entry.id)) throw new Error(`${row}: duplicate id ${entry.id}`);
    ids.add(entry.id);
    if (!/^[a-z0-9-]+$/i.test(entry.owner))
      throw new Error(`${row}: owner must be a GitHub handle`);
    if (!DATE.test(entry.addedAt ?? '')) throw new Error(`${row}: addedAt must be YYYY-MM-DD`);
    return {
      id: entry.id,
      owner: entry.owner,
      regression: entry.regression,
      file: entry.file,
      testTitle: entry.testTitle,
      addedAt: entry.addedAt,
    };
  });
}

export function loadRegressionLedger({ cwd = REPO_ROOT, ledgerPath = null } = {}) {
  const file = ledgerPath ?? join(cwd, LEDGER_PATH);
  return parseRegressionLedger(readFileSync(file, 'utf8'), LEDGER_PATH);
}

export function validateRegressionEntries(cwd, entries) {
  const failures = [];
  for (const entry of entries) {
    const path = join(cwd, entry.file);
    if (!existsSync(path)) {
      failures.push(`${entry.id}: ${entry.file} does not exist`);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    const position = content.indexOf(entry.testTitle);
    if (position === -1) {
      failures.push(`${entry.id}: test title not found in ${entry.file}`);
      continue;
    }
    const prefix = content.slice(Math.max(0, position - 160), position);
    if (/(?:^|\s)(?:test|it)\.(?:skip|fixme)\s*\(\s*['"`]\s*$/.test(prefix)) {
      failures.push(`${entry.id}: test is skipped or marked fixme in ${entry.file}`);
      continue;
    }
    if (!/(?:^|\s)(?:test|it)\s*\(\s*['"`]\s*$/.test(prefix)) {
      failures.push(`${entry.id}: title in ${entry.file} is not a direct test/it declaration`);
    }
  }
  return failures;
}

export function ledgerIdsAtRef(cwd, ref) {
  try {
    return new Set(
      parseRegressionLedger(
        git(cwd, ['show', `${ref}:${LEDGER_PATH}`]),
        `${ref}:${LEDGER_PATH}`,
      ).map((entry) => entry.id),
    );
  } catch {
    return null;
  }
}

export function validateLedgerMonotonic(cwd, base) {
  const before = ledgerIdsAtRef(cwd, base);
  if (before === null || before.size === 0) return [];
  const after = new Set(loadRegressionLedger({ cwd }).map((entry) => entry.id));
  return [...before]
    .filter((id) => !after.has(id))
    .map((id) => `${id}: regression ledger entry removed; update the existing row instead`);
}

function parseArgs(argv) {
  const opts = { base: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') opts.base = argv[++index];
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const entries = loadRegressionLedger({ cwd: REPO_ROOT });
    const failures = validateRegressionEntries(REPO_ROOT, entries);
    const base =
      opts.base ?? process.env.REGRESSION_LEDGER_BASE_SHA ?? process.env.PREPUSH_BASE_SHA;
    if (base && !/^0{40}$/.test(base)) failures.push(...validateLedgerMonotonic(REPO_ROOT, base));
    if (failures.length > 0) {
      for (const failure of failures) console.error(`[regression-ledger] FAIL ${failure}`);
      process.exit(1);
    }
    console.log(`[regression-ledger] PASS (${entries.length} entries present and enabled)`);
  } catch (error) {
    console.error(
      `[regression-ledger] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
}
