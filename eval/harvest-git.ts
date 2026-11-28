import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScorerEnv, isDependencyDriftOutput } from './harness/lane.js';
import {
  commitExists,
  isRegularBlobAtCommit,
  linkDependencyDirs,
  materializeCommitTree,
  overlayCommitFiles,
  parentOfCommit,
} from './harness/snapshot.js';
import { type LaneTask, laneTask } from './harness/types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SCAN_LIMIT = 40;
const VERIFY_TIMEOUT_MS = 90_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const SECURITY_SUBJECT_RE = /\b(?:cve|xss|csrf|ssrf|sqli|rce|exploit|auth-bypass|vuln)\b/i;
const TEST_FAILURE_OUTPUT_RE = /(?:FAIL\b|AssertionError|✖|not ok\b|\bfailed\b)/i;

export interface ScanCandidate {
  fixCommit: string;
  parentCommit: string;
  date: string;
  subject: string;
  srcFiles: string[];
  testFiles: string[];
}

export interface VerifyResult {
  id: string;
  ok: boolean;
  baselineMs: number;
  nopMs: number;
  oracleMs: number;
  reason?: string;
}

export interface VerifyOptions {
  commandTimeoutMs?: number;
}

interface CommandResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  errorMessage: string | null;
  output: string;
  durationMs: number;
}

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): CommandResult {
  const t0 = Date.now();
  const res = spawnSync('bash', ['-c', command], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER_BYTES,
    env,
  });
  const durationMs = Date.now() - t0;
  const errCode = (res.error as NodeJS.ErrnoException | undefined)?.code;
  const timedOut = errCode === 'ETIMEDOUT';
  const errorMessage = res.error ? res.error.message : null;
  const output = [res.stderr, res.stdout, errorMessage].filter(Boolean).join('\n');
  return {
    status: res.status,
    signal: res.signal,
    timedOut,
    errorMessage,
    output,
    durationMs,
  };
}

function changedBetween(
  repoRoot: string,
  parentCommit: string,
  fixCommit: string,
): { status: string; path: string }[] {
  const raw = execFileSync(
    'git',
    ['diff', '--no-renames', '--name-status', '-z', parentCommit, fixCommit],
    { cwd: repoRoot, maxBuffer: MAX_BUFFER_BYTES },
  ).toString('utf8');
  const parts = raw.split('\0').filter(Boolean);
  const out: { status: string; path: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    if (status && path) out.push({ status, path });
  }
  return out;
}

export function scanFixCandidates(
  repoRoot: string,
  { ref = 'origin/main', limit = DEFAULT_SCAN_LIMIT }: { ref?: string; limit?: number } = {},
): ScanCandidate[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const rawLog = execFileSync(
    'git',
    [
      'log',
      '--no-merges',
      '--grep=^fix(',
      `-n`,
      String(Math.max(limit * 4, 120)),
      '--format=%H\t%ad\t%s',
      '--date=short',
      ref,
    ],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES },
  ).trim();
  if (!rawLog) return [];
  const candidates: ScanCandidate[] = [];
  for (const line of rawLog.split('\n')) {
    const [fixCommit, date, subject] = line.split('\t');
    if (!fixCommit || !date || !subject) continue;
    if (SECURITY_SUBJECT_RE.test(subject)) continue;
    const parentCommit = parentOfCommit(repoRoot, fixCommit);
    if (!parentCommit) continue;
    const files = changedBetween(repoRoot, parentCommit, fixCommit);
    const tests = files.filter(
      (f) =>
        (f.status === 'A' || f.status === 'M') &&
        (/^(?:apps\/(?:server|daemon|web)|packages\/shared)\/.*\.test\.tsx?$/.test(f.path) ||
          /^scripts\/.*\.test\.mjs$/.test(f.path)),
    );
    const src = files.filter(
      (f) =>
        /^(?:apps\/(?:server|daemon)|packages\/shared)\/src\//.test(f.path) ||
        (/^scripts\/.*\.mjs$/.test(f.path) && !f.path.endsWith('.test.mjs')),
    );
    const blocked = files.some(
      (f) =>
        f.path.includes('drizzle/') ||
        f.path.includes('pnpm-lock.yaml') ||
        f.path.includes('package.json') ||
        f.path.includes('e2e/') ||
        f.path.includes('.github/'),
    );
    if (
      tests.length >= 1 &&
      tests.length <= 2 &&
      src.length >= 1 &&
      src.length <= 4 &&
      files.length <= 6 &&
      !blocked
    ) {
      candidates.push({
        fixCommit,
        parentCommit,
        date,
        subject,
        srcFiles: src.map((f) => f.path),
        testFiles: tests.map((f) => f.path),
      });
      if (candidates.length >= limit) break;
    }
  }
  return candidates;
}

function baselineCommandForFiles(task: LaneTask, files: string[]): string {
  const usesNodeTest =
    task.checks.commands.some((cmd) => cmd.trimStart().startsWith('node --test')) ||
    files.every((f) => /\.test\.m?js$/.test(f));
  const quoted = files.map((f) => JSON.stringify(f)).join(' ');
  return usesNodeTest ? `node --test ${quoted}` : `pnpm exec vitest run --maxWorkers=1 ${quoted}`;
}

