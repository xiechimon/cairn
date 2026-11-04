#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts/lint-warning-baseline.json');
const BASELINE_REL = 'scripts/lint-warning-baseline.json';
const CAP_KEY = 'maxWarnings';

const ANSI_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'g');

function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function currentSha() {
  try {
    return git(['rev-parse', 'HEAD']).trim();
  } catch {
    return 'unknown';
  }
}

function biomeCi() {
  try {
    const out = execFileSync('npx', ['biome', 'ci', '.'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stripAnsi(out), stderr: '' };
  } catch (err) {
    const stdout = stripAnsi(err.stdout ?? '');
    const stderr = stripAnsi(err.stderr ?? '');
    const status = typeof err.status === 'number' ? err.status : 1;
    return { status, stdout, stderr };
  }
}

function parseWarningCount(stdout) {
  const errorMatch = /Found\s+(\d+)\s+errors?\.?/.exec(stdout);
  if (errorMatch) {
    const warningMatch = /Found\s+(\d+)\s+warnings?\.?/.exec(stdout);
    return warningMatch ? Number(warningMatch[1]) : 0;
  }
  const warningMatch = /Found\s+(\d+)\s+warnings?\.?/.exec(stdout);
  if (warningMatch) return Number(warningMatch[1]);
  if (/No fixes applied|Checked\s+\d+\s+files/.test(stdout)) return 0;
  return null;
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

function validateBaseline(b, label) {
  if (b === null || typeof b !== 'object') return [`${label}: baseline is not an object`];
  if (!isNonNegativeInt(b[CAP_KEY]))
    return [
      `${label}: ${CAP_KEY} is not a non-negative integer (got ${JSON.stringify(b[CAP_KEY])})`,
    ];
  return [];
}

function loadInTreeBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `[lint-warning-cap] no baseline at ${BASELINE_REL} — freeze one from a clean main with: node scripts/lint-warning-cap.mjs --write`,
    );
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`[lint-warning-cap] ${BASELINE_REL} is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  const problems = validateBaseline(parsed, BASELINE_REL);
  if (problems.length > 0) {
    for (const p of problems) console.error(`[lint-warning-cap] ${p}`);
    process.exit(2);
  }
  return parsed;
}

function loadBaseBaseline(sha) {
  let text;
  try {
    text = git(['show', `${sha}:${BASELINE_REL}`]);
  } catch {
    try {
      git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    } catch {
      console.error(
        `[lint-warning-cap] base sha ${sha} is not available locally; fetch it first (CI: git fetch --depth=1 origin <sha>). Refusing to fall back to the branch baseline.`,
      );
      process.exit(2);
    }
    return { baseline: null, mode: 'bootstrap' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error(
      `[lint-warning-cap] baseline at base ${sha.slice(0, 12)} is not valid JSON: ${err.message}`,
    );
    process.exit(2);
  }
  const problems = validateBaseline(parsed, `base ${sha.slice(0, 12)}`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`[lint-warning-cap] ${p}`);
    process.exit(2);
  }
  return { baseline: parsed, mode: 'base' };
}

function writeBaseline(actualCount) {
  const doc = {
    [CAP_KEY]: actualCount,
    frozenFrom: { sha: currentSha(), date: new Date().toISOString().slice(0, 10) },
    scope:
      'biome ci . warning count from summary line "Found N warnings"; info diagnostics are excluded',
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `[lint-warning-cap] baseline frozen at ${CAP_KEY}=${actualCount}. Written to ${BASELINE_REL}.`,
  );
}

function check(baseSha) {
  const inTree = loadInTreeBaseline();
  let effective = inTree;
  let baseMode = 'in-tree only';
  if (baseSha) {
    const loaded = loadBaseBaseline(baseSha);
    if (loaded.mode === 'base') {
      effective = loaded.baseline;
      baseMode = `base ${baseSha.slice(0, 12)}`;
    } else {
      baseMode = `bootstrap (base ${baseSha.slice(0, 12)} has no ${BASELINE_REL})`;
    }
  }

  const run = biomeCi();
  const actual = parseWarningCount(run.stdout);
  if (actual === null) {
    process.stderr.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    console.error(
      '[lint-warning-cap] could not parse "Found N warnings" from biome ci . output; the gate cannot prove the cap. Update the summary regex for the installed biome version.',
    );
    process.exit(2);
  }

  const cap = effective[CAP_KEY];
  const failures = [];

  if (actual > cap) {
    failures.push(
      `cap: biome ci . reports ${actual} warning(s), over the cap of ${cap} (baseline ${baseMode})`,
    );
  }

  if (baseSha && effective !== inTree && inTree[CAP_KEY] > effective[CAP_KEY]) {
    failures.push(
      `${BASELINE_REL} ${CAP_KEY} raised vs base: ${effective[CAP_KEY]} -> ${inTree[CAP_KEY]}`,
    );
  }

  if (run.status !== 0) {
    failures.push(
      `biome ci . exited ${run.status} — an error-severity diagnostic is present; fix the error before the warning cap is meaningful`,
    );
  }

  if (failures.length > 0) {
    process.stderr.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    for (const f of failures) console.error(`[lint-warning-cap] ${f}`);
    console.error(
      `[lint-warning-cap] FAIL: ${failures.length} violation(s). Clear warnings, then re-freeze: node scripts/lint-warning-cap.mjs --write`,
    );
    process.exit(1);
  }

  if (actual < cap) {
    console.log(
      `[lint-warning-cap] warnings below cap (${actual} < ${cap}); re-freeze to lock the lower value: node scripts/lint-warning-cap.mjs --write`,
    );
  }
  console.log(
    `[lint-warning-cap] PASS: ${actual} warning(s) at or below cap ${cap} (baseline ${baseMode}, frozen from ${(effective.frozenFrom?.sha ?? 'unknown').slice(0, 12)}).`,
  );
  process.exit(0);
}

const argv = process.argv.slice(2);
let writeMode = false;
let baseSha = process.env.LINT_WARNING_BASE_SHA || '';
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--write') writeMode = true;
  else if (arg === '--base') {
    baseSha = argv[++i] ?? '';
    if (!baseSha) {
      console.error('[lint-warning-cap] --base requires a sha argument');
      process.exit(2);
    }
  } else {
    console.error(`[lint-warning-cap] unknown argument: ${arg} (expected --write or --base <sha>)`);
    process.exit(2);
  }
}

if (writeMode) {
  const run = biomeCi();
  const actual = parseWarningCount(run.stdout);
  if (actual === null) {
    process.stderr.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    console.error(
      '[lint-warning-cap] --write: could not parse warning count from biome ci . output; refusing to freeze a malformed baseline.',
    );
    process.exit(2);
  }
  writeBaseline(actual);
} else {
  check(baseSha);
}
