import type {
  ActiveRun,
  Assignment,
  AutonomyGateReason,
  AutonomyKind,
  AutonomySettings,
  BlockerHandoffRecord,
  BuildEvidence,
  ChiefWatch,
  ClaudeCodeReport,
  DocumentDiffFile,
  MachineCapabilities,
  MemoryCandidateStatus,
  ModelRef,
  PersonaRole,
  Phase,
  ProjectRepoKind,
  ProviderApi,
  ProviderCompat,
  ProviderModel,
  RequiredCapabilities,
  SkillInjectionRecord,
  StepKind,
  TodoOutputKind,
  TodoSourceKind,
  TriggerSource,
} from '@cairn/shared';
import { sql } from 'drizzle-orm';
import {
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
  avatarStyle: text('avatarStyle'),
});

export const project = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  description: text('description'),
  repoKind: text('repoKind').$type<ProjectRepoKind>(),
  repoName: text('repoName'),
  githubRepo: text('githubRepo'),
  localPath: text('localPath'),
  autonomy: json<AutonomySettings | null>('autonomy'),
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
    phase: text('phase').$type<Phase>().notNull().default('todo'),
    phaseAt: epochMs('phaseAt').notNull(),
    seqNum: integer('seqNum').notNull(),
    orderIndex: real('orderIndex').notNull().default(0),
    assignment: json<Assignment | null>('assignment'),
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
    output: text('output').$type<TodoOutputKind>().notNull().default('code'),
  },
  (t) => [index('todo_phase_idx').on(t.phase)],
);

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

export const build = sqliteTable('build', {
  id: text('id').primaryKey(),
  todoId: text('todoId')
    .notNull()
    .references(() => todo.id, { onDelete: 'cascade' }),
  withPlan: bool('withPlan').notNull(),
  prevPhase: text('prevPhase').$type<Phase | null>(),
  triggerSource: text('triggerSource').$type<TriggerSource>().notNull(),
  planDocId: text('planDocId'),
  errorMessage: text('errorMessage'),
  prUrl: text('prUrl'),
  prNumber: integer('prNumber'),
  changes: json<DocumentDiffFile[] | { files: DocumentDiffFile[]; changed: true }>('changes'),
  diffHash: text('diffHash'),
  baseSha: text('baseSha'),
  harnessHash: text('harnessHash'),
  reportAttachmentId: text('reportAttachmentId'),
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
    quotaBlock: json<QuotaWaitRow>('quotaBlock'),
    fallback: json<StepFallbackRow>('fallback'),
    sessionId: text('sessionId'),
    checkpointCommit: text('checkpointCommit'),
    claimedAt: epochMs('claimedAt'),
    lastHeartbeatAt: epochMs('lastHeartbeatAt'),
    finishedAt: epochMs('finishedAt'),
    prompt: text('prompt'),
    freshSession: bool('freshSession').notNull().default(false),
    skillInjection: json<SkillInjectionRecord>('skillInjection'),
    blockerHandoff: json<BlockerHandoffRecord>('blockerHandoff'),
    holdReason: text('holdReason'),
    holdUntil: epochMs('holdUntil'),
    holdCount: integer('holdCount').notNull().default(0),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('step_status_kind_idx').on(t.status, t.kind),
    index('step_buildId_status_idx').on(t.buildId, t.status),
    index('step_kind_idx').on(t.kind),
  ],
);

export const message = sqliteTable('message', {
  id: text('id').primaryKey(),
  conversationId: text('conversationId').notNull(),
  role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
  content: json<unknown>('content').notNull(),
  createdAt: epochMs('createdAt').notNull(),
  actor: text('actor'),
});

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
    kind: text('kind').$type<'once' | 'hourly' | 'daily' | 'weekly'>().notNull(),
    at: epochMs('at'),
    tz: text('tz').notNull(),
    nextRunAt: epochMs('nextRunAt'),
    createdBy: text('createdBy').notNull(),
  },
  (t) => [index('schedule_nextRunAt_idx').on(t.nextRunAt)],
);

