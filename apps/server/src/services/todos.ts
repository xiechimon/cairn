import type {
  Assignment,
  GithubRepoRef,
  Phase,
  SecretBox,
  TodoOutputKind,
  TodoRecord,
  TodoSourceKind,
  UserRecord,
} from '@cairn/shared';
import {
  canMoveTodoProject,
  DONE_ANNOUNCEMENT,
  derivePlaceholderTitle,
  githubIssueSourceRef,
  IN_PROGRESS_PHASES,
  isStartedTodo,
  orchestrationSourceRef,
  PLACEHOLDER_TITLE_FALLBACK,
  parseGithubIssueSourceRef,
} from '@cairn/shared';
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  build,
  machine,
  message,
  plan as planTable,
  schedule,
  steerPending,
  step,
  stopPending,
  tag,
  todo,
  todoTag,
  tokenUsage,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubCloseIssue, githubCreateIssue, githubUpdateIssueTitle } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { triggerChiefWakes } from './chief.js';
import {
  agentForStep as agentForStepEligibility,
  capabilityGatePasses,
  runtimeGatePasses,
} from './dispatch-eligibility.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { hasGithubConnection, teamGithubToken } from './github-connection.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { notifyTodoPhase } from './notifications.js';
import type { OAuthClientConfig } from './oauth.js';
import { assertPhaseTransition, canManualMovePhase } from './phase.js';
import { insertGateAnnouncement } from './transcript.js';

type TodoRow = typeof todo.$inferSelect;

export interface TodoDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  user: UserRecord;
  convHub?: ConversationStreamHub;
  box?: SecretBox;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
}

function notifyPhaseEntry(deps: TodoDeps, record: TodoRecord, from: Phase, to: Phase): void {
  if (from === to) return;
  if (to === 'confirm' || to === 'review') notifyTodoPhase(deps, record, to);
  triggerChiefWakes(deps, record, to);
}

export function toTodoRecord(deps: TodoDeps, row: TodoRow): TodoRecord {
  const { db } = deps;
  const tagIds = db
    .select({ tagId: todoTag.tagId })
    .from(todoTag)
    .where(eq(todoTag.todoId, row.id))
    .all()
    .map((r) => r.tagId);
  const history = db
    .select({ buildId: build.id, createdAt: build.createdAt })
    .from(build)
    .where(eq(build.todoId, row.id))
    .orderBy(asc(build.createdAt))
    .all();
  const buildAgentId = row.assignment?.build?.agentId ?? null;
  const agentRow = buildAgentId
    ? db.select().from(agent).where(eq(agent.id, buildAgentId)).get()
    : undefined;
  let quotaWait: TodoRecord['quotaWait'] = null;
  if (row.latestBuildId !== null) {
    const waiting = db
      .select()
      .from(step)
      .where(and(eq(step.buildId, row.latestBuildId), eq(step.status, 'waiting_quota')))
      .all()
      .at(-1);
    const block = waiting?.quotaBlock ?? null;
    if (block !== null) {
      quotaWait = {
        kind: block.kind,
        providerId: block.providerId,
        label: block.label,
        retryAfterMs: block.retryAfterMs,
        probeAt: block.probeAt,
      };
    }
  }
  const waitingOn = waitingOnOf(deps, row);
  const usage = db
    .select({
      rows: sql<number>`count(*)`,
      input: sql<number>`coalesce(sum(${tokenUsage.costInput}), 0)`,
      output: sql<number>`coalesce(sum(${tokenUsage.costOutput}), 0)`,
      cacheRead: sql<number>`coalesce(sum(${tokenUsage.costCacheRead}), 0)`,
      cacheWrite: sql<number>`coalesce(sum(${tokenUsage.costCacheWrite}), 0)`,
      total: sql<number>`coalesce(sum(${tokenUsage.costTotal}), 0)`,
      priced: sql<number>`count(${tokenUsage.costTotal})`,
    })
    .from(tokenUsage)
    .innerJoin(build, eq(build.id, tokenUsage.buildId))
    .where(eq(build.todoId, row.id))
    .get();
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    title: row.title,
    spec: row.spec,
    phase: row.phase,
    phaseAt: row.phaseAt,
    seqNum: row.seqNum,
    orderIndex: row.orderIndex,
    tagIds,
    assignment: row.assignment ?? null,
    agent: agentRow ? { id: agentRow.id, displayName: agentRow.displayName } : null,
    latestBuildId: row.latestBuildId,
    lastRunAt: row.lastRunAt,
    hasChanges: row.hasChanges,
    hasPlan: row.hasPlan,
    buildHistory: history,
    sourceTodo: row.sourceTodo,
    blockedBy: row.blockedBy ?? null,
    v: row.v,
    createdBy: row.createdBy,
    ownerId: row.ownerId,
    sourceBuildId: row.sourceBuildId,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    output: row.output,
    ...(waitingOn !== undefined ? { waitingOn } : {}),
    quotaWait,
    ...(usage !== undefined && usage.rows > 0
      ? {
          usageCost: {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
            total: usage.total,
            ...(usage.priced > 0 ? (usage.total === 0 ? { priced: true } : {}) : { priced: false }),
          },
        }
      : {}),
  };
}

