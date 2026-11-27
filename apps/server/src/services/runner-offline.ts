import {
  parseLocalFolderActionInstruction,
  parseLocalMergeInstruction,
  type RouteOverride,
  RUNNER_OFFLINE_KIND,
  type RunnerOfflineContent,
  runnerOfflineContentSchema,
} from '@cairn/shared';
import { and, desc, eq, gte, inArray, isNotNull, isNull, like } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefMessage, machine, step, todo } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { enabledAntigravitySubscriptionId } from './antigravity-subscriptions.js';
import { BLOCKED_BY_HOLD } from './blockers.js';
import { type ChiefDeps, coordinatorThreadRow, ensureChief } from './chief.js';
import { enabledSubscriptionId } from './claude-subscriptions.js';
import { enabledDevinSubscriptionId } from './devin-subscriptions.js';
import { requiredGithubPushRepoForStep } from './dispatch-eligibility.js';
import { projectOfTodo } from './git.js';
import {
  priorSessionOf,
  targetUnavailable,
  teamDefaultMachineId,
  type WorkerStepFacts,
} from './machine-routing.js';
import { effectiveModel } from './model-fallback.js';
import { mergedCatalogModels } from './model-liveness.js';
import { profileForStep } from './routing-rules.js';
import { stepQueueProjector } from './step-queue.js';

export const RUNNER_OFFLINE_NOTICE_MS = 2 * 60_000;

const NOTICE_PREFIX = 'runner-offline-';

type MachineRow = typeof machine.$inferSelect;
interface PendingRow {
  stepRow: typeof step.$inferSelect;
  buildRow: typeof build.$inferSelect;
  todoRow: typeof todo.$inferSelect;
}

function noticeId(machineId: string): string {
  return `${NOTICE_PREFIX}${machineId}`;
}

interface NoticeRow {
  row: typeof chiefMessage.$inferSelect;
  content: RunnerOfflineContent;
}

function canonicalNotice(group: NoticeRow[], machineId: string): NoticeRow {
  const open = group.filter((entry) => entry.content.recoveredAt === null);
  const pool = open.length > 0 ? open : group;
  const stable = noticeId(machineId);
  return pool.reduce((best, entry) => {
    if (entry.row.id === stable) return entry;
    if (best.row.id === stable) return best;
    return entry.row.createdAt > best.row.createdAt ? entry : best;
  });
}

function waitingByMachine(db: Db): Map<string, Map<string, PendingRow>> {
  const rows = db
    .select({ stepRow: step, buildRow: build, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), isNull(todo.archivedAt)))
    .all();
  const projectors = new Map<string, ReturnType<typeof stepQueueProjector>>();
  const waiting = new Map<string, Map<string, PendingRow>>();
  for (const row of rows) {
    if (row.stepRow.holdReason === 'quota' || row.stepRow.holdReason === BLOCKED_BY_HOLD) continue;
    const projector =
      projectors.get(row.todoRow.teamId) ?? stepQueueProjector(db, row.todoRow.teamId);
    projectors.set(row.todoRow.teamId, projector);
    const queue = projector.project({
      id: row.stepRow.id,
      createdAt: row.stepRow.createdAt,
      homeMachineId:
        profileForStep(db, row.todoRow, row.stepRow.kind, row.stepRow.id)?.machineId ?? null,
      holdReason: row.stepRow.holdReason,
      holdUntil: row.stepRow.holdUntil,
    });
    const machineId = queue?.waitingFor?.machineId;
    if (machineId === undefined) continue;
    const forMachine = waiting.get(machineId) ?? new Map<string, PendingRow>();
    if (!forMachine.has(row.todoRow.id)) forMachine.set(row.todoRow.id, row);
    waiting.set(machineId, forMachine);
  }
  return waiting;
}

function sessionStarted(db: Db, row: PendingRow): boolean {
  const prior = priorSessionOf(
    db,
    row.stepRow,
    row.buildRow,
    {
      claude: enabledSubscriptionId({ db }, row.todoRow.teamId),
      devin: enabledDevinSubscriptionId({ db }, row.todoRow.teamId),
      antigravity: enabledAntigravitySubscriptionId({ db }, row.todoRow.teamId),
    },
    profileForStep(db, row.todoRow, row.stepRow.kind, row.stepRow.id)?.provider ?? null,
  );
  return !prior.freshSession && prior.priorSessionId !== null;
}

