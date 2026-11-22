import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaneTask, TurnRecord } from './types.js';

const LANE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
];

function laneEnv(): NodeJS.ProcessEnv {
  const keep = new Set(LANE_ENV_KEYS);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && (keep.has(key) || key.startsWith('DEVIN_')),
    ),
  ) as NodeJS.ProcessEnv;
}

function changedFiles(dir: string, baseline: string): string[] | null {
  const committed = spawnSync('git', ['diff', '--name-only', '-z', baseline], {
    cwd: dir,
    encoding: 'utf8',
  });
  const dirty = spawnSync('git', ['status', '--porcelain', '-z'], { cwd: dir, encoding: 'utf8' });
  if (committed.status !== 0 || dirty.status !== 0) return null;
  const files = new Set<string>();
  for (const name of committed.stdout.split('\0')) if (name !== '') files.add(name);
  const entries = dirty.stdout.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const line = entries[i];
    if (line === undefined || line === '') continue;
    if (line.startsWith('R ') || line.startsWith('C ')) i += 1;
    const name = line.slice(3);
    if (name !== '') files.add(name);
  }
  return [...files];
}

export async function runLaneTask(task: LaneTask, examDir: string): Promise<TurnRecord> {
  const fixture = join(examDir, 'tasks', 'lane', task.id, 'repo');
  if (!existsSync(fixture))
    return { caseId: task.id, kind: 'lane', incomplete: `missing fixture ${fixture}` };
  const work = mkdtempSync(join(tmpdir(), `eval-lane-${task.id}-`));
  cpSync(fixture, work, { recursive: true });
  try {
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
    const run = spawnSync('devin', ['-p', task.instruction, '--respect-workspace-trust', 'false'], {
      cwd: work,
      encoding: 'utf8',
      timeout: task.timeoutMs,
      env: laneEnv(),
    });
    if (run.error !== undefined)
      return { caseId: task.id, kind: 'lane', incomplete: `devin: ${run.error.message}` };
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
        env: laneEnv(),
      });
      return { command, ok: res.status === 0 };
    });
    const changed = changedFiles(work, baseline);
    if (changed === null)
      return { caseId: task.id, kind: 'lane', incomplete: 'git state unreadable after devin run' };
    return {
      caseId: task.id,
      kind: 'lane',
      stepStatus: 'done',
      decision: 'route',
      lane: {
        exitCode: run.status ?? 1,
        changedFiles: changed,
        fileChecks: files,
        commandChecks: commands,
      },
    };
  } catch (error) {
    return {
      caseId: task.id,
      kind: 'lane',
      incomplete: error instanceof Error ? error.message : String(error),
    };
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