function waitingOnOf(
  deps: TodoDeps,
  row: TodoRow,
): { on: 'machine' | 'quota'; retryAt: number | null } | undefined {
  if (!(IN_PROGRESS_PHASES as readonly string[]).includes(row.phase) || row.latestBuildId === null)
    return undefined;
  const pendingSteps = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, row.latestBuildId), eq(step.status, 'pending')))
    .all();
  if (pendingSteps.length === 0) return undefined;
  const held = pendingSteps.find((s) => s.holdReason === 'quota');
  if (held !== undefined) {
    return { on: 'quota', retryAt: held.holdUntil ?? null };
  }
  for (const s of pendingSteps) {
    const agentRow = agentForStepEligibility(deps.db, row, s.kind, s.prompt);
    if (agentRow === null) continue;
    if (agentRow.machineId === null) {
      return { on: 'machine', retryAt: null };
    }
    const home = deps.db.select().from(machine).where(eq(machine.id, agentRow.machineId)).get();
    if (home === undefined || !home.online) {
      return { on: 'machine', retryAt: null };
    }
    if (!runtimeGatePasses(home, s.fallback?.model?.provider ?? agentRow.provider)) {
      return { on: 'machine', retryAt: null };
    }
    if (!capabilityGatePasses(home, agentRow)) {
      return { on: 'machine', retryAt: null };
    }
  }
  const online = deps.db
    .select({ id: machine.id })
    .from(machine)
    .where(and(eq(machine.teamId, row.teamId), eq(machine.online, true)))
    .all();
  if (online.length === 0) {
    return { on: 'machine', retryAt: null };
  }
  return undefined;
}

function getRow(deps: TodoDeps, id: string): TodoRow | undefined {
  return deps.db.select().from(todo).where(eq(todo.id, id)).get();
}

export function listTodos(
  deps: TodoDeps,
  filter: { teamId?: string; projectId?: string } = {},
): TodoRecord[] {
  const conds = [
    filter.teamId !== undefined ? eq(todo.teamId, filter.teamId) : undefined,
    filter.projectId !== undefined ? eq(todo.projectId, filter.projectId) : undefined,
  ].filter((c) => c !== undefined);
  const rows = deps.db
    .select()
    .from(todo)
    .where(conds.length > 0 ? and(...conds) : sql`1=1`)
    .orderBy(asc(todo.seqNum))
    .all();
  return rows.map((row) => toTodoRecord(deps, row));
}

export function getTodo(deps: TodoDeps, id: string): TodoRecord | null {
  const row = getRow(deps, id);
  return row ? toTodoRecord(deps, row) : null;
}

function assertTagsInProject(db: Db, projectId: string, tagIds: readonly string[]): void {
  if (tagIds.length === 0) return;
  const owned = new Set(
    db
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.projectId, projectId), inArray(tag.id, [...tagIds])))
      .all()
      .map((r) => r.id),
  );
  for (const tagId of tagIds) {
    if (!owned.has(tagId)) throw new HttpError(400, `tag ${tagId} not in project`);
  }
}

