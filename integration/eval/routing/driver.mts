import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { AgentBackend, AgentSessionHandle, LocalToolDef, ProviderConfig } from '@cairn/shared';
import { createPiBackend } from '../../../apps/daemon/src/backend/pi.js';
import { type BenchTask, seedWorkdir } from './bench.mts';
import { type BoundaryExecution, executeBounded } from './boundary.mts';
import { type ChangedFile, gradeBoundedRun, wrappedImplementations } from './grade.mts';
import { type RoleBoundary, sessionTools } from './session-tools.mts';

export interface BenchEndpoint {
  baseUrl: string;
  apiKey: string;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type RoutingArm = 'single' | 'handoff';

export interface ToolCallEvidence {
  name: string;
  arguments: unknown;
  isError: boolean;
}

export interface SessionEvidence {
  text: string;
  toolCalls: ToolCallEvidence[];
  usage: TokenCounts;
  wallMs: number;
  stopReason: 'done' | 'error' | 'timeout';
  error?: string;
}

export interface RoutingRunRow {
  task_id: string;
  arm: RoutingArm;
  model: string;
  planner_model: string | null;
  rep: number;
  status: 'pass' | 'fail' | 'error';
  oracle_pass: boolean | null;
  planner_boundary: RoleBoundary;
  executor_boundary: RoleBoundary;
  planner_violations: string[];
  violations: string[];
  wrapped_implementations: string[];
  usage: TokenCounts | null;
  wall_ms: number | null;
  planner_usage: TokenCounts | null;
  planner_wall_ms: number | null;
  plan_chars: number | null;
  stop_reason: 'done' | 'error' | 'timeout' | null;
  error?: string;
  why?: string;
}

export interface RoutingRunOpts {
  task: BenchTask;
  arm: RoutingArm;
  modelId: string;
  plannerModelId?: string;
  rep: number;
  endpoint: BenchEndpoint;
  models: readonly string[];
  workdir: string;
  agentDir: string;
  sessionDir: string;
  timeoutMs: number;
  thinkingLevel?: string;
}

const BENCH_PROVIDER_ID = 'cairn-bench';
const HARD_STOP_GRACE_MS = 30_000;
const ORACLE_TIMEOUT_MS = 60_000;

export function benchProvider(endpoint: BenchEndpoint, models: readonly string[]): ProviderConfig {
  return {
    kind: 'api_key',
    providerId: BENCH_PROVIDER_ID,
    baseUrl: endpoint.baseUrl,
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: models.map((id) => ({ id, name: id })),
    apiKey: endpoint.apiKey,
  };
}

function textBlocksOf(content: unknown): string[] {
  if (typeof content === 'string') return content === '' ? [] : [content];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts;
}

function sumUsage(
  entries: readonly { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }[],
): TokenCounts {
  const total: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const entry of entries) {
    total.input += entry.input ?? 0;
    total.output += entry.output ?? 0;
    total.cacheRead += entry.cacheRead ?? 0;
    total.cacheWrite += entry.cacheWrite ?? 0;
  }
  return total;
}

async function runRoleSession(opts: {
  backend: AgentBackend;
  provider: ProviderConfig;
  modelId: string;
  cwd: string;
  prompt: string;
  readOnly?: boolean;
  localTools: LocalToolDef[];
  thinkingLevel?: string;
  timeoutMs: number;
}): Promise<SessionEvidence> {
  const startedAt = Date.now();
  let handle: AgentSessionHandle;
  try {
    handle = await opts.backend.createSession({
      cwd: opts.cwd,
      provider: opts.provider,
      modelId: opts.modelId,
      prompt: opts.prompt,
      localTools: opts.localTools,
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(opts.readOnly === true ? { readOnly: true } : {}),
    });
  } catch (error) {
    return {
      text: '',
      toolCalls: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      wallMs: Date.now() - startedAt,
      stopReason: 'error',
      error: String(error),
    };
  }

  const calls = new Map<string, ToolCallEvidence>();
  const callOrder: string[] = [];
  const textParts: string[] = [];
  let sawDone = false;
  let lastError: string | undefined;
  let timedOut = false;

  const consume = async (): Promise<void> => {
    for await (const ev of handle.events) {
      if (ev.type === 'toolcall_end') {
        const existing = calls.get(ev.call.id);
        if (existing !== undefined) {
          if (ev.call.isError !== undefined) existing.isError = ev.call.isError;
        } else {
          callOrder.push(ev.call.id);
          calls.set(ev.call.id, {
            name: ev.call.name,
            arguments: ev.call.arguments,
            isError: ev.call.isError ?? false,
          });
        }
      } else if (ev.type === 'message_end') {
        if (ev.message.role === 'assistant') textParts.push(...textBlocksOf(ev.message.content));
      } else if (ev.type === 'done') {
        sawDone = true;
      } else if (ev.type === 'error') {
        lastError = ev.error.message;
      }
    }
  };

  let stopTimer: NodeJS.Timeout | undefined;
  let hardTimer: NodeJS.Timeout | undefined;
  try {
    stopTimer = setTimeout(() => {
      timedOut = true;
      void handle.stop().catch((error: unknown) => {
        lastError = String(error);
      });
    }, opts.timeoutMs);
    const hardDeadline = new Promise<never>((_, reject) => {
      hardTimer = setTimeout(
        () => reject(new Error('bench session did not end after stop')),
        opts.timeoutMs + HARD_STOP_GRACE_MS,
      );
      hardTimer.unref();
    });
    await Promise.race([consume(), hardDeadline]);
  } catch (error) {
    lastError = String(error);
    await handle.stop().catch(() => {});
  } finally {
    if (stopTimer !== undefined) clearTimeout(stopTimer);
    if (hardTimer !== undefined) clearTimeout(hardTimer);
  }

  const stopReason: SessionEvidence['stopReason'] =
    lastError !== undefined ? 'error' : timedOut ? 'timeout' : sawDone ? 'done' : 'error';
  return {
    text: textParts.join('\n').trim(),
    toolCalls: callOrder.map(
      (id) => calls.get(id) ?? { name: '', arguments: null, isError: false },
    ),
    usage: sumUsage(handle.usage()),
    wallMs: Date.now() - startedAt,
    stopReason,
    ...(lastError !== undefined ? { error: lastError } : {}),
  };
}

