import {
  type AgentTodoItem,
  type ChiefDigestItem,
  type ChiefReportContent,
  type ClaudeLogin,
  type GithubRepoSummary,
  type MachineExecutor,
  type MachineHardware,
  type MachineOsPlatform,
  type MemoryRecord,
  type ModelSource,
  type PermissionState,
  PHASE_VALUES,
  type Phase,
  type ProjectColor,
  type ProjectIcon,
  type ProjectRepoKind,
  type ProviderRecord,
  type QuotaWait,
  type RouteOverride,
  type RunnerOfflineContent,
  type SecretRecord,
  type SkillFact,
  type StepPromptOrigin,
  type TagRecord,
  type TaskRequest,
  type ThreadMessageContent,
  type ThreadReportContent,
  type TodoOutputKind,
  type TodoOwner,
  type TodoSection,
  type TokenUsage,
  type UsageCost,
} from '@cairn/shared';
import type { MachineProvider } from '../api/claude-accounts.js';
import type { EngineRun, EngineRunStage } from '../board/engine-run.js';
import type { AccountsContent } from './accounts.js';

export type { Phase };
export { PHASE_VALUES };

export interface AgentRef {
  id: string;
  displayName: string;
}

export interface AssignmentRecord {
  agentId: string;
}

export interface BuildRef {
  buildId: string;
  createdAt: number;
}

export type MadeKind = 'document' | 'design' | 'page' | 'code';

export interface TodoRecord {
  id: string;
  teamId: string;
  projectId: string;
  title: string;
  spec: string;
  request?: TaskRequest | null;
  phase: Phase;
  phaseAt: number;
  archivedAt?: number | null;
  snoozedUntil?: number | null;
  snoozeMode?: 'needed' | 'until' | null;
  seqNum: number;
  orderIndex: number;
  tagIds: string[];
  githubLabelIds?: string[];
  assignment: AssignmentRecord | null;
  agent: AgentRef | null;
  latestBuildId: string | null;
  lastRunAt: number | null;
  hasChanges: boolean;
  hasPlan: boolean;
  buildHistory: BuildRef[];
  sourceTodo: string | null;
  v: number;
  chiefCreated?: boolean;
  waitingOn?: { on: 'machine' | 'quota'; retryAt: number | null };
  quotaWait?: QuotaWait | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
  usageCost?: UsageCost;
  context?: ChiefContextUsage | null;
  verified?: boolean;
  owner?: TodoOwner;
  output?: TodoOutputKind;
  section?: TodoSection | null;
  madeKind?: MadeKind;
  previewUrl?: string;
  visibility?: 'private' | 'team';
  routeOverride?: RouteOverride | null;
}

export interface TokenUsageContent {
  total: string;
  model: string;
  modelTotal: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  cacheHitRate: string;
  cost?: UsageCostContent | null;
}

export interface UsageCostContent {
  total: string;
  cacheRead: string;
  input: string;
  output: string;
}

export interface BranchInfoContent {
  branch: string;
  commit: string;
  machine: string;
  directory: string;
}

export interface RunHistoryRow {
  label: string;
  meta: string;
  status: 'current' | 'failed' | 'done' | 'failed-current';
}

export type PaneView = 'doc' | 'branch' | 'token' | 'history';

export type OverlayKind = 'branch' | 'accept' | 'rerun' | 'reuse' | 'review' | 'reject';

export interface OverlayState {
  kind: OverlayKind;
}

export interface BuildOverlayContent {
  token: TokenUsageContent;
  branch: BranchInfoContent;
  runs: RunHistoryRow[];
}
export interface OverlayUi {
  searchOpen?: boolean;
  searchQuery?: string;
  statusMenuOpen?: boolean;
  paneView?: PaneView;
  langDropdownOpen?: boolean;
  notificationBanner?: boolean;
  notificationPermission?: NotificationPermission;
}

export interface ScheduleRecord {
  id: string;
  teamId: string;
  projectId: string;
  todoId: string;
  kind: 'hourly' | 'daily' | 'weekly' | 'once' | 'cron';
  at: number;
  tz: string;
  nextRunAt: number | null;
  cron?: string | null;
  prompt?: string;
  lastRunAt?: number | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
  createdBy: string;
  enabled?: boolean;
  pausedReason?: string | null;
  todo: {
    seqNum: number;
    title: string;
    phase: Phase;
    projectName: string;
    ownerId: string;
  };
}

