import { readFileSync } from 'node:fs';
import { redactSecrets, STOP_MESSAGE } from '@cairn/shared';
import Database from 'better-sqlite3';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Db } from './db/client.js';
import * as schema from './db/schema.js';
import { build, message, step, todo } from './db/schema.js';

export const BUILD_CAUSES = [
  'provider-network',
  'quota',
  'timeout',
  'git',
  'unstaffed',
  'unclaimed',
  'session-lost',
  'agent-gave-up',
  'gate-or-phase-bug',
  'stuck-waiting',
  'other',
] as const;
export type BuildCause = (typeof BUILD_CAUSES)[number];

export const UNATTRIBUTED: BuildCause = 'other';

export const STUCK_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const WILSON_Z_95 = 1.96;
const MESSAGE_MAX_CHARS = 300;

export type BuildOutcome = 'reached-pr' | 'cancelled' | 'active' | BuildCause;

const MESSAGE_BEARING_OUTCOMES: readonly BuildOutcome[] = BUILD_CAUSES.filter(
  (cause) => cause !== 'stuck-waiting',
);

const NO_STEPS: ReliabilityStepCounts = {
  pending: 0,
  claimed: 0,
  done: 0,
  failed: 0,
  stopped: 0,
  waitingQuota: 0,
};

const CAUSE_PATTERNS: readonly { cause: BuildCause; pattern: RegExp }[] = [
  { cause: 'timeout', pattern: /\bstream timeout \(arm=/ },
  {
    cause: 'git',
    pattern:
      /\bgit (?:push|commit|merge|fetch|clone|checkout|reset|rebase|rev-parse|worktree) failed\b|^fatal:|merge conflict against|authentication failed on both credential paths/,
  },
  { cause: 'unstaffed', pattern: /plan 步无指派 Agent|no agent assigned to the plan slot/ },
  { cause: 'unclaimed', pattern: /本轮无人认领|was never claimed/ },
  {
    cause: 'session-lost',
    pattern: /session \S+ not found on this machine|continue session impossible/,
  },
  {
    cause: 'quota',
    pattern:
      /\b402\b|usage[ _-]?limit|insufficient[ _](?:quota|credit|balance)|(?:quota|credit|balance)[ _]is[ _]insufficient|quota[ _](?:exceed|exhaust|limit)|credit[ _]balance|billing|you['’]ve hit your limit|credits/,
  },
  {
    cause: 'provider-network',
    pattern:
      /econnreset|etimedout|econnrefused|connection[ _]reset|connection[ _]refused|connection[ _]closed|\bconnection[ _]?(?:error|failed)\b|socket[ _]hang[ _]up|dial tcp|fetch failed|error sending request|unable to connect|stream disconnected|network error|temporarily unavailable|rate[ _-]?limit|too many requests|overloaded|no capacity available|all available accounts exhausted|\b429\b|\b503\b|\b529\b|\bdns\b|deadline exceeded|request timed out/i,
  },
  {
    cause: 'agent-gave-up',
    pattern: /zero progress and no terminal outcome|silent no-op round/,
  },
  {
    cause: 'gate-or-phase-bug',
    pattern: /方案结构不合格|规划未产出方案|构建零改动|信息卡未产出报告|偏离工作分支/,
  },
];

export interface BuildCauseInput {
  errorMessage: string | null;
  prNumber: number | null;
  ageMs: number;
}

export function sanitizeErrorMessage(errorMessage: string, outcome: BuildOutcome): string | null {
  if (!MESSAGE_BEARING_OUTCOMES.includes(outcome)) return null;
  const redacted = redactSecrets(errorMessage);
  const text = typeof redacted.value === 'string' ? redacted.value : String(redacted.value);
  const chars = Array.from(text);
  return chars.length > MESSAGE_MAX_CHARS ? `${chars.slice(0, MESSAGE_MAX_CHARS).join('')}…` : text;
}

export function classifyBuildCause(input: BuildCauseInput): BuildOutcome {
  if (input.prNumber !== null) return 'reached-pr';
  if (input.errorMessage === null) {
    return input.ageMs >= STUCK_THRESHOLD_MS ? 'stuck-waiting' : 'active';
  }
  if (input.errorMessage === STOP_MESSAGE) return 'cancelled';
  for (const { cause, pattern } of CAUSE_PATTERNS) {
    if (pattern.test(input.errorMessage)) return cause;
  }
  return 'other';
}

export function wilsonInterval(successes: number, total: number): [number, number] | null {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = WILSON_Z_95 * WILSON_Z_95;
  const denominator = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const spread = WILSON_Z_95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return [(center - spread) / denominator, (center + spread) / denominator];
}

export type StepStatus = 'pending' | 'claimed' | 'done' | 'failed' | 'stopped' | 'waiting_quota';

export interface ReliabilityStepCounts {
  pending: number;
  claimed: number;
  done: number;
  failed: number;
  stopped: number;
  waitingQuota: number;
}

export interface ReliabilityBuildRow {
  id: string;
  todoId: string;
  title: string;
  createdAt: number;
  ageHours: number;
  prNumber: number | null;
  outcome: BuildOutcome;
  message: string | null;
  steps: ReliabilityStepCounts;
}

export interface ReliabilityDayRow {
  day: string;
  started: number;
  reachedPr: number;
  rate: number | null;
}

export interface ReliabilityReport {
  project: string;
  since: number;
  until: number;
  buildsStarted: number;
  reachedPr: number;
  cancelled: number;
  active: number;
  rate: number | null;
  wilson95: [number, number] | null;
  perDay: ReliabilityDayRow[];
  causes: Record<BuildCause, number>;
  builds: ReliabilityBuildRow[];
}

export interface ReliabilityReportOptions {
  projectId: string;
  since: number;
  until: number;
}

export interface SampleTaskIdentity {
  repo: string;
  baseSha: string;
  taskIds?: readonly string[];
}

export interface BuildReplayEntry {
  task: string;
  kind: string | null;
  repo: string;
  baseSha: string;
  buildId: string;
  todoId: string | null;
  createdAt: number;
  prNumber: number | null;
  errorMessage: string | null;
  outcome: BuildOutcome;
}

export type BuildReplayRequest = BuildReplayEntry;

export type ReplayWindow = SampleTaskIdentity & { since: number; until: number };

export function replayId(entry: BuildReplayEntry): string {
  return entry.buildId;
}

export function normalizeReplay(raw: unknown, identity: SampleTaskIdentity): BuildReplayEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('a replay entry must be an object');
  }
  const record = raw as Record<string, unknown>;
  const text = (field: string): string => {
    const value = record[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`a replay entry needs a non-empty ${field}`);
    }
    return value;
  };
  const task = text('task');
  if (identity.taskIds !== undefined && !identity.taskIds.includes(task)) {
    throw new Error(`replay task ${task} is not in the checked-in sample set`);
  }
  const repo = record.repo === undefined ? identity.repo : text('repo');
  if (repo !== identity.repo) {
    throw new Error(`replay repo ${repo} is not the sample repo ${identity.repo}`);
  }
  const baseSha = record.baseSha === undefined ? identity.baseSha : text('baseSha');
  if (baseSha !== identity.baseSha) {
    throw new Error(`replay baseSha ${baseSha} is not the sample base ${identity.baseSha}`);
  }
  const createdAt = Date.parse(text('createdAt'));
  if (!Number.isFinite(createdAt)) {
    throw new Error(`replay createdAt ${String(record.createdAt)} is not an ISO timestamp`);
  }
  const prNumber = record.prNumber ?? null;
  if (prNumber !== null && typeof prNumber !== 'number') {
    throw new Error('a replay prNumber must be a number or null');
  }
  const errorMessage = record.errorMessage ?? null;
  if (errorMessage !== null && typeof errorMessage !== 'string') {
    throw new Error('a replay errorMessage must be a string or null');
  }
  const kind = typeof record.kind === 'string' ? record.kind : null;
  const todoId = typeof record.todoId === 'string' ? record.todoId : null;
  return {
    task,
    kind,
    repo,
    baseSha,
    buildId: text('buildId'),
    todoId,
    createdAt,
    prNumber,
    errorMessage,
    outcome: classifyBuildCause({ errorMessage, prNumber, ageMs: 0 }),
  };
}

