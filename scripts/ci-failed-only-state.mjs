import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';

export const STATE_VERSION = 1;
const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

export function contextFromEnv(env = process.env) {
  return {
    currDir: env.CI_FAILED_ONLY_CURR_DIR || '',
    prevDir: env.CI_FAILED_ONLY_PREV_DIR || '',
    jobKey: env.CI_FAILED_ONLY_JOB_KEY || '',
    sha: env.GITHUB_SHA || '',
    runId: env.GITHUB_RUN_ID ? String(env.GITHUB_RUN_ID) : '',
    attempt: Number.parseInt(env.GITHUB_RUN_ATTEMPT || '1', 10),
  };
}

export function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function toRepoRelative(filePath, root = DEFAULT_ROOT) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const resolved = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, resolved).split('\\').join(posix.sep);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

export function readPrevState({ prevDir, sha, runId, attempt, jobKey }) {
  if (!prevDir || !sha || !runId || !jobKey || !Number.isInteger(attempt) || attempt <= 1) {
    return null;
  }
  const statePath = join(prevDir, 'state.json');
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (
      parsed?.version !== STATE_VERSION ||
      parsed.sha !== sha ||
      String(parsed.runId) !== String(runId) ||
      parsed.attempt !== attempt - 1 ||
      parsed.jobKey !== jobKey ||
      typeof parsed.steps !== 'object' ||
      parsed.steps === null ||
      Array.isArray(parsed.steps)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function recordStepState({ currDir, sha, runId, attempt, jobKey, stepKey, outcome }) {
  if (!currDir || !stepKey) return null;
  const statePath = join(currDir, 'state.json');
  let state = null;
  if (existsSync(statePath)) {
    try {
      const existing = JSON.parse(readFileSync(statePath, 'utf8'));
      if (
        existing?.version === STATE_VERSION &&
        existing.sha === sha &&
        String(existing.runId) === String(runId) &&
        existing.attempt === attempt &&
        existing.jobKey === jobKey &&
        typeof existing.steps === 'object' &&
        existing.steps !== null
      ) {
        state = existing;
      }
    } catch {
      state = null;
    }
  }
  state ??= {
    version: STATE_VERSION,
    sha: sha || '',
    runId: String(runId || ''),
    attempt,
    jobKey: jobKey || '',
    steps: {},
  };
  state.steps[stepKey] = outcome;
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return state;
}

export function extractVitestFailedFiles(reportPath, repoRoot = DEFAULT_ROOT, exists = existsSync) {
  if (!reportPath || !exists(reportPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
    const out = new Set();
    for (const suite of parsed?.testResults ?? []) {
      if (suite?.status !== 'failed') continue;
      const rel = toRepoRelative(suite.name, repoRoot);
      if (rel && exists(resolve(repoRoot, rel))) out.add(rel);
    }
    return [...out].sort();
  } catch {
    return [];
  }
}

export function stripShardArgs(args) {
  const stripped = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--shard') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--shard=')) continue;
    stripped.push(arg);
  }
  return stripped;
}

export function prepareVitestRun({
  command,
  args,
  env = process.env,
  cwd = DEFAULT_ROOT,
  exists = existsSync,
}) {
  const ctx = contextFromEnv(env);
  if (!ctx.currDir || command !== 'pnpm' || args[0] !== 'test') {
    return { active: false, skip: false, args, reportPath: null, ctx, stepKey: 'vitest' };
  }
  const stepKey = 'vitest';
  const prev = readPrevState(ctx);
  const prevStep = prev?.steps?.[stepKey];
  if (prevStep?.status === 'passed') {
    return { active: true, skip: true, args, reportPath: null, ctx, stepKey, prev };
  }
  const reportPath = join(ctx.currDir, 'vitest-report.json');
  rmSync(reportPath, { force: true });
  const vitestCmd = ['exec', 'vitest', 'run'];
  const restArgs = args.slice(1);
  const reporterArgs = ['--reporter=default', '--reporter=json', `--outputFile=${reportPath}`];
  if (prevStep?.status === 'failed' && Array.isArray(prevStep.failedFiles)) {
    const existing = prevStep.failedFiles.filter(
      (file) => typeof file === 'string' && file.length > 0 && exists(resolve(cwd, file)),
    );
    if (existing.length > 0) {
      return {
        active: true,
        skip: false,
        rerunOnly: existing,
        args: [...vitestCmd, ...stripShardArgs(restArgs), ...reporterArgs, ...existing],
        reportPath,
        ctx,
        stepKey,
        prev,
      };
    }
  }
  return {
    active: true,
    skip: false,
    rerunOnly: null,
    args: [...vitestCmd, ...restArgs, ...reporterArgs],
    reportPath,
    ctx,
    stepKey,
    prev,
  };
}

export function finalizeVitestRun({ prep, code, cwd = DEFAULT_ROOT }) {
  if (!prep?.active) return null;
  if (prep.skip) {
    return recordStepState({
      ...prep.ctx,
      stepKey: prep.stepKey,
      outcome: { status: 'passed', failedFiles: [] },
    });
  }
  const failedFiles = prep.reportPath ? extractVitestFailedFiles(prep.reportPath, cwd) : [];
  return recordStepState({
    ...prep.ctx,
    stepKey: prep.stepKey,
    outcome: { status: code === 0 ? 'passed' : 'failed', failedFiles },
  });
}

export function readPlaywrightLastFailed(lastRunFile, exists = existsSync) {
  if (!lastRunFile || !exists(lastRunFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(lastRunFile, 'utf8'));
    if (parsed?.status !== 'failed' || !Array.isArray(parsed.failedTests)) return null;
    const ids = parsed.failedTests.filter((id) => typeof id === 'string' && id.length > 0);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}
