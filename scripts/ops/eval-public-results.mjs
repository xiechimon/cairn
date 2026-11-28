import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { scrubDiagnostics } from '../../eval/harness/devin-env.mjs';

export const PUBLIC_RESULTS_BRANCH = 'eval-results';

const KIND_ORDER = ['lane', 'runtime', 'canary'];
const RUN_STATUSES = new Set(['ok', 'degraded', 'incomplete', 'failed']);
const CASE_STATUSES = new Set(['pass', 'partial', 'fail', 'incomplete']);
const GIT_TIMEOUT_MS = 20_000;

function isItemPassed(item) {
  if (item?.incomplete !== undefined) return false;
  const values = Object.values(item?.scores ?? {});
  return values.length > 0 && values.every((value) => value === 1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readPublicEvalSpec(repoDir) {
  const suite = readJson(join(repoDir, 'eval', 'suite.json'));
  const expectedTotal = KIND_ORDER.reduce((sum, kind) => {
    const count = Number(suite?.expectedCounts?.[kind]);
    const repeats = Number(suite?.repeats?.[kind]);
    if (!Number.isInteger(count) || count < 0 || !Number.isInteger(repeats) || repeats < 1) {
      throw new Error(`invalid eval suite count for ${kind}`);
    }
    return sum + count * repeats;
  }, 0);
  const publicTasks = new Set();
  const taskIdsByKind = {};
  for (const kind of KIND_ORDER) {
    const dir = join(repoDir, 'eval', 'tasks', kind);
    taskIdsByKind[kind] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (kind === 'lane' && entry.isDirectory()) {
        publicTasks.add(`${kind}:${entry.name}`);
        taskIdsByKind[kind].push(entry.name);
      }
      if (kind !== 'lane' && entry.isFile() && entry.name.endsWith('.json')) {
        const caseId = entry.name.slice(0, -'.json'.length);
        publicTasks.add(`${kind}:${caseId}`);
        taskIdsByKind[kind].push(caseId);
      }
    }
    taskIdsByKind[kind].sort();
    if (taskIdsByKind[kind].length !== Number(suite?.expectedCounts?.[kind])) {
      throw new Error(`eval suite count for ${kind} does not match public tasks`);
    }
  }
  return { suite, expectedTotal, publicTasks, taskIdsByKind };
}

function modelForCase(kind, models, env) {
  if (kind !== 'lane') return 'Recorded replay';
  const unique = [...models].filter(Boolean);
  if (unique.length > 0) return `Devin CLI · ${unique.join(', ')}`;
  const configured = typeof env?.DEVIN_MODEL === 'string' ? env.DEVIN_MODEL.trim() : '';
  return configured ? `Devin CLI · ${configured}` : 'Devin CLI';
}

function emptyKindCounts() {
  return { total: 0, passed: 0, failed: 0, incomplete: 0 };
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`unsafe public payload: ${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`unsafe public payload: ${label} keys are ${actual.join(',')}`);
  }
}

function assertCountObject(value, label, exact = true) {
  if (exact) exactKeys(value, ['total', 'passed', 'failed', 'incomplete'], label);
  for (const key of ['total', 'passed', 'failed', 'incomplete']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      throw new Error(`unsafe public payload: ${label}.${key} is invalid`);
    }
  }
  if (value.passed + value.failed + value.incomplete !== value.total) {
    throw new Error(`unsafe public payload: ${label} counts do not add up`);
  }
}

function assertSafePayload(payload) {
  exactKeys(
    payload,
    ['version', 'dataset', 'suiteVersion', 'date', 'sha', 'status', 'summary', 'cases'],
    'root',
  );
  if (payload.version !== 1) throw new Error('unsafe public payload: unsupported version');
  if (typeof payload.dataset !== 'string' || payload.dataset.length === 0) {
    throw new Error('unsafe public payload: dataset is invalid');
  }
  if (!Number.isInteger(payload.suiteVersion) || payload.suiteVersion < 1) {
    throw new Error('unsafe public payload: suiteVersion is invalid');
  }
  if (typeof payload.date !== 'string' || Number.isNaN(Date.parse(payload.date))) {
    throw new Error('unsafe public payload: date is invalid');
  }
  if (typeof payload.sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(payload.sha)) {
    throw new Error('unsafe public payload: sha is invalid');
  }
  if (!RUN_STATUSES.has(payload.status))
    throw new Error('unsafe public payload: status is invalid');
  exactKeys(payload.summary, ['total', 'passed', 'failed', 'incomplete', 'byKind'], 'summary');
  assertCountObject(payload.summary, 'summary', false);
  exactKeys(payload.summary.byKind, KIND_ORDER, 'summary.byKind');
  for (const kind of KIND_ORDER) assertCountObject(payload.summary.byKind[kind], `byKind.${kind}`);
  if (!Array.isArray(payload.cases) || payload.cases.length === 0 || payload.cases.length > 200) {
    throw new Error('unsafe public payload: cases are invalid');
  }
  for (const row of payload.cases) {
    exactKeys(
      row,
      ['caseId', 'kind', 'status', 'passed', 'failed', 'incomplete', 'trials', 'model'],
      `case ${String(row?.caseId)}`,
    );
    if (!KIND_ORDER.includes(row.kind)) throw new Error('unsafe public payload: case kind');
    if (!CASE_STATUSES.has(row.status)) throw new Error('unsafe public payload: case status');
    for (const key of ['passed', 'failed', 'incomplete', 'trials']) {
      if (!Number.isInteger(row[key]) || row[key] < 0) {
        throw new Error(`unsafe public payload: case ${key} is invalid`);
      }
    }
    if (row.passed + row.failed + row.incomplete !== row.trials || row.trials < 1) {
      throw new Error('unsafe public payload: case counts do not add up');
    }
    if (
      typeof row.caseId !== 'string' ||
      row.caseId.length === 0 ||
      row.caseId.length > 120 ||
      typeof row.model !== 'string' ||
      row.model.length === 0 ||
      row.model.length > 120
    ) {
      throw new Error('unsafe public payload: case text is invalid');
    }
  }
  const serialized = JSON.stringify(payload);
  const forbidden = [
    /https?:\/\//i,
    /\.ts\.net\b/i,
    /\/(?:Users|home)\/[^\s"']+/,
    /\b(?:sk|pk)(?:-lf)?-[A-Za-z0-9_-]{8,}\b/,
    /\b(?:DEVIN|LANGFUSE)_[A-Z0-9_]*=/,
    /\b(?:quota|rate\s+limit|cost|usd)\b|\$\d/i,
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) {
    throw new Error('unsafe public payload: forbidden content');
  }
}

export function buildPublicResults(record, { repoDir, env = process.env } = {}) {
  const { suite, expectedTotal, publicTasks, taskIdsByKind } = readPublicEvalSpec(repoDir);
  const items = Array.isArray(record?.items) ? record.items : [];
  if (record?.evalExitCode !== 0 || items.length === 0 || items.length !== expectedTotal) {
    return {
      payload: null,
      skipReason: `no complete official eval result (expected ${expectedTotal} trials, got ${items.length})`,
    };
  }
  if (typeof record.finishedAt !== 'string' || Number.isNaN(Date.parse(record.finishedAt))) {
    throw new Error('unsafe public payload: run finishedAt is invalid');
  }
  if (!RUN_STATUSES.has(record.status))
    throw new Error('unsafe public payload: run status is invalid');

  const expectedTrials = new Set();
  for (const kind of KIND_ORDER) {
    const repeats = Number(suite.repeats[kind]);
    for (const caseId of taskIdsByKind[kind]) {
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        expectedTrials.add(`${kind}:${caseId}:${repeat}`);
      }
    }
  }
  const seenTrials = new Set();
  const byCase = new Map();
  const byKind = Object.fromEntries(KIND_ORDER.map((kind) => [kind, emptyKindCounts()]));
  for (const item of items) {
    const caseId = String(item?.caseId ?? '');
    const kind = String(item?.kind ?? '');
    if (!KIND_ORDER.includes(kind) || !publicTasks.has(`${kind}:${caseId}`)) {
      throw new Error(`unsafe public payload: ${kind}/${caseId} is not a public eval task`);
    }
    if (!Number.isInteger(item.repeat) || item.repeat < 0) {
      throw new Error(`unsafe public payload: ${kind}/${caseId} has invalid repeat`);
    }
    const trialKey = `${kind}:${caseId}:${item.repeat}`;
    if (!expectedTrials.has(trialKey)) {
      throw new Error(`unsafe public payload: ${trialKey} is outside the official eval matrix`);
    }
    if (seenTrials.has(trialKey)) {
      throw new Error(`unsafe public payload: ${trialKey} is duplicated`);
    }
    seenTrials.add(trialKey);
    const bucket = byCase.get(`${kind}:${caseId}`) ?? {
      caseId,
      kind,
      passed: 0,
      failed: 0,
      incomplete: 0,
      trials: 0,
      models: new Set(),
    };
    const itemModel =
      typeof item?.ranModel === 'string' && item.ranModel.trim()
        ? item.ranModel.trim()
        : typeof item?.model === 'string' && item.model.trim()
          ? item.model.trim()
          : '';
    if (itemModel) bucket.models.add(itemModel);
    bucket.trials += 1;
    byKind[kind].total += 1;
    if (item.incomplete !== undefined) {
      bucket.incomplete += 1;
      byKind[kind].incomplete += 1;
    } else if (isItemPassed(item)) {
      bucket.passed += 1;
      byKind[kind].passed += 1;
    } else {
      bucket.failed += 1;
      byKind[kind].failed += 1;
    }
    byCase.set(`${kind}:${caseId}`, bucket);
  }
  if (seenTrials.size !== expectedTrials.size) {
    throw new Error('unsafe public payload: official eval matrix is incomplete');
  }

  const cases = [...byCase.values()]
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.caseId.localeCompare(b.caseId),
    )
    .map((row) => ({
      caseId: row.caseId,
      kind: row.kind,
      status:
        row.incomplete > 0
          ? 'incomplete'
          : row.passed === row.trials
            ? 'pass'
            : row.passed === 0
              ? 'fail'
              : 'partial',
      passed: row.passed,
      failed: row.failed,
      incomplete: row.incomplete,
      trials: row.trials,
      model: modelForCase(row.kind, row.models, env),
    }));
  const summary = {
    total: items.length,
    passed: KIND_ORDER.reduce((sum, kind) => sum + byKind[kind].passed, 0),
    failed: KIND_ORDER.reduce((sum, kind) => sum + byKind[kind].failed, 0),
    incomplete: KIND_ORDER.reduce((sum, kind) => sum + byKind[kind].incomplete, 0),
    byKind,
  };
  const payload = {
    version: 1,
    dataset: String(suite.dataset ?? ''),
    suiteVersion: Number(suite.version),
    date: record.finishedAt,
    sha: String(record.sha ?? ''),
    status: record.status,
    summary,
    cases,
  };
  assertSafePayload(payload);
  return { payload };
}

function spawnGit(args, { cwd, env }) {
  return spawnSync('git', args, {
    cwd,
    env: { ...env, GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function git(args, options) {
  const result = spawnGit(args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git exited ${result.status}`);
  }
  return result.stdout.trim();
}