export function createTodo(
  deps: TodoDeps,
  input: {
    teamId: string;
    projectId: string;
    title: string;
    spec: string;
    tagIds?: string[];
    createdBy: string | null;
    ownerId: string | null;
    sourceKind?: TodoSourceKind;
    sourceRef?: string;
    orchestration?: { threadId: string };
    output?: TodoOutputKind;
    userSpecAttachmentIds?: string[];
  },
): TodoRecord {
  const { db, hub } = deps;
  const tagIds = [...new Set(input.tagIds ?? [])];
  assertTagsInProject(db, input.projectId, tagIds);
  const seqRow = db
    .select({ n: max(todo.seqNum) })
    .from(todo)
    .where(eq(todo.teamId, input.teamId))
    .get();
  const seqNum = (seqRow?.n ?? 0) + 1;
  const orderRow = db
    .select({ n: max(todo.orderIndex) })
    .from(todo)
    .where(and(eq(todo.projectId, input.projectId), eq(todo.phase, 'todo')))
    .get();
  const now = nowMs();
  const id = newRecordId();
  const title =
    input.title.trim() || derivePlaceholderTitle(input.spec) || PLACEHOLDER_TITLE_FALLBACK;
  const selfIssue =
    input.sourceKind === undefined ? planSelfIssue(deps, input.teamId, input.projectId) : null;
  db.insert(todo)
    .values({
      id,
      teamId: input.teamId,
      projectId: input.projectId,
      title,
      spec: input.spec,
      phase: 'todo',
      phaseAt: now,
      seqNum,
      orderIndex: (orderRow?.n ?? -1) + 1,
      assignment: null,
      latestBuildId: null,
      lastRunAt: null,
      hasChanges: false,
      hasPlan: false,
      sourceTodo: null,
      v: 1,
      createdBy: input.createdBy,
      ownerId: input.ownerId,
      sourceBuildId: null,
      sourceKind:
        input.sourceKind ??
        (selfIssue !== null
          ? 'github-issue-self'
          : input.orchestration !== undefined
            ? 'orchestration'
            : null),
      sourceRef:
        input.sourceRef ??
        (selfIssue === null && input.orchestration !== undefined
          ? orchestrationSourceRef(input.orchestration.threadId)
          : null),
      output: input.output ?? 'code',
      ...(input.userSpecAttachmentIds !== undefined
        ? { userSpecAttachmentIds: input.userSpecAttachmentIds }
        : {}),
    })
    .run();
  for (const tagId of tagIds) {
    db.insert(todoTag).values({ todoId: id, tagId }).run();
  }
  const record = getTodo(deps, id);
  if (!record) throw new Error('todo missing after insert');
  hub.publishTodoDoc(input.teamId, record);
  if (selfIssue !== null) scheduleSelfIssueCreate(deps, id);
  return record;
}