export interface ProjectContent {
  name: string;
  repoName: string;
  hosted: boolean;
  repoKind?: ProjectRepoKind;
  defaultBranch: string;
  description: string | null;
  icon?: ProjectIcon;
  color?: ProjectColor;
}

export interface TeamAgentCard {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  model: string;
  isDefault: boolean;
  machineId?: string | null;
  role: string | null;
  provider?: string | null;
}

export interface TeamContent {
  members: number;
  agents: TeamAgentCard[];
}

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  masked: string;
  gitAccess: boolean;
  mcpAccess: boolean;
  machineAccess: boolean;
  plaintext?: string;
}

export interface ApiKeysContent {
  keys: ApiKeyRecord[];
}

export interface FixtureSet {
  todos: TodoRecord[];
  now: number;
  detail?: DetailContent;
  details?: Record<string, DetailContent>;
  overlay?: OverlayState;
  reviewChoice?: {
    agents: { id: string; name: string; model: string; provider: string | null }[];
    defaultAgentId?: string;
    producerProvider: string | null;
    fanoutAvailable: boolean;
  };
  chiefUnread?: number;
  unreadThreadIds?: string[];
  chiefBusy?: boolean;
  ui?: OverlayUi;
  usageNav?: boolean;
  schedules?: ScheduleRecord[];
  scheduleForm?: 'hourly' | 'daily' | 'weekly' | 'once';
  project?: ProjectContent;
  team?: TeamContent;
  apiKeys?: ApiKeysContent;
  resources?: ResourcesContent;
  projectNames?: Record<string, string>;
  projectGroups?: Record<string, string>;
  archivedProjects?: Array<{ id: string; name: string; archivedAt: number }>;
  projectAvatars?: Record<string, { icon?: ProjectIcon; color?: ProjectColor }>;
  chief?: ChiefContent;
  chiefChannels?: Record<string, ChiefContent>;
  github?: GithubFixture;
  tags?: Array<Pick<TagRecord, 'id' | 'name' | 'color'>>;
  machinesOpen?: string;
  attachments?: Record<string, { text?: string; src?: string }>;
}

export interface GithubFixture {
  connected: boolean;
  login?: string;
  scope?: string;
  repos?: GithubRepoSummary[];
}

export interface SkillRow {
  name: string;
  description: string;
}

export interface McpRow {
  name: string;
  kind: string;
  url: string;
  ago: string;
}

export interface MachineRow {
  id?: string;
  kind?: 'local' | 'remote';
  name: string;
  online?: boolean;
  lastSeenAt?: number | null;
  pill?: string;
  enabledRuntimes?: string[];
  chiefHost?: boolean;
  isDefault?: boolean;
  chiefRunning?: boolean;
  chiefWaiting?: boolean;
  maxConcurrent?: number;
  runningSteps?: number;
  capabilities?: {
    mcpServers: string[];
    skills: string[];
    hardware?: MachineHardware;
    executor?: MachineExecutor;
    osPlatform?: MachineOsPlatform;
    computer?: true;
    ownComputer?: true;
    browser?: true;
    hostPermissions?: {
      accessibility: PermissionState;
      automation: PermissionState;
      screenRecording: PermissionState;
    };
  } | null;
  maxConcurrentOverridden?: boolean;
  recommendedConcurrent?: number;
  concurrencyRange?: { min: number; max: number };
  concurrencySource?: 'measured' | 'estimate' | 'manual';
  claudeLogin?: ClaudeLogin;
  providers?: MachineProvider[];
  hostname?: string;
  folders?: MachineFolder[];
  runningHere?: MachineRunningThread[];
}

export interface MachineFolder {
  path: string;
  enabled: boolean;
}

export interface MachineRunningThread {
  threadId: string;
  title: string;
  projectId: string;
  startedAt: number;
}

export interface ResourcesContent {
  skills: SkillRow[];
  mcpServers: McpRow[];
  machines: MachineRow[];
  providerSources: ModelSource[];
  providers?: ProviderRecord[];
  memories?: MemoryRecord[];
  secrets?: SecretRecord[];
  accounts?: AccountsContent;
  routingSettings?: import('@cairn/shared').TeamRoutingSettings;
}

export interface DocSegment {
  text: string;
  style?: 'code' | 'link' | 'mention' | 'strong' | 'anchor' | 'attachment' | 'break';
  href?: string;
  attachmentKey?: string;
  strong?: boolean;
  em?: boolean;
  del?: boolean;
  mentionKind?: 'todo' | 'skill' | 'agent' | 'project' | 'machine';
  mentionId?: string;
}