function isCanonicalRemote(remote) {
  const normalized = remote
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  return [
    'https://github.com/xiechimon/cairn',
    'git@github.com:xiechimon/cairn',
    'ssh://git@github.com/xiechimon/cairn',
  ].includes(normalized);
}

function publishFailure(error, extraPaths) {
  return {
    state: 'failed',
    branch: PUBLIC_RESULTS_BRANCH,
    reason:
      scrubDiagnostics(error instanceof Error ? error.message : String(error), extraPaths) ||
      'unknown publish failure',
  };
}

export function publishPublicResults(
  record,
  { repoDir, stateDir, env = process.env, enforceCanonicalRemote = true } = {},
) {
  const extraPaths = [env?.HOME, repoDir, stateDir].filter(Boolean);
  let tempDir = null;
  try {
    if (!repoDir || !stateDir) throw new Error('repoDir and stateDir are required');
    const built = buildPublicResults(record, { repoDir, env });
    if (!built.payload) {
      return { state: 'skipped', branch: PUBLIC_RESULTS_BRANCH, reason: built.skipReason };
    }
    const remote = git(['config', '--get', 'remote.origin.url'], { cwd: repoDir, env });
    if (!remote) throw new Error('EVAL_DAILY_REPO has no origin remote');
    if (enforceCanonicalRemote && !isCanonicalRemote(remote)) {
      throw new Error(`origin is not the canonical public results remote: ${remote}`);
    }

    const safeRunId = String(record.runId ?? 'run').replace(/[^A-Za-z0-9._-]/g, '_');
    const normalizedStateDir = resolve(stateDir);
    let stateStat = null;
    try {
      stateStat = lstatSync(normalizedStateDir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (stateStat) {
      if (!stateStat.isDirectory()) throw new Error('unsafe state tmp directory');
    } else {
      mkdirSync(normalizedStateDir, { recursive: true, mode: 0o700 });
      if (!lstatSync(normalizedStateDir).isDirectory())
        throw new Error('unsafe state tmp directory');
    }
    const tmpRoot = join(realpathSync(normalizedStateDir), 'tmp');
    let tmpStat = null;
    try {
      tmpStat = lstatSync(tmpRoot);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (tmpStat) {
      if (!tmpStat.isDirectory()) throw new Error('unsafe state tmp directory');
    } else {
      mkdirSync(tmpRoot, { mode: 0o700 });
      if (!lstatSync(tmpRoot).isDirectory()) throw new Error('unsafe state tmp directory');
    }
    if (realpathSync(tmpRoot) !== tmpRoot) throw new Error('unsafe state tmp directory');
    tempDir = mkdtempSync(join(tmpRoot, `${safeRunId}-public-`));
    git(['init', '-q'], { cwd: tempDir, env });
    git(['remote', 'add', 'origin', remote], { cwd: tempDir, env });
    const resolvedFetch = git(['remote', 'get-url', 'origin'], { cwd: tempDir, env });
    const resolvedPush = git(['remote', 'get-url', '--push', 'origin'], { cwd: tempDir, env });
    if (
      enforceCanonicalRemote &&
      (!isCanonicalRemote(resolvedFetch) || !isCanonicalRemote(resolvedPush))
    ) {
      throw new Error(
        `origin is not the canonical public results remote: ${resolvedFetch} / ${resolvedPush}`,
      );
    }
    const remoteRefs = git(['ls-remote', '--heads', 'origin', PUBLIC_RESULTS_BRANCH], {
      cwd: tempDir,
      env,
    });
    const branchExists = remoteRefs.length > 0;
    let existingText = null;
    if (branchExists) {
      git(['fetch', '-q', '--depth', '1', 'origin', PUBLIC_RESULTS_BRANCH], { cwd: tempDir, env });
      git(['checkout', '-q', '-b', PUBLIC_RESULTS_BRANCH, 'FETCH_HEAD'], { cwd: tempDir, env });
      const existingPath = join(tempDir, 'latest.json');
      let existingStat = null;
      try {
        existingStat = lstatSync(existingPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (existingStat && !existingStat.isFile()) {
        git(['rm', '-rfq', '--', 'latest.json'], { cwd: tempDir, env });
        rmSync(existingPath, { recursive: true, force: true });
      } else if (existingStat?.isFile()) {
        const fd = openSync(existingPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try {
          existingText = readFileSync(fd, 'utf8');
        } finally {
          closeSync(fd);
        }
      }
      if (existingText) {
        try {
          const existing = JSON.parse(existingText);
          const existingTime = Date.parse(existing?.date);
          const nextTime = Date.parse(built.payload.date);
          if (
            existingText !== `${JSON.stringify(built.payload, null, 2)}\n` &&
            Number.isFinite(existingTime) &&
            Number.isFinite(nextTime) &&
            existingTime >= nextTime &&
            existingTime <= Date.now() + 10 * 60 * 1000
          ) {
            return {
              state: 'skipped',
              branch: PUBLIC_RESULTS_BRANCH,
              reason: 'stale local result: remote has a newer or equal snapshot',
            };
          }
        } catch {}
      }
    } else {
      git(['checkout', '-q', '--orphan', PUBLIC_RESULTS_BRANCH], { cwd: tempDir, env });
    }

    if (branchExists) {
      const tracked = git(['ls-files', '-z'], { cwd: tempDir, env });
      for (const file of tracked.split('\0').filter(Boolean)) {
        if (file !== 'latest.json') git(['rm', '-q', '--', file], { cwd: tempDir, env });
      }
    }
    const targetPath = join(tempDir, 'latest.json');
    const stagingPath = join(tempDir, `.latest-${process.pid}-${randomUUID().slice(0, 8)}.tmp`);
    try {
      const targetStat = lstatSync(targetPath);
      if (!targetStat.isFile()) rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    writeFileSync(stagingPath, `${JSON.stringify(built.payload, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(stagingPath, targetPath);
    git(['add', '--', 'latest.json'], { cwd: tempDir, env });
    const diff = spawnGit(['diff', '--cached', '--quiet'], { cwd: tempDir, env });
    if (diff.error) throw diff.error;
    if (diff.status === 0) {
      return {
        state: 'unchanged',
        branch: PUBLIC_RESULTS_BRANCH,
        commit: git(['rev-parse', 'HEAD'], { cwd: tempDir, env }),
      };
    }
    if (diff.status !== 1) throw new Error(diff.stderr || `git diff exited ${diff.status}`);
    git(
      [
        '-c',
        'user.name=xiechimon',
        '-c',
        'user.email=157263579+xiechimon@users.noreply.github.com',
        'commit',
        '-qm',
        `ops(eval): publish daily eval results ${String(record.runId ?? '').slice(0, 80)}`,
      ],
      { cwd: tempDir, env },
    );
    const commit = git(['rev-parse', 'HEAD'], { cwd: tempDir, env });
    git(['push', '-q', 'origin', `HEAD:refs/heads/${PUBLIC_RESULTS_BRANCH}`], {
      cwd: tempDir,
      env,
    });
    return { state: 'published', branch: PUBLIC_RESULTS_BRANCH, commit };
  } catch (error) {
    return publishFailure(error, extraPaths);
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
