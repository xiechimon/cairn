import type {
  ActiveRun,
  AntigravitySubscriptionModel,
  ArtifactAnchor,
  AutonomyPauseMarker,
  AutonomyPauseSource,
  BlockerHandoffRecord,
  BuildStop,
  ChiefMemoryTrace,
  ChiefMessageDelivery,
  ChiefWatch,
  ClaudeCodeReport,
  ClaudeRateLimitWindow,
  ClaudeSubscriptionModel,
  ClaudeSubscriptionQuotaWindow,
  ComputerCallState,
  ComputerControlHolder,
  ComputerImage,
  ComputerState,
  ComputerTool,
  DesignCommentStatus,
  DesignRect,
  DesignStyle,
  DesignViewport,
  DevinSubscriptionModel,
  DocumentDiffFile,
  DoubaoSubscriptionModel,
  EvidenceStore,
  ImConnectionStatus,
  ImPairedSender,
  ImPairingRequestStatus,
  ImPlatform,
  MachineCapabilities,
  MailAccountStatus,
  MailEventStatus,
  MailRank,
  McpConnectorAuthKind,
  McpConnectorOAuthMeta,
  McpConnectorStatus,
  McpConnectorTool,
  McpConnectorTransport,
  MemoryLayer,
  ModelRef,
  NotificationType,
  Phase,
  PrMergeState,
  ProjectColor,
  ProjectIcon,
  ProjectMergeConfig,
  ProjectModelOverrides,
  ProjectRepoKind,
  ProviderApi,
  ProviderCompat,
  ProviderModel,
  PrPanelState,
  RequiredCapabilities,
  RetryFailureClass,
  RetryReasonCode,
  RouteOverride,
  RouteUse,
  ScheduleKind,
  ScheduleTriggerSpec,
  SecretDelivery,
  SkillInjectionRecord,
  SplitPolicy,
  StepFailureCode,
  StepFailureDetail,
  StepKind,
  StepPromptOrigin,
  SubscriptionCheck,
  TaskDecision,
  TaskRequest,
  TodoOutputKind,
  TodoSourceKind,
  TranscriptUserOrigin,
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

/**
 * Server-stamped provenance of an assistant row: the step that produced it, the runner that holds
 * its workspace and that runner's opaque workspace instance token. Private; never projected to the
 * browser. A row without `workspace` or `machineId` grants no file access.
 */
export interface MessageFileSource {
  stepId: string;
  machineId: string | null;
  generation: number | null;
  workspace?: string;
}

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  displayName: text('displayName').notNull(),
  displayNameEdited: bool('displayNameEdited'),
  avatarUrl: text('avatarUrl'),
  lastDesktopActiveAt: epochMs('lastDesktopActiveAt'),
});