function canRunOn(db: Db, row: PendingRow, target: MachineRow, now: number): boolean {
  if (sessionStarted(db, row)) return false;
  const projectRow = projectOfTodo(db, row.todoRow);
  const localProject = projectRow?.repoKind === 'local';
  if (localProject) return false;
  const agentRow = profileForStep(db, row.todoRow, row.stepRow.kind, row.stepRow.id);
  if (agentRow === null || agentRow.modelId == null) return false;
  const facts: WorkerStepFacts = {
    agentRow,
    model: effectiveModel(agentRow, row.stepRow),
    localProject,
    localMerge:
      parseLocalMergeInstruction(row.stepRow.prompt) !== null ||
      parseLocalFolderActionInstruction(row.stepRow.prompt) !== null,
    githubPushRepo: requiredGithubPushRepoForStep({
      project: projectRow,
      step: row.stepRow,
      todo: row.todoRow,
      agentTools: agentRow.tools,
    }),
  };
  return !targetUnavailable(
    db,
    target,
    row.todoRow.teamId,
    facts,
    mergedCatalogModels(row.todoRow.teamId),
    now,
  );
}

function alternativeFor(
  db: Db,
  offline: MachineRow,
  waiting: Map<string, PendingRow>,
  now: number,
): RunnerOfflineContent['alternative'] {
  const defaultId = teamDefaultMachineId(db, offline.teamId);
  const candidates = db
    .select()
    .from(machine)
    .where(
      and(
        eq(machine.teamId, offline.teamId),
        eq(machine.online, true),
        isNotNull(machine.tokenHash),
        isNull(machine.retiredAt),
      ),
    )
    .all()
    .filter((row) => row.id !== offline.id)
    .sort((a, b) =>
      a.id === defaultId ? -1 : b.id === defaultId ? 1 : a.name.localeCompare(b.name),
    );
  for (const candidate of candidates) {
    const todoIds = [...waiting.values()]
      .filter((row) => canRunOn(db, row, candidate, now))
      .map((row) => row.todoRow.id);
    if (todoIds.length > 0) return { machineId: candidate.id, name: candidate.name, todoIds };
  }
  return null;
}

function todoState(
  db: Db,
  todoId: string,
  runner: MachineRow,
  since: number,
  waiting: Map<string, PendingRow> | undefined,
): RunnerOfflineContent['todos'][number]['state'] {
  if (waiting?.has(todoId) === true) return 'waiting';
  const claimed = db
    .select({ machineId: step.machineId })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .where(and(eq(build.todoId, todoId), isNotNull(step.machineId), gte(step.claimedAt, since)))
    .orderBy(desc(step.claimedAt))
    .get();
  if (claimed !== undefined) return claimed.machineId === runner.id ? 'started' : 'moved';
  const pending = db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .where(and(eq(build.todoId, todoId), eq(step.status, 'pending')))
    .get();
  return pending === undefined ? 'gone' : 'moved';
}

function nextContent(
  db: Db,
  current: RunnerOfflineContent,
  runner: MachineRow,
  waiting: Map<string, PendingRow> | undefined,
  now: number,
): RunnerOfflineContent {
  if (current.recoveredAt !== null) return current;
  const back = runner.online || (runner.lastSeenAt ?? 0) !== current.lastSeenAt;
  const listed = new Map(current.todos.map((row) => [row.id, row]));
  if (!back) {
    for (const row of waiting?.values() ?? []) {
      if (!listed.has(row.todoRow.id)) {
        listed.set(row.todoRow.id, {
          id: row.todoRow.id,
          seqNum: row.todoRow.seqNum,
          title: row.todoRow.title,
          state: 'waiting',
        });
      }
    }
  }
  const todos = [...listed.values()]
    .map((row) => ({ ...row, state: todoState(db, row.id, runner, current.lastSeenAt, waiting) }))
    .sort((a, b) => a.seqNum - b.seqNum);
  const backAt = back ? (current.backAt ?? now) : null;
  const settled =
    backAt !== null &&
    (todos.every((row) => row.state !== 'waiting') || now - backAt >= RUNNER_OFFLINE_NOTICE_MS);
  return {
    ...current,
    machineName: runner.name,
    todos,
    alternative: back || waiting === undefined ? null : alternativeFor(db, runner, waiting, now),
    backAt,
    recoveredAt: settled ? now : null,
  };
}

function publishNotice(deps: ChiefDeps, id: string): void {
  const row = deps.db.select().from(chiefMessage).where(eq(chiefMessage.id, id)).get();
  if (row !== undefined) deps.convHub?.publishMessage(row.threadId, row);
}