export function updateTodo(
  deps: TodoDeps,
  id: string,
  patch: {
    title?: string;
    spec?: string;
    phase?: Phase;
    tagIds?: string[];
    orderIndex?: number;
    projectId?: string;
    assignment?: {
      plan?: NonNullable<Assignment['plan']>;
      build?: NonNullable<Assignment['build']>;
      review?: NonNullable<Assignment['review']>;
      verify?: NonNullable<Assignment['verify']>;
    };
  },
  opts: { manualPhase?: boolean; userSpecAttachmentIds?: string[] } = {},
): TodoRecord | null {
  const { db, hub } = deps;
  const row = getRow(deps, id);
  if (!row) return null;

  const sets: Partial<TodoRow> = {};
  const move =
    patch.projectId !== undefined && patch.projectId !== row.projectId
      ? planProjectMove(deps, row, patch.projectId, patch.tagIds ?? [])
      : null;
  if (move !== null) Object.assign(sets, move.sets);
  if (patch.title !== undefined) sets.title = patch.title;
  if (patch.spec !== undefined) {
    sets.spec = patch.spec;
    sets.userSpecAttachmentIds = opts.userSpecAttachmentIds ?? [];
  }
  if (patch.orderIndex !== undefined) sets.orderIndex = patch.orderIndex;
  if (patch.assignment !== undefined) {
    const merged: NonNullable<TodoRow['assignment']> = {
      plan:
        patch.assignment.plan !== undefined
          ? patch.assignment.plan
          : (row.assignment?.plan ?? null),
      build:
        patch.assignment.build !== undefined
          ? patch.assignment.build
          : (row.assignment?.build ?? null),
    };
    if (patch.assignment.review !== undefined || row.assignment?.review != null) {
      merged.review =
        patch.assignment.review !== undefined
          ? patch.assignment.review
          : (row.assignment?.review ?? null);
    }
    if (patch.assignment.verify !== undefined || row.assignment?.verify != null) {
      merged.verify =
        patch.assignment.verify !== undefined
          ? patch.assignment.verify
          : (row.assignment?.verify ?? null);
    }
    sets.assignment = merged;
  }
  let manualPhaseApplied = false;
  if (patch.phase !== undefined && patch.phase !== row.phase) {
    manualPhaseApplied = opts.manualPhase === true && canManualMovePhase(row.phase, patch.phase);
    if (!manualPhaseApplied) assertPhaseTransition(row.phase, patch.phase);
    if (row.phase === 'failed' && patch.phase === 'review') {
      throw new HttpError(
        409,
        'failed 任务的审核关口恢复由合并/审核重跑动作发起（build 腿已交付时），手动改相不收',
      );
    }
    if (row.phase === 'done' && patch.phase === 'review' && !row.hasChanges) {
      throw new HttpError(409, '无变更产物的已完成任务不能拖回待处理（没有可重开验收的东西）');
    }
    sets.phase = patch.phase;
    sets.phaseAt = nowMs();
  }
  if (Object.keys(sets).length > 0) {
    sets.v = row.v + 1;
    db.update(todo).set(sets).where(eq(todo.id, id)).run();
  }
  if (move !== null) {
    db.update(schedule)
      .set({ projectId: move.sets.projectId })
      .where(eq(schedule.todoId, id))
      .run();
    if (patch.tagIds === undefined) db.delete(todoTag).where(eq(todoTag.todoId, id)).run();
  }
  if (patch.tagIds !== undefined) {
    db.delete(todoTag).where(eq(todoTag.todoId, id)).run();
    for (const tagId of patch.tagIds) {
      db.insert(todoTag).values({ todoId: id, tagId }).run();
    }
    if (Object.keys(sets).length === 0) {
      db.update(todo)
        .set({ v: row.v + 1 })
        .where(eq(todo.id, id))
        .run();
    }
  }

  if (
    sets.phase === 'done' &&
    (row.phase === 'confirm' || row.phase === 'review') &&
    row.latestBuildId !== null
  ) {
    insertGateAnnouncement(deps, row.latestBuildId, DONE_ANNOUNCEMENT, deps.user.displayName);
  }

  const record = getTodo(deps, id);
  if (!record) return null;
  hub.publishTodoDoc(record.teamId, record);
  if (move?.closeIssueRef != null) scheduleMovedIssueClose(deps, row.teamId, move);
  if (move !== null && record.sourceKind === 'github-issue-self') {
    scheduleSelfIssueCreate(deps, id);
  }
  if (patch.phase !== undefined && !manualPhaseApplied) {
    notifyPhaseEntry(deps, record, row.phase, patch.phase);
  }
  if (sets.phase === 'done') settleSplitOnDone(deps, id);
  return record;
}

interface ProjectMove {
  sets: Pick<TodoRow, 'projectId' | 'orderIndex'> &
    Partial<Pick<TodoRow, 'sourceKind' | 'sourceRef'>>;
  closeIssueRef: string | null;
  targetName: string;
}