export function readReplayFile(path: string, window: ReplayWindow): BuildReplayEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must hold an array of replay entries`);
  }
  const entries = parsed.map((raw, index) => {
    try {
      return normalizeReplay(raw, window);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${path} entry [${index}]: ${reason}`);
    }
  });
  const inWindow = entries.filter(
    (entry) => entry.createdAt >= window.since && entry.createdAt < window.until,
  );
  if (inWindow.length === 0) {
    throw new Error(
      `no replay entries for ${window.repo} inside ${new Date(window.since).toISOString()} .. ${new Date(window.until).toISOString()}`,
    );
  }
  return inWindow;
}

export function replayOutcomeCause(entry: BuildReplayEntry): BuildCause | null {
  if (entry.prNumber !== null) return null;
  if (entry.outcome === 'cancelled' || entry.outcome === 'active') return null;
  return entry.outcome as BuildCause;
}

export function matchesReplay(
  entry: BuildReplayEntry,
  build: { buildId: string; errorMessage: string | null },
): boolean {
  if (entry.buildId !== build.buildId) return false;
  const expected = replayOutcomeCause(entry);
  const actual = classifyBuildCause({
    errorMessage: build.errorMessage,
    prNumber: null,
    ageMs: 0,
  });
  if (expected === null) return actual === 'active' && build.errorMessage === null;
  return actual === expected;
}

