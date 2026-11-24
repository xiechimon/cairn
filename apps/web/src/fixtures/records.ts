import {
  type AgentTodoItem,
  type BackgroundTask,
  type ChiefReportContent,
  type ChiefTurnErrorContent,
  type ClaudeLogin,
  type ConfinementCause,
  type ConfinementReport,
  type DailyUsage,
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
  type SecretListEntry,
  type StepPromptOrigin,
  type StepQueueBlocked,
  type TaskRequest,
  type ThinkingLevel,
  type ThreadMessageContent,
  type ThreadReportContent,
  type TodoDeliverables,
  type TodoOutputKind,
  type TodoOwner,
  type TodoSection,
  type TodoWaitingOn,
  type TokenUsage,
  type UsageCost,
} from '@cairn/shared';
import type { MachineProvider } from '../api/claude-accounts.js';
import type { EngineRun, EngineRunStage } from '../board/engine-run.js';
import type { DocumentPreview } from '../vendor-open-design/viewers/document-preview-viewer.js';
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

export type MadeKind = 'document' | 'design' | 'page' | 'slides' | 'code';

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
  seqNum: number;
  orderIndex: number;
  githubLabelIds?: string[];
  assignment: AssignmentRecord | null;
  agent: AgentRef | null;
  latestBuildId: string | null;
  lastRunAt: number | null;
  hasChanges: boolean;
  hasPlan: boolean;
  buildHistory: BuildRef[];
  sourceTodo: string | null;
  blockedBy?: string[];
  v: number;
  chiefCreated?: boolean;
  waitingOn?: TodoWaitingOn;
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
  deliverables?: TodoDeliverables;
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
  mcpDialog?:
    | { kind: 'catalog'; catalogId: string }
    | { kind: 'custom' }
    | { kind: 'manage'; connectorId: string }
    | { kind: 'authorizing'; catalogId: string }
    | { kind: 'confirm'; name: string; host: string }
    | { kind: 'landing'; reason: string; name?: string }
    | { kind: 'github-device'; step: GithubDeviceFixtureStep };
}

export type GithubDeviceFixtureStep =
  | 'code'
  | 'denied'
  | 'expired'
  | 'repos'
  | 'repos-missing'
  | 'reconnect';

export interface ScheduleRecord {
  id: string;
  teamId: string;
  projectId: string;
  todoId: string;
  kind: 'hourly' | 'daily' | 'weekly' | 'once' | 'cron' | 'event' | 'webhook';
  at: number | null;
  tz: string;
  nextRunAt: number | null;
  cron?: string | null;
  prompt?: string;
  lastRunAt?: number | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
  triggerSpec?: { topic: 'todo.build.completed' } | null;
  webhookMasked?: string | null;
  webhookLastUsedAt?: number | null;
  missedRunWindowMs?: number | null;
  createdAt?: number | null;
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
  dailyUsage?: DailyUsage;
  schedules?: ScheduleRecord[];
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
  attachments?: Record<string, { text?: string; src?: string; document?: DocumentPreview }>;
}

export interface GithubFixture {
  connected: boolean;
  login?: string;
  scope?: string;
  repos?: GithubRepoSummary[];
  grantReposUrl?: string;
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
  hostname?: string;
  online?: boolean;
  lastSeenAt?: number | null;
  pill?: string;
  enabledRuntimes?: string[];
  chiefHost?: boolean;
  isDefault?: boolean;
  runningSteps?: number;
  capabilities?: {
    mcpServers: string[];
    skills: string[];
    hardware?: MachineHardware;
    executor?: MachineExecutor;
    osPlatform?: MachineOsPlatform;
    confinement?: ConfinementReport;
    confinementCause?: ConfinementCause;
    computer?: true;
    ownComputer?: true;
    ownComputerShell?: true;
    browser?: true;
    computerName?: string;
    hostname?: string;
    hostPermissions?: {
      accessibility: PermissionState;
      automation: PermissionState;
      screenRecording: PermissionState;
    };
    phoneHost?: true;
    phones?: import('@cairn/shared').MachinePhoneReport[];
  } | null;
  claudeLogin?: ClaudeLogin;
  providers?: MachineProvider[];
  phonesFixture?: PhonesFixture;
}

export interface PhonesFixture {
  phones?: import('@cairn/shared').PhoneRow[];
}

export interface ResourcesContent {
  skills: SkillRow[];
  mcpServers: McpRow[];
  mcpConnectors?: import('@cairn/shared').McpConnectorRecord[];
  composioApps?: import('@cairn/shared').ComposioApps;
  githubConnector?: import('@cairn/shared').GithubConnectorAvailability;
  machines: MachineRow[];
  providerSources: ModelSource[];
  providers?: ProviderRecord[];
  memories?: MemoryRecord[];
  secrets?: SecretListEntry[];
  browserPasswordGrants?: import('@cairn/shared').BrowserPasswordGrant[];
  accounts?: AccountsContent;
  routingSettings?: import('@cairn/shared').TeamRoutingSettings;
  topModels?: import('@cairn/shared').TopModel[] | null;
  mailAccounts?: import('@cairn/shared').MailAccountRecord[];
}