function planProjectMove(
  deps: TodoDeps,
  row: TodoRow,
  projectId: string,
  tagIds: readonly string[],
): ProjectMove {
  const target = projectOfTodo(deps.db, { projectId, teamId: row.teamId });
  if (target === undefined) throw new HttpError(404, `project ${projectId}`);
  assertTagsInProject(deps.db, target.id, tagIds);
  if (!canMoveTodoProject(row)) {
    throw new HttpError(
      409,
      row.sourceKind === 'github-issue'
        ? '从 GitHub issue 导入的任务不能换项目'
        : '这张卡已经开始了，不能换项目',
    );
  }
  if (selfIssueInFlight.has(row.id)) {
    throw new HttpError(409, '正在给这张卡开 GitHub issue，稍后再换项目');
  }
  const orderRow = deps.db
    .select({ n: max(todo.orderIndex) })
    .from(todo)
    .where(and(eq(todo.projectId, target.id), eq(todo.phase, 'todo')))
    .get();
  const sets: ProjectMove['sets'] = { projectId: target.id, orderIndex: (orderRow?.n ?? -1) + 1 };
  const targetOpensIssues = planSelfIssue(deps, row.teamId, target.id) !== null;
  const dropsIssue = row.sourceKind === 'github-issue-self' && !targetOpensIssues;
  if (dropsIssue) {
    sets.sourceKind = null;
    sets.sourceRef = null;
  } else if (row.sourceKind === null && targetOpensIssues) {
    sets.sourceKind = 'github-issue-self';
  }
  return {
    sets,
    closeIssueRef: dropsIssue ? row.sourceRef : null,
    targetName: target.name,
  };
}

function scheduleMovedIssueClose(deps: TodoDeps, teamId: string, move: ProjectMove): void {
  const parsed = move.closeIssueRef === null ? null : parseGithubIssueSourceRef(move.closeIssueRef);
  if (parsed === null || deps.box === undefined) return;
  void teamGithubToken(deps, teamId)
    .then((access) =>
      'token' in access
        ? githubCloseIssue(
            deps.githubFetch ?? fetch,
            access.token,
            parsed.owner,
            parsed.repo,
            parsed.issueNumber,
            `Cairn：这个任务挪到了项目「${move.targetName}」，这里的 issue 关闭。`,
          )
        : console.warn(`moved todo: no GitHub token to close ${move.closeIssueRef}`),
    )
    .catch((error: unknown) =>
      console.warn(`moved todo: closing ${move.closeIssueRef} failed`, error),
    );
}

export function setTodoPhase(
  deps: TodoDeps,
  id: string,
  to: Phase,
  extra: Partial<
    Pick<TodoRow, 'hasChanges' | 'hasPlan' | 'latestBuildId' | 'lastRunAt' | 'assignment'>
  > = {},
): TodoRecord | null {
  const { db } = deps;
  const row = getRow(deps, id);
  if (!row) return null;
  if (row.phase === to) {
    const changed = (Object.keys(extra) as (keyof typeof extra)[]).filter(
      (k) => extra[k] !== undefined && JSON.stringify(extra[k]) !== JSON.stringify(row[k]),
    );
    if (changed.length === 0) return getTodo(deps, id);
    db.update(todo)
      .set({ ...extra, v: row.v + 1 })
      .where(eq(todo.id, id))
      .run();
    const record = getTodo(deps, id);
    if (!record) return null;
    deps.hub.publishTodoDoc(record.teamId, record);
    return record;
  }
  assertPhaseTransition(row.phase, to);
  db.update(todo)
    .set({ ...extra, phase: to, phaseAt: nowMs(), v: row.v + 1 })
    .where(eq(todo.id, id))
    .run();
  const record = getTodo(deps, id);
  if (!record) return null;
  deps.hub.publishTodoDoc(record.teamId, record);
  notifyPhaseEntry(deps, record, row.phase, to);
  if (to === 'done') settleSplitOnDone(deps, id);
  return record;
}

export function childrenOfTodo(db: Db, parentId: string): TodoRow[] {
  return db
    .select()
    .from(todo)
    .where(eq(todo.sourceTodo, parentId))
    .orderBy(asc(todo.seqNum))
    .all();
}

export function splitBlockersSatisfied(db: Db, row: TodoRow): boolean {
  const ids = row.blockedBy ?? [];
  if (ids.length === 0) return true;
  const done = new Set(
    db
      .select({ id: todo.id })
      .from(todo)
      .where(and(inArray(todo.id, ids), eq(todo.phase, 'done')))
      .all()
      .map((r) => r.id),
  );
  return ids.every((id) => done.has(id));
}