export const team = sqliteTable('team', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  plan: text('plan').notNull().default('free'),
  avatarStyle: text('avatarStyle'),
  maxAutonomousMergesPerDay: integer('maxAutonomousMergesPerDay').notNull().default(10),
  defaultMachineId: text('defaultMachineId'),
  providerOrder: json<string[]>('providerOrder'),
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
  modelOverrides: json<ProjectModelOverrides>('modelOverrides'),
  autonomy: json<Partial<ProjectMergeConfig> | null>('autonomy'),
  personalOwnerId: text('personalOwnerId').references(() => user.id),
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

export const todoTransition = sqliteTable(
  'todo_transition',
  {
    id: text('id').primaryKey(),
    todoId: text('todoId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    fromPhase: text('fromPhase').$type<Phase>().notNull(),
    toPhase: text('toPhase').$type<Phase>().notNull(),
    cause: text('cause').$type<'stop' | 'manual'>(),
    at: epochMs('at').notNull(),
  },
  (t) => [index('todo_transition_todo_idx').on(t.todoId, t.at)],
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
  afterStopPhase: text('afterStopPhase').$type<'done' | 'keep' | null>(),
  triggerSource: text('triggerSource').$type<TriggerSource>().notNull(),
  scheduledBy: text('scheduledBy'),
  planDocId: text('planDocId'),
  errorMessage: text('errorMessage'),
  failureCode: text('failureCode').$type<StepFailureCode | null>(),
  failureDetail: json<StepFailureDetail>('failureDetail'),
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
  retryAttempt: integer('retryAttempt').notNull().default(0),
  retryClass: text('retryClass').$type<RetryFailureClass | null>(),
  retryNextAt: epochMs('retryNextAt'),
  retryWindowStartedAt: epochMs('retryWindowStartedAt'),
  retryParkReason: text('retryParkReason').$type<RetryReasonCode | null>(),
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

export interface StepRanModel extends ModelRef {
  thinkingLevel?: string | null;
}

export type StepStallCause =
  | 'permission_wait'
  | 'missing_tools'
  | 'quota'
  | 'dead_turn'
  | 'silent_turn';

export interface StepStallActivity {
  phase: string;
  stallSignal?: 'quota' | 'capacity' | 'missing_tools' | 'permission';
  attempt?: number;
  detail?: string;
  firstSeenAt: number;
  at: number;
}

export interface StepStallMeta {
  recoveryCount?: number;
  lastCause?: StepStallCause;
  lastRecoveredAt?: number;
  lastRecoveredFromMachineId?: string | null;
  reportedAt?: number;
  reportedFingerprint?: string;
  activity?: StepStallActivity;
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
    stallState: json<StepStallMeta>('stallState'),
    sessionId: text('sessionId'),
    checkpointCommit: text('checkpointCommit'),
    claimedAt: epochMs('claimedAt'),
    lastHeartbeatAt: epochMs('lastHeartbeatAt'),
    lastProgressAt: epochMs('lastProgressAt'),
    finishedAt: epochMs('finishedAt'),
    prompt: text('prompt'),
    promptOrigin: json<StepPromptOrigin>('promptOrigin'),
    scopeProjectId: text('scopeProjectId'),
    ownerMessageIds: json<string[]>('ownerMessageIds'),
    ownerSaid: text('ownerSaid'),
    byPerson: bool('byPerson').notNull().default(false),
    doubaoSubscriptionId: text('doubaoSubscriptionId'),
    freshSession: bool('freshSession').notNull().default(false),
    holdReason: text('holdReason'),
    holdUntil: epochMs('holdUntil'),
    holdCount: integer('holdCount').notNull().default(0),
    claimCount: integer('claimCount').notNull().default(0),
    failureCode: text('failureCode').$type<StepFailureCode | null>(),
    mcpGrant: json<string[]>('mcpGrant'),
    claimedRepo: text('claimedRepo'),
    claimedRepoId: integer('claimedRepoId'),
    targetMachineId: text('targetMachineId'),
    routedFromMachineId: text('routedFromMachineId'),
    routedReason: text('routedReason').$type<'offline' | 'busy' | 'manual-switch' | null>(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('step_status_kind_idx').on(t.status, t.kind),
    index('step_buildId_status_idx').on(t.buildId, t.status),
    index('step_kind_idx').on(t.kind),
    index('step_merge_finished_idx').on(t.kind, t.status, t.finishedAt),
  ],
);

export const stepQuota = sqliteTable('step_quota', {
  stepId: text('stepId')
    .primaryKey()
    .notNull()
    .references(() => step.id, { onDelete: 'cascade' }),
  quotaBlock: json<QuotaWaitRow>('quotaBlock'),
  fallback: json<StepFallbackRow>('fallback'),
  ranModel: json<StepRanModel>('ranModel'),
});

export const stepSubscription = sqliteTable('step_subscription', {
  stepId: text('stepId')
    .primaryKey()
    .notNull()
    .references(() => step.id, { onDelete: 'cascade' }),
  claudeSubscriptionId: text('claudeSubscriptionId'),
  devinSubscriptionId: text('devinSubscriptionId'),
  antigravitySubscriptionId: text('antigravitySubscriptionId'),
});

export const stepSchedule = sqliteTable('step_schedule', {
  stepId: text('stepId')
    .primaryKey()
    .notNull()
    .references(() => step.id, { onDelete: 'cascade' }),
  scheduleId: text('scheduleId'),
  scheduledBy: text('scheduledBy'),
});

export const stepMemoryTrace = sqliteTable('step_memory_trace', {
  stepId: text('stepId')
    .primaryKey()
    .notNull()
    .references(() => step.id, { onDelete: 'cascade' }),
  memoryTrace: json<ChiefMemoryTrace>('memoryTrace').notNull(),
});

export const stepSkillInjection = sqliteTable('step_skill_injection', {
  stepId: text('stepId')
    .primaryKey()
    .notNull()
    .references(() => step.id, { onDelete: 'cascade' }),
  skillInjection: json<SkillInjectionRecord>('skillInjection').notNull(),
});

export const stepBlockerHandoff = sqliteTable('step_blocker_handoff', {
  stepId: text('stepId')
    .primaryKey()
    .notNull()
    .references(() => step.id, { onDelete: 'cascade' }),
  blockerHandoff: json<BlockerHandoffRecord>('blockerHandoff').notNull(),
});

export const message = sqliteTable(
  'message',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversationId').notNull(),
    role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
    content: json<unknown>('content').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    actor: text('actor'),
    origin: text('origin').$type<TranscriptUserOrigin>(),
    typedAt: epochMs('typedAt'),
    sentByAgent: integer('sentByAgent', { mode: 'boolean' }),
    clientMessageId: text('clientMessageId'),
    fileSource: json<MessageFileSource | null>('fileSource'),
  },
  (t) => [
    index('message_createdAt_idx').on(t.createdAt),
    index('message_conversationId_idx').on(t.conversationId),
  ],
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
    handoffReason: text('handoffReason').$type<'login' | 'model'>(),
    handoffStepId: text('handoffStepId'),
    handoffRequestedAt: epochMs('handoffRequestedAt'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [uniqueIndex('computer_scope_key_idx').on(t.scopeKey)],
);

export const phone = sqliteTable(
  'phone',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    machineId: text('machineId')
      .notNull()
      .references(() => machine.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<'android' | 'ios'>().notNull(),
    deviceId: text('deviceId').notNull(),
    name: text('name').notNull(),
    consentAt: epochMs('consentAt'),
    consentedBy: text('consentedBy'),
    lastError: text('lastError'),
    executionStepId: text('executionStepId'),
    executionLeaseExpiresAt: epochMs('executionLeaseExpiresAt'),
    executionFence: integer('executionFence').notNull().default(0),
    handoffReason: text('handoffReason').$type<'login' | 'model'>(),
    handoffStepId: text('handoffStepId'),
    handoffRequestedAt: epochMs('handoffRequestedAt'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    index('phone_team_idx').on(t.teamId),
    uniqueIndex('phone_machine_device_idx').on(t.machineId, t.deviceId),
  ],
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
    phoneId: text('phoneId').references(() => phone.id, { onDelete: 'set null' }),
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
    workspace: text('workspace'),
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

export const computerBrowserLease = sqliteTable(
  'computer_browser_lease',
  {
    id: text('id').primaryKey(),
    computerId: text('computerId')
      .notNull()
      .references(() => computer.id, { onDelete: 'cascade' }),
    profileKey: text('profileKey').notNull(),
    stepId: text('stepId').notNull(),
    expiresAt: epochMs('expiresAt').notNull(),
    fence: integer('fence').notNull().default(0),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    uniqueIndex('computer_browser_lease_profile_idx').on(t.computerId, t.profileKey),
    index('computer_browser_lease_step_idx').on(t.stepId),
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
    sentByAgent: integer('sentByAgent', { mode: 'boolean' }),
    clientMessageId: text('clientMessageId'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [index('queued_message_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const steerPending = sqliteTable('steer_pending', {
  conversationId: text('conversationId').primaryKey(),
  stepId: text('stepId').notNull(),
  content: text('content').notNull(),
  sentAt: epochMs('sentAt'),
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
    projectId: text('projectId'),
    todoId: text('todoId'),
    chiefThreadId: text('chiefThreadId'),
    kind: text('kind').$type<ScheduleKind>().notNull(),
    cron: text('cron'),
    prompt: text('prompt').notNull().default(''),
    enabled: bool('enabled').notNull().default(true),
    at: epochMs('at'),
    tz: text('tz').notNull(),
    triggerSpec: json<ScheduleTriggerSpec>('triggerSpec'),
    webhookTokenHash: text('webhookTokenHash'),
    webhookMasked: text('webhookMasked'),
    webhookDeliveries: json<string[]>('webhookDeliveries'),
    webhookLastUsedAt: epochMs('webhookLastUsedAt'),
    missedRunWindowMs: integer('missedRunWindowMs'),
    createdAt: epochMs('createdAt'),
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
    index('schedule_chiefThreadId_idx').on(t.chiefThreadId),
    uniqueIndex('schedule_webhookTokenHash_unique').on(t.webhookTokenHash),
    check(
      'schedule_target_xor',
      sql`((${t.todoId} IS NOT NULL AND ${t.chiefThreadId} IS NULL) OR (${t.todoId} IS NULL AND ${t.chiefThreadId} IS NOT NULL))`,
    ),
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
    deliveryId: text('deliveryId'),
    deliveryStatus: text('deliveryStatus')
      .$type<'none' | 'suppressed' | 'desktop' | 'pending_away' | 'away' | 'read'>()
      .notNull()
      .default('none'),
    deliveryTarget: text('deliveryTarget'),
    deliveryDueAt: epochMs('deliveryDueAt'),
  },
  (t) => [index('notification_type_readAt_idx').on(t.type, t.readAt)],
);

export const noticeMark = sqliteTable(
  'notice_mark',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    condition: text('condition').$type<'no_machine' | 'watchdog_flag'>().notNull(),
    subjectId: text('subjectId').notNull(),
    fingerprint: text('fingerprint').notNull(),
    notedAt: epochMs('notedAt').notNull(),
  },
  (t) => [index('notice_mark_userId_condition_idx').on(t.userId, t.condition)],
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
    harness: text('harness').$type<'claude-code' | 'pi' | 'devin' | 'antigravity' | 'doubao'>(),
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

export const teamMemoryEntry = sqliteTable(
  'team_memory_entry',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId').notNull(),
    line: text('line').notNull(),
    source: text('source'),
    sourceMessageId: text('sourceMessageId'),
    writtenAt: epochMs('writtenAt').notNull(),
    lastUsedAt: epochMs('lastUsedAt').notNull(),
  },
  (t) => [uniqueIndex('team_memory_entry_line_idx').on(t.teamId, t.line)],
);

export const memoryCorrection = sqliteTable(
  'memory_correction',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId').notNull(),
    projectId: text('projectId'),
    pointedFile: text('pointedFile'),
    pointedRule: text('pointedRule'),
    inTurnIndex: bool('inTurnIndex'),
    buildId: text('buildId').notNull(),
    stepId: text('stepId').notNull(),
    ownerMessageId: text('ownerMessageId').notNull(),
    ownerWords: text('ownerWords').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('memory_correction_exchange_idx').on(t.teamId, t.ownerMessageId),
    index('memory_correction_team_created_idx').on(t.teamId, t.createdAt),
  ],
);

export const dataMigration = sqliteTable('data_migration', {
  id: text('id').primaryKey(),
  doneAt: epochMs('doneAt').notNull(),
  detail: text('detail').notNull(),
});

export type MemoryEditStatus =
  | 'working'
  | 'awaiting_input'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'partial';

export const memoryEdit = sqliteTable(
  'memory_edit',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId').notNull(),
    userId: text('userId').notNull(),
    chiefId: text('chiefId').notNull(),
    threadId: text('threadId').notNull(),
    stepId: text('stepId'),
    instruction: text('instruction').notNull(),
    file: text('file'),
    projectId: text('projectId'),
    status: text('status').$type<MemoryEditStatus>().notNull().default('working'),
    attempt: integer('attempt').notNull().default(1),
    reply: text('reply'),
    failureReason: text('failureReason'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [index('memory_edit_team_idx').on(t.teamId, t.createdAt)],
);

export const memoryEditReceipt = sqliteTable(
  'memory_edit_receipt',
  {
    id: text('id').primaryKey(),
    editId: text('editId')
      .notNull()
      .references(() => memoryEdit.id, { onDelete: 'cascade' }),
    callId: text('callId').notNull(),
    tool: text('tool').notNull(),
    scope: text('scope'),
    file: text('file'),
    beforeVersion: text('beforeVersion'),
    afterVersion: text('afterVersion'),
    summary: text('summary').notNull(),
    result: text('result').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    uniqueIndex('memory_edit_receipt_call_unique').on(t.editId, t.callId),
    index('memory_edit_receipt_edit_idx').on(t.editId, t.createdAt),
  ],
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

export const apnsDevice = sqliteTable(
  'apns_device',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    teamId: text('teamId').notNull(),
    token: text('token').notNull(),
    environment: text('environment').$type<'sandbox' | 'production'>().notNull(),
    pairedDeviceId: text('pairedDeviceId'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [uniqueIndex('apns_device_token_unique').on(t.token)],
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

export const secret = sqliteTable(
  'secret',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    projectId: text('projectId').references(() => project.id),
    name: text('name').notNull(),
    description: text('description'),
    valueCipher: text('valueCipher'),
    delivery: text('delivery').$type<SecretDelivery>().notNull().default('plaintext'),
    httpOrigin: text('httpOrigin'),
    httpHeader: text('httpHeader'),
    httpTemplate: text('httpTemplate'),
    policyRevision: integer('policyRevision').notNull().default(1),
    envSeal: text('envSeal'),
    usernameCipher: text('usernameCipher'),
    updatedAt: epochMs('updatedAt'),
  },
  (t) => [
    check(
      'secret_delivery_policy',
      sql`(${t.delivery} = 'http' AND ${t.httpOrigin} IS NOT NULL AND ${t.httpHeader} IS NOT NULL AND ${t.httpTemplate} IS NOT NULL) OR (${t.delivery} = 'plaintext' AND ${t.httpOrigin} IS NULL AND ${t.httpHeader} IS NULL AND ${t.httpTemplate} IS NULL)`,
    ),
  ],
);

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
  claimGeneration: integer('claimGeneration'),
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

export const pairingRequest = sqliteTable(
  'pairing_request',
  {
    id: text('id').primaryKey(),
    secretHash: text('secretHash').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    detail: text('detail'),
    source: text('source').notNull(),
    peer: text('peer').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: epochMs('expiresAt').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    decidedAt: epochMs('decidedAt'),
    deviceId: text('deviceId'),
    browserMarkHash: text('browserMarkHash'),
  },
  (t) => [uniqueIndex('pairing_request_secretHash_unique').on(t.secretHash)],
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
    browserMarkHash: text('browserMarkHash'),
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
    pendingTokenHash: text('pendingTokenHash'),
    apiKeyId: text('apiKeyId'),
    latestCliVersion: text('latestCliVersion'),
    kind: text('kind').notNull().default('remote'),
    claudeCodeReport: json<ClaudeCodeReport | null>('claudeCodeReport'),
    claudeRateLimits: json<ClaudeRateLimitWindow[] | null>('claudeRateLimits'),
    lastSeenAt: epochMs('lastSeenAt'),
    capabilities: json<MachineCapabilities | null>('capabilities'),
    hostKey: text('hostKey'),
    retiredAt: epochMs('retiredAt'),
    tokenReauthRequired: bool('tokenReauthRequired').notNull().default(false),
  },
  (t) => [
    index('machine_online_lastSeenAt_idx').on(t.online, t.lastSeenAt),
    index('machine_team_hostKey_idx').on(t.teamId, t.hostKey),
  ],
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
    cacheWrite1h: integer('cacheWrite1h').notNull().default(0),
    ttftMs: integer('ttftMs'),
    contextTokens: integer('contextTokens'),
    contextWindow: integer('contextWindow'),
    compactAt: integer('compactAt'),
    createdAt: epochMs('createdAt').notNull(),
    firstReportAt: epochMs('firstReportAt').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.stepId, t.model] }),
    index('chief_turn_usage_thread_idx').on(t.threadId, t.createdAt),
  ],
);

export const stepUsage = sqliteTable(
  'step_usage',
  {
    stepId: text('stepId').notNull(),
    model: text('model').notNull(),
    teamId: text('teamId').notNull(),
    buildId: text('buildId').notNull(),
    kind: text('kind').$type<StepKind>().notNull(),
    input: integer('input').notNull().default(0),
    output: integer('output').notNull().default(0),
    cacheRead: integer('cacheRead').notNull().default(0),
    cacheWrite: integer('cacheWrite').notNull().default(0),
    cacheWrite1h: integer('cacheWrite1h').notNull().default(0),
    mirroredTokens: integer('mirroredTokens').notNull().default(0),
    contextTokens: integer('contextTokens'),
    contextWindow: integer('contextWindow'),
    compactAt: integer('compactAt'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.stepId, t.model] }),
    index('step_usage_team_created_idx').on(t.teamId, t.createdAt),
    index('step_usage_build_model_idx').on(t.buildId, t.model),
  ],
);

export const coordinatorConversation = sqliteTable('coordinator_conversation', {
  storeId: text('storeId'),
  threadId: text('threadId').primaryKey(),
  conversationId: text('conversationId').notNull(),
  mailOwnerConversationId: text('mailOwnerConversationId'),
  lastMirroredEntryId: text('lastMirroredEntryId'),
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

export const chief = sqliteTable('chief', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
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
    memoryFlushedAt: epochMs('memoryFlushedAt'),
    memoryFlushedMessageId: text('memoryFlushedMessageId'),
  },
  (t) => [
    uniqueIndex('chief_thread_coordinator_unique')
      .on(t.chiefId)
      .where(
        sql`${t.archivedAt} is null and ${t.projectId} is null and ${t.id} not like 'chief-digest-%' and ${t.id} not like 'chief-memory-%'`,
      ),
    uniqueIndex('chief_thread_channel_unique')
      .on(t.chiefId, t.projectId)
      .where(sql`${t.archivedAt} is null and ${t.projectId} is not null`),
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
    attempt: integer('attempt').notNull().default(1),
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

export const chiefMessage = sqliteTable(
  'chief_message',
  {
    id: text('id').primaryKey(),
    threadId: text('threadId')
      .notNull()
      .references(() => chiefThread.id, { onDelete: 'cascade' }),
    role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
    content: json<unknown>('content').notNull(),
    projectId: text('projectId'),
    delivery: text('delivery').$type<ChiefMessageDelivery>(),
    origin: text('origin').$type<TranscriptUserOrigin>(),
    typedAt: epochMs('typedAt'),
    ownerComposedAt: epochMs('ownerComposedAt'),
    sentByAgent: integer('sentByAgent', { mode: 'boolean' }),
    clientMessageId: text('clientMessageId'),
    fileSource: json<MessageFileSource | null>('fileSource'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('chief_message_thread_created_idx').on(t.threadId, t.createdAt),
    index('chief_message_thread_insert_idx').on(t.threadId),
  ],
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
  scope: text('scope').$type<'spec' | 'message' | 'deliverable' | 'design'>().notNull(),
  status: text('status')
    .$type<'pending' | 'received' | 'ready' | 'failed'>()
    .notNull()
    .default('pending'),
  createdAt: epochMs('createdAt').notNull(),
});

export const designVersion = sqliteTable(
  'design_version',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    todoId: text('todoId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    fileName: text('fileName').notNull(),
    seq: integer('seq').notNull(),
    attachmentId: text('attachmentId').notNull(),
    sha256: text('sha256'),
    source: text('source').$type<'agent' | 'restore' | 'user'>().notNull(),
    restoredFromVersionId: text('restoredFromVersionId'),
    createdBy: text('createdBy').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [uniqueIndex('design_version_page_seq_idx').on(t.todoId, t.fileName, t.seq)],
);

export const designComment = sqliteTable(
  'design_comment',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    todoId: text('todoId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    fileName: text('fileName').notNull(),
    versionId: text('versionId')
      .notNull()
      .references(() => designVersion.id, { onDelete: 'cascade' }),
    pin: integer('pin').notNull(),
    elementId: text('elementId').notNull(),
    selector: text('selector').notNull(),
    label: text('label').notNull(),
    text: text('text').notNull(),
    htmlHint: text('htmlHint').notNull(),
    position: json<DesignRect>('position').notNull(),
    viewport: text('viewport').$type<DesignViewport>().notNull(),
    style: json<DesignStyle | null>('style'),
    note: text('note').notNull(),
    markAttachmentId: text('markAttachmentId'),
    status: text('status').$type<DesignCommentStatus>().notNull(),
    messageId: text('messageId'),
    anchor: json<ArtifactAnchor | null>('anchor'),
    sentAt: epochMs('sentAt'),
    createdBy: text('createdBy').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    uniqueIndex('design_comment_page_pin_idx').on(t.todoId, t.fileName, t.pin),
    index('design_comment_status_idx').on(t.todoId, t.status),
  ],
);

export const designShare = sqliteTable(
  'design_share',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    todoId: text('todoId')
      .notNull()
      .references(() => todo.id, { onDelete: 'cascade' }),
    fileName: text('fileName').notNull(),
    token: text('token').notNull(),
    createdBy: text('createdBy').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    revokedAt: epochMs('revokedAt'),
  },
  (t) => [
    uniqueIndex('design_share_token_idx').on(t.token),
    uniqueIndex('design_share_live_idx').on(t.todoId, t.fileName).where(sql`"revokedAt" IS NULL`),
  ],
);

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

export const githubConnection = sqliteTable(
  'github_connection',
  {
    githubUserId: integer('githubUserId'),
    githubName: text('githubName'),
    teamId: text('teamId')
      .primaryKey()
      .references(() => team.id, { onDelete: 'cascade' }),
    login: text('login').notNull(),
    accessTokenCipher: text('accessTokenCipher').notNull(),
    refreshTokenCipher: text('refreshTokenCipher'),
    accessTokenExpiresAt: epochMs('accessTokenExpiresAt'),
    refreshTokenExpiresAt: epochMs('refreshTokenExpiresAt'),
    appClientId: text('appClientId'),
    connectionGeneration: text('connectionGeneration'),
    refreshLeaseUntil: epochMs('refreshLeaseUntil'),
    disconnectedReason: text('disconnectedReason'),
    webhookTokenHash: text('webhookTokenHash'),
    webhookMasked: text('webhookMasked'),
    webhookDeliveries: json<string[]>('webhookDeliveries'),
    webhookLastUsedAt: epochMs('webhookLastUsedAt'),
    scope: text('scope').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [uniqueIndex('github_connection_webhookTokenHash_unique').on(t.webhookTokenHash)],
);

type GateVerdictKind = 'review' | 'verify' | 'decision';
type GateVerdictOutcome =
  | 'pass'
  | 'block'
  | 'extraction_failed'
  | 'step_failed'
  | 'tampered'
  | 'unbound'
  | 'evidence_invalid';
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
    ranModel: json<StepRanModel>('ranModel'),
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
  blockers: json<GateBlockerRow[]>('blockers').notNull(),
  evaluatedAt: epochMs('evaluatedAt').notNull(),
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

export const claudeSubscription = sqliteTable(
  'claude_subscription',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    tokenCipher: text('tokenCipher').notNull(),
    expiresAt: epochMs('expiresAt'),
    enabledAt: epochMs('enabledAt'),
    quotaWindows: json<ClaudeRateLimitWindow[] | null>('quotaWindows'),
    models: json<ClaudeSubscriptionModel[] | null>('models'),
    lastCheck: json<SubscriptionCheck | null>('lastCheck'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    uniqueIndex('claude_subscription_one_enabled')
      .on(t.teamId)
      .where(sql`${t.enabledAt} is not null`),
  ],
);

export const devinSubscription = sqliteTable(
  'devin_subscription',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    tokenCipher: text('tokenCipher').notNull(),
    expiresAt: epochMs('expiresAt'),
    enabledAt: epochMs('enabledAt'),
    models: json<DevinSubscriptionModel[]>('models').notNull().default(sql`'[]'`),
    lastCheck: json<SubscriptionCheck | null>('lastCheck'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    uniqueIndex('devin_subscription_one_enabled')
      .on(t.teamId)
      .where(sql`${t.enabledAt} is not null`),
  ],
);

export const antigravitySubscription = sqliteTable(
  'antigravity_subscription',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    tokenCipher: text('tokenCipher'),
    runnerId: text('runnerId'),
    expiresAt: epochMs('expiresAt'),
    enabledAt: epochMs('enabledAt'),
    quotaWindows: json<ClaudeSubscriptionQuotaWindow[] | null>('quotaWindows'),
    models: json<AntigravitySubscriptionModel[]>('models').notNull().default(sql`'[]'`),
    lastCheck: json<SubscriptionCheck | null>('lastCheck'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    uniqueIndex('antigravity_subscription_one_enabled')
      .on(t.teamId)
      .where(sql`${t.enabledAt} is not null`),
  ],
);

export const doubaoSubscription = sqliteTable(
  'doubao_subscription',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    runnerId: text('runnerId'),
    enabledAt: epochMs('enabledAt'),
    models: json<DoubaoSubscriptionModel[]>('models').notNull().default(sql`'[]'`),
    lastCheck: json<SubscriptionCheck | null>('lastCheck'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('doubao_subscription_team_idx').on(t.teamId),
    uniqueIndex('doubao_subscription_one_enabled')
      .on(t.teamId)
      .where(sql`${t.enabledAt} is not null`),
  ],
);

export const mcpConnector = sqliteTable(
  'mcp_connector',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    catalogId: text('catalogId'),
    transport: text('transport').$type<McpConnectorTransport>().notNull().default('http'),
    url: text('url'),
    headerNames: json<string[]>('headerNames').notNull(),
    valuesCipher: text('valuesCipher'),
    authKind: text('authKind').$type<McpConnectorAuthKind>().notNull().default('none'),
    oauthMeta: json<McpConnectorOAuthMeta>('oauthMeta'),
    oauthCipher: text('oauthCipher'),
    authRevision: integer('authRevision').notNull().default(0),
    tokenGeneration: integer('tokenGeneration').notNull().default(0),
    status: text('status').$type<McpConnectorStatus>().notNull(),
    statusReason: text('statusReason'),
    toolCount: integer('toolCount'),
    toolsJson: json<McpConnectorTool[]>('toolsJson'),
    composioSession: text('composioSession'),
    composioAccount: text('composioAccount'),
    checkedAt: epochMs('checkedAt'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    uniqueIndex('mcp_connector_team_slug_idx').on(t.teamId, t.slug),
    check(
      'mcp_connector_status',
      sql`${t.status} in ('unchecked', 'connected', 'needs_auth', 'error', 'revoked', 'local')`,
    ),
    check('mcp_connector_transport', sql`${t.transport} in ('http', 'stdio')`),
    check(
      'mcp_connector_auth_kind',
      sql`${t.authKind} in ('none', 'static', 'oauth', 'github-app', 'composio')`,
    ),
  ],
);

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
    revokedAt: epochMs('revokedAt'),
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

export const hostedCleanupOutbox = sqliteTable(
  'hosted_cleanup_outbox',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: text('projectId').notNull(),
    repoName: text('repoName').notNull(),
    state: text('state').$type<'pending' | 'retrying' | 'conflict' | 'done'>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: epochMs('nextAttemptAt').notNull(),
    lastError: text('lastError'),
  },
  (t) => [
    uniqueIndex('hosted_cleanup_unresolved_idx')
      .on(t.teamId, t.repoName)
      .where(sql`${t.state} != 'done'`),
  ],
);

export const mailAccount = sqliteTable(
  'mail_account',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    userId: text('userId')
      .notNull()
      .references(() => user.id),
    provider: text('provider').$type<'gmail' | 'imap'>().notNull(),
    mailbox: text('mailbox').notNull(),
    status: text('status').$type<MailAccountStatus>().notNull(),
    generation: integer('generation').notNull().default(0),
    historyWatermark: text('historyWatermark'),
    uidValidity: text('uidValidity'),
    lastReconciledUid: integer('lastReconciledUid'),
    pushServiceAccountEmail: text('pushServiceAccountEmail'),
    secretId: text('secretId').references(() => secret.id),
    watchExpiration: epochMs('watchExpiration'),
    address: text('address'),
    imapHost: text('imapHost'),
    imapPort: integer('imapPort'),
    smtpHost: text('smtpHost'),
    smtpPort: integer('smtpPort'),
    defaultRank: text('defaultRank').$type<MailRank>().notNull().default('can_wait'),
    lastMailAt: epochMs('lastMailAt'),
    lastError: text('lastError'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    index('mail_account_team_idx').on(t.teamId),
    check(
      'mail_account_status',
      sql`${t.status} in ('disconnected', 'connecting', 'watching', 'degraded', 'revoked')`,
    ),
    check('mail_account_provider', sql`${t.provider} in ('gmail', 'imap')`),
  ],
);

export const mailEvent = sqliteTable(
  'mail_event',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId')
      .notNull()
      .references(() => mailAccount.id),
    externalId: text('externalId').notNull(),
    status: text('status').$type<MailEventStatus>().notNull(),
    rank: text('rank').$type<MailRank | null>(),
    ruleId: text('ruleId'),
    ruleName: text('ruleName'),
    dropReason: text('dropReason'),
    generation: integer('generation').notNull(),
    displayName: text('displayName'),
    fromAddress: text('fromAddress'),
    subject: text('subject'),
    excerpt: text('excerpt'),
    messageId: text('messageId'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    uniqueIndex('mail_event_account_external_unique').on(t.accountId, t.externalId),
    index('mail_event_account_message_idx').on(t.accountId, t.messageId),
    check('mail_event_status', sql`${t.status} in ('received', 'ranked', 'delivered', 'dropped')`),
    check(
      'mail_event_rank',
      sql`${t.rank} is null or ${t.rank} in ('needs_you', 'can_wait', 'drop')`,
    ),
    check('mail_event_drop_reason', sql`${t.status} != 'dropped' or ${t.dropReason} is not null`),
    check(
      'mail_event_dropped_body',
      sql`${t.status} != 'dropped' or (${t.excerpt} is null and ${t.subject} is null and ${t.displayName} is null and ${t.fromAddress} is null)`,
    ),
  ],
);

export const mailRule = sqliteTable(
  'mail_rule',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId')
      .notNull()
      .references(() => mailAccount.id),
    name: text('name').notNull(),
    matchKind: text('matchKind').$type<'sender_allow' | 'subject_contains'>().notNull(),
    pattern: text('pattern').notNull(),
    rank: text('rank').$type<MailRank>().notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('mail_rule_account_idx').on(t.accountId, t.createdAt, t.id),
    check('mail_rule_kind', sql`${t.matchKind} in ('sender_allow', 'subject_contains')`),
    check('mail_rule_rank', sql`${t.rank} in ('needs_you', 'can_wait', 'drop')`),
    check('mail_rule_pattern', sql`length(trim(${t.pattern})) > 0`),
  ],
);

export const teamTopModels = sqliteTable('team_top_models', {
  teamId: text('teamId')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  models: text('models').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
});

export const imConnection = sqliteTable(
  'im_connection',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    userId: text('userId')
      .notNull()
      .references(() => user.id),
    platform: text('platform').$type<ImPlatform>().notNull(),
    accountLabel: text('accountLabel'),
    secretCipher: text('secretCipher').notNull(),
    pairedSenders: json<ImPairedSender[]>('pairedSenders').notNull().default(sql`'[]'`),
    status: text('status').$type<ImConnectionStatus>().notNull(),
    statusDetail: text('statusDetail'),
    pollOffset: text('pollOffset'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    index('im_connection_team_idx').on(t.teamId),
    check(
      'im_connection_platform',
      sql`${t.platform} in ('telegram', 'wechat', 'slack', 'imessage')`,
    ),
    check(
      'im_connection_status',
      sql`${t.status} in ('connecting', 'ready', 'degraded', 'expired', 'error')`,
    ),
  ],
);

export const imPairingRequest = sqliteTable(
  'im_pairing_request',
  {
    id: text('id').primaryKey(),
    connId: text('connId')
      .notNull()
      .references(() => imConnection.id),
    senderId: text('senderId').notNull(),
    senderName: text('senderName'),
    chatKey: text('chatKey').notNull(),
    status: text('status').$type<ImPairingRequestStatus>().notNull(),
    requestedAt: epochMs('requestedAt').notNull(),
    decidedAt: epochMs('decidedAt'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    index('im_pairing_request_status_idx').on(t.status, t.createdAt),
    uniqueIndex('im_pairing_request_conn_sender_unique').on(t.connId, t.senderId),
    check('im_pairing_request_status', sql`${t.status} in ('pending', 'approved', 'rejected')`),
  ],
);

export const imSeenInbound = sqliteTable(
  'im_seen_inbound',
  {
    connId: text('connId')
      .notNull()
      .references(() => imConnection.id, { onDelete: 'cascade' }),
    messageId: text('messageId').notNull(),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.connId, t.messageId] }),
    index('im_seen_inbound_conn_idx').on(t.connId, t.createdAt),
  ],
);

export const imTurnOrigin = sqliteTable('im_turn_origin', {
  stepId: text('stepId').primaryKey(),
  connId: text('connId')
    .notNull()
    .references(() => imConnection.id, { onDelete: 'cascade' }),
  chatKey: text('chatKey').notNull(),
  senderId: text('senderId').notNull(),
  threadId: text('threadId').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const externalEffect = sqliteTable(
  'external_effect',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    scopeKind: text('scopeKind')
      .$type<'todo' | 'build' | 'step' | 'chiefThread' | 'mailEvent' | 'imConnection' | 'team'>()
      .notNull(),
    scopeId: text('scopeId').notNull(),
    stepId: text('stepId'),
    claimGeneration: epochMs('claimGeneration'),
    kind: text('kind').notNull(),
    dedupeKey: text('dedupeKey').notNull(),
    payload: json<unknown>('payload').notNull(),
    state: text('state')
      .$type<'pending' | 'sending' | 'delivered' | 'failed' | 'interrupted' | 'cancelled'>()
      .notNull(),
    dueAt: epochMs('dueAt').notNull(),
    claimedAt: epochMs('claimedAt'),
    claimFence: epochMs('claimFence'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('lastError'),
    receipt: json<unknown>('receipt'),
    createdAt: epochMs('createdAt').notNull(),
    updatedAt: epochMs('updatedAt').notNull(),
  },
  (t) => [
    uniqueIndex('external_effect_dedupe_idx').on(t.dedupeKey),
    index('external_effect_state_due_idx').on(t.state, t.dueAt),
    index('external_effect_scope_idx').on(t.scopeKind, t.scopeId),
    check(
      'external_effect_state',
      sql`${t.state} in ('pending', 'sending', 'delivered', 'failed', 'interrupted', 'cancelled')`,
    ),
  ],
);
