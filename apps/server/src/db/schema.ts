import type {
  ActiveRun,
  AutonomyGateReason,
  AutonomyKind,
  AutonomyPauseMarker,
  AutonomyPauseSource,
  AutonomySettings,
  BlockerHandoffRecord,
  BuildEvidence,
  BuildStop,
  ChiefWatch,
  ClaudeCodeReport,
  ClaudeRateLimitWindow,
  ClaudeUsage,
  ComputerCallState,
  ComputerControlHolder,
  ComputerImage,
  ComputerState,
  ComputerTool,
  DocumentDiffFile,
  EvidenceStore,
  INTAKE_SOURCE_KIND,
  MachineCapabilities,
  MemoryCandidateStatus,
  MemoryLayer,
  ModelRef,
  NamedPromptOverrides,
  NotificationType,
  Phase,
  PrMergeState,
  ProjectColor,
  ProjectIcon,
  ProjectMergeConfig,
  ProjectRepoKind,
  ProviderApi,
  ProviderCompat,
  ProviderModel,
  PrPanelState,
  RequiredCapabilities,
  RouteOverride,
  RouteUse,
  ScheduleKind,
  ScheduleReport,
  ShipRoute,
  SkillInjectionRecord,
  SnoozeMode,
  SplitPolicy,
  StepKind,
  StepPromptOrigin,
  TaskDecision,
  TaskRequest,
  TodoOutputKind,
  TodoSourceKind,
  TriggerSource,
} from '@cairn/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const epochMs = (name: string) => integer(name);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  displayName: text('displayName').notNull(),
  avatarUrl: text('avatarUrl'),
});

export const team = sqliteTable('team', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  plan: text('plan').notNull().default('free'),
  claudeUsage: text('claudeUsage').$type<ClaudeUsage>().notNull().default('subscription-only'),
  avatarStyle: text('avatarStyle'),
  coAuthorTrailer: bool('coAuthorTrailer').notNull().default(true),
  requestInstructorReview: bool('requestInstructorReview').notNull().default(false),
  maxAutonomousMergesPerDay: integer('maxAutonomousMergesPerDay').notNull().default(10),
  firstPrReportPromptEnabled: bool('firstPrReportPromptEnabled').notNull().default(false),
  firstPrReportPromptDismissedAt: epochMs('firstPrReportPromptDismissedAt'),
  firstPrReportPromptFirstPrAt: epochMs('firstPrReportPromptFirstPrAt'),
  firstPrReportPromptFirstPrNumber: integer('firstPrReportPromptFirstPrNumber'),
  namedPrompts: json<NamedPromptOverrides | null>('namedPrompts'),
});

export const autonomyPause = sqliteTable(
  'autonomy_pause',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    source: text('source').$type<AutonomyPauseSource>().notNull(),
    reason: text('reason').notNull(),
    markers: json<AutonomyPauseMarker[]>('markers').notNull(),
    publishError: text('publishError'),
    openedAt: epochMs('openedAt').notNull(),
    resolvedAt: epochMs('resolvedAt'),
    resolvedBy: text('resolvedBy').$type<'markers' | 'owner'>(),
    requestKey: text('requestKey'),
  },
  (t) => [
    index('autonomy_pause_team_resolved_idx').on(t.teamId, t.resolvedAt),
    uniqueIndex('autonomy_pause_team_request_key_idx').on(t.teamId, t.requestKey),
  ],
);

export const project = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  group: text('group'),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  splitPolicy: text('splitPolicy').$type<SplitPolicy>().notNull().default('human'),
  evidenceStore: text('evidenceStore').$type<EvidenceStore>().notNull().default('attachments'),
  description: text('description'),
  instructions: text('instructions'),
  maxConcurrent: integer('maxConcurrent'),
  repoKind: text('repoKind').$type<ProjectRepoKind>(),
  repoName: text('repoName'),
  githubRepo: text('githubRepo'),
  localPath: text('localPath'),
  baseBranch: text('baseBranch'),
  icon: text('icon').$type<ProjectIcon>(),
  color: text('color').$type<ProjectColor>(),
  archivedAt: epochMs('archivedAt'),
  autonomy: json<
    (AutonomySettings & Partial<ProjectMergeConfig> & { shipRoute?: ShipRoute }) | null
  >('autonomy'),
});

export const todo = sqliteTable(
  'todo',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    projectId: text('projectId')
      .notNull()
      .references(() => project.id),
    title: text('title').notNull(),
    spec: text('spec').notNull().default(''),
    correctionRequired: bool('correctionRequired').notNull().default(false),
    phase: text('phase').$type<Phase>().notNull().default('todo'),
    phaseAt: epochMs('phaseAt').notNull(),
    archivedAt: epochMs('archivedAt'),
    snoozedUntil: epochMs('snoozedUntil'),
    snoozeMode: text('snoozeMode').$type<SnoozeMode>(),
    seqNum: integer('seqNum').notNull(),
    orderIndex: real('orderIndex').notNull().default(0),
    routeOverride: json<RouteOverride | null>('routeOverride'),
    latestBuildId: text('latestBuildId'),
    lastRunAt: epochMs('lastRunAt'),
    hasChanges: bool('hasChanges').notNull().default(false),
    hasPlan: bool('hasPlan').notNull().default(false),
    sourceTodo: text('sourceTodo'),
    blockedBy: json<string[]>('blockedBy'),
    v: integer('v').notNull().default(1),
    createdBy: text('createdBy'),
    ownerId: text('ownerId'),
    sourceBuildId: text('sourceBuildId'),
    sourceKind: text('sourceKind').$type<TodoSourceKind | null>(),
    sourceRef: text('sourceRef'),
    issueState: text('issueState').$type<'open' | 'closed' | null>(),
    supersededBy: text('supersededBy'),
    output: text('output').$type<TodoOutputKind>().notNull().default('code'),
    decisions: json<TaskDecision[]>('decisions').notNull().default(sql`'[]'`),
    lastNotifiedOwner: text('lastNotifiedOwner').default('none'),
    lastNotifiedWork: text('lastNotifiedWork').default(''),
    coordinatorTurn: json<CoordinatorTurn>('coordinatorTurn'),
    userSpecAttachmentIds: json<string[]>('userSpecAttachmentIds').notNull().default(sql`'[]'`),
    userMessageAttachmentIds: json<string[]>('userMessageAttachmentIds')
      .notNull()
      .default(sql`'[]'`),
    request: json<TaskRequest | null>('request'),
  },
  (t) => [index('todo_phase_idx').on(t.phase)],
);

