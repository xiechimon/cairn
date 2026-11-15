import type {
  GithubRepoRef,
  GitIdentity,
  Phase,
  RouteOverride,
  SecretBox,
  TaskRequest,
  TodoOutputKind,
  TodoRecord,
  TodoSection,
  TodoSourceKind,
  UserRecord,
} from '@cairn/shared';
import {
  canMoveTodoProject,
  categoryFreeTaskInputSchema,
  DONE_ANNOUNCEMENT,
  derivePlaceholderTitle,
  githubIssueSourceRef,
  IN_PROGRESS_PHASES,
  isStartedTodo,
  orchestrationSourceRef,
  PLACEHOLDER_TITLE_FALLBACK,
  parseGithubIssueSourceRef,
  renderTaskText,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNotNull, isNull, max, min, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  machine,
  message,
  plan as planTable,
  schedule,
  steerPending,
  step,
  stopPending,
  tag,
  taskIssueClose,
  todo,
  todoGithubLabel,
  todoTag,
  tokenUsage,
} from '../db/schema.js';
import { HttpError, notFound, parseWith } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubCreateIssue, githubUpdateIssueTitle } from '../lib/github.js';
import type { GithubWriteToken } from '../lib/github-token.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { checkBlockedBy, holdBlockedBuild, releaseBlockedSteps } from './blockers.js';
import { triggerChiefWakes } from './chief.js';
import { assertCorrectionDone } from './correction.js';
import { capabilityGatePasses, runtimeGatePasses } from './dispatch-eligibility.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { autonomousToken } from './github-autonomous-token.js';
import { hasGithubConnection, userTokenOrNull } from './github-connection.js';
import {
  assertGithubLabelsInProject,
  correctionFromGithubLabels,
  todoGithubLabelIds,
} from './github-labels.js';
import { priorSessionOf, soleOnlineMachineId, teamDefaultMachineId } from './machine-routing.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { notifyTodo } from './notifications.js';
import type { OAuthClientConfig } from './oauth.js';
import { ownershipOf, reconcileOwners, sectionOf } from './owner.js';
import { assertPhaseTransition, canManualMovePhase } from './phase.js';
import type { VapidKeys } from './push.js';
import { profileForStep } from './routing-rules.js';
import { ARCHIVED_SCHEDULE_PAUSE_REASON, pauseTodoSchedule } from './schedules.js';
import { insertGateAnnouncement } from './transcript.js';
import { cancelPendingWorkerQuestions } from './worker-question-store.js';

type TodoRow = typeof todo.$inferSelect;

const QUESTION_ABANDONING_PHASES: readonly Phase[] = ['todo', 'done', 'closed'];

export function abandonsQuestions(to: Phase): boolean {
  return QUESTION_ABANDONING_PHASES.includes(to);
}

export interface TodoDeps {
  githubAppTokenSocket?: string | null | undefined;
  githubAppIdentity?: GitIdentity | null | undefined;
  githubWriteTokenForRepo?: (
    teamId: string,
    repo: GithubRepoRef,
  ) => Promise<GithubWriteToken | null>;
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
  convHub?: ConversationStreamHub;
  box?: SecretBox;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
}

function notifyPhaseEntry(deps: TodoDeps, record: TodoRecord, from: Phase, to: Phase): void {
  if (from === to) return;
  if (to === 'done') notifyTodo(deps, record, 'todo_done');
  reconcileOwners(deps, [record.id]);
  triggerChiefWakes(deps, record, to);
}

type QuotaWait = TodoRecord['quotaWait'];

interface TodoUsage {
  rows: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  priced: number;
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const group = groups.get(keyOf(item));
    if (group === undefined) groups.set(keyOf(item), [item]);
    else group.push(item);
  }
  return groups;
}