export interface DocBlock {
  kind: 'para' | 'bullet' | 'head';
  segments: DocSegment[];
}

export interface FailFacts {
  files: number | null;
  commits: string[];
  pr: number | null;
}

export type WorkStep =
  | { kind: 'think'; id: string; text: string; seconds: number | null }
  | {
      kind: 'call';
      id: string;
      action: 'read' | 'search' | 'run' | 'edit' | 'tool' | 'setup';
      label: string;
      target?: string;
      description?: string;
      command?: string;
      diff?: { added: number; removed: number };
      changes?: { removed: string[]; added: string[] };
      output: string | null;
      error: boolean;
      running: boolean;
      unfinished: boolean;
      cancelled?: boolean;
      localized?: boolean;
      seconds: number | null;
    };

export type TranscriptItem =
  | { kind: 'run'; at?: string; machine?: string; cancelled?: boolean }
  | {
      kind: 'user';
      text: string;
      seq?: number;
      title?: string;
      markdown?: string;
      id?: string;
      at?: string;
      createdAt?: number;
    }
  | {
      kind: 'robot';
      paragraphs?: (RobotPara | DocSegment[])[];
      markdown?: string;
      footer?: RobotFooter;
      id?: string;
      createdAt?: number;
    }
  | {
      kind: 'streaming';
      seconds?: number;
      startedAt?: number;
      label: string;
      labelVars?: Record<string, string | number>;
      signalAt?: number;
      skills?: SkillFact[];
    }
  | { kind: 'skills'; read: string[]; denied: string[] }
  | { kind: 'plan'; title: string; preview: string; seconds?: number; createdAt?: number }
  | { kind: 'work'; id: string; steps: WorkStep[]; expanded?: boolean; createdAt?: number }
  | { kind: 'elapsed'; seconds: number }
  | {
      kind: 'note';
      text: string;
      id?: string;
    }
  | { kind: 'scheduled'; id?: string; stepId?: string }
  | { kind: 'scheduled-turn'; id: string; items: TranscriptItem[] }
  | { kind: 'automation-completed'; id: string }
  | { kind: 'chief' }
  | { kind: 'step-prompt'; id: string; origin: StepPromptOrigin; raw: string }
  | {
      kind: 'fail';
      title: string;
      body: string;
      raw?: string;
      facts?: FailFacts;
      id?: string;
      createdAt?: number;
    }
  | {
      kind: 'question';
      id: string;
      requestId: string;
      status: 'pending' | 'answered' | 'cancelled';
      questions: {
        header: string;
        question: string;
        options: { label: string; description?: string; recommended?: boolean }[];
        multiSelect?: boolean;
      }[];
      answers: { header: string; choices?: string[]; text?: string }[] | null;
    }
  | {
      kind: 'review';
      createdAt?: number;
      conclusion: string;
      findings: ReviewFinding[];
      extractionError?: string;
      id?: string;
    }
  | {
      kind: 'verify';
      createdAt?: number;
      passed: boolean;
      conclusion: string;
      evidence: { path: string; note?: string }[];
      extractionError?: string;
      id?: string;
    }
  | { kind: 'report'; markdown: string; id?: string; createdAt?: number }
  | {
      kind: 'thinking';
      text: string;
      id?: string;
    }
  | { kind: 'agent-todo'; items: AgentTodoItem[] };