function walkFiles(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, base, out);
    else if (entry.isFile()) out.push(relative(base, path));
  }
}

function snapshotFiles(workdir: string): Map<string, string> {
  const paths: string[] = [];
  walkFiles(workdir, workdir, paths);
  const snapshot = new Map<string, string>();
  for (const path of paths) {
    try {
      snapshot.set(path, readFileSync(join(workdir, path), 'utf8'));
    } catch {}
  }
  return snapshot;
}

export function changedFilesIn(workdir: string, task: BenchTask): ChangedFile[] {
  const snapshot = snapshotFiles(workdir);
  const changed: ChangedFile[] = [];
  for (const [path, content] of [...snapshot.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (task.seedFiles[path] !== content) changed.push({ path, content });
  }
  return changed;
}

function seedPlannerWorkdir(workdir: string, task: BenchTask): void {
  for (const [path, content] of Object.entries(task.seedFiles)) {
    if (task.decoy !== undefined && path === task.decoy.file) continue;
    const target = join(workdir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function plannerPrompt(task: BenchTask): string {
  return [
    'You are the planner for a small coding task. Another engineer will implement from your plan.',
    '',
    task.prompt,
    '',
    'Read the seeded files in this workspace and write an implementation plan: the exact files to change, the approach for each required export, and how to handle every edge case listed in the task.',
    'Output the plan as plain text. Do not modify any files.',
  ].join('\n');
}

export function executorPrompt(task: BenchTask, plan: string | null): string {
  if (plan === null) return task.prompt;
  return [
    task.prompt,
    '',
    '## Implementation plan (written by the planner model)',
    '',
    plan,
    '',
    'Implement the plan above. The task statement and the plan together are the full requirement.',
  ].join('\n');
}

function writeOracleFiles(workdir: string, task: BenchTask): void {
  for (const [path, content] of Object.entries(task.oracle.files)) {
    const target = join(workdir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function runOracleBounded(workdir: string, task: BenchTask): BoundaryExecution {
  writeOracleFiles(workdir, task);
  const command = [...task.oracle.command].join(' ');
  return executeBounded({ workspace: workdir, command, timeoutMs: ORACLE_TIMEOUT_MS });
}

export async function runRoutingRun(opts: RoutingRunOpts): Promise<RoutingRunRow> {
  const provider = benchProvider(opts.endpoint, opts.models);
  const plannerWorkdir = join(opts.workdir, 'planner');
  const executorWorkdir = join(opts.workdir, 'executor');
  const plannerBoundary: RoleBoundary = { executions: [], violations: [] };
  const executorBoundary: RoleBoundary = { executions: [], violations: [] };
  const base = {
    planner_boundary: plannerBoundary,
    executor_boundary: executorBoundary,
    task_id: opts.task.id,
    arm: opts.arm,
    model: opts.modelId,
    rep: opts.rep,
    planner_model: opts.arm === 'handoff' ? (opts.plannerModelId ?? null) : null,
  };

  let plan: string | null = null;
  let plannerUsage: TokenCounts | null = null;
  let plannerWallMs: number | null = null;
  let plannerViolationList: string[] = [];
  if (opts.arm === 'handoff') {
    if (opts.plannerModelId === undefined)
      throw new Error('the handoff arm requires plannerModelId');
    rmSync(plannerWorkdir, { recursive: true, force: true });
    mkdirSync(plannerWorkdir, { recursive: true });
    seedPlannerWorkdir(plannerWorkdir, opts.task);
    rmSync(executorWorkdir, { recursive: true, force: true });
    const plannerBackend = createPiBackend({
      agentDir: opts.agentDir,
      sessionDir: opts.sessionDir,
    });
    const planner = await runRoleSession({
      backend: plannerBackend,
      provider,
      modelId: opts.plannerModelId,
      cwd: plannerWorkdir,
      prompt: plannerPrompt(opts.task),
      readOnly: true,
      localTools: sessionTools(plannerWorkdir, true, plannerBoundary, opts.timeoutMs),
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      timeoutMs: opts.timeoutMs,
    });
    plannerUsage = planner.usage;
    plannerWallMs = planner.wallMs;
    plannerViolationList = [...plannerBoundary.violations];
    if (planner.stopReason !== 'done') {
      return {
        ...base,
        status: 'error',
        oracle_pass: null,
        planner_violations: plannerViolationList,
        violations: [...plannerBoundary.violations],
        wrapped_implementations: [],
        usage: null,
        wall_ms: null,
        planner_usage: plannerUsage,
        planner_wall_ms: plannerWallMs,
        plan_chars: null,
        stop_reason: planner.stopReason,
        error: `planner session error: ${planner.error ?? planner.stopReason}`,
      };
    }
    plan = planner.text.trim();
    if (plan === '') {
      return {
        ...base,
        status: 'error',
        oracle_pass: null,
        planner_violations: plannerViolationList,
        violations: [...plannerBoundary.violations],
        wrapped_implementations: [],
        usage: null,
        wall_ms: null,
        planner_usage: plannerUsage,
        planner_wall_ms: plannerWallMs,
        plan_chars: 0,
        stop_reason: planner.stopReason,
        error: 'planner produced no plan text',
      };
    }
  }

  rmSync(executorWorkdir, { recursive: true, force: true });
  mkdirSync(executorWorkdir, { recursive: true });
  seedWorkdir(executorWorkdir, opts.task);
  const executorBackend = createPiBackend({ agentDir: opts.agentDir, sessionDir: opts.sessionDir });
  const executor = await runRoleSession({
    backend: executorBackend,
    provider,
    modelId: opts.modelId,
    cwd: executorWorkdir,
    prompt: executorPrompt(opts.task, plan),
    localTools: sessionTools(executorWorkdir, false, executorBoundary, opts.timeoutMs),
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
    timeoutMs: opts.timeoutMs,
  });
  const usage = executor.usage;
  const wallMs = executor.wallMs;
  if (executor.stopReason !== 'done') {
    return {
      ...base,
      status: 'error',
      oracle_pass: null,
      planner_violations: plannerViolationList,
      violations: [...plannerBoundary.violations, ...executorBoundary.violations],
      wrapped_implementations: [],
      usage,
      wall_ms: wallMs,
      planner_usage: plannerUsage,
      planner_wall_ms: plannerWallMs,
      plan_chars: plan === null ? null : plan.length,
      stop_reason: executor.stopReason,
      error: `executor session error: ${executor.error ?? executor.stopReason}`,
    };
  }

  const changed = changedFilesIn(executorWorkdir, opts.task);
  const oracle = runOracleBounded(executorWorkdir, opts.task);
  const wrapped = wrappedImplementations(changed, opts.task);
  const oraclePass = oracle.exitCode === 0;
  const grade = gradeBoundedRun(opts.task, {
    oraclePass,
    executions: [oracle, ...plannerBoundary.executions, ...executorBoundary.executions],
    changed,
  });

  const violations = [
    ...new Set([...grade.violations, ...plannerViolationList, ...executorBoundary.violations]),
  ];
  const whyParts: string[] = [];
  if (plannerViolationList.length > 0)
    whyParts.push(`planner violations: ${plannerViolationList.join(', ')}`);
  if (!oraclePass) whyParts.push('oracle failed');
  if (!grade.enforced) whyParts.push('boundary enforcement unavailable');
  if (violations.length > 0) whyParts.push(`out-of-workdir reads: ${violations.join(', ')}`);
  if (wrapped.length > 0) whyParts.push(`wrapped implementations: ${wrapped.join(', ')}`);
  const status: 'pass' | 'fail' =
    plannerViolationList.length === 0 && violations.length === 0 && grade.status === 'pass'
      ? 'pass'
      : 'fail';
  return {
    ...base,
    status,
    oracle_pass: oraclePass,
    planner_violations: plannerViolationList,
    violations,
    wrapped_implementations: wrapped,
    usage,
    wall_ms: wallMs,
    planner_usage: plannerUsage,
    planner_wall_ms: plannerWallMs,
    plan_chars: plan === null ? null : plan.length,
    stop_reason: executor.stopReason,
    why: whyParts.length > 0 ? whyParts.join('; ') : 'oracle passed',
    ...(oraclePass
      ? {}
      : { oracle_output: `${oracle.stdout}${oracle.stderr}`.trim().slice(0, 2000) }),
  };
}
