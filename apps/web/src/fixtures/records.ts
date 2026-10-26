import {
  type AgentRecord,
  type AgentTask,
  type AgentTodoItem,
  type ClaudeLogin,
  type DocumentDiffFile,
  type GithubRepoSummary,
  type MachineHardware,
  type MemoryRecord,
  type ModelSource,
  PHASE_VALUES,
  type Phase,
  type ProjectRepoKind,
  type ProviderRecord,
  type QuotaWait,
  type SecretRecord,
  type SkillFact,
  type TagRecord,
  type UsageCost,
} from '@cairn/shared';

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

export interface TodoRecord {
  id: string;
  teamId: string;
  projectId: string;
  title: string;
  spec: string;
  phase: Phase;
  phaseAt: number;
  seqNum: number;
  orderIndex: number;
  tagIds: string[];
  assignment: AssignmentRecord | null;
  agent: AgentRef | null;
  latestBuildId: string | null;
  lastRunAt: number | null;
  hasChanges: boolean;
  hasPlan: boolean;
  buildHistory: BuildRef[];
  sourceTodo: string | null;
  v: number;
  awaitingReply?: boolean;
  chiefCreated?: boolean;
  waitingOn?: { on: 'machine' | 'quota'; retryAt: number | null };
  quotaWait?: QuotaWait | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
  usageCost?: UsageCost;
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
  chipPopoverOpen?: boolean;
  planDropdownOpen?: boolean;
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
  kind: 'hourly' | 'daily' | 'weekly' | 'once';
  at: number;
  tz: string;
  nextRunAt: number;
  createdBy: string;
  todo: {
    seqNum: number;
    title: string;
    phase: Phase;
    projectName: string;
    ownerId: string;
  };
}

export interface ProjectCommitRow {
  id: string;
  shortSha: string;
  message: string;
  authorName: string;
  at: number;
  files?: DocumentDiffFile[];
}

export interface ProjectContent {
  name: string;
  branch: string;
  files: string[];
  repoName: string;
  hosted: boolean;
  repoKind?: ProjectRepoKind;
  defaultBranch: string;
  description: string | null;
  commits?: ProjectCommitRow[];
  fileContents?: Record<string, string>;
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
  plaintext?: string;
}

export interface ApiKeysContent {
  keys: ApiKeyRecord[];
}

export interface FixtureSet {
  todos: TodoRecord[];
  now: number;
  detail?: DetailContent;
  overlay?: OverlayState;
  chiefUnread?: number;
  chiefBusy?: boolean;
  ui?: OverlayUi;
  usageNav?: boolean;
  schedules?: ScheduleRecord[];
  scheduleForm?: 'hourly' | 'daily' | 'weekly' | 'once';
  project?: ProjectContent;
  projectTab?: 'tasks' | 'files';
  team?: TeamContent;
  agents?: AgentRecord[];
  apiKeys?: ApiKeysContent;
  resources?: ResourcesContent;
  projectNames?: Record<string, string>;
  chief?: ChiefContent;
  github?: GithubFixture;
  tags?: Array<Pick<TagRecord, 'id' | 'name' | 'color'>>;
  agentTasks?: AgentTask[];
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
  pill?: string;
  enabledRuntimes?: string[];
  chiefHost?: boolean;
  chiefRunning?: boolean;
  chiefWaiting?: boolean;
  maxConcurrent?: number;
  runningSteps?: number;
  capabilities?: { mcpServers: string[]; skills: string[]; hardware?: MachineHardware } | null;
  maxConcurrentOverridden?: boolean;
  recommendedConcurrent?: number;
  concurrencyRange?: { min: number; max: number };
  concurrencySource?: 'measured' | 'estimate' | 'manual';
  claudeLogin?: ClaudeLogin;
}

export interface ResourcesContent {
  skills: SkillRow[];
  mcpServers: McpRow[];
  machines: MachineRow[];
  providerSources: ModelSource[];
  providers?: ProviderRecord[];
  memories?: MemoryRecord[];
  secrets?: SecretRecord[];
}

