#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  contextFromEnv,
  extractVitestFailedFiles,
  finalizeVitestRun,
  prepareVitestRun,
  readPrevState,
  recordStepState,
  STATE_VERSION,
  safeName,
  stripShardArgs,
  toRepoRelative,
} from '../ci-failed-only-state.mjs';

export {
  contextFromEnv,
  extractVitestFailedFiles,
  finalizeVitestRun,
  prepareVitestRun,
  readPrevState,
  recordStepState,
  STATE_VERSION,
  safeName,
  stripShardArgs,
};

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const NODE_TEST_REPORTER = resolve(import.meta.dirname, 'ci-node-test-reporter.mjs');

export function extractNodeTestFailedFiles(failLogPath, declaredFiles, repoRoot = REPO_ROOT) {
  if (!failLogPath || !existsSync(failLogPath)) return [];
  const declaredByAbs = new Map(declaredFiles.map((file) => [resolve(repoRoot, file), file]));
  const declaredSet = new Set(declaredFiles);
  const out = new Set();
  for (const line of readFileSync(failLogPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.file !== 'string' || entry.file.length === 0) continue;
      const abs = isAbsolute(entry.file) ? entry.file : resolve(repoRoot, entry.file);
      const declared = declaredByAbs.get(abs);
      if (declared) {
        out.add(declared);
        continue;
      }
      const rel = toRepoRelative(abs, repoRoot);
      if (rel && declaredSet.has(rel)) out.add(rel);
    } catch {}
  }
  return [...out].sort();
}

export function extractGoTestFailures(jsonOutput) {
  const failedPackages = new Set();
  const packageOnlyFailures = new Set();
  const failedTests = new Set();
  for (const line of String(jsonOutput || '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event.Action !== 'fail' || typeof event.Package !== 'string') continue;
      failedPackages.add(event.Package);
      if (typeof event.Test === 'string' && event.Test.length > 0) {
        failedTests.add(event.Test.split('/')[0]);
      } else {
        packageOnlyFailures.add(event.Package);
      }
    } catch {}
  }
  if (failedPackages.size === 0 || packageOnlyFailures.size > 0) {
    return { packages: [...failedPackages].sort(), tests: [] };
  }
  return { packages: [...failedPackages].sort(), tests: [...failedTests].sort() };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function selectNodeTestFiles({
  stepKey,
  declaredFiles,
  ctx,
  cwd = REPO_ROOT,
  exists = existsSync,
}) {
  if (!ctx.currDir) return { skip: false, files: declaredFiles, rerunOnly: null };
  const prev = readPrevState(ctx);
  const prevStep = prev?.steps?.[stepKey];
  if (prevStep?.status === 'passed') {
    return { skip: true, files: [], rerunOnly: null };
  }
  if (prevStep?.status === 'failed' && Array.isArray(prevStep.failedFiles)) {
    const allowed = new Set(declaredFiles);
    const filtered = prevStep.failedFiles.filter(
      (file) => typeof file === 'string' && allowed.has(file) && exists(resolve(cwd, file)),
    );
    if (filtered.length > 0) {
      return { skip: false, files: filtered, rerunOnly: filtered };
    }
  }
  return { skip: false, files: declaredFiles, rerunOnly: null };
}

function runNodeTest({ stepKey, rest, cwd = process.cwd(), env = process.env }) {
  if (rest[0] !== 'node' || rest[1] !== '--test' || rest.length < 3) {
    console.error('[failed-only] node-test expects: -- node --test <file...>');
    return 2;
  }
  const declaredFiles = rest.slice(2);
  const ctx = contextFromEnv(env);
  if (!ctx.currDir) {
    const res = spawnSync('node', ['--test', ...declaredFiles], { cwd, env, stdio: 'inherit' });
    return res.status ?? 1;
  }
  const selection = selectNodeTestFiles({ stepKey, declaredFiles, ctx, cwd });
  if (selection.skip) {
    console.log(`[failed-only] skipping ${stepKey}: passed in attempt ${ctx.attempt - 1}`);
    recordStepState({ ...ctx, stepKey, outcome: { status: 'passed', failedFiles: [] } });
    return 0;
  }
  if (selection.rerunOnly) {
    console.log(
      `[failed-only] rerunning ${selection.files.length}/${declaredFiles.length} failed node:test file(s) for ${stepKey}: ${selection.files.join(' ')}`,
    );
  }
  mkdirSync(ctx.currDir, { recursive: true });
  const failLog = join(ctx.currDir, `node-test-${safeName(stepKey)}.jsonl`);
  rmSync(failLog, { force: true });
  const child = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      `--test-reporter=${NODE_TEST_REPORTER}`,
      '--test-reporter-destination=stdout',
      ...selection.files,
    ],
    {
      cwd,
      env: { ...env, CI_NODE_TEST_FAIL_LOG: failLog },
      stdio: 'inherit',
    },
  );
  const code = child.status ?? 1;
  const failedFiles = code === 0 ? [] : extractNodeTestFailedFiles(failLog, declaredFiles, cwd);
  recordStepState({
    ...ctx,
    stepKey,
    outcome: { status: code === 0 ? 'passed' : 'failed', failedFiles },
  });
  return code;
}

