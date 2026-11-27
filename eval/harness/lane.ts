import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laneEnv, resolveDevinBin, scrubDiagnostics } from './devin-env.mjs';
import type { LaneTask, TurnRecord } from './types.js';

const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function isPyCacheArtifact(relPath: string): boolean {
  return (
    relPath === '__pycache__' ||
    relPath.startsWith('__pycache__/') ||
    relPath.includes('/__pycache__/') ||
    relPath.endsWith('.pyc')
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
    if (name !== '' && !isPyCacheArtifact(name)) files.add(name);
  }
  const entries = dirty.stdout.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const line = entries[i];
    if (line === undefined || line === '') continue;
    if (line.startsWith('R ') || line.startsWith('C ')) i += 1;
    const name = line.slice(3);
    if (name !== '' && !isPyCacheArtifact(name)) files.add(name);
  }
  return [...files];
}

export async function runLaneTask(task: LaneTask, examDir: string): Promise<TurnRecord> {
  const fixture = join(examDir, 'tasks', 'lane', task.id, 'repo');
  if (!existsSync(fixture))
    return { caseId: task.id, kind: 'lane', incomplete: `missing fixture ${fixture}` };
  const startedAt = Date.now();
  const work = mkdtempSync(join(tmpdir(), `eval-lane-${task.id}-`));
  const extraPaths = [process.env.HOME, process.env.EVAL_DAILY_DEVIN_HOME].filter(
    (value): value is string => Boolean(value),
  );
  try {
    cpSync(fixture, work, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: work });
    execFileSync('git', ['add', '-A'], { cwd: work });
    execFileSync(
      'git',
      ['-c', 'user.email=eval@cairn.dev', '-c', 'user.name=eval', 'commit', '-qm', 'baseline'],
      { cwd: work },
    );
    const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: work,
      encoding: 'utf8',
    }).trim();
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
    const diagnostics = scrubDiagnostics(rawDiag, extraPaths);
    const files = task.checks.files.map((check) => {
      const path = join(work, check.path);
      const ok =
        existsSync(path) &&
        (check.contains === undefined || readFileSync(path, 'utf8').includes(check.contains));
      return { path: check.path, ok };
    });
    const commands = task.checks.commands.map((command) => {
      const res = spawnSync('bash', ['-c', command], {
        cwd: work,
        encoding: 'utf8',
        timeout: 60_000,
        env,
      });
      return { command, ok: res.status === 0 };
    });
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
    rmSync(work, { recursive: true, force: true });
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