export const taskIssueClose = sqliteTable('task_issue_close', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  sourceRef: text('sourceRef').notNull(),
  comment: text('comment').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const tag = sqliteTable('tag', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  createdAt: epochMs('createdAt').notNull().default(0),
  v: integer('v').notNull().default(1),
});

export const todoTag = sqliteTable(
  'todo_tag',
  {
    todoId: text('todoId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    tagId: text('tagId')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.todoId, t.tagId] })],
);

export const githubLabel = sqliteTable('github_label', {
  id: text('id').primaryKey(),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  createdAt: epochMs('createdAt').notNull().default(0),
  v: integer('v').notNull().default(1),
});

export const todoGithubLabel = sqliteTable(
  'todo_github_label',
  {
    todoId: text('todoId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    labelId: text('labelId')
      .notNull()
      .references(() => githubLabel.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.todoId, t.labelId] })],
);

export const build = sqliteTable('build', {
  id: text('id').primaryKey(),
  todoId: text('todoId')
    .notNull()
    .references(() => todo.id, { onDelete: 'cascade' }),
  withPlan: bool('withPlan').notNull(),
  prevPhase: text('prevPhase').$type<Phase | null>(),
  triggerSource: text('triggerSource').$type<TriggerSource>().notNull(),
  scheduledBy: text('scheduledBy'),
  planDocId: text('planDocId'),
  errorMessage: text('errorMessage'),
  prUrl: text('prUrl'),
  prNumber: integer('prNumber'),
  changes: json<DocumentDiffFile[] | { files: DocumentDiffFile[]; changed: true }>('changes'),
  diffHash: text('diffHash'),
  baseSha: text('baseSha'),
  harnessHash: text('harnessHash'),
  reportAttachmentId: text('reportAttachmentId'),
  reportLine: text('reportLine'),
  evidenceStore: text('evidenceStore').$type<EvidenceStore>(),
  stop: json<BuildStop | null>('stop'),
  createdAt: epochMs('createdAt').notNull(),
});

export interface QuotaWaitRow {
  kind: 'quota' | 'capacity';
  providerId: string;
  label: string | null;
  reason: string;
  retryAfterMs: number | null;
  firstSeenAt: number;
  lastAt: number;
  attempts: number;
  probeAt: number;
  source?: 'claude_rate_limit' | 'subscription_policy';
}

export interface StepFallbackRow {
  model: ModelRef | null;
  tried: string[];
  zeroUsageRetried: boolean;
}

export const step = sqliteTable(
  'step',
  {
    id: text('id').primaryKey(),
    buildId: text('buildId').notNull(),
    kind: text('kind').$type<StepKind>().notNull(),
    machineId: text('machineId'),
    status: text('status')
      .$type<'pending' | 'claimed' | 'done' | 'failed' | 'stopped' | 'waiting_quota'>()
      .notNull()
      .default('pending'),
    archiveStop: text('archiveStop').$type<'requested' | 'acknowledged' | null>(),
    quotaBlock: json<QuotaWaitRow>('quotaBlock'),
    fallback: json<StepFallbackRow>('fallback'),
    sessionId: text('sessionId'),
    scheduleId: text('scheduleId'),
    scheduledBy: text('scheduledBy'),
    checkpointCommit: text('checkpointCommit'),
    claimedAt: epochMs('claimedAt'),
    lastHeartbeatAt: epochMs('lastHeartbeatAt'),
    finishedAt: epochMs('finishedAt'),
    prompt: text('prompt'),
    promptOrigin: json<StepPromptOrigin>('promptOrigin'),
    scopeProjectId: text('scopeProjectId'),
    ownerMessageIds: json<string[]>('ownerMessageIds'),
    byPerson: bool('byPerson').notNull().default(false),
    freshSession: bool('freshSession').notNull().default(false),
    skillInjection: json<SkillInjectionRecord>('skillInjection'),
    blockerHandoff: json<BlockerHandoffRecord>('blockerHandoff'),
    holdReason: text('holdReason'),
    holdUntil: epochMs('holdUntil'),
    holdCount: integer('holdCount').notNull().default(0),
    claimCount: integer('claimCount').notNull().default(0),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('step_status_kind_idx').on(t.status, t.kind),
    index('step_buildId_status_idx').on(t.buildId, t.status),
    index('step_kind_idx').on(t.kind),
    index('step_merge_finished_idx').on(t.kind, t.status, t.finishedAt),
  ],
);

export const message = sqliteTable(
  'message',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversationId').notNull(),
    role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
    content: json<unknown>('content').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    actor: text('actor'),
  },
  (t) => [index('message_createdAt_idx').on(t.createdAt)],
);

export const autonomousMergeAdmission = sqliteTable(
  'autonomous_merge_admission',
  {
    buildId: text('buildId').primaryKey(),
    teamId: text('teamId').notNull(),
    state: text('state').$type<'pending' | 'merged'>().notNull(),
    createdAt: epochMs('createdAt').notNull(),
    landedAt: epochMs('landedAt'),
  },
  (t) => [
    index('autonomous_merge_team_state_landed_idx').on(t.teamId, t.state, t.landedAt),
    index('autonomous_merge_pending_age_idx').on(t.state, t.createdAt),
  ],
);

export const branchSync = sqliteTable('branch_sync', {
  id: text('id').primaryKey(),
  buildId: text('buildId')
    .notNull()
    .references(() => build.id, { onDelete: 'cascade' }),
  machineId: text('machineId')
    .notNull()
    .references(() => machine.id),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  directory: text('directory').notNull(),
  ref: text('ref').notNull(),
  commit: text('commit').notNull(),
  force: integer('force', { mode: 'boolean' }).notNull().default(false),
  status: text('status')
    .$type<'pending' | 'running' | 'synced' | 'failed'>()
    .notNull()
    .default('pending'),
  errorMessage: text('errorMessage'),
  createdAt: epochMs('createdAt').notNull(),
  startedAt: epochMs('startedAt'),
  finishedAt: epochMs('finishedAt'),
});