export function settleSplitOnDone(deps: TodoDeps, childId: string): void {
  const { db } = deps;
  const child = getRow(deps, childId);
  if (child === undefined || child.sourceTodo === null) return;
  const parent = getRow(deps, child.sourceTodo);
  if (parent === undefined || parent.phase === 'done') return;
  const children = childrenOfTodo(db, parent.id);
  if (children.length === 0) return;
  if (!children.every((c) => c.phase === 'done')) return;
  setTodoPhase(deps, parent.id, 'done', { lastRunAt: nowMs() });
  if (parent.latestBuildId !== null) {
    insertGateAnnouncement(deps, parent.latestBuildId, DONE_ANNOUNCEMENT, 'Chief');
  }
}

export function resetTodo(
  deps: TodoDeps & { convHub?: ConversationStreamHub },
  id: string,
  expected?: { phase?: Phase; buildId?: string | null },
): { stale: boolean; record: TodoRecord } | null {
  const { db, hub } = deps;
  const row = getRow(deps, id);
  if (!row) return null;
  const current = getTodo(deps, id);
  if (!current) return null;
  if (expected?.phase !== undefined && expected.phase !== row.phase) {
    return { stale: true, record: current };
  }
  if (expected?.buildId !== undefined && expected.buildId !== row.latestBuildId) {
    return { stale: true, record: current };
  }
  if (!isStartedTodo(row)) return { stale: false, record: current };

  const buildRows = db.select().from(build).where(eq(build.todoId, id)).all();
  const buildIds = buildRows.map((b) => b.id);
  if (buildIds.length > 0) {
    for (const b of buildRows) {
      const active = db
        .select()
        .from(step)
        .where(and(eq(step.buildId, b.id), inArray(step.status, ['pending', 'claimed'])))
        .orderBy(asc(step.createdAt))
        .all()
        .at(-1);
      if (active?.status === 'claimed') {
        db.insert(stopPending)
          .values({ conversationId: b.id, stepId: active.id, discard: false, createdAt: nowMs() })
          .onConflictDoUpdate({
            target: stopPending.conversationId,
            set: { stepId: active.id, discard: false, createdAt: nowMs() },
          })
          .run();
        deps.machineHub?.stopSignal(row.teamId, active.id);
      }
    }
    db.delete(stopPending).where(inArray(stopPending.conversationId, buildIds)).run();
    db.delete(steerPending).where(inArray(steerPending.conversationId, buildIds)).run();
    db.delete(step).where(inArray(step.buildId, buildIds)).run();
    db.delete(message).where(inArray(message.conversationId, buildIds)).run();
    db.delete(planTable).where(inArray(planTable.buildId, buildIds)).run();
    db.delete(build).where(eq(build.todoId, id)).run();
    for (const bid of buildIds) deps.convHub?.clearConversationBuffer(bid);
  }
  db.update(todo)
    .set({
      phase: 'todo',
      phaseAt: nowMs(),
      hasPlan: false,
      hasChanges: false,
      latestBuildId: null,
      lastRunAt: null,
      userMessageAttachmentIds: [],
      v: row.v + 1,
    })
    .where(eq(todo.id, id))
    .run();

  const record = getTodo(deps, id);
  if (!record) return null;
  hub.publishTodoDoc(record.teamId, record);
  return { stale: false, record };
}

export function deleteTodo(deps: TodoDeps, id: string): boolean {
  const { db } = deps;
  const row = getRow(deps, id);
  if (!row) return false;
  const buildIds = db
    .select({ id: build.id })
    .from(build)
    .where(eq(build.todoId, id))
    .all()
    .map((r) => r.id);
  if (buildIds.length > 0) {
    db.delete(step).where(inArray(step.buildId, buildIds)).run();
  }
  db.delete(todo).where(eq(todo.id, id)).run();
  return true;
}

const selfIssueInFlight = new Map<string, Promise<unknown>>();

export async function flushSelfIssueWrites(): Promise<void> {
  await Promise.all([...selfIssueInFlight.values()]);
}

function planSelfIssue(deps: TodoDeps, teamId: string, projectId: string): GithubRepoRef | null {
  if (deps.box === undefined) return null;
  const ref = githubRepoOfProject(projectOfTodo(deps.db, { projectId, teamId }));
  if (ref === null) return null;
  if (!hasGithubConnection(deps.db, teamId)) return null;
  return ref;
}

