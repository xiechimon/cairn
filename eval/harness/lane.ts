import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { laneEnv, resolveDevinBin, scrubDiagnostics } from './devin-env.mjs';
import {
  commitExists,
  copyAllowedChangesToScorer,
  initBaselineRepo,
  isolateDependencyDirs,
  linkDependencyDirs,
  materializeCommitTree,
  overlayCommitFiles,
  sweepStaleTempDirs,
} from './snapshot.js';
import type { LaneTask, TurnRecord } from './types.js';

const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const DEPENDENCY_DRIFT_RE =
  /ERR_MODULE_NOT_FOUND|Cannot find package|NODE_MODULE_VERSION|Cannot find module ['"]@/;

export function isScorerProtectedPath(relPath: string): boolean {
  return (
    /(?:^|\/)package\.json$/.test(relPath) ||
    relPath === 'pnpm-lock.yaml' ||
    relPath === 'pnpm-workspace.yaml' ||
    /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(relPath) ||
    /(?:^|\/)(?:vitest|vite|playwright)\.config\.[^/]+$/.test(relPath) ||
    relPath === 'biome.json' ||
    /^scripts\/(?:test-|vitest)/.test(relPath) ||
    relPath.startsWith('eval/') ||
    /(?:^|\/)tests?\/.*setup[^/]*\.(?:[cm]?[jt]sx?)$/.test(relPath)
  );
}

function isIgnoredArtifact(relPath: string): boolean {
  return (
    relPath === '__pycache__' ||
    relPath.startsWith('__pycache__/') ||
    relPath.includes('/__pycache__/') ||
    relPath.endsWith('.pyc') ||
    relPath === 'node_modules' ||
    relPath.startsWith('node_modules/') ||
    relPath.includes('/node_modules/')
  );
}

function changedFiles(dir: string, baseline: string): string[] | null {
  const committed = spawnSync('git', ['diff', '--name-only', '-z', baseline], {
    cwd: dir,
    encoding: 'utf8',
  });
  const dirty = spawnSync('git', ['status', '--porcelain', '-z'], { cwd: dir, encoding: 'utf8' });
  if (committed.status !== 0 || dirty.status !== 0) return null;
  const files = new Set<string>();
  for (const name of committed.stdout.split('\0')) {
    if (name !== '' && !isIgnoredArtifact(name)) files.add(name);
  }
  const entries = dirty.stdout.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const line = entries[i];
    if (line === undefined || line === '') continue;
    if (line.startsWith('R ') || line.startsWith('C ')) i += 1;
    const name = line.slice(3);
    if (name !== '' && !isIgnoredArtifact(name)) files.add(name);
  }
  return [...files];
}

export function isDependencyDriftOutput(output: string): boolean {
  return DEPENDENCY_DRIFT_RE.test(output);
}

export function buildScorerEnv(
  baseEnv: NodeJS.ProcessEnv,
  scorerTmp: string,
): Record<string, string | undefined> {
  const cmdEnv: Record<string, string | undefined> = {
    ...baseEnv,
    CAIRN_LOCAL_HEAVY: '1',
    CAIRN_TEST_TEMP_ROOT: scorerTmp,
  };
  delete cmdEnv.NODE_TEST_CONTEXT;
  return cmdEnv;
}