export const computer = sqliteTable(
  'computer',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    scope: text('scope').$type<'private'>().notNull().default('private'),
    scopeKey: text('scopeKey').notNull(),
    machineId: text('machineId')
      .notNull()
      .references(() => machine.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'orb'>().notNull().default('orb'),
    providerRef: text('providerRef').notNull(),
    state: text('state').$type<ComputerState>().notNull().default('stopped'),
    runningSince: epochMs('runningSince'),
    executionStepId: text('executionStepId'),
    executionLeaseExpiresAt: epochMs('executionLeaseExpiresAt'),
    executionFence: integer('executionFence').notNull().default(0),
    controlHolder: text('controlHolder').$type<ComputerControlHolder>().notNull().default('none'),
    controlLeaseId: text('controlLeaseId'),
    controlLeaseExpiresAt: epochMs('controlLeaseExpiresAt'),
    controlFence: integer('controlFence').notNull().default(0),
    screenGeneration: integer('screenGeneration').notNull().default(0),
    browserEnabled: bool('browserEnabled').notNull().default(false),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [uniqueIndex('computer_scope_key_idx').on(t.scopeKey)],
);

export const computerCall = sqliteTable(
  'computer_call',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    stepId: text('stepId').notNull(),
    toolCallId: text('toolCallId').notNull(),
    machineId: text('machineId')
      .notNull()
      .references(() => machine.id, { onDelete: 'cascade' }),
    computerId: text('computerId').references(() => computer.id, { onDelete: 'set null' }),
    tool: text('tool').$type<ComputerTool>().notNull(),
    replaySafe: bool('replaySafe').notNull(),
    params: json<Record<string, unknown>>('params').notNull(),
    state: text('state').$type<ComputerCallState>().notNull().default('dispatched'),
    lastSeq: integer('lastSeq').notNull().default(0),
    outputHead: text('outputHead').notNull().default(''),
    outputTail: text('outputTail').notNull().default(''),
    outputChars: integer('outputChars').notNull().default(0),
    resultText: text('resultText'),
    resultImages: json<ComputerImage[] | null>('resultImages'),
    exitCode: integer('exitCode'),
    errorMessage: text('errorMessage'),
    errorDelivery: text('errorDelivery').$type<'not_delivered' | 'unknown'>(),
    deadlineAt: epochMs('deadlineAt').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    startedAt: epochMs('startedAt'),
    finishedAt: epochMs('finishedAt'),
  },
  (t) => [
    index('computer_call_step_idx').on(t.stepId),
    index('computer_call_machine_state_idx').on(t.machineId, t.state),
  ],
);