export interface DocSegment {
  text: string;
  style?: 'code' | 'link' | 'mention' | 'strong' | 'anchor' | 'attachment' | 'break';
  href?: string;
  internal?: boolean;
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
  | { kind: 'think'; id: string; text: string; seconds: number | null; running?: boolean }
  | { kind: 'say'; id: string; text: string }
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
      background?: true;
      seconds: number | null;
    };

export interface BackgroundTaskView {
  taskId: string;
  type: 'agent' | 'shell';
  description: string;
  prompt?: string;
  status: BackgroundTask['status'];
  startedAt: number;
  endedAt?: number;
  toolUses?: number;
  steps: WorkStep[];
}

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
      outputTokens?: number;
      blocked?: true;
      blockedKind?: StepQueueBlocked['kind'];
    }
  | { kind: 'skills'; read: string[]; denied: string[] }
  | {
      kind: 'work';
      id: string;
      steps: WorkStep[];
      expanded?: boolean;
      running?: boolean;
      startedAt?: number;
      outputTokens?: number;
      createdAt?: number;
    }
  | {
      kind: 'note';
      text: string;
      vars?: Record<string, string>;
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
      plain?: { key: string; vars: Record<string, string> };
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
  | { kind: 'agent-todo'; id?: string; items: AgentTodoItem[]; backgroundRunning?: number }
  | { kind: 'bg-tasks'; buildId: string; tasks: BackgroundTaskView[] };

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
  usage?: { rows: TokenUsage[]; machines: string[] };
  engineRun?: EngineRun;
  engineStage?: EngineRunStage;
}

export interface ChiefSegment {
  text: string;
  code?: boolean;
  todo?: number;
  strong?: boolean;
}

export interface QueueWait {
  kind: 'no-computer' | 'machine-offline';
  machine?: string;
}

export type ChiefStreamItem =
  | (ThreadReportContent & { id: string; projectId?: string | null })
  | (ThreadMessageContent & { id: string; projectId?: string | null })
  | { kind: 'note'; text: string; vars?: Record<string, string>; id?: string; machineName?: string }
  | {
      kind: 'error';
      text: string;
      error?: Omit<ChiefTurnErrorContent, 'kind'>;
      id?: string;
      createdAt?: number;
    }
  | { kind: 'handoff'; todoId: string; id?: string }
  | { kind: 'report-ack'; id: string; todoId: string; buildId: string }
  | {
      kind: 'takeover';
      id: string;
      reason: string;
      phone?: string;
      startedAt: number | null;
      endedAt: number | null;
      outcome: 'waiting' | 'handed-back' | 'not-done';
    }
  | {
      kind: 'secret-request';
      id: string;
      name: string;
      scope: 'team' | 'project';
      projectId: string | null;
      description: string;
      outcome: 'waiting' | 'saved' | 'cancelled' | 'failed';
    }
  | {
      kind: 'package-install';
      id: string;
      packages: string[];
      outcome: 'waiting' | 'installed' | 'declined' | 'not-answered' | 'failed';
    }
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
      pending?: 'steering' | 'queued' | 'held';
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
      plain?: { key: string; vars: Record<string, string> };
      typing?: boolean;
      seconds: string;
      tools?: ChiefToolRow[];
      id?: string;
      createdAt?: number;
      fallbackModel?: string;
      projectId?: string | null;
      report?: { todoId: string; buildId: string };
    }
  | {
      kind: 'thinking';
      text: string;
      id?: string;
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
      signalAt?: number;
      blocked?: true;
      blockedKind?: StepQueueBlocked['kind'];
      queueWait?: QueueWait;
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

export interface ModelOption {
  runtime: string;
  provider: string;
  machineId?: string;
  providerLabel: string;
  modelId: string;
  modelName: string;
  liveness?: 'alive' | 'dead' | 'unknown';
  updateRequired?: { runtime: string; current: string; required: string };
  thinkingLevels?: readonly ThinkingLevel[];
  thinkingDefault?: ThinkingLevel;
  coordinatorThinkingLevels?: readonly ThinkingLevel[];
  coordinatorThinkingDefault?: ThinkingLevel;
}

export interface ChiefContextUsage {
  tokens: number;
  contextWindow: number;
  compactAt?: number;
  resume?: 'warm' | 'cold' | 'compacted' | 'idle';
  resumeExpiresAt?: number;
  cache?: { read: number; write: number; input: number };
}

export interface ChiefContent {
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