function todoRelations(db: Db, rows: readonly TodoRow[]) {
  const ids = rows.map((row) => row.id);
  const latestBuildIds = rows.flatMap((row) =>
    row.latestBuildId === null ? [] : [row.latestBuildId],
  );
  const tags = groupBy(
    db
      .select({ todoId: todoTag.todoId, tagId: todoTag.tagId })
      .from(todoTag)
      .where(inArray(todoTag.todoId, ids))
      .all(),
    (r) => r.todoId,
  );
  const labels = groupBy(
    db
      .select({ todoId: todoGithubLabel.todoId, labelId: todoGithubLabel.labelId })
      .from(todoGithubLabel)
      .where(inArray(todoGithubLabel.todoId, ids))
      .all(),
    (r) => r.todoId,
  );
  const history = groupBy(
    db
      .select({ todoId: build.todoId, buildId: build.id, createdAt: build.createdAt })
      .from(build)
      .where(inArray(build.todoId, ids))
      .orderBy(asc(build.createdAt))
      .all(),
    (r) => r.todoId,
  );
  const quotaWaits = new Map<string, QuotaWait>();
  const waitingSteps =
    latestBuildIds.length === 0
      ? []
      : db
          .select({ buildId: step.buildId, block: step.quotaBlock })
          .from(step)
          .where(and(inArray(step.buildId, latestBuildIds), eq(step.status, 'waiting_quota')))
          .all();
  for (const waiting of waitingSteps) {
    const block = waiting.block;
    quotaWaits.set(
      waiting.buildId,
      block === null
        ? null
        : {
            kind: block.kind,
            providerId: block.providerId,
            label: block.label,
            retryAfterMs: block.retryAfterMs,
            probeAt: block.probeAt,
          },
    );
  }
  const usage = new Map<string, TodoUsage>(
    db
      .select({
        todoId: build.todoId,
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
      .where(inArray(build.todoId, ids))
      .groupBy(build.todoId)
      .all()
      .map(({ todoId, ...sums }) => [todoId, sums]),
  );
  return (row: TodoRow) => ({
    tagIds: (tags.get(row.id) ?? []).map((r) => r.tagId),
    githubLabelIds: (labels.get(row.id) ?? []).map((r) => r.labelId),
    history: (history.get(row.id) ?? []).map(({ buildId, createdAt }) => ({ buildId, createdAt })),
    quotaWait: row.latestBuildId === null ? null : (quotaWaits.get(row.latestBuildId) ?? null),
    usage: usage.get(row.id),
  });
}

export function toTodoRecords(
  deps: Pick<TodoDeps, 'db'>,
  rows: readonly TodoRow[],
  now = nowMs(),
): (TodoRecord & { section: TodoSection | null })[] {
  if (rows.length === 0) return [];
  const relationsOf = todoRelations(deps.db, rows);
  return rows.map((row) => todoRecordOf(deps, row, relationsOf(row), now));
}

export function toTodoRecord(
  deps: Pick<TodoDeps, 'db'>,
  row: TodoRow,
  now = nowMs(),
): TodoRecord & { section: TodoSection | null } {
  return todoRecordOf(deps, row, todoRelations(deps.db, [row])(row), now);
}

function todoRecordOf(
  deps: Pick<TodoDeps, 'db'>,
  row: TodoRow,
  {
    tagIds,
    githubLabelIds,
    history,
    quotaWait,
    usage,
  }: ReturnType<ReturnType<typeof todoRelations>>,
  now: number,
): TodoRecord & { section: TodoSection | null } {
  const waitingOn = waitingOnOf(deps, row);
  const ownership = ownershipOf(deps.db, row);
  return {
    id: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    title: row.title,
    spec: row.spec,
    phase: row.phase,
    phaseAt: row.phaseAt,
    archivedAt: row.archivedAt,
    snoozedUntil: row.snoozedUntil,
    snoozeMode: row.snoozeMode,
    ...(row.decisions.length > 0 ? { decisions: row.decisions } : {}),
    seqNum: row.seqNum,
    orderIndex: row.orderIndex,
    tagIds,
    githubLabelIds,
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
    owner: ownership?.owner ?? null,
    section: sectionOf(row, ownership, now),
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
            priced: usage.priced === usage.rows,
          },
        }
      : {}),
    ...(row.routeOverride != null ? { routeOverride: row.routeOverride } : {}),
    ...(row.request != null ? { request: row.request } : {}),
  };
}

function waitingOnOf(
  deps: Pick<TodoDeps, 'db'>,
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
  const online = deps.db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, row.teamId), eq(machine.online, true)))
    .all();
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
  const sole =
    teamDefaultMachineId(deps.db, row.teamId) ?? soleOnlineMachineId(online.map((m) => m.id));
  for (const s of pendingSteps) {
    const agentRow = profileForStep(deps.db, row, s.kind, s.id);
    if (agentRow === null) continue;
    const prior =
      buildRow === undefined
        ? { priorSessionId: null, priorMachineId: null, freshSession: true }
        : priorSessionOf(deps.db, s, buildRow);
    const named =
      !prior.freshSession && prior.priorSessionId !== null
        ? prior.priorMachineId
        : (agentRow.machineId ?? sole);
    const provider = s.fallback?.model?.provider ?? agentRow.provider;
    const runnable =
      named !== null &&
      online.some(
        (m) =>
          m.id === named && runtimeGatePasses(m, provider) && capabilityGatePasses(m, agentRow),
      );
    if (!runnable) return { on: 'machine', retryAt: null };
  }
  if (online.length === 0) {
    return { on: 'machine', retryAt: null };
  }
  return undefined;
}