export const queuedMessage = sqliteTable(
  'queued_message',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversationId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    deliverAfterStop: integer('deliverAfterStop', { mode: 'boolean' }).notNull().default(false),
    error: text('error'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [index('queued_message_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const steerPending = sqliteTable('steer_pending', {
  conversationId: text('conversationId').primaryKey(),
  stepId: text('stepId').notNull(),
  content: text('content').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const stopPending = sqliteTable('stop_pending', {
  conversationId: text('conversationId').primaryKey(),
  stepId: text('stepId').notNull(),
  discard: bool('discard').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const plan = sqliteTable('plan', {
  id: text('id').primaryKey(),
  buildId: text('buildId')
    .notNull()
    .references(() => build.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  content: text('content').notNull().default(''),
  stepId: text('stepId'),
  autoApprovePausedAt: epochMs('autoApprovePausedAt'),
  createdAt: epochMs('createdAt').notNull(),
});

export const schedule = sqliteTable(
  'schedule',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    projectId: text('projectId').notNull(),
    todoId: text('todoId').notNull(),
    kind: text('kind').$type<ScheduleKind>().notNull(),
    cron: text('cron'),
    prompt: text('prompt').notNull().default(''),
    enabled: bool('enabled').notNull().default(true),
    at: epochMs('at'),
    tz: text('tz').notNull(),
    nextRunAt: epochMs('nextRunAt'),
    lastRunAt: epochMs('lastRunAt'),
    lastRunStatus: text('lastRunStatus'),
    lastRunError: text('lastRunError'),
    lastRunStepId: text('lastRunStepId'),
    retryNotBefore: epochMs('retryNotBefore'),
    pausedReason: text('pausedReason'),
    createdBy: text('createdBy').notNull(),
  },
  (t) => [
    index('schedule_nextRunAt_idx').on(t.nextRunAt),
    uniqueIndex('schedule_todoId_unique').on(t.todoId),
  ],
);

export const dueEvent = sqliteTable(
  'due_event',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    dueAt: epochMs('dueAt').notNull(),
    intervalMs: integer('intervalMs'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('lastError'),
  },
  (t) => [index('due_event_dueAt_idx').on(t.dueAt)],
);

export const notification = sqliteTable(
  'notification',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId').notNull(),
    userId: text('userId').notNull(),
    type: text('type').$type<NotificationType>().notNull(),
    entityId: text('entityId').notNull(),
    entityRef: json<{ title: string; projectId: string | null; seqNum: number | null }>(
      'entityRef',
    ).notNull(),
    agentName: text('agentName').notNull(),
    agentAvatarUrl: text('agentAvatarUrl'),
    snippet: text('snippet'),
    readAt: epochMs('readAt'),
    createdAt: epochMs('createdAt').notNull(),
    channels: json<['in_app']>('channels').notNull().default(['in_app']),
  },
  (t) => [index('notification_type_readAt_idx').on(t.type, t.readAt)],
);

export const routingRule = sqliteTable(
  'routing_rule',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    use: text('use').$type<RouteUse>().notNull(),
    provider: text('provider').notNull(),
    modelId: text('modelId').notNull(),
    thinkingLevel: text('thinkingLevel'),
    fallbackModels: json<ModelRef[] | null>('fallbackModels'),
    machineId: text('machineId').references(() => machine.id),
    requiredCapabilities: json<RequiredCapabilities | null>('requiredCapabilities'),
    tools: json<string[] | null>('tools'),
    mcpServers: json<string[] | null>('mcpServers'),
    skillsAllowlist: json<string[] | null>('skillsAllowlist'),
    defaultSkill: text('defaultSkill'),
    secrets: json<string[] | null>('secrets'),
    seededFromAgentId: text('seededFromAgentId'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [uniqueIndex('routing_rule_team_use_unique').on(t.teamId, t.use)],
);

export const workPolicy = sqliteTable(
  'work_policy',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    use: text('use').$type<'session' | 'review'>().notNull(),
    tools: json<string[]>('tools').notNull(),
    mcpServers: json<string[]>('mcpServers').notNull(),
    skillsAllowlist: json<string[] | null>('skillsAllowlist'),
    defaultSkill: text('defaultSkill'),
    secrets: json<string[]>('secrets').notNull(),
    seededFromAgentId: text('seededFromAgentId'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [uniqueIndex('work_policy_team_use_unique').on(t.teamId, t.use)],
);

export const stepRoute = sqliteTable(
  'step_route',
  {
    stepId: text('stepId').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    kind: text('kind').$type<StepKind>().notNull(),
    difficulty: text('difficulty').$type<'easy' | 'standard' | 'hard'>().notNull(),
    harness: text('harness').$type<'claude-code' | 'pi'>(),
    provider: text('provider'),
    modelId: text('modelId'),
    machineId: text('machineId'),
    reason: text('reason').notNull(),
    rejected:
      json<{ modelId: string; machineId: string | null; why: string }[]>('rejected').notNull(),
    decidedAt: epochMs('decidedAt').notNull(),
  },
  (t) => [index('step_route_team_decided_idx').on(t.teamId, t.decidedAt)],
);

export const agentMemory = sqliteTable('agent_memory', {
  id: text('id').primaryKey(),
  agentId: text('agentId').notNull(),
  teamId: text('teamId').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  projectId: text('projectId'),
  sourceTodoId: text('sourceTodoId'),
  sourceBuildId: text('sourceBuildId'),
  source: text('source'),
  layer: text('layer').$type<MemoryLayer>().notNull().default('core'),
  threadId: text('threadId'),
  adoptedFrom: text('adoptedFrom'),
  independent: bool('independent').notNull().default(false),
  history: json<{ title: string; content: string; updatedAt: number }[]>('history')
    .notNull()
    .default(sql`'[]'`),
  invalidAt: epochMs('invalidAt'),
  supersededBy: text('supersededBy'),
  lastInjectedAt: epochMs('lastInjectedAt'),
  createdAt: epochMs('createdAt').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
});

export const dataMigration = sqliteTable('data_migration', {
  id: text('id').primaryKey(),
  doneAt: epochMs('doneAt').notNull(),
  detail: text('detail').notNull(),
});

export const memorySaveConflict = sqliteTable('memory_save_conflict', {
  id: text('id').primaryKey(),
  candidateIds: json<string[]>('candidateIds').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const memoryCandidate = sqliteTable(
  'memory_candidate',
  {
    id: text('id').primaryKey(),
    agentId: text('agentId').notNull(),
    teamId: text('teamId').notNull(),
    projectId: text('projectId').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    status: text('status').$type<MemoryCandidateStatus>().notNull().default('pending'),
    buildIds: json<string[]>('buildIds').notNull(),
    evidence: json<BuildEvidence[]>('evidence').notNull(),
    conflictIds: json<string[]>('conflictIds').notNull().default(sql`'[]'`),
    memoryId: text('memoryId'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [index('memory_candidate_scope_idx').on(t.agentId, t.teamId, t.projectId)],
);

export const pushSubscription = sqliteTable(
  'push_subscription',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    teamId: text('teamId').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    pairedDeviceId: text('pairedDeviceId'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [uniqueIndex('push_subscription_endpoint_unique').on(t.endpoint)],
);

export const pushDelivery = sqliteTable('push_delivery', {
  message: json<{ title: string; body: string; href: string; tag: string }>('message'),
  pushStatus: text('pushStatus').notNull().default('unknown'),
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  teamId: text('teamId').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  receivedAt: epochMs('receivedAt'),
  fallbackClaimedAt: epochMs('fallbackClaimedAt'),
  alertStatus: text('alertStatus').$type<
    'pending' | 'sending' | 'received' | 'fallback-accepted' | 'undelivered'
  >(),
});

export const pushDigestItem = sqliteTable('push_digest_item', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  teamId: text('teamId').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  href: text('href').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export type CoordinatorTurn = { stepId: string; workKey: string };

type HarnessEvalAttemptState = 'claimed' | 'dispatched' | 'dispatch_uncertain' | 'terminal';
type HarnessEvalAttemptOutcome =
  | 'completed'
  | 'timeout'
  | 'worker_failure'
  | 'rejected_publication'
  | 'unavailable_worker'
  | 'budget_refusal';

export const harnessEvalAttempt = sqliteTable(
  'harness_eval_attempts',
  {
    id: text('id').primaryKey(),
    repo: text('repo').notNull(),
    pr: integer('pr').notNull(),
    patchDigest: text('patchDigest').notNull(),
    workerId: text('workerId').notNull(),
    state: text('state').$type<HarnessEvalAttemptState>().notNull(),
    deadlineAt: epochMs('deadlineAt').notNull(),
    outcome: text('outcome').$type<HarnessEvalAttemptOutcome | null>(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    uniqueIndex('harness_eval_attempts_repo_pr_digest_unique').on(t.repo, t.pr, t.patchDigest),
  ],
);

export const skillAudit = sqliteTable('skill_audit', {
  id: text('id').primaryKey(),
  skillId: text('skillId').notNull(),
  actorType: text('actorType').notNull(),
  actorId: text('actorId').notNull(),
  action: text('action').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const provider = sqliteTable('provider', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  kind: text('kind').notNull().default('custom'),
  providerId: text('providerId').notNull(),
  label: text('label').notNull(),
  baseUrl: text('baseUrl').notNull(),
  api: text('api').$type<ProviderApi>().notNull(),
  authHeader: bool('authHeader').notNull().default(true),
  compat: json<ProviderCompat>('compat').notNull(),
  models: json<ProviderModel[]>('models').notNull().default(sql`'[]'`),
  apiKeyCipher: text('apiKeyCipher'),
  createdBy: text('createdBy').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
});

export const secret = sqliteTable('secret', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  projectId: text('projectId').references(() => project.id),
  name: text('name').notNull(),
  description: text('description'),
  valueCipher: text('valueCipher'),
});

export const apiKey = sqliteTable('api_key', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  name: text('name'),
  gitAccess: bool('gitAccess').notNull().default(false),
  mcpAccess: bool('mcpAccess').notNull().default(false),
  machineAccess: bool('machineAccess').notNull().default(false),
  toolGrants: json<{ read: string[]; write: string[] }>('toolGrants').notNull(),
  keyHash: text('keyHash').notNull(),
  masked: text('masked').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const pairedDevice = sqliteTable(
  'paired_device',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    name: text('name').notNull(),
    tokenHash: text('tokenHash').notNull(),
    masked: text('masked').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    lastSeenAt: epochMs('lastSeenAt'),
  },
  (t) => [uniqueIndex('paired_device_tokenHash_unique').on(t.tokenHash)],
);

export const pairingGrant = sqliteTable(
  'pairing_grant',
  {
    id: text('id').primaryKey(),
    codeHash: text('codeHash').notNull(),
    expiresAt: epochMs('expiresAt').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    revokedAt: epochMs('revokedAt'),
    redeemedAt: epochMs('redeemedAt'),
  },
  (t) => [uniqueIndex('pairing_grant_codeHash_unique').on(t.codeHash)],
);

export const browserSession = sqliteTable(
  'browser_session',
  {
    id: text('id').primaryKey(),
    tokenHash: text('tokenHash').notNull(),
    kind: text('kind').notNull(),
    deviceId: text('deviceId').references(() => pairedDevice.id, { onDelete: 'cascade' }),
    expiresAt: epochMs('expiresAt').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [uniqueIndex('browser_session_tokenHash_unique').on(t.tokenHash)],
);

export const machine = sqliteTable(
  'machine',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    name: text('name').notNull(),
    online: bool('online').notNull().default(false),
    tokenHash: text('tokenHash'),
    apiKeyId: text('apiKeyId'),
    latestCliVersion: text('latestCliVersion'),
    kind: text('kind').notNull().default('remote'),
    enabledRuntimes: json<string[]>('enabledRuntimes').notNull().default(sql`'[]'`),
    claudeCodeReport: json<ClaudeCodeReport | null>('claudeCodeReport'),
    claudeRateLimits: json<ClaudeRateLimitWindow[] | null>('claudeRateLimits'),
    maxConcurrent: integer('maxConcurrent').notNull().default(3),
    maxConcurrentOverridden: bool('maxConcurrentOverridden').notNull().default(false),
    lastSeenAt: epochMs('lastSeenAt'),
    capabilities: json<MachineCapabilities | null>('capabilities'),
  },
  (t) => [index('machine_online_lastSeenAt_idx').on(t.online, t.lastSeenAt)],
);

export const harnessProfile = sqliteTable(
  'harness_profile',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    mode: text('mode').notNull().default('independent'),
    capabilities: json<string[]>('capabilities').notNull().default(sql`'[]'`),
    targets: json<string[]>('targets').notNull().default(sql`'[]'`),
    version: integer('version').notNull().default(0),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [uniqueIndex('harness_profile_team_unique').on(t.teamId)],
);

export const threadPr = sqliteTable(
  'thread_pr',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    threadId: text('threadId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull().default(''),
    url: text('url').notNull(),
    state: text('state').$type<PrPanelState>().notNull().default('open'),
    mergeState: text('mergeState').$type<PrMergeState>().notNull().default('unknown'),
    additions: integer('additions').notNull().default(0),
    deletions: integer('deletions').notNull().default(0),
    checksPassed: integer('checksPassed').notNull().default(0),
    checksFailed: integer('checksFailed').notNull().default(0),
    checksRunning: integer('checksRunning').notNull().default(0),
    checksTotal: integer('checksTotal').notNull().default(0),
    checksFailedNames: text('checksFailedNames').notNull().default('[]'),
    head: text('head').notNull().default(''),
    checksReadFor: text('checksReadFor').notNull().default(''),
    headRef: text('headRef').notNull().default(''),
    baseRef: text('baseRef').notNull().default(''),
    verdictResult: text('verdictResult').$type<'pass' | 'block'>(),
    verdictHead: text('verdictHead'),
    autoFix: bool('autoFix').notNull().default(true),
    mergeWhenReady: bool('mergeWhenReady').notNull().default(false),
    autoArchive: bool('autoArchive').notNull().default(true),
    dismissed: bool('dismissed').notNull().default(false),
    blockedSince: epochMs('blockedSince'),
    wakeRounds: integer('wakeRounds').notNull().default(0),
    lastReadAt: epochMs('lastReadAt').notNull().default(0),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    uniqueIndex('thread_pr_build_unique').on(t.buildId),
    uniqueIndex('thread_pr_team_repo_number_unique').on(t.teamId, t.repo, t.number),
    index('thread_pr_threadId_idx').on(t.threadId),
  ],
);

export const tokenUsage = sqliteTable(
  'token_usage',
  {
    buildId: text('buildId').notNull(),
    model: text('model').notNull(),
    input: integer('input').notNull().default(0),
    output: integer('output').notNull().default(0),
    cacheRead: integer('cacheRead').notNull().default(0),
    cacheWrite: integer('cacheWrite').notNull().default(0),
    costInput: real('costInput'),
    costOutput: real('costOutput'),
    costCacheRead: real('costCacheRead'),
    costCacheWrite: real('costCacheWrite'),
    costTotal: real('costTotal'),
  },
  (t) => [primaryKey({ columns: [t.buildId, t.model] })],
);

export const chiefTurnUsage = sqliteTable(
  'chief_turn_usage',
  {
    stepId: text('stepId').notNull(),
    threadId: text('threadId').notNull(),
    model: text('model').notNull(),
    input: integer('input').notNull().default(0),
    output: integer('output').notNull().default(0),
    cacheRead: integer('cacheRead').notNull().default(0),
    cacheWrite: integer('cacheWrite').notNull().default(0),
    ttftMs: integer('ttftMs'),
    contextTokens: integer('contextTokens'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.stepId, t.model] }),
    index('chief_turn_usage_thread_idx').on(t.threadId, t.createdAt),
  ],
);

export const coordinatorConversation = sqliteTable('coordinator_conversation', {
  storeId: text('storeId'),
  threadId: text('threadId').primaryKey(),
  conversationId: text('conversationId').notNull(),
  lastMirroredEntryId: text('lastMirroredEntryId'),
  lastColdSlimAt: epochMs('lastColdSlimAt'),
  lastColdSlimStepId: text('lastColdSlimStepId'),
  piVersion: text('piVersion').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
});

export const coordinatorEntry = sqliteTable(
  'coordinator_entry',
  {
    chiefMessageId: text('chiefMessageId').primaryKey(),
    threadId: text('threadId').notNull(),
    conversationId: text('conversationId').notNull(),
    entryId: text('entryId').notNull(),
  },
  (t) => [index('coordinator_entry_thread_idx').on(t.threadId, t.conversationId)],
);

export const coordinatorLease = sqliteTable('coordinator_lease', {
  storeKey: text('storeKey').primaryKey(),
  owner: text('owner'),
  heartbeatAt: epochMs('heartbeatAt').notNull(),
});

export const chiefSummary = sqliteTable('chief_summary', {
  threadId: text('threadId').primaryKey(),
  summary: text('summary').notNull(),
  coveredThroughId: text('coveredThroughId').notNull(),
  coveredAt: epochMs('coveredAt').notNull(),
  coveredRowid: integer('coveredRowid').notNull(),
  compactedMessages: integer('compactedMessages').notNull(),
  generation: integer('generation').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
});

export const chief = sqliteTable('chief', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  charter: text('charter').notNull().default(''),
  watches: json<ChiefWatch[]>('watches').notNull().default(sql`'[]'`),
  wakes: json<Record<string, unknown>[]>('wakes').notNull().default(sql`'[]'`),
  lastTurnAt: epochMs('lastTurnAt'),
  createdAt: epochMs('createdAt').notNull(),
  tz: text('tz'),
});

export const chiefThread = sqliteTable(
  'chief_thread',
  {
    id: text('id').primaryKey(),
    chiefId: text('chiefId').notNull(),
    userId: text('userId').notNull(),
    teamId: text('teamId').notNull(),
    projectId: text('projectId'),
    title: text('title').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
    lastTurnAt: epochMs('lastTurnAt'),
    sessionRuntime: text('sessionRuntime').notNull().default('pi'),
    sessionId: text('sessionId').notNull(),
    sessionOpenedAt: epochMs('sessionOpenedAt').notNull(),
    pendingSessionResumeAt: epochMs('pendingSessionResumeAt'),
    toolDefHashes: json<Record<string, string>>('toolDefHashes').notNull().default(sql`'{}'`),
    toolResultHashes: json<Record<string, string>>('toolResultHashes').notNull().default(sql`'{}'`),
    activeRun: json<ActiveRun>('activeRun'),
    archivedAt: epochMs('archivedAt'),
  },
  (t) => [
    uniqueIndex('chief_thread_coordinator_unique')
      .on(t.chiefId)
      .where(sql`${t.archivedAt} is null and ${t.id} not like 'chief-digest-%'`),
  ],
);

export const coordinatorInput = sqliteTable(
  'coordinator_input',
  {
    id: text('id').primaryKey(),
    threadId: text('threadId')
      .notNull()
      .references(() => chiefThread.id, { onDelete: 'cascade' }),
    stepId: text('stepId').notNull(),
    kind: text('kind').$type<'initial' | 'steer'>().notNull(),
    ownerMessageIds: json<string[]>('ownerMessageIds').notNull(),
    content: text('content').notNull(),
    conversationId: text('conversationId'),
    state: text('state').$type<'pending' | 'consumed' | 'released'>().notNull().default('pending'),
    entryId: text('entryId'),
    successorStepId: text('successorStepId'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    uniqueIndex('coordinator_input_initial_unique')
      .on(t.stepId, t.conversationId)
      .where(sql`${t.kind} = 'initial'`),
    index('coordinator_input_thread_state_idx').on(t.threadId, t.state, t.stepId),
    check(
      'coordinator_input_receipt',
      sql`(${t.state} = 'consumed' AND ${t.entryId} IS NOT NULL) OR (${t.state} IN ('pending', 'released') AND ${t.entryId} IS NULL)`,
    ),
  ],
);

export const coordinatorRun = sqliteTable(
  'coordinator_run',
  {
    threadId: text('threadId')
      .notNull()
      .references(() => chiefThread.id, { onDelete: 'cascade' }),
    conversationId: text('conversationId').notNull(),
    taskId: text('taskId').notNull(),
    stepId: text('stepId').notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.conversationId, t.taskId] })],
);

export const chiefMessage = sqliteTable('chief_message', {
  id: text('id').primaryKey(),
  threadId: text('threadId')
    .notNull()
    .references(() => chiefThread.id, { onDelete: 'cascade' }),
  role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
  content: json<unknown>('content').notNull(),
  projectId: text('projectId'),
  createdAt: epochMs('createdAt').notNull(),
});

export interface ChiefReportSourceRef {
  kind: 'coordinator' | 'thread' | 'step';
  id: string;
  label: string;
  todoId: string | null;
  projectId: string | null;
}

export interface ChiefReportInputs {
  covers: string;
  coversStart: number;
  coversEnd: number;
  refs: Record<string, ChiefReportSourceRef>;
  projects: Record<string, string>;
  truncated: string[];
}

export const chiefReport = sqliteTable(
  'chief_report',
  {
    id: text('id').primaryKey(),
    chiefId: text('chiefId').notNull(),
    teamId: text('teamId').notNull(),
    day: text('day').notNull(),
    threadId: text('threadId').notNull(),
    status: text('status')
      .$type<'running' | 'retrying' | 'posted' | 'failed' | 'empty'>()
      .notNull(),
    attempts: integer('attempts').notNull().default(0),
    stepId: text('stepId'),
    inputs: json<ChiefReportInputs | null>('inputs'),
    pushedAt: epochMs('pushedAt'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [uniqueIndex('chief_report_chief_day_unique').on(t.chiefId, t.day)],
);

export const retroProposal = sqliteTable(
  'retro_proposal',
  {
    id: text('id').primaryKey(),
    reportId: text('reportId').notNull(),
    teamId: text('teamId').notNull(),
    projectId: text('projectId').notNull(),
    title: text('title').notNull(),
    what: text('what').notNull(),
    why: text('why').notNull(),
    safeguard: text('safeguard').notNull(),
    sourceKind: text('sourceKind')
      .$type<'coordinator' | 'thread' | 'step' | typeof INTAKE_SOURCE_KIND>()
      .notNull(),
    sourceId: text('sourceId').notNull(),
    sourceLabel: text('sourceLabel').notNull(),
    sourceTodoId: text('sourceTodoId'),
    status: text('status').$type<'draft' | 'accepted' | 'dismissed'>().notNull().default('draft'),
    todoId: text('todoId'),
    decidedAt: epochMs('decidedAt'),
    decidedBy: text('decidedBy'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [index('retro_proposal_report_idx').on(t.reportId)],
);

export const attachment = sqliteTable('attachment', {
  todoId: text('todoId'),
  sha256: text('sha256'),
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  createdBy: text('createdBy').notNull(),
  fileName: text('fileName').notNull(),
  mimeType: text('mimeType').notNull(),
  sizeBytes: integer('sizeBytes').notNull(),
  storageKey: text('storageKey').notNull(),
  grantId: text('grantId').notNull(),
  scope: text('scope').$type<'spec' | 'message'>().notNull(),
  status: text('status').$type<'pending' | 'ready' | 'failed'>().notNull().default('pending'),
  createdAt: epochMs('createdAt').notNull(),
});

export const composerDraft = sqliteTable(
  'composer_draft',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    content: text('content').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [uniqueIndex('composer_draft_owner_scope_idx').on(t.teamId, t.userId, t.scope)],
);

export const githubConnection = sqliteTable('github_connection', {
  githubUserId: integer('githubUserId'),
  githubName: text('githubName'),
  teamId: text('teamId')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  login: text('login').notNull(),
  accessTokenCipher: text('accessTokenCipher').notNull(),
  refreshTokenCipher: text('refreshTokenCipher'),
  accessTokenExpiresAt: epochMs('accessTokenExpiresAt'),
  disconnectedReason: text('disconnectedReason'),
  scope: text('scope').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

type GateVerdictKind = 'review' | 'verify' | 'decision';
type GateVerdictOutcome =
  | 'pass'
  | 'block'
  | 'extraction_failed'
  | 'step_failed'
  | 'tampered'
  | 'unbound'
  | 'evidence_invalid';
type GatePolicy = 'human' | 'shadow' | 'autonomous';
interface GateBlockerRow {
  code: string;
  class: 'policy' | 'transient' | 'human';
  label: string;
  detail: string[];
}
type GateRoundState = 'open' | 'fixing' | 'fix_no_change' | 'closed';
interface GateRoundDispatch {
  count: number;
  lastAt: number;
}

export const gateDigest = sqliteTable(
  'gate_digest',
  {
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    headSha: text('headSha').notNull(),
    patchDigest: text('patchDigest').notNull(),
    countedFiles: integer('countedFiles').notNull(),
    countedLines: integer('countedLines').notNull(),
    keptFiles: integer('keptFiles').notNull(),
    keptLines: integer('keptLines').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [primaryKey({ columns: [t.buildId, t.headSha] })],
);

export const gateRound = sqliteTable(
  'gate_round',
  {
    id: text('id').primaryKey(),
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    patchDigest: text('patchDigest').notNull(),
    round: integer('round').notNull(),
    fixRound: integer('fixRound').notNull().default(0),
    state: text('state').$type<GateRoundState>().notNull().default('open'),
    perspectives: json<string[]>('perspectives').notNull(),
    timedOut: json<string[]>('timedOut').notNull().default(sql`'[]'`),
    dispatches: json<Record<string, GateRoundDispatch>>('dispatches').notNull().default(sql`'{}'`),
    startedAt: epochMs('startedAt').notNull(),
  },
  (t) => [
    uniqueIndex('gate_round_build_digest_unique').on(t.buildId, t.patchDigest),
    uniqueIndex('gate_round_build_round_unique').on(t.buildId, t.round),
  ],
);

export const gateVerdict = sqliteTable(
  'gate_verdict',
  {
    stepId: text('stepId').primaryKey(),
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<GateVerdictKind>().notNull(),
    perspective: text('perspective'),
    outcome: text('outcome').$type<GateVerdictOutcome>().notNull(),
    patchDigest: text('patchDigest'),
    headSha: text('headSha'),
    expectedHeadSha: text('expectedHeadSha').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [index('gate_verdict_buildId_idx').on(t.buildId)],
);

export const gateState = sqliteTable('gate_state', {
  buildId: text('buildId')
    .primaryKey()
    .references(() => build.id, { onDelete: 'cascade' }),
  ready: bool('ready').notNull(),
  headSha: text('headSha'),
  patchDigest: text('patchDigest'),
  policy: text('policy').$type<GatePolicy>().notNull(),
  blockers: json<GateBlockerRow[]>('blockers').notNull(),
  evaluatedAt: epochMs('evaluatedAt').notNull(),
});

export const autonomyState = sqliteTable(
  'autonomy_state',
  {
    projectId: text('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AutonomyKind>().notNull(),
    lastStartedAt: epochMs('lastStartedAt'),
    baselineSha: text('baselineSha'),
    lastBlockedReason: text('lastBlockedReason').$type<AutonomyGateReason | null>(),
    lastEvaluatedAt: epochMs('lastEvaluatedAt'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.kind] })],
);

export const memberActivity = sqliteTable('member_activity', {
  scope: text('scope').primaryKey(),
  at: epochMs('at').notNull(),
});

export const buildFeedback = sqliteTable(
  'build_feedback',
  {
    id: text('id').primaryKey(),
    buildId: text('buildId')
      .notNull()
      .references(() => build.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'revision' | 'restart'>().notNull(),
    side: text('side').$type<'plan' | 'build'>().notNull(),
    feedback: text('feedback').notNull(),
    actor: text('actor').notNull(),
    stepId: text('stepId'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [index('build_feedback_buildId_idx').on(t.buildId)],
);

export const buildOutcomeBackfill = sqliteTable('build_outcome_backfill', {
  buildId: text('buildId')
    .primaryKey()
    .references(() => build.id, { onDelete: 'cascade' }),
  revertedWithin7d: bool('revertedWithin7d').notNull(),
  fixedByLaterPr: bool('fixedByLaterPr').notNull(),
  mergeCommit: text('mergeCommit').notNull(),
  checkedAt: epochMs('checkedAt').notNull(),
});

export const scheduleReport = sqliteTable(
  'schedule_report',
  {
    id: text('id').primaryKey(),
    projectId: text('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    generatedAt: epochMs('generatedAt').notNull(),
    mainSha: text('mainSha').notNull(),
    groups: json<ScheduleReport['groups']>('groups').notNull(),
    items: json<ScheduleReport['items']>('items').notNull(),
    unparsedDeps: json<ScheduleReport['unparsedDeps']>('unparsedDeps').notNull(),
    decidedAt: epochMs('decidedAt'),
    decidedBy: text('decidedBy'),
    appliedAt: epochMs('appliedAt'),
  },
  (t) => [index('schedule_report_project_idx').on(t.projectId, t.generatedAt)],
);

export const claudeSubscription = sqliteTable('claude_subscription', {
  id: text('id').primaryKey(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  tokenCipher: text('tokenCipher').notNull(),
  expiresAt: epochMs('expiresAt'),
  createdAt: epochMs('createdAt').notNull(),
});

export const clientMessage = sqliteTable(
  'client_message',
  {
    scopeId: text('scopeId').notNull(),
    clientMessageId: text('clientMessageId').notNull(),
    response: json<unknown>('response'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeId, t.clientMessageId] })],
);

export const deployLease = sqliteTable(
  'deploy_lease',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    status: text('status').$type<'accepting' | 'draining'>().notNull(),
    expiresAt: epochMs('expiresAt').notNull(),
  },
  (t) => [check('deploy_lease_status', sql`${t.status} in ('accepting', 'draining')`)],
);

export const coordinatorTurnSnapshot = sqliteTable(
  'coordinator_turn_snapshot',
  {
    turnId: text('turnId').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    sourceTraceId: text('sourceTraceId').notNull(),
    schemaVersion: integer('schemaVersion').notNull(),
    outcome: text('outcome').$type<'success' | 'failed' | 'stopped'>().notNull(),
    capturedAt: epochMs('capturedAt').notNull(),
    expiresAt: epochMs('expiresAt').notNull(),
    status: text('status').$type<'sealed' | 'unusable'>().notNull(),
    reason: text('reason'),
    redactionCount: integer('redactionCount').notNull(),
    payloadBytes: integer('payloadBytes').notNull(),
    digest: text('digest'),
    payload: text('payload'),
  },
  (t) => [
    uniqueIndex('coordinator_turn_snapshot_trace_idx').on(t.sourceTraceId),
    index('coordinator_turn_snapshot_expiry_idx').on(t.expiresAt),
    index('coordinator_turn_snapshot_team_age_idx').on(t.teamId, t.capturedAt, t.turnId),
    check('coordinator_turn_snapshot_version', sql`${t.schemaVersion} > 0`),
    check(
      'coordinator_turn_snapshot_outcome',
      sql`${t.outcome} in ('success', 'failed', 'stopped')`,
    ),
    check('coordinator_turn_snapshot_expiry', sql`${t.expiresAt} = ${t.capturedAt} + 2592000000`),
    check('coordinator_turn_snapshot_redactions', sql`${t.redactionCount} >= 0`),
    check(
      'coordinator_turn_snapshot_payload',
      sql`
      (${t.status} = 'sealed' AND ${t.reason} IS NULL AND ${t.redactionCount} = 0
       AND ${t.payload} IS NOT NULL AND json_valid(${t.payload})
       AND ${t.payloadBytes} = length(cast(${t.payload} AS blob))
       AND ${t.payloadBytes} <= 2097152
       AND ${t.digest} IS NOT NULL AND length(${t.digest}) = 64
       AND ${t.digest} NOT GLOB '*[^0-9a-f]*')
      OR (${t.status} = 'unusable' AND ${t.payload} IS NULL AND ${t.payloadBytes} = 0
       AND ${t.digest} IS NULL AND ${t.reason} IS NOT NULL
       AND length(${t.reason}) BETWEEN 1 AND 128)`,
    ),
  ],
);

export const actionJournal = sqliteTable(
  'action_journal',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    actionId: text('actionId').notNull(),
    targetId: text('targetId').notNull(),
    actor: text('actor').$type<'user' | 'coordinator'>().notNull(),
    surface: text('surface').notNull(),
    kind: text('kind').$type<'run' | 'undo' | 'undo-refused' | 'error'>().notNull(),
    inputHash: text('inputHash').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('action_journal_team_idx').on(t.teamId, t.createdAt),
    check('action_journal_actor', sql`${t.actor} in ('user', 'coordinator')`),
    check('action_journal_kind', sql`${t.kind} in ('run', 'undo', 'undo-refused', 'error')`),
  ],
);

export const actionProposal = sqliteTable(
  'action_proposal',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    actionId: text('actionId').notNull(),
    targetId: text('targetId').notNull(),
    inputJson: text('inputJson').notNull(),
    inputHash: text('inputHash').notNull(),
    status: text('status')
      .$type<'pending' | 'refused' | 'executed' | 'failed' | 'expired' | 'superseded'>()
      .notNull(),
    decision: text('decision').$type<'refuse' | 'allow-once' | 'always' | null>(),
    expiresAt: epochMs('expiresAt').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    decidedBy: text('decidedBy'),
    decidedAt: epochMs('decidedAt'),
  },
  (t) => [
    uniqueIndex('action_proposal_pending_idx')
      .on(t.teamId, t.actionId, t.targetId)
      .where(sql`${t.status} = 'pending'`),
    index('action_proposal_expiry_idx').on(t.status, t.expiresAt),
  ],
);

export const actionSubscriber = sqliteTable(
  'action_subscriber',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposalId')
      .notNull()
      .references(() => actionProposal.id, { onDelete: 'cascade' }),
    threadId: text('threadId').notNull(),
    wakeStepId: text('wakeStepId').notNull(),
    scopeProjectId: text('scopeProjectId'),
  },
  (t) => [uniqueIndex('action_subscriber_proposal_thread_idx').on(t.proposalId, t.threadId)],
);

export const actionWakeOutbox = sqliteTable(
  'action_wake_outbox',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposalId')
      .notNull()
      .references(() => actionProposal.id, { onDelete: 'cascade' }),
    threadId: text('threadId').notNull(),
    outcome: text('outcome').notNull(),
    state: text('state').$type<'pending' | 'delivered' | 'undeliverable'>().notNull(),
  },
  (t) => [uniqueIndex('action_wake_outbox_proposal_thread_idx').on(t.proposalId, t.threadId)],
);