function scheduleSelfIssueCreate(deps: TodoDeps, todoId: string): void {
  const pending = runSelfIssueCreate(deps, todoId)
    .catch(() => undefined)
    .finally(() => {
      if (selfIssueInFlight.get(todoId) === pending) selfIssueInFlight.delete(todoId);
    });
  selfIssueInFlight.set(todoId, pending);
}

async function runSelfIssueCreate(deps: TodoDeps, todoId: string): Promise<TodoRecord | null> {
  const { db, hub, box } = deps;
  const row = getRow(deps, todoId);
  if (row?.sourceKind !== 'github-issue-self') return null;
  const repoRef = githubRepoOfProject(projectOfTodo(db, row));
  const replaced = row.sourceRef === null ? null : parseGithubIssueSourceRef(row.sourceRef);
  const replacesOtherRepo =
    replaced !== null &&
    repoRef !== null &&
    `${replaced.owner}/${replaced.repo}`.toLowerCase() !==
      `${repoRef.owner}/${repoRef.repo}`.toLowerCase();
  if (row.sourceRef !== null && !replacesOtherRepo) return null;
  if (!box) throw new HttpError(502, 'github writeback unavailable (no secret box)');
  if (repoRef === null) throw new HttpError(404, 'project is not github-backed');
  const access = await teamGithubToken(deps, row.teamId);
  if (!('token' in access)) throw new HttpError(404, 'github connection not found');
  const { owner, repo } = repoRef;
  const { number } = await githubCreateIssue(deps.githubFetch ?? fetch, access.token, owner, repo, {
    title: row.title,
    body: row.spec,
  });
  const fresh = getRow(deps, todoId);
  if (!fresh || fresh.sourceRef !== row.sourceRef) return null;
  const ref = githubIssueSourceRef(owner, repo, number);
  db.update(todo)
    .set({ sourceRef: ref, v: fresh.v + 1 })
    .where(eq(todo.id, todoId))
    .run();
  const record = getTodo(deps, todoId);
  if (record) hub.publishTodoDoc(record.teamId, record);
  if (replaced !== null) {
    const closeAccess = await teamGithubToken(deps, row.teamId);
    if ('token' in closeAccess) {
      await githubCloseIssue(
        deps.githubFetch ?? fetch,
        closeAccess.token,
        replaced.owner,
        replaced.repo,
        replaced.issueNumber,
        `Cairn：这个任务挪到了 ${owner}/${repo}#${number}，这里的 issue 关闭。`,
      ).catch((error: unknown) =>
        console.warn(`moved todo: closing ${row.sourceRef} failed`, error),
      );
    } else {
      console.warn(`moved todo: no GitHub token to close ${row.sourceRef}`);
    }
  }
  return record;
}

export async function retrySelfIssueCreate(deps: TodoDeps, todoId: string): Promise<TodoRecord> {
  const row = getRow(deps, todoId);
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  if (row.sourceKind !== 'github-issue-self') {
    throw new HttpError(404, 'todo has no self-created github issue');
  }
  if (selfIssueInFlight.has(todoId)) {
    throw new HttpError(409, 'github issue creation already in flight');
  }
  const raw = runSelfIssueCreate(deps, todoId);
  const guarded = raw
    .catch(() => undefined)
    .finally(() => {
      if (selfIssueInFlight.get(todoId) === guarded) selfIssueInFlight.delete(todoId);
    });
  selfIssueInFlight.set(todoId, guarded);
  const record = await raw;
  if (!record) throw new HttpError(409, 'github issue already created');
  return record;
}

export async function writebackSelfIssueTitle(
  deps: TodoDeps,
  todoId: string,
  title: string,
): Promise<void> {
  const { box } = deps;
  if (!box) return;
  const row = getRow(deps, todoId);
  if (row?.sourceKind !== 'github-issue-self' || row.sourceRef === null) return;
  const parsed = parseGithubIssueSourceRef(row.sourceRef);
  if (parsed === null) return;
  const access = await teamGithubToken(deps, row.teamId);
  if (!('token' in access)) return;
  await githubUpdateIssueTitle(
    deps.githubFetch ?? fetch,
    access.token,
    parsed.owner,
    parsed.repo,
    parsed.issueNumber,
    title,
  );
}
