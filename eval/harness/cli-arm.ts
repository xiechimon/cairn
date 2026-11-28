import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isScorerProtectedPath, runIsolatedCommand } from './lane.js';
import {
  copyAllowedChangesToScorer,
  initBaselineRepo,
  materializeCommitTree,
  overlayCommitFiles,
  workspaceChanges,
} from './snapshot.js';
import type { JourneyTask } from './types.js';

/**
 * The approved model behind its own CLI, the way a Cairn runner starts it.
 * The harness reads the launcher from its own environment, never from a
 * candidate or a checked-in file. `launchCliAgent` sends the flags the
 * approved Doubao CLI documents; a different launcher needs its own adapter.
 */
export interface CliModel {
  command: string;
  /** Extra launcher arguments before the harness ones; tests use this to fake the CLI. */
  args?: string[];
  modelId: string;
  effort: string;
  permissionMode: string;
  timeoutMs: number;
}

export function cliModelFromEnv(env: NodeJS.ProcessEnv = process.env): CliModel | null {
  const command = env.EVAL_ARM_CLI?.trim() ?? '';
  const modelId = (env.EVAL_ARM_MODEL_ID ?? env.EVAL_ARM_MODEL)?.trim() ?? '';
  if (command === '' || modelId === '') return null;
  const timeoutMs = Number(env.EVAL_ARM_TIMEOUT_MS ?? 180_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('eval: EVAL_ARM_TIMEOUT_MS must be a positive number of milliseconds');
  return {
    command,
    modelId,
    effort: env.EVAL_ARM_EFFORT?.trim() || 'low',
    permissionMode: env.EVAL_ARM_PERMISSION?.trim() || 'always_allow',
    timeoutMs,
  };
}

export interface CliLaunch {
  exitCode: number | null;
  timedOut: boolean;
  wallMs: number;
  detail?: string;
}

export function launchCliAgent(
  model: CliModel,
  prompt: string,
  workDir: string,
): Promise<CliLaunch> {
  const args = [
    ...(model.args ?? []),
    '-p',
    prompt,
    '-C',
    workDir,
    '--model',
    model.modelId,
    '--output-format',
    'json',
    '--permission-mode',
    model.permissionMode,
    '--effort',
    model.effort,
  ];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(model.command, args, { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let termTimer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let giveUpTimer: NodeJS.Timeout | undefined;
    const settle = (launch: CliLaunch) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      clearTimeout(giveUpTimer);
      resolve(launch);
    };
    child.stdout.resume();
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    termTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, model.timeoutMs);
    giveUpTimer = setTimeout(() => {
      settle({
        exitCode: null,
        timedOut: true,
        wallMs: Date.now() - started,
        detail: 'launcher did not exit after SIGKILL',
      });
    }, model.timeoutMs + 15_000);
    child.on('error', (error) => {
      settle({
        exitCode: null,
        timedOut: false,
        wallMs: Date.now() - started,
        detail: error.message,
      });
    });
    child.on('close', (code) => {
      settle({
        exitCode: code,
        timedOut,
        wallMs: Date.now() - started,
        ...(stderr === '' ? {} : { detail: stderr.trim().slice(-1200) }),
      });
    });
  });
}

export interface CliCaseOutcome {
  passed: boolean;
  launches: number;
  launch?: CliLaunch;
  fileChecks: { path: string; ok: boolean }[];
  commandChecks: { command: string; ok: boolean }[];
  detail?: string;
}

/**
 * One model-backed arm on one case: the agent starts in the parent checkout in
 * the role a runner has, then a separate grader copy takes only the allowed
 * patch and runs the trusted test.
 */
export async function runCliCase(
  task: JourneyTask,
  options: { repoRoot: string; model: CliModel; launch?: boolean; commandTimeoutMs?: number },
): Promise<CliCaseOutcome> {
  const workDir = mkdtempSync(join(tmpdir(), `eval-cli-work-${task.id}-`));
  const scorerDir = mkdtempSync(join(tmpdir(), `eval-cli-scorer-${task.id}-`));
  const hidden = new Set([...task.source.testFiles, ...task.source.existingTestFiles]);
  const shouldLaunch = options.launch ?? true;
  try {
    materializeCommitTree(options.repoRoot, task.source.parentCommit, workDir);
    initBaselineRepo(workDir);
    const launch = shouldLaunch
      ? await launchCliAgent(options.model, task.request, workDir)
      : undefined;
    const changed = workspaceChanges(workDir);
    const fileChecks = task.checks.files.map((check) => {
      const path = join(workDir, check.path);
      const ok =
        existsSync(path) &&
        (check.contains === undefined || readFileSync(path, 'utf8').includes(check.contains));
      return { path: check.path, ok };
    });
    let detail = launch?.detail;
    const commandChecks: { command: string; ok: boolean }[] = [];
    try {
      materializeCommitTree(options.repoRoot, task.source.parentCommit, scorerDir);
      copyAllowedChangesToScorer(workDir, scorerDir, changed, hidden, isScorerProtectedPath);
      overlayCommitFiles(options.repoRoot, task.source.fixCommit, task.source.testFiles, scorerDir);
    } catch (error) {
      detail = `grade setup failed: ${error instanceof Error ? error.message : String(error)}`;
      return {
        passed: false,
        launches: launch === undefined ? 0 : 1,
        ...(launch === undefined ? {} : { launch }),
        fileChecks,
        commandChecks,
        ...(detail === undefined ? {} : { detail }),
      };
    }
    const env: Record<string, string | undefined> = {
      ...process.env,
      CAIRN_LOCAL_HEAVY: '1',
      CAIRN_TEST_TEMP_ROOT: scorerDir,
    };
    delete env.NODE_TEST_CONTEXT;
    for (const command of task.checks.commands) {
      const res = await runIsolatedCommand(command, {
        cwd: scorerDir,
        env,
        timeoutMs: options.commandTimeoutMs ?? 120_000,
        maxBufferBytes: 16 * 1024 * 1024,
      });
      const ok =
        !res.timedOut && res.signal === null && res.error === undefined && res.status === 0;
      commandChecks.push({ command, ok });
      if (!ok)
        detail = `grading ${command} failed: ${[res.stderr, res.stdout]
          .filter(Boolean)
          .join('\n')
          .trim()
          .slice(-2000)}`;
    }
    return {
      passed:
        launch !== undefined &&
        launch.exitCode === 0 &&
        !launch.timedOut &&
        fileChecks.every((check) => check.ok) &&
        commandChecks.length > 0 &&
        commandChecks.every((check) => check.ok),
      launches: launch === undefined ? 0 : 1,
      ...(launch === undefined ? {} : { launch }),
      fileChecks,
      commandChecks,
      ...(detail === undefined ? {} : { detail }),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(scorerDir, { recursive: true, force: true });
  }
}