export interface ReviewFinding {
  id: string;
  severity: 'blocking' | 'suggestion' | 'info';
  summary: string;
  description?: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface RobotPara {
  segments: DocSegment[];
  quote?: boolean;
  ordinal?: number;
  bullet?: boolean;
}

export interface RobotFooter {
  seconds?: number;
}

export interface DiffFile {
  path: string;
  added: number;
  removed?: number;
  hunks: DiffHunk[];
  fullContent?: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'marker';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface ChangesContent {
  files: DiffFile[];
  expanded: boolean;
}

export interface DetailContent {
  transcript: TranscriptItem[];
  doc?: DocBlock[];
  changes?: ChangesContent;
  userMenuOpen?: boolean;
  planVersions?: PlanVersion[];
  versionMenu?: 'versions' | 'compare';
  planDiff?: PlanDiffContent;
  compareTarget?: PlanDiffContent;
  revision?: RevisionStep;
  usage?: { rows: TokenUsage[]; machines: string[] };
  engineRun?: EngineRun;
  engineStage?: EngineRunStage;
}

export interface PlanVersion {
  v: string;
  at: number;
}

export interface PlanDiffContent {
  from: string;
  to: string;
  files: DiffFile[];
  expanded: boolean;
}

export interface RevisionStep {
  feedback: string;
  streaming: { seconds: number; label: string };
  planDiff?: PlanDiffContent;
  landed: {
    planVersions: PlanVersion[];
    doc: DocBlock[];
    transcriptTail: TranscriptItem[];
    planDiff: PlanDiffContent;
  };
}

export interface ChiefSegment {
  text: string;
  code?: boolean;
  todo?: number;
  strong?: boolean;
}

export type ChiefStreamItem =
  | (ThreadReportContent & { id: string; projectId?: string | null })
  | (ThreadMessageContent & { id: string; projectId?: string | null })
  | { kind: 'note'; text: string; machineName?: string }
  | { kind: 'error'; text: string; createdAt?: number }
  | { kind: 'handoff'; todoId: string; id?: string }
  | {
      kind: 'task-card';
      todoId: string;
      id: string;
      projectId: string | null;
      seq: number | null;
      title: string | null;
    }
  | {
      kind: 'question';
      id?: string;
      requestId: string;
      status: 'pending' | 'answered' | 'cancelled';
      questions: {
        header: string;
        question: string;
        options: { label: string; description?: string; recommended?: boolean }[];
        multiSelect?: boolean;
      }[];
      answers: { header: string; choices?: string[]; text?: string }[] | null;
      todoId?: string;
    }
  | {
      kind: 'user';
      text: string;
      id?: string;
      markdown?: string;
      pending?: 'queued' | 'held';
      delivery?: 'sending';
      outboxKey?: string;
      at?: string;
      createdAt?: number;
      projectId?: string | null;
    }
  | {
      kind: 'stopped';
      todos: { id: string; seq: number; title: string }[];
      id?: string;
      createdAt?: number;
    }
  | {
      kind: 'robot';
      paragraphs?: ChiefSegment[][];
      bullets?: ChiefSegment[][];
      markdown?: string;
      typing?: boolean;
      seconds: string;
      tools?: ChiefToolRow[];
      id?: string;
      createdAt?: number;
      fallbackModel?: string;
      projectId?: string | null;
    }
  | {
      kind: 'thinking';
      text: string;
      id?: string;
    }
  | {
      kind: 'digest';
      id: string;
      reason: 'daily' | 'threshold';
      madeAt: number;
      items: ChiefDigestItem[];
    }
  | {
      kind: 'daily-report';
      id: string;
      report: ChiefReportContent;
    }
  | {
      kind: 'runner-offline';
      id: string;
      notice: RunnerOfflineContent;
    }
  | {
      kind: 'streaming';
      seconds?: number;
      startedAt?: number;
      label: string;
      tools?: ChiefToolRow[];
      labelVars?: Record<string, string | number>;
      labelDetail?: { label: string; vars: Record<string, string | number> };
      signalAt?: number;
      waiting?: boolean;
    };

export interface ChiefToolRow {
  label: string;
  seconds?: number;
  error?: boolean;
  running?: boolean;
}

export interface ChiefThreadRef {
  title: string;
  active?: boolean;
}

export type ChiefSettingsTab = 'routing' | 'charter' | 'memory' | 'watches';

export interface ModelOption {
  provider: string;
  machineId?: string;
  providerLabel: string;
  modelId: string;
  modelName: string;
  liveness?: 'alive' | 'dead' | 'unknown';
}

export interface ChiefContextUsage {
  tokens: number;
  contextWindow: number;
  resume?: 'warm' | 'cold' | 'compacted' | 'idle';
}

export interface ChiefContent {
  view: 'settings' | 'none';
  tab?: ChiefSettingsTab;
  bound: boolean;
  modelSlot?: string;
  agent?: { id?: string; displayName: string; avatarUrl: string | null };
  modelProvider?: string | null;
  threadTitle: string;
  threadId?: string;
  threads?: ChiefThreadRef[];
  draft?: string;
  stream?: ChiefStreamItem[];
  streamAt?: number[];
  running?: boolean;
  runningTool?: string;
  waitingTurn?: { messageId: string; text: string };
  outage?: { reason: 'quota' | 'capacity'; model: string | null; retryAt: number | null };
  fallbackModel?: string;
  hasEarlier?: boolean;
  quickReplies?: string[];
  context?: ChiefContextUsage;
  composerFiles?: ComposerFileSeed[];
}

export interface ComposerFileSeed {
  name: string;
  state: 'ready' | 'uploading' | 'error';
}