export const notification = sqliteTable(
  'notification',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId').notNull(),
    userId: text('userId').notNull(),
    type: text('type')
      .$type<'plan_ready' | 'build_review' | 'chief_message' | 'quota_wait' | 'model_fallback'>()
      .notNull(),
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

export const agent = sqliteTable(
  'agent',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    displayName: text('displayName').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    avatarUrl: text('avatarUrl'),
    provider: text('provider'),
    modelId: text('modelId'),
    thinkingLevel: text('thinkingLevel'),
    persona: text('persona').$type<PersonaRole | null>(),
    machineId: text('machineId').references(() => machine.id),
    tools: json<string[]>('tools').notNull().default(sql`'[]'`),
    secrets: json<string[]>('secrets').notNull().default(sql`'[]'`),
    defaultSkill: text('defaultSkill'),
    skillsAllowlist: json<string[]>('skillsAllowlist'),
    mcpServers: json<string[]>('mcpServers').notNull().default(sql`'[]'`),
    maxConcurrentTasks: integer('maxConcurrentTasks'),
    requiredCapabilities: json<RequiredCapabilities | null>('requiredCapabilities'),
    fallbackModels: json<ModelRef[] | null>('fallbackModels'),
  },
  (t) => [
    uniqueIndex('agent_team_persona_unique')
      .on(t.teamId, t.persona)
      .where(sql`${t.persona} is not null`),
  ],
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
  history: json<{ title: string; content: string; updatedAt: number }[]>('history')
    .notNull()
    .default(sql`'[]'`),
  invalidAt: epochMs('invalidAt'),
  supersededBy: text('supersededBy'),
  lastInjectedAt: epochMs('lastInjectedAt'),
  createdAt: epochMs('createdAt').notNull(),
  updatedAt: epochMs('updatedAt').notNull(),
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
  toolGrants: json<{ read: string[]; write: string[] }>('toolGrants').notNull(),
  keyHash: text('keyHash').notNull(),
  masked: text('masked').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const webhookToken = sqliteTable(
  'webhook_token',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => team.id),
    name: text('name'),
    tokenHash: text('tokenHash').notNull(),
    masked: text('masked').notNull(),
    createdAt: epochMs('createdAt').notNull(),
    lastUsedAt: epochMs('lastUsedAt'),
  },
  (t) => [uniqueIndex('webhook_token_tokenHash_unique').on(t.tokenHash)],
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
    shellEnabled: bool('shellEnabled').notNull().default(false),
    claudeCodeReport: json<ClaudeCodeReport | null>('claudeCodeReport'),
    maxConcurrent: integer('maxConcurrent').notNull().default(3),
    maxConcurrentOverridden: bool('maxConcurrentOverridden').notNull().default(false),
    lastSeenAt: epochMs('lastSeenAt'),
    capabilities: json<MachineCapabilities | null>('capabilities'),
  },
  (t) => [index('machine_online_lastSeenAt_idx').on(t.online, t.lastSeenAt)],
);

export const shellCommand = sqliteTable('shell_command', {
  id: text('id').primaryKey(),
  stepId: text('stepId').notNull(),
  machineId: text('machineId').notNull(),
  agentId: text('agentId').notNull(),
  teamId: text('teamId').notNull(),
  command: text('command').notNull(),
  status: text('status').$type<'denied' | 'running' | 'done' | 'failed'>().notNull(),
  exitCode: integer('exitCode'),
  output: text('output'),
  errorMessage: text('errorMessage'),
  createdAt: epochMs('createdAt').notNull(),
  finishedAt: epochMs('finishedAt'),
});

export const tokenUsage = sqliteTable(
  'token_usage',
  {
    buildId: text('buildId').notNull(),
    model: text('model').notNull(),
    input: integer('input').notNull().default(0),
    output: integer('output').notNull().default(0),
    cacheRead: integer('cacheRead').notNull().default(0),
    cacheWrite: integer('cacheWrite').notNull().default(0),
    costInput: real('costInput').notNull().default(0),
    costOutput: real('costOutput').notNull().default(0),
    costCacheRead: real('costCacheRead').notNull().default(0),
    costCacheWrite: real('costCacheWrite').notNull().default(0),
    costTotal: real('costTotal').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.buildId, t.model] })],
);

export const chief = sqliteTable('chief', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  teamId: text('teamId')
    .notNull()
    .references(() => team.id),
  agentId: text('agentId'),
  charter: text('charter').notNull().default(''),
  watches: json<ChiefWatch[]>('watches').notNull().default(sql`'[]'`),
  wakes: json<Record<string, unknown>[]>('wakes').notNull().default(sql`'[]'`),
  lastTurnAt: epochMs('lastTurnAt'),
  createdAt: epochMs('createdAt').notNull(),
  tz: text('tz'),
});

export const chiefThread = sqliteTable('chief_thread', {
  id: text('id').primaryKey(),
  chiefId: text('chiefId').notNull(),
  userId: text('userId').notNull(),
  teamId: text('teamId').notNull(),
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
});

export const chiefMessage = sqliteTable('chief_message', {
  id: text('id').primaryKey(),
  threadId: text('threadId')
    .notNull()
    .references(() => chiefThread.id, { onDelete: 'cascade' }),
  role: text('role').$type<'system' | 'user' | 'assistant'>().notNull(),
  content: json<unknown>('content').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const whatsNew = sqliteTable('whats_new', {
  id: text('id').primaryKey(),
  body: json<Record<string, unknown>>('body').notNull(),
  createdAt: epochMs('createdAt').notNull(),
});

export const attachment = sqliteTable('attachment', {
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

export const githubConnection = sqliteTable('github_connection', {
  teamId: text('teamId')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  login: text('login').notNull(),
  accessTokenCipher: text('accessTokenCipher').notNull(),
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