export function openReliabilityReportDb(dbPath: string): { db: Db; close(): void } {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  const db = drizzle(sqlite, { schema });
  return { db, close: () => sqlite.close() };
}

export function buildReliabilityReport(
  db: Db,
  options: ReliabilityReportOptions,
): ReliabilityReport {
  const buildRows = db
    .select({
      id: build.id,
      todoId: build.todoId,
      title: todo.title,
      createdAt: build.createdAt,
      errorMessage: build.errorMessage,
      prNumber: build.prNumber,
    })
    .from(build)
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        eq(todo.projectId, options.projectId),
        gte(build.createdAt, options.since),
        lte(build.createdAt, options.until),
      ),
    )
    .orderBy(asc(build.createdAt), asc(build.id))
    .all();
  const stepRows = buildRows.length
    ? db
        .select({ buildId: step.buildId, status: step.status, id: step.id })
        .from(step)
        .where(
          inArray(
            step.buildId,
            buildRows.map((row) => row.id),
          ),
        )
        .all()
    : [];
  const stepsByBuild = new Map<string, ReliabilityStepCounts>();
  for (const row of stepRows) {
    const counts = stepsByBuild.get(row.buildId) ?? { ...NO_STEPS };
    if (row.status === 'waiting_quota') counts.waitingQuota += 1;
    else counts[row.status] += 1;
    stepsByBuild.set(row.buildId, counts);
  }
  const failedStepIds = stepRows.filter((row) => row.status === 'failed').map((row) => row.id);
  const residualTextByBuild = new Map<string, string>();
  if (failedStepIds.length > 0) {
    const residualRows = db
      .select({
        conversationId: message.conversationId,
        content: message.content,
      })
      .from(message)
      .where(
        inArray(
          message.id,
          failedStepIds.map((id) => `plan-residual-${id}`),
        ),
      )
      .all();
    for (const row of residualRows) {
      const text = typeof row.content === 'string' ? row.content : String(row.content);
      const prior = residualTextByBuild.get(row.conversationId);
      residualTextByBuild.set(row.conversationId, prior === undefined ? text : `${prior}\n${text}`);
    }
  }
  const builds: ReliabilityBuildRow[] = [];
  for (const row of buildRows) {
    const ageMs = options.until - row.createdAt;
    const classificationError = row.errorMessage ?? residualTextByBuild.get(row.id) ?? null;
    const outcome = classifyBuildCause({
      errorMessage: classificationError,
      prNumber: row.prNumber,
      ageMs,
    });
    const messageText =
      classificationError === null ? null : sanitizeErrorMessage(classificationError, outcome);
    builds.push({
      id: row.id,
      todoId: row.todoId,
      title: row.title,
      createdAt: row.createdAt,
      ageHours: Number((ageMs / 3_600_000).toFixed(1)),
      prNumber: row.prNumber,
      outcome,
      message: messageText,
      steps: stepsByBuild.get(row.id) ?? NO_STEPS,
    });
  }
  return aggregateReport(
    { name: options.projectId, since: options.since, until: options.until },
    builds,
  );
}