function getRow(deps: Pick<TodoDeps, 'db'>, id: string): TodoRow | undefined {
  return deps.db.select().from(todo).where(eq(todo.id, id)).get();
}

export function setTodoArchived(deps: TodoDeps, id: string, archived: boolean): TodoRecord | null {
  const row = getRow(deps, id);
  if (!row) return null;
  if ((row.archivedAt !== null) === archived) return getTodo(deps, id);
  deps.db
    .update(todo)
    .set({ archivedAt: archived ? nowMs() : null, v: row.v + 1 })
    .where(eq(todo.id, id))
    .run();
  if (archived) pauseTodoSchedule(deps, id, ARCHIVED_SCHEDULE_PAUSE_REASON);
  reconcileOwners(deps, [id]);
  const record = getTodo(deps, id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
  return record;
}

export function listTodos(
  deps: TodoDeps,
  filter: { teamId?: string; projectId?: string; archived?: boolean } = {},
): TodoRecord[] {
  const conds = [
    filter.archived === true ? isNotNull(todo.archivedAt) : isNull(todo.archivedAt),
    filter.teamId !== undefined ? eq(todo.teamId, filter.teamId) : undefined,
    filter.projectId !== undefined ? eq(todo.projectId, filter.projectId) : undefined,
  ].filter((c) => c !== undefined);
  const rows = deps.db
    .select()
    .from(todo)
    .where(conds.length > 0 ? and(...conds) : sql`1=1`)
    .orderBy(asc(todo.seqNum))
    .all();
  return toTodoRecords(deps, rows);
}

export function getTodo<D extends Pick<TodoDeps, 'db'>>(deps: D, id: string): TodoRecord | null {
  const row = getRow(deps, id);
  return row ? toTodoRecord(deps, row) : null;
}

function correctionFromTags(db: Db, tagIds: string[]): boolean {
  if (tagIds.length === 0) return false;
  return (
    db
      .select({ id: tag.id })
      .from(tag)
      .where(and(inArray(tag.id, tagIds), eq(sql`lower(${tag.name})`, 'correction')))
      .get() !== undefined
  );
}

export function createTodo(
  deps: TodoDeps,
  input: Parameters<typeof createAutonomousTodo>[1],
): TodoRecord {
  return createAutonomousTodo(
    { ...deps, githubWriteTokenForRepo: (teamId) => userTokenOrNull(deps, teamId) },
    input,
  );
}

export function createAutonomousTodo(
  deps: TodoDeps,
  input: {
    teamId: string;
    projectId: string;
    title: string;
    spec: string;
    githubLabelIds?: string[];
    correctionRequired?: boolean;
    createdBy: string | null;
    ownerId: string | null;
    sourceKind?: TodoSourceKind;
    sourceRef?: string;
    orchestration?: { threadId: string };
    output?: TodoOutputKind;
    userSpecAttachmentIds?: string[];
    request?: TaskRequest;
    blockedBy?: string[];
    orderFirst?: boolean;
  },
): TodoRecord {
  parseWith(categoryFreeTaskInputSchema, input, 'input');
  const { db, hub } = deps;
  const githubLabelIds = [...new Set(input.githubLabelIds ?? [])];
  assertGithubLabelsInProject(db, input.projectId, githubLabelIds);
  const seqRow = db
    .select({ n: max(todo.seqNum) })
    .from(todo)
    .where(eq(todo.teamId, input.teamId))
    .get();
  const seqNum = (seqRow?.n ?? 0) + 1;
  const orderRow = db
    .select({ n: input.orderFirst === true ? min(todo.orderIndex) : max(todo.orderIndex) })
    .from(todo)
    .where(and(eq(todo.projectId, input.projectId), inArray(todo.phase, ['todo', 'queued'])))
    .get();
  const now = nowMs();
  const id = newRecordId();
  const blockedBy =
    input.blockedBy === undefined
      ? undefined
      : checkBlockedBy(db, { id, teamId: input.teamId, latestBuildId: null }, input.blockedBy);
  const title =
    input.title.trim() || derivePlaceholderTitle(input.spec) || PLACEHOLDER_TITLE_FALLBACK;
  const selfIssue =
    input.sourceKind === undefined ? planSelfIssue(deps, input.teamId, input.projectId) : null;
  db.transaction((tx) => {
    tx.insert(todo)
      .values({
        id,
        teamId: input.teamId,
        projectId: input.projectId,
        title,
        spec: input.spec,
        correctionRequired:
          input.correctionRequired ?? correctionFromGithubLabels(db, githubLabelIds),
        phase: 'todo',
        phaseAt: now,
        seqNum,
        orderIndex: input.orderFirst === true ? (orderRow?.n ?? 1) - 1 : (orderRow?.n ?? -1) + 1,
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
        ...(input.request !== undefined ? { request: input.request } : {}),
        ...(blockedBy !== undefined ? { blockedBy } : {}),
      })
      .run();
    for (const labelId of githubLabelIds) {
      tx.insert(todoGithubLabel).values({ todoId: id, labelId }).run();
    }
  });
  const record = getTodo(deps, id);
  if (!record) throw new Error('todo missing after insert');
  hub.publishTodoDoc(input.teamId, record);
  if (selfIssue !== null) scheduleSelfIssueCreate(deps, id);
  return record;
}

export function updateTodo(
  deps: TodoDeps,
  id: string,
  patch: Parameters<typeof updateAutonomousTodo>[2],
  opts: Parameters<typeof updateAutonomousTodo>[3] = {},
): TodoRecord | null {
  return updateAutonomousTodo(
    { ...deps, githubWriteTokenForRepo: (teamId) => userTokenOrNull(deps, teamId) },
    id,
    patch,
    { ...opts, textWriter: { ownerEdit: deps.user.id } },
  );
}

export type TodoTextWriter = 'request-service' | 'coordinator-title' | { ownerEdit: string };

export function updateAutonomousTodo(
  deps: TodoDeps,
  id: string,
  patch: {
    title?: string;
    spec?: string;
    phase?: Phase;
    githubLabelIds?: string[];
    orderIndex?: number;
    projectId?: string;
    routeOverride?: RouteOverride | null;
    blockedBy?: string[];
  },
  opts: {
    manualPhase?: boolean;
    userSpecAttachmentIds?: string[];
    textWriter?: TodoTextWriter;
  } = {},
): TodoRecord | null {
  const { db, hub } = deps;
  parseWith(categoryFreeTaskInputSchema, patch, 'patch');
  const row = getRow(deps, id);
  if (!row) return null;
  if (
    row.request !== null &&
    (patch.title !== undefined || patch.spec !== undefined) &&
    opts.textWriter === undefined
  ) {
    throw new HttpError(
      409,
      `todo ${id} carries the owner's cited words; edit it in the board, or send owner messages through the Coordinator`,
    );
  }
  if (
    opts.textWriter === 'coordinator-title' &&
    (patch.title === undefined || row.request === null)
  ) {
    throw new HttpError(
      409,
      `todo ${id} has no cited request; summary titles are only for Coordinator-created request tasks`,
    );
  }

  const sets: Partial<TodoRow> = {};
  if (patch.blockedBy !== undefined) sets.blockedBy = checkBlockedBy(db, row, patch.blockedBy);
  const githubLabelIds =
    patch.githubLabelIds === undefined ? undefined : [...new Set(patch.githubLabelIds)];
  const move =
    patch.projectId !== undefined && patch.projectId !== row.projectId
      ? planProjectMove(deps, row, patch.projectId)
      : null;
  if (githubLabelIds !== undefined)
    assertGithubLabelsInProject(db, move?.sets.projectId ?? row.projectId, githubLabelIds);
  if (move !== null) Object.assign(sets, move.sets);
  if (githubLabelIds !== undefined || move !== null) {
    const nextTags =
      move !== null
        ? []
        : db
            .select({ id: todoTag.tagId })
            .from(todoTag)
            .where(eq(todoTag.todoId, id))
            .all()
            .map((link) => link.id);
    const nextLabels = githubLabelIds ?? (move !== null ? [] : todoGithubLabelIds(db, id));
    sets.correctionRequired =
      correctionFromTags(db, nextTags) || correctionFromGithubLabels(db, nextLabels);
  }
  if (patch.title !== undefined) sets.title = patch.title;
  if (patch.spec !== undefined) {
    sets.spec = patch.spec;
    sets.userSpecAttachmentIds = opts.userSpecAttachmentIds ?? [];
    const editor = opts.textWriter;
    if (row.request !== null && editor !== undefined && typeof editor === 'object') {
      sets.request = {
        ...row.request,
        segments: [
          {
            source: { kind: 'edit', userId: editor.ownerEdit, at: nowMs(), span: 'whole' },
            author: 'owner',
            sourceRef: null,
            text: patch.spec,
          },
        ],
      };
      sets.spec = renderTaskText(sets.request);
    }
  }
  if (patch.title !== undefined && row.request !== null) {
    sets.request = {
      ...(sets.request ?? row.request),
      titleSource: opts.textWriter === 'coordinator-title' ? 'coordinator' : 'owner',
      titleSourceRef: null,
    };
  }
  if (patch.orderIndex !== undefined) sets.orderIndex = patch.orderIndex;
  if (patch.routeOverride !== undefined) {
    const machineId = patch.routeOverride?.machineId;
    if (machineId !== undefined) {
      const owned = db
        .select({ id: machine.id })
        .from(machine)
        .where(and(eq(machine.id, machineId), eq(machine.teamId, row.teamId)))
        .get();
      if (owned === undefined) throw notFound(`machine ${machineId}`);
    }
    sets.routeOverride = patch.routeOverride;
  }
  let manualPhaseApplied = false;
  if (patch.phase !== undefined && patch.phase !== row.phase) {
    sets.supersededBy = null;
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
    if (patch.phase === 'done') assertCorrectionDone(db, row);
    sets.phase = patch.phase;
    sets.phaseAt = nowMs();
  }
  db.transaction((tx) => {
    if (Object.keys(sets).length > 0) {
      sets.v = row.v + 1;
      tx.update(todo).set(sets).where(eq(todo.id, id)).run();
    }
    if (move !== null) {
      tx.update(schedule)
        .set({ projectId: move.sets.projectId })
        .where(eq(schedule.todoId, id))
        .run();
      tx.delete(todoTag).where(eq(todoTag.todoId, id)).run();
      if (githubLabelIds === undefined)
        tx.delete(todoGithubLabel).where(eq(todoGithubLabel.todoId, id)).run();
    }
    if (githubLabelIds !== undefined) {
      tx.delete(todoGithubLabel).where(eq(todoGithubLabel.todoId, id)).run();
      for (const labelId of githubLabelIds) {
        tx.insert(todoGithubLabel).values({ todoId: id, labelId }).run();
      }
    }
  });

  if (
    sets.phase === 'done' &&
    (row.phase === 'confirm' || row.phase === 'review') &&
    row.latestBuildId !== null
  ) {
    insertGateAnnouncement(deps, row.latestBuildId, DONE_ANNOUNCEMENT, deps.user.displayName);
  }

  if (sets.blockedBy !== undefined && row.latestBuildId !== null)
    holdBlockedBuild(db, row.latestBuildId);
  const record = getTodo(deps, id);
  if (!record) return null;
  hub.publishTodoDoc(record.teamId, record);
  if (move?.closeIssueRef != null) {
    queueIssueClose(
      deps.db,
      row.teamId,
      move.closeIssueRef,
      `Cairn：这个任务挪到了项目「${move.targetName}」，这里的 issue 关闭。`,
    );
  }
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

function planProjectMove(deps: TodoDeps, row: TodoRow, projectId: string): ProjectMove {
  const target = projectOfTodo(deps.db, { projectId, teamId: row.teamId });
  if (target === undefined) throw new HttpError(404, `project ${projectId}`);
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

export function queueIssueClose(db: Db, teamId: string, sourceRef: string, comment: string): void {
  db.insert(taskIssueClose)
    .values({ id: newRecordId(), teamId, sourceRef, comment, createdAt: nowMs() })
    .run();
}

export const DELETED_TASK_ISSUE_COMMENT = 'Cairn：这个任务已删除，这里的 issue 关闭（未计划）。';

export function setTodoPhase(
  deps: TodoDeps,
  id: string,
  to: Phase,
  extra: Partial<
    Pick<TodoRow, 'hasChanges' | 'hasPlan' | 'latestBuildId' | 'lastRunAt' | 'routeOverride'>
  > = {},
  options: { landedMerge?: true } = {},
): TodoRecord | null {
  const { db } = deps;
  const row = getRow(deps, id);
  if (!row) return null;
  if (row.phase === to) {
    const changed = (Object.keys(extra) as (keyof typeof extra)[]).filter(
      (k) => extra[k] !== undefined && JSON.stringify(extra[k]) !== JSON.stringify(row[k]),
    );
    if (changed.length > 0) {
      db.update(todo)
        .set({ ...extra, v: row.v + 1 })
        .where(eq(todo.id, id))
        .run();
    }
    reconcileOwners(deps, [id]);
    const record = getTodo(deps, id);
    if (record && changed.length > 0) deps.hub.publishTodoDoc(record.teamId, record);
    return record;
  }
  assertPhaseTransition(row.phase, to);
  if (to === 'done' && !options.landedMerge) assertCorrectionDone(db, row);
  return db.transaction(() => {
    if (abandonsQuestions(to) && row.latestBuildId !== null) {
      cancelPendingWorkerQuestions(
        deps,
        row.latestBuildId,
        'The thread moved on before an answer.',
      );
    }
    db.update(todo)
      .set({
        ...extra,
        phase: to,
        phaseAt: nowMs(),
        v: row.v + 1,
      })
      .where(eq(todo.id, id))
      .run();
    const record = getTodo(deps, id);
    if (!record) return null;
    deps.hub.publishTodoDoc(record.teamId, record);
    notifyPhaseEntry(deps, record, row.phase, to);
    if (to === 'done') settleSplitOnDone(deps, id);
    if (to === 'done' || to === 'review') releaseBlockedSteps(deps);
    return record;
  });
}

export function childrenOfTodo(db: Db, parentId: string): TodoRow[] {
  return db
    .select()
    .from(todo)
    .where(eq(todo.sourceTodo, parentId))
    .orderBy(asc(todo.seqNum))
    .all();
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
    insertGateAnnouncement(deps, parent.latestBuildId, DONE_ANNOUNCEMENT, 'Coordinator');
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
    db.delete(stopPending).where(inArray(stopPending.conversationId, buildIds)).run();
    db.delete(step).where(inArray(step.buildId, buildIds)).run();
  }
  if (row.sourceKind === 'github-issue-self' && row.sourceRef !== null) {
    queueIssueClose(db, row.teamId, row.sourceRef, DELETED_TASK_ISSUE_COMMENT);
  }
  db.delete(schedule).where(eq(schedule.todoId, id)).run();
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
    .catch((error: unknown) => {
      console.error(
        `self issue create failed for todo ${todoId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
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
  const token = await (
    deps.githubWriteTokenForRepo ?? ((teamId, repo) => autonomousToken(deps, teamId, repo))
  )(row.teamId, repoRef);
  if (token === null) throw new HttpError(404, 'github connection not found');
  const { owner, repo } = repoRef;
  const { number } = await githubCreateIssue(deps.githubFetch ?? fetch, token, owner, repo, {
    title: row.title,
    body: row.spec,
  });
  const fresh = getRow(deps, todoId);
  const ref = githubIssueSourceRef(owner, repo, number);
  if (!fresh) {
    queueIssueClose(db, row.teamId, ref, DELETED_TASK_ISSUE_COMMENT);
    return null;
  }
  if (fresh.sourceRef !== row.sourceRef) return null;
  db.update(todo)
    .set({ sourceRef: ref, issueState: 'open', v: fresh.v + 1 })
    .where(eq(todo.id, todoId))
    .run();
  const record = getTodo(deps, todoId);
  if (record) hub.publishTodoDoc(record.teamId, record);
  if (replaced !== null && row.sourceRef !== null) {
    queueIssueClose(
      db,
      row.teamId,
      row.sourceRef,
      `Cairn：这个任务挪到了 ${owner}/${repo}#${number}，这里的 issue 关闭。`,
    );
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
  const raw = runSelfIssueCreate(
    { ...deps, githubWriteTokenForRepo: (teamId) => userTokenOrNull(deps, teamId) },
    todoId,
  );
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
  const token = await (
    deps.githubWriteTokenForRepo ?? ((teamId, repo) => autonomousToken(deps, teamId, repo))
  )(row.teamId, parsed);
  if (token === null) return;
  await githubUpdateIssueTitle(
    deps.githubFetch ?? fetch,
    token,
    parsed.owner,
    parsed.repo,
    parsed.issueNumber,
    title,
  );
}