function runGoTest({ stepKey, rest, cwd = process.cwd(), env = process.env }) {
  if (rest[0] !== 'go' || rest[1] !== 'test') {
    console.error('[failed-only] go-test expects: -- go test <args...>');
    return 2;
  }
  const ctx = contextFromEnv(env);
  if (!ctx.currDir) {
    const res = spawnSync(rest[0], rest.slice(1), { cwd, env, stdio: 'inherit' });
    return res.status ?? 1;
  }
  const prev = readPrevState(ctx);
  const prevStep = prev?.steps?.[stepKey];
  if (prevStep?.status === 'passed') {
    console.log(`[failed-only] skipping ${stepKey}: passed in attempt ${ctx.attempt - 1}`);
    recordStepState({ ...ctx, stepKey, outcome: { status: 'passed', packages: [], tests: [] } });
    return 0;
  }
  let goArgs;
  if (
    prevStep?.status === 'failed' &&
    Array.isArray(prevStep.packages) &&
    prevStep.packages.length > 0
  ) {
    const tests = Array.isArray(prevStep.tests) ? prevStep.tests.filter(Boolean) : [];
    const runArg = tests.length > 0 ? ['-run', `^(${tests.map(escapeRegex).join('|')})$`] : [];
    console.log(
      `[failed-only] rerunning failed go test targets for ${stepKey}: packages=${prevStep.packages.join(',')} tests=${tests.join(',') || 'all'}`,
    );
    goArgs = ['test', '-json', ...runArg, ...prevStep.packages];
  } else {
    goArgs = ['test', '-json', ...rest.slice(2)];
  }
  const res = spawnSync('go', goArgs, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const line of String(res.stdout || '').split('\n')) {
    if (!line) continue;
    try {
      const ev = JSON.parse(line);
      if (typeof ev.Output === 'string') process.stdout.write(ev.Output);
    } catch {
      process.stdout.write(`${line}\n`);
    }
  }
  if (res.stderr) process.stderr.write(res.stderr);
  const code = res.status ?? 1;
  const failures = code === 0 ? { packages: [], tests: [] } : extractGoTestFailures(res.stdout);
  recordStepState({
    ...ctx,
    stepKey,
    outcome: { status: code === 0 ? 'passed' : 'failed', ...failures },
  });
  return code;
}

function runGenericStep({ stepKey, rest, cwd = process.cwd(), env = process.env }) {
  if (rest.length === 0) {
    console.error('[failed-only] step expects: -- <command> [args...]');
    return 2;
  }
  const ctx = contextFromEnv(env);
  if (!ctx.currDir) {
    const res = spawnSync(rest[0], rest.slice(1), { cwd, env, stdio: 'inherit' });
    return res.status ?? 1;
  }
  const prev = readPrevState(ctx);
  if (prev?.steps?.[stepKey]?.status === 'passed') {
    console.log(`[failed-only] skipping ${stepKey}: passed in attempt ${ctx.attempt - 1}`);
    recordStepState({ ...ctx, stepKey, outcome: { status: 'passed' } });
    return 0;
  }
  const res = spawnSync(rest[0], rest.slice(1), { cwd, env, stdio: 'inherit' });
  const code = res.status ?? 1;
  recordStepState({ ...ctx, stepKey, outcome: { status: code === 0 ? 'passed' : 'failed' } });
  return code;
}

function parseCli(argv) {
  const mode = argv[0];
  const sep = argv.indexOf('--');
  if (!mode || sep === -1) return null;
  const opts = argv.slice(1, sep);
  const keyIndex = opts.indexOf('--key');
  const stepKey = keyIndex === -1 ? '' : opts[keyIndex + 1] || '';
  if (!stepKey) return null;
  return { mode, stepKey, rest: argv.slice(sep + 1) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const parsed = parseCli(process.argv.slice(2));
  if (!parsed) {
    console.error(
      'Usage: node scripts/ops/ci-failed-only.mjs <node-test|go-test|step> --key <id> -- <command...>',
    );
    process.exit(2);
  }
  let code;
  if (parsed.mode === 'node-test') code = runNodeTest(parsed);
  else if (parsed.mode === 'go-test') code = runGoTest(parsed);
  else if (parsed.mode === 'step') code = runGenericStep(parsed);
  else {
    console.error(`[failed-only] unknown mode: ${parsed.mode}`);
    process.exit(2);
  }
  process.exit(code);
}