function aggregateReport(
  identity: { name: string; since: number; until: number },
  builds: ReliabilityBuildRow[],
): ReliabilityReport {
  const causes = Object.fromEntries(BUILD_CAUSES.map((cause) => [cause, 0])) as Record<
    BuildCause,
    number
  >;
  for (const row of builds) {
    if (row.outcome === 'cancelled' || row.outcome === 'active' || row.outcome === 'reached-pr') {
      continue;
    }
    causes[row.outcome] += 1;
  }
  const reachedPr = builds.filter((row) => row.outcome === 'reached-pr').length;
  const cancelled = builds.filter((row) => row.outcome === 'cancelled').length;
  const active = builds.filter((row) => row.outcome === 'active').length;
  const perDay: ReliabilityDayRow[] = [];
  for (const row of builds) {
    const day = new Date(row.createdAt).toISOString().slice(0, 10);
    const existing = perDay.find((entry) => entry.day === day);
    if (existing === undefined) {
      perDay.push({
        day,
        started: 1,
        reachedPr: row.outcome === 'reached-pr' ? 1 : 0,
        rate: null,
      });
    } else {
      existing.started += 1;
      if (row.outcome === 'reached-pr') existing.reachedPr += 1;
    }
  }
  for (const entry of perDay) {
    entry.rate = entry.started > 0 ? entry.reachedPr / entry.started : null;
  }
  return {
    project: identity.name,
    since: identity.since,
    until: identity.until,
    buildsStarted: builds.length,
    reachedPr,
    cancelled,
    active,
    rate: builds.length > 0 ? reachedPr / builds.length : null,
    wilson95: wilsonInterval(reachedPr, builds.length),
    perDay,
    causes,
    builds,
  };
}

export function buildReplayReport(
  entries: readonly BuildReplayEntry[],
  window: { repo: string; since: number; until: number },
): ReliabilityReport {
  const builds: ReliabilityBuildRow[] = entries
    .slice()
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.buildId.localeCompare(right.buildId),
    )
    .map((entry) => {
      const ageMs = window.until - entry.createdAt;
      const outcome = classifyBuildCause({
        errorMessage: entry.errorMessage,
        prNumber: entry.prNumber,
        ageMs,
      });
      return {
        id: entry.buildId,
        todoId: entry.todoId ?? entry.task,
        title: entry.kind === null ? entry.task : `${entry.task} (${entry.kind})`,
        createdAt: entry.createdAt,
        ageHours: Number((ageMs / 3_600_000).toFixed(1)),
        prNumber: entry.prNumber,
        outcome,
        message:
          entry.errorMessage === null ? null : sanitizeErrorMessage(entry.errorMessage, outcome),
        steps: NO_STEPS,
      };
    });
  return aggregateReport({ name: window.repo, since: window.since, until: window.until }, builds);
}

const percent = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

export function renderReliabilityMarkdown(report: ReliabilityReport): string {
  const lines: string[] = [];
  lines.push('# Build-to-PR reliability report');
  lines.push('');
  lines.push(`- project: ${report.project}`);
  lines.push(
    `- window: ${new Date(report.since).toISOString()} .. ${new Date(report.until).toISOString()}`,
  );
  lines.push(`- builds started: ${report.buildsStarted}`);
  lines.push(`- reached PR: ${report.reachedPr}`);
  lines.push(
    `- build-to-PR rate: ${percent(report.rate)}${
      report.wilson95 === null
        ? ''
        : ` (Wilson 95% ${percent(report.wilson95[0])}..${percent(report.wilson95[1])})`
    }`,
  );
  lines.push(`- cancelled by operator: ${report.cancelled}`);
  lines.push(`- still active (younger than 6h at report time): ${report.active}`);
  lines.push('');
  lines.push('| day | started | reached PR | rate |');
  lines.push('|---|---|---|---|');
  for (const day of report.perDay) {
    lines.push(`| ${day.day} | ${day.started} | ${day.reachedPr} | ${percent(day.rate)} |`);
  }
  lines.push('');
  lines.push('| cause | builds |');
  lines.push('|---|---|');
  for (const cause of BUILD_CAUSES) {
    lines.push(`| ${cause} | ${report.causes[cause]} |`);
  }
  lines.push('');
  lines.push(
    '| build | task | outcome | age (h) | steps (done/failed/pending/claimed/waiting/stopped) | message |',
  );
  lines.push('|---|---|---|---|---|---|');
  for (const row of report.builds) {
    const steps = `${row.steps.done}/${row.steps.failed}/${row.steps.pending}/${row.steps.claimed}/${row.steps.waitingQuota}/${row.steps.stopped}`;
    lines.push(
      `| ${row.id} | ${row.title} | ${row.outcome}${row.prNumber !== null ? ` #${row.prNumber}` : ''} | ${row.ageHours} | ${steps} | ${row.message ?? ''} |`,
    );
  }
  return lines.join('\n');
}