export function verifyLaneTask(
  task: LaneTask,
  repoRoot: string,
  options: VerifyOptions = {},
): VerifyResult {
  const commandTimeoutMs = options.commandTimeoutMs ?? VERIFY_TIMEOUT_MS;
  const { parentCommit, fixCommit, testFiles, existingTestFiles } = task.source;
  if (!commitExists(repoRoot, parentCommit)) {
    return {
      id: task.id,
      ok: false,
      baselineMs: 0,
      nopMs: 0,
      oracleMs: 0,
      reason: `missing parentCommit ${parentCommit}`,
    };
  }
  if (!commitExists(repoRoot, fixCommit)) {
    return {
      id: task.id,
      ok: false,
      baselineMs: 0,
      nopMs: 0,
      oracleMs: 0,
      reason: `missing fixCommit ${fixCommit}`,
    };
  }
  const actualParent = parentOfCommit(repoRoot, fixCommit);
  if (actualParent !== parentCommit) {
    return {
      id: task.id,
      ok: false,
      baselineMs: 0,
      nopMs: 0,
      oracleMs: 0,
      reason: `parentCommit ${parentCommit.slice(0, 10)} !== fixCommit^ (${actualParent?.slice(0, 10) ?? 'none'})`,
    };
  }

  let baselineMs = 0;
  let nopMs = 0;
  let oracleMs = 0;
  const runInTempTree = (
    prefix: string,
    prepare: (work: string) => void,
    commands: string[],
  ): {
    ok: boolean;
    abortedReason: string | null;
    output: string;
    durationMs: number;
  } => {
    const work = mkdtempSync(join(tmpdir(), prefix));
    const tmp = mkdtempSync(join(tmpdir(), `${prefix}-tmp-`));
    try {
      materializeCommitTree(repoRoot, parentCommit, work);
      linkDependencyDirs(repoRoot, work);
      prepare(work);
      const env = buildScorerEnv(process.env, tmp);
      let totalMs = 0;
      for (const cmd of commands) {
        const res = runCommand(cmd, work, env, commandTimeoutMs);
        totalMs += res.durationMs;
        if (res.timedOut) {
          return {
            ok: false,
            abortedReason: `command timed out after ${commandTimeoutMs}ms`,
            output: res.output,
            durationMs: totalMs,
          };
        }
        if (res.signal !== null) {
          return {
            ok: false,
            abortedReason: `command killed by signal ${res.signal}`,
            output: res.output,
            durationMs: totalMs,
          };
        }
        if (res.errorMessage !== null) {
          return {
            ok: false,
            abortedReason: `command error: ${res.errorMessage}`,
            output: res.output,
            durationMs: totalMs,
          };
        }
        if (res.status !== 0) {
          return {
            ok: false,
            abortedReason: null,
            output: res.output,
            durationMs: totalMs,
          };
        }
      }
      return { ok: true, abortedReason: null, output: '', durationMs: totalMs };
    } finally {
      rmSync(`${resolve(work)}.archive.tar`, { force: true });
      rmSync(work, { recursive: true, force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  };

  try {
    const preExisting = [...new Set([...existingTestFiles, ...testFiles])].filter((rel) =>
      isRegularBlobAtCommit(repoRoot, parentCommit, rel),
    );
    if (preExisting.length > 0) {
      const baseRes = runInTempTree(`eval-verify-base-${task.id}-`, () => {}, [
        baselineCommandForFiles(task, preExisting),
      ]);
      baselineMs = baseRes.durationMs;
      if (!baseRes.ok) {
        return {
          id: task.id,
          ok: false,
          baselineMs,
          nopMs,
          oracleMs,
          reason: `baseline failed on parentCommit${baseRes.abortedReason ? ` (${baseRes.abortedReason})` : ''}: ${baseRes.output.trim().slice(-400)}`,
        };
      }
    }

    const nopRes = runInTempTree(
      `eval-verify-nop-${task.id}-`,
      (work) => {
        overlayCommitFiles(repoRoot, fixCommit, testFiles, work);
      },
      task.checks.commands,
    );
    nopMs = nopRes.durationMs;
    if (nopRes.ok) {
      return {
        id: task.id,
        ok: false,
        baselineMs,
        nopMs,
        oracleMs,
        reason: 'nop unexpectedly passed on parentCommit with overlaid testFiles',
      };
    }
    if (nopRes.abortedReason) {
      return {
        id: task.id,
        ok: false,
        baselineMs,
        nopMs,
        oracleMs,
        reason: `nop ${nopRes.abortedReason}: ${nopRes.output.trim().slice(-400)}`,
      };
    }
    if (isDependencyDriftOutput(nopRes.output)) {
      return {
        id: task.id,
        ok: false,
        baselineMs,
        nopMs,
        oracleMs,
        reason: `nop hit dependency drift: ${nopRes.output.trim().slice(-400)}`,
      };
    }
    if (!TEST_FAILURE_OUTPUT_RE.test(nopRes.output)) {
      return {
        id: task.id,
        ok: false,
        baselineMs,
        nopMs,
        oracleMs,
        reason: `nop exited non-zero without test failure output: ${nopRes.output.trim().slice(-400)}`,
      };
    }

    const hiddenSet = new Set(testFiles);
    const keepParentTests = existingTestFiles.filter((p) => !hiddenSet.has(p));
    const diffEntries = changedBetween(repoRoot, parentCommit, fixCommit).filter(
      (entry) => !hiddenSet.has(entry.path) && !existingTestFiles.includes(entry.path),
    );
    const addOrModify = diffEntries
      .filter((e) => e.status === 'A' || e.status === 'M')
      .map((e) => e.path);
    const removals = diffEntries.filter((e) => e.status === 'D').map((e) => e.path);

    const oracleRes = runInTempTree(
      `eval-verify-oracle-${task.id}-`,
      (work) => {
        for (const rel of removals) {
          rmSync(join(work, rel), { force: true });
        }
        overlayCommitFiles(repoRoot, fixCommit, addOrModify, work);
        overlayCommitFiles(repoRoot, parentCommit, keepParentTests, work);
        overlayCommitFiles(repoRoot, fixCommit, testFiles, work);
      },
      task.checks.commands,
    );
    oracleMs = oracleRes.durationMs;
    if (!oracleRes.ok) {
      return {
        id: task.id,
        ok: false,
        baselineMs,
        nopMs,
        oracleMs,
        reason: `oracle failed on patched parent: ${oracleRes.output.trim().slice(-400)}`,
      };
    }

    return { id: task.id, ok: true, baselineMs, nopMs, oracleMs };
  } catch (error) {
    return {
      id: task.id,
      ok: false,
      baselineMs,
      nopMs,
      oracleMs,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function loadLaneTasksFromExam(examDir: string): LaneTask[] {
  const laneDir = join(examDir, 'tasks', 'lane');
  if (!existsSync(laneDir)) return [];
  const tasks: LaneTask[] = [];
  for (const entry of readdirSync(laneDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const file = join(laneDir, entry.name, 'task.json');
    if (!existsSync(file)) continue;
    tasks.push(laneTask.parse(JSON.parse(readFileSync(file, 'utf8'))));
  }
  return tasks;
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

export function runCli(argv: string[] = process.argv.slice(2)): number {
  const repoRoot = resolve(argValue(argv, '--repo') ?? REPO_ROOT);
  const examDir = resolve(argValue(argv, '--exam') ?? join(repoRoot, 'eval'));

  if (argv.includes('--scan')) {
    const limit = Number(argValue(argv, '--limit') ?? DEFAULT_SCAN_LIMIT);
    const ref = argValue(argv, '--ref') ?? 'origin/main';
    const outArg = argValue(argv, '--out');
    const candidates = scanFixCandidates(repoRoot, { ref, limit });
    const text = candidates.map((c) => JSON.stringify(c)).join('\n');
    if (outArg) {
      const resolvedOut = resolve(outArg);
      const resolvedRepo = resolve(repoRoot);
      if (resolvedOut === resolvedRepo || resolvedOut.startsWith(`${resolvedRepo}${sep}`)) {
        throw new Error('harvest-git: --out must stay outside the repository');
      }
      writeFileSync(resolvedOut, text ? `${text}\n` : '');
      console.log(`harvest-git: ${candidates.length} candidate(s) -> ${resolvedOut}`);
    } else {
      console.log(`harvest-git: ${candidates.length} candidate(s)`);
      for (const c of candidates) {
        console.log(
          `${c.fixCommit.slice(0, 10)} ${c.date} | ${c.subject} | tests=${c.testFiles.join(',')}`,
        );
      }
    }
    return 0;
  }

  if (argv.includes('--verify')) {
    const verifyIdx = argv.indexOf('--verify');
    const maybeId = argv[verifyIdx + 1];
    const targetId = maybeId && !maybeId.startsWith('--') ? maybeId : undefined;
    const allTasks = loadLaneTasksFromExam(examDir);
    const selected = targetId ? allTasks.filter((t) => t.id === targetId) : allTasks;
    if (selected.length === 0) {
      console.error(
        targetId ? `[verify] unknown lane task id: ${targetId}` : '[verify] no lane tasks found',
      );
      return 1;
    }
    let failed = 0;
    for (const task of selected) {
      const res = verifyLaneTask(task, repoRoot);
      if (res.ok) {
        console.log(
          `[verify] PASS ${res.id} (baseline=${res.baselineMs}ms nop=${res.nopMs}ms oracle=${res.oracleMs}ms)`,
        );
      } else {
        failed += 1;
        console.error(`[verify] FAIL ${res.id}: ${res.reason}`);
      }
    }
    console.log(`[verify] ${selected.length - failed}/${selected.length} passed`);
    return failed === 0 ? 0 : 1;
  }

  console.error(
    'usage: harvest-git.ts --scan [--limit N] [--ref origin/main] [--out <path>] | --verify [taskId]',
  );
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}