export function sweepOfflineRunners(deps: ChiefDeps, now: number = nowMs()): void {
  const { db } = deps;
  const waiting = waitingByMachine(db);
  const machines = new Map<string, MachineRow>(
    db
      .select()
      .from(machine)
      .all()
      .map((row) => [row.id, row]),
  );
  const byMachine = new Map<string, NoticeRow[]>();
  for (const row of db
    .select()
    .from(chiefMessage)
    .where(like(chiefMessage.id, `${NOTICE_PREFIX}%`))
    .all()) {
    let stored: unknown = null;
    try {
      stored = JSON.parse(String(row.content));
    } catch {}
    const parsed = runnerOfflineContentSchema.safeParse(stored);
    if (!parsed.success) continue;
    const group = byMachine.get(parsed.data.machineId) ?? [];
    group.push({ row, content: parsed.data });
    byMachine.set(parsed.data.machineId, group);
  }
  const canonical = new Map<string, NoticeRow>();
  for (const [machineId, group] of byMachine) {
    const keep = canonicalNotice(group, machineId);
    canonical.set(machineId, keep);
    const extras = group.filter((entry) => entry !== keep).map((entry) => entry.row.id);
    if (extras.length > 0) db.delete(chiefMessage).where(inArray(chiefMessage.id, extras)).run();
  }
  const created = new Set<string>();
  for (const [machineId, rows] of waiting) {
    const runner = machines.get(machineId);
    if (runner === undefined || runner.online) continue;
    const lastSeenAt = runner.lastSeenAt ?? 0;
    if (now - lastSeenAt < RUNNER_OFFLINE_NOTICE_MS) continue;
    const existing = canonical.get(machineId);
    if (
      existing !== undefined &&
      existing.content.recoveredAt === null &&
      existing.content.backAt === null
    )
      continue;
    const content = nextContent(
      db,
      {
        kind: RUNNER_OFFLINE_KIND,
        machineId,
        machineName: runner.name,
        lastSeenAt,
        todos: [],
        alternative: null,
        backAt: null,
        recoveredAt: null,
      },
      runner,
      rows,
      now,
    );
    if (existing !== undefined) {
      db.update(chiefMessage)
        .set({ content: JSON.stringify(content), createdAt: now })
        .where(eq(chiefMessage.id, existing.row.id))
        .run();
      publishNotice(deps, existing.row.id);
      continue;
    }
    const thread = coordinatorThreadRow(deps, ensureChief(deps, runner.teamId));
    const id = noticeId(machineId);
    const inserted = db
      .insert(chiefMessage)
      .values({
        id,
        threadId: thread.id,
        role: 'system',
        content: JSON.stringify(content),
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes > 0) created.add(id);
  }
  const open = db
    .select()
    .from(chiefMessage)
    .where(
      and(
        like(chiefMessage.id, `${NOTICE_PREFIX}%`),
        like(chiefMessage.content, '%recoveredAt\\":null%'),
      ),
    )
    .all();
  for (const row of open) {
    let stored: unknown = null;
    try {
      stored = JSON.parse(String(row.content));
    } catch {}
    const parsed = runnerOfflineContentSchema.safeParse(stored);
    if (!parsed.success || parsed.data.recoveredAt !== null) continue;
    const runner = machines.get(parsed.data.machineId);
    const next =
      runner === undefined
        ? { ...parsed.data, alternative: null, recoveredAt: now }
        : nextContent(db, parsed.data, runner, waiting.get(runner.id), now);
    const text = JSON.stringify(next);
    if (text !== row.content) {
      db.update(chiefMessage).set({ content: text }).where(eq(chiefMessage.id, row.id)).run();
    }
    if (text !== row.content || created.has(row.id)) publishNotice(deps, row.id);
  }
}

export function runnerOverrideFor(
  db: Db,
  todoRow: { id: string; teamId: string; routeOverride?: RouteOverride | null },
  machineId: string,
): RouteOverride {
  const target = db
    .select()
    .from(machine)
    .where(and(eq(machine.id, machineId), eq(machine.teamId, todoRow.teamId)))
    .get();
  if (target === undefined) throw notFound(`machine ${machineId}`);
  const pending = db
    .select({ stepRow: step, buildRow: build, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(build.todoId, todoRow.id), eq(step.status, 'pending')))
    .all();
  const first = pending[0];
  if (first === undefined) throw conflict('这个任务已经开工，换执行机请新开任务');
  if (projectOfTodo(db, first.todoRow)?.repoKind === 'local') {
    throw conflict('项目代码只在一台执行机上，不能改到别的执行机');
  }
  if (pending.some((row) => sessionStarted(db, row))) {
    throw conflict('这个任务已经开过会话，换执行机请新开任务');
  }
  const now = nowMs();
  if (!pending.every((row) => canRunOn(db, row, target, now))) {
    throw conflict(`${target.name} 现在无法运行这个任务`);
  }
  return { ...(todoRow.routeOverride ?? {}), machineId };
}