export interface DocSegment {
  text: string;
  style?: 'code' | 'link' | 'mention' | 'strong';
  mentionKind?: 'todo' | 'skill' | 'agent' | 'project' | 'machine';
  mentionId?: string;
}

export interface DocBlock {
  kind: 'para' | 'bullet' | 'head';
  segments: DocSegment[];
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
    }
  | {
      kind: 'robot';
      paragraphs?: (RobotPara | DocSegment[])[];
      markdown?: string;
      footer?: RobotFooter;
      id?: string;
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
  | { kind: 'injected-skills'; skills: { id: string; reason: string }[] }
  | { kind: 'plan'; title: string; preview: string; seconds?: number }
  | {
      kind: 'tools';
      seconds: number;
      expanded: boolean;
      pills: string[];
      outputs?: (string | null)[];
    }
  | { kind: 'elapsed'; seconds: number }
  | {
      kind: 'note';
      text: string;
      id?: string;
    }
  | { kind: 'scheduled' }
  | { kind: 'chief' }
  | { kind: 'fail'; title: string; body: string }
  | {
      kind: 'review';
      conclusion: string;
      findings: ReviewFinding[];
      extractionError?: string;
      id?: string;
    }
  | {
      kind: 'verify';
      passed: boolean;
      conclusion: string;
      evidence: { path: string; note?: string }[];
      extractionError?: string;
      id?: string;
    }
  | { kind: 'report'; markdown: string; id?: string }
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

export interface ChiefExample {
  icon: 'user-plus' | 'folder' | 'grid' | 'bars';
  text: string;
}

export interface ChiefSegment {
  text: string;
  code?: boolean;
  todo?: number;
  agent?: string;
  strong?: boolean;
}

export type ChiefStreamItem =
  | { kind: 'note'; text: string; machineName?: string }
  | { kind: 'error'; text: string }
  | {
      kind: 'question';
      id?: string;
      requestId: string;
      status: 'pending' | 'answered' | 'cancelled';
      questions: {
        header: string;
        question: string;
        options: { label: string; description?: string }[];
        multiSelect?: boolean;
      }[];
      answers: { header: string; choices?: string[]; text?: string }[] | null;
    }
  | { kind: 'user'; text: string; id?: string; markdown?: string }
  | {
      kind: 'robot';
      paragraphs?: ChiefSegment[][];
      bullets?: ChiefSegment[][];
      markdown?: string;
      typing?: boolean;
      seconds: string;
      tools?: ChiefToolRow[];
      id?: string;
    }
  | {
      kind: 'thinking';
      text: string;
      id?: string;
    }
  | {
      kind: 'tool';
      label: string;
      startedAt?: number;
      seconds?: number;
      running?: boolean;
      error?: boolean;
      id?: string;
    }
  | {
      kind: 'streaming';
      seconds?: number;
      label: string;
      tools?: ChiefToolRow[];
      labelVars?: Record<string, string | number>;
      signalAt?: number;
    };

export interface ChiefToolRow {
  label: string;
  seconds?: number;
  error?: boolean;
}

export interface ChiefThreadRef {
  title: string;
  active?: boolean;
}

export type ChiefSettingsTab = 'agent' | 'charter' | 'memory' | 'watches';

export interface ModelOption {
  provider: string;
  machineId?: string;
  providerLabel: string;
  modelId: string;
  modelName: string;
  liveness?: 'alive' | 'dead' | 'unknown';
}

export interface ChiefContent {
  view: 'drawer' | 'settings' | 'none';
  tab?: ChiefSettingsTab;
  bound: boolean;
  modelSlot?: string;
  agent?: { id?: string; displayName: string; avatarUrl: string | null };
  modelProvider?: string | null;
  threadTitle: string;
  threadsOpen?: boolean;
  threads?: ChiefThreadRef[];
  examples?: ChiefExample[];
  draft?: string;
  stream?: ChiefStreamItem[];
  running?: boolean;
  runningTool?: string;
}