export async function runLaneTask(
  task: LaneTask,
  examDir: string,
  options: { repoRoot?: string } = {},
): Promise<TurnRecord> {
  const repoRoot = options.repoRoot ?? resolve(examDir, '..');
  const extraPaths = [process.env.HOME, process.env.EVAL_DAILY_DEVIN_HOME, repoRoot].filter(
    (value): value is string => Boolean(value),
  );
  if (!commitExists(repoRoot, task.source.parentCommit)) {
    return {
      caseId: task.id,
      kind: 'lane',
      durationMs: 0,
      incomplete: scrubDiagnostics(`missing git commit ${task.source.parentCommit}`, extraPaths),
    };
  }
  if (!commitExists(repoRoot, task.source.fixCommit)) {
    return {
      caseId: task.id,
      kind: 'lane',
      durationMs: 0,
      incomplete: scrubDiagnostics(`missing git commit ${task.source.fixCommit}`, extraPaths),
    };
  }

  sweepStaleTempDirs();
  const startedAt = Date.now();
  const work = mkdtempSync(join(tmpdir(), `eval-lane-${task.id}-`));
  const scorerWork = mkdtempSync(join(tmpdir(), `eval-lane-scorer-${task.id}-`));
  const scorerTmp = mkdtempSync(join(tmpdir(), `eval-lane-tmp-${task.id}-`));
  try {
    let baseline: string;
    try {
      materializeCommitTree(repoRoot, task.source.parentCommit, work);
      baseline = initBaselineRepo(work);
      isolateDependencyDirs(repoRoot, work);
    } catch (error) {
      return {
        caseId: task.id,
        kind: 'lane',
        durationMs: Date.now() - startedAt,
        incomplete: scrubDiagnostics(
          `snapshot setup failed: ${error instanceof Error ? error.message : String(error)}`,
          extraPaths,
        ),
      };
    }

    const devinBin = resolveDevinBin(process.env);
    const env = laneEnv(process.env);
    const run = spawnSync(
      devinBin,
      [
        '-p',
        task.instruction,
        '--respect-workspace-trust',
        'false',
        '--permission-mode',
        'dangerous',
        '--process-model',
        'in-process',
      ],
      {
        cwd: work,
        encoding: 'utf8',
        timeout: task.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env,
      },
    );
    const durationMs = Date.now() - startedAt;
    const errorCode = (run.error as NodeJS.ErrnoException | undefined)?.code;
    if (run.error !== undefined && errorCode !== 'ETIMEDOUT' && errorCode !== 'ENOBUFS') {
      return {
        caseId: task.id,
        kind: 'lane',
        durationMs,
        incomplete: scrubDiagnostics(`devin: ${run.error.message}`, extraPaths),
      };
    }
    const changed = changedFiles(work, baseline);
    if (changed === null) {
      return {
        caseId: task.id,
        kind: 'lane',
        durationMs,
        incomplete: 'git state unreadable after devin run',
      };
    }
    const rawErr = run.stderr ?? '';
    const rawOut = run.stdout ?? '';
    if (changed.length === 0) {
      if (/rejected a tool call that requires confirmation/i.test(rawErr)) {
        return {
          caseId: task.id,
          kind: 'lane',
          durationMs,
          incomplete: scrubDiagnostics(`permission rejection: ${rawErr}`, extraPaths),
        };
      }
      if (
        (run.status ?? 0) !== 0 &&
        /(?:Login canceled|Not logged in|Unauthorized|\b401\b)/i.test(rawErr)
      ) {
        return {
          caseId: task.id,
          kind: 'lane',
          durationMs,
          incomplete: scrubDiagnostics(`devin auth: ${rawErr}`, extraPaths),
        };
      }
      if (
        (run.status ?? 0) !== 0 &&
        /(?:quota|rate limit|capacity|\b429\b|usage limit)/i.test(rawErr)
      ) {
        return {
          caseId: task.id,
          kind: 'lane',
          durationMs,
          incomplete: scrubDiagnostics(`devin quota: ${rawErr}`, extraPaths),
        };
      }
    }
    const timedOut = errorCode === 'ETIMEDOUT' || run.signal !== null;
    const bufferOverflow = errorCode === 'ENOBUFS';
    const rawDiag = timedOut
      ? `timeout after ${task.timeoutMs}ms${run.signal ? ` (${run.signal})` : ''}${rawErr ? `: ${rawErr}` : ''}`
      : bufferOverflow
        ? `output buffer exceeded (${MAX_BUFFER_BYTES} bytes)${rawErr ? `: ${rawErr}` : ''}`
        : (run.status ?? 1) !== 0
          ? rawErr || rawOut || `exit=${run.status ?? 1}`
          : '';

    try {
      const hiddenTestSet = new Set([...task.source.testFiles, ...task.source.existingTestFiles]);
      materializeCommitTree(repoRoot, task.source.parentCommit, scorerWork);
      linkDependencyDirs(repoRoot, scorerWork);
      copyAllowedChangesToScorer(work, scorerWork, changed, hiddenTestSet, isScorerProtectedPath);
      overlayCommitFiles(repoRoot, task.source.fixCommit, task.source.testFiles, scorerWork);
    } catch (error) {
      return {
        caseId: task.id,
        kind: 'lane',
        durationMs,
        incomplete: scrubDiagnostics(
          `test overlay failed: ${error instanceof Error ? error.message : String(error)}`,
          extraPaths,
        ),
      };
    }

    const files = task.checks.files.map((check) => {
      const path = join(scorerWork, check.path);
      const ok =
        existsSync(path) &&
        (check.contains === undefined || readFileSync(path, 'utf8').includes(check.contains));
      return { path: check.path, ok };
    });

    const commandEnv = buildScorerEnv(env, scorerTmp);
    const commandDiagParts: string[] = [];
    const commands = [];
    for (const command of task.checks.commands) {
      const res = spawnSync('bash', ['-c', command], {
        cwd: scorerWork,
        encoding: 'utf8',
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        env: commandEnv,
      });
      const cmdOutput = [res.stderr, res.stdout].filter(Boolean).join('\n');
      if (isDependencyDriftOutput(cmdOutput)) {
        return {
          caseId: task.id,
          kind: 'lane',
          durationMs,
          incomplete: scrubDiagnostics(`dependency drift: ${cmdOutput}`, extraPaths),
        };
      }
      const cmdErrCode = (res.error as NodeJS.ErrnoException | undefined)?.code;
      const cmdTimedOut = cmdErrCode === 'ETIMEDOUT' || res.signal !== null;
      const ok = res.error === undefined && res.status === 0;
      if (!ok) {
        if (cmdTimedOut) {
          commandDiagParts.push(`command timeout after ${COMMAND_TIMEOUT_MS}ms: ${command}`);
        } else if (res.error !== undefined) {
          commandDiagParts.push(`command error (${res.error.message}): ${command}`);
        } else {
          const tail = cmdOutput.trim().slice(-500);
          commandDiagParts.push(`exit=${res.status ?? 1}: ${tail || command}`);
        }
      }
      commands.push({ command, ok });
    }

    const combinedDiag = [rawDiag, ...commandDiagParts].filter(Boolean).join(' | ');
    const diagnostics = scrubDiagnostics(combinedDiag, extraPaths);
    return {
      caseId: task.id,
      kind: 'lane',
      stepStatus: 'done',
      decision: 'route',
      durationMs,
      ...(diagnostics ? { diagnostics } : {}),
      lane: {
        exitCode: timedOut || bufferOverflow ? 1 : (run.status ?? 1),
        changedFiles: changed,
        fileChecks: files,
        commandChecks: commands,
      },
    };
  } catch (error) {
    return {
      caseId: task.id,
      kind: 'lane',
      durationMs: Date.now() - startedAt,
      incomplete: scrubDiagnostics(
        error instanceof Error ? error.message : String(error),
        extraPaths,
      ),
    };
  } finally {
    rmSync(`${resolve(work)}.archive.tar`, { force: true });
    rmSync(`${resolve(scorerWork)}.archive.tar`, { force: true });
    rmSync(work, { recursive: true, force: true });
    rmSync(scorerWork, { recursive: true, force: true });
    rmSync(scorerTmp, { recursive: true, force: true });
  }
}

export function laneTaskIds(examDir: string): string[] {
  const dir = join(examDir, 'tasks', 'lane');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(dir, name, 'task.json')));
}
