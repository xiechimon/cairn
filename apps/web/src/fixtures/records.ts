// Fixture record contract = 02-架构平价 §6.2 + §4.1 todo field table.
// Field set copied from the r3 §3.0 observed wire shape:
// phaseAt/seqNum/orderIndex/tagIds/spec/assignment/agent/latestBuildId/
// lastRunAt/hasChanges/hasPlan/buildHistory/sourceTodo/v — plus one [推断]
// display-only extension (awaitingReply, see the field) carried for the
// observed waiting-on-user board placement.
// Timestamps are epoch milliseconds (02 §6.2 schedule record precedent).

// phase 九值枚举单源 = @pacman/shared（02 §4.1；#65 M1 收口），本地不再定义。
// GithubRepoSummary = repo picker 行封套单源（spec 12 数据契约，#359）。
import {
  type AgentRecord,
  type AgentTask,
  type DocumentDiffFile,
  type GithubRepoSummary,
  type MemoryRecord,
  type ModelSource,
  PHASE_VALUES,
  type Phase,
  type ProjectRepoKind,
  type ProviderRecord,
  type SecretRecord,
  type SkillFact,
  type TagRecord,
} from '@pacman/shared';

export type { Phase };
export { PHASE_VALUES };

/** Agent reference embedded in a todo record (02 §6.2 agent shape subset). */
export interface AgentRef {
  id: string;
  displayName: string;
}

/** Agent assignment on a todo (r3 §3.0 `assignment` field). */
export interface AssignmentRecord {
  agentId: string;
}

/** Build history entry (buildId ≡ conversationId, CONTEXT.md). */
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
  /** Record version, r3 §3.0 wire field replicated verbatim (value observed 2–4). */
  v: number;
  /** True when the latest run stopped to ask the user something (r5b §3.15
   *  #1: phase review, card sits in 执行中 with a 回复 button). [推断] wire
   *  field — not in the r3 §3.0 snapshot, needed to reproduce the observed
   *  board placement and card action for waiting-on-user todos. */
  awaitingReply?: boolean;
  /** #640 / r14 §5.4：总管建的卡（wire sourceBuildId ≠ null 的显示投影）
   *  ——看板卡底行「由总管创建」芯片的判定位（区分 agent 拆的卡与人手建
   *  的卡，参考站 11-todo12-card-zoom 同构）。fixture 捕获缺省 = 无芯片，
   *  基线像素零漂移。 */
  chiefCreated?: boolean;
  /** #1257 板面挂起态（server 读侧派生，wire todoRecordSchema.waitingOn）：
   *  等机器 / 等额度——看板卡挂起芯片的判定位（与「执行失败」红态区分）。
   *  fixture 捕获缺省 = 无芯片，基线像素零漂移。 */
  waitingOn?: { on: 'machine' | 'quota'; retryAt: number | null };
}

/** Token 用量 content (issue #68, r7 30): the cumulative-run figures,
 *  verbatim strings from the capture. Rendered as a static right-pane
 *  section on the detail route (issue #366). */
export interface TokenUsageContent {
  total: string;
  model: string;
  modelTotal: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  /** Cache hit rate display (#777): cacheRead over input plus cacheRead. */
  cacheHitRate: string;
}

/** 分支与 PR content (issue #68, r7 31): sync-tab fields. Board cards open
 *  the dialog; the detail route renders it as a right-pane section (#366). */
export interface BranchInfoContent {
  branch: string;
  commit: string;
  machine: string;
  directory: string;
}

/** One 运行历史 row. r7 32 froze the single-row state (ring glyph);
 *  the r8 80 dark capture adds the multi-row forms: failed runs carry a
 *  stop-colored ×, succeeded ones a done-colored check (r8 80). */
export interface RunHistoryRow {
  label: string;
  meta: string;
  /** r8 57: `failed-current` = the failed run that is still the current
   *  one — carries the 当前 chip; a failed PAST run under a live current
   *  one carries none (r8 77/80). */
  status: 'current' | 'failed' | 'done' | 'failed-current';
}

/** Detail-route right-pane view (issue #366): the doc surface (DocPane
 *  plan/changes/diff) plus the three static sections that replaced the
 *  former head-icon overlays. */
export type PaneView = 'doc' | 'branch' | 'token' | 'history';

/** Modal surface rendered over a route (issue #68). The scenario fixture
 *  opens one for capture determinism; the header/card buttons open the same
 *  set interactively. The branch payload is build-scoped display data —
 *  outside the 02 §6.2 record contract — resolved per todo from the fixture
 *  layer; the accept dialog carries no payload. Token/history left the
 *  overlay family in #366 (static right-pane sections, PaneView). */
export type OverlayKind = 'branch' | 'accept' | 'rerun' | 'reuse' | 'review' | 'reject';

export interface OverlayState {
  kind: OverlayKind;
}

/** The three build-scoped payloads travelling together (issue #68): the
 *  board branch dialog and the detail right-pane sections (#366) read the
 *  same set. */
export interface BuildOverlayContent {
  token: TokenUsageContent;
  branch: BranchInfoContent;
  runs: RunHistoryRow[];
}
/** Overlay open-states a scenario freezes (issue #67): the ⌘K search
 *  panel, the detail status-chip popover and the doc-pane 方案▾ dropdown.
 *  Pure initial UI state — the overlays stay interactive afterwards. */
export interface OverlayUi {
  /** ⌘K panel open; absent query = the empty 前往 surface (r7 05). */
  searchOpen?: boolean;
  searchQuery?: string;
  /** Status-chip popover open over the detail header (r7 19 / 29). */
  chipPopoverOpen?: boolean;
  /** 方案▾ document-type dropdown open in the doc pane (r7 20). */
  planDropdownOpen?: boolean;
  /** Right-pane view frozen for the capture scenarios (issue #366 — the
   *  former `overlay: token/branch/history` freeze of r7 30/31/32, r8
   *  57/77/78–80; absent = the doc view). */
  paneView?: PaneView;
  /** Account 语言 dropdown open (issue #74; open state [设计] — the
   *  official option list was never captured, r2 §11 Q19). */
  langDropdownOpen?: boolean;
  /** 看板顶部通知引导条 (issue #114, r2 §1.3: captures 01/28/30). Freezes
   *  the Notification.permission === 'default' state for the fixture — the
   *  r7 board baselines carry no banner, so no existing scenario may grow one. */
  notificationBanner?: boolean;
  /** Account 推送通知 switch 的权限档冻结位 (#1031). The switch is a
   *  preference layered over permission, so the fixture face must be able to
   *  express all three permission states (not the old hardcoded 'granted'):
   *  denied/default 档让「点开 → 拦截解释」与「default 起步」两面可钉。
   *  Absent = account 面缺省 'granted'（r7 13 基线行的开态）。 */
  notificationPermission?: NotificationPermission;
}

/** Scheduled rule (02 §9.2 / r3 §8.3 wire shape, copied verbatim:
 *  `{id, teamId, projectId, todoId, kind, at, tz, machineId, nextRunAt,
 *  createdBy, todo{seqNum,title,phase,projectName,ownerId}}`). */
export interface ScheduleRecord {
  id: string;
  teamId: string;
  projectId: string;
  todoId: string;
  /** 频率 tab (02 §9.2): 每小时/每天/每周/单次. */
  kind: 'hourly' | 'daily' | 'weekly' | 'once';
  at: number;
  tz: string;
  /** null = 自动 (r3 §9 机器 row). */
  machineId: string | null;
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

/** Commit row of the project 文件|历史 segment's 历史 view (#149; display
 *  shape shared by the fixture and the live wire mapper — [推断] endpoint
 *  GET /api/projects/{id}/commits, row = git log minimal projection). */
export interface ProjectCommitRow {
  id: string;
  shortSha: string;
  message: string;
  authorName: string;
  /** Author instant, epoch ms (relativeTime renders against the clock). */
  at: number;
  /** #1102 提交详情面 fixture 供肉：该提交相对第一父的文件级 diff（wire 形
   *  DocumentDiffFile，与 live 载荷同契约——两面都经 mapDiffFiles 进同一渲染
   *  面）。live 走 GET commits/{sha}；fixture 无 server 由本槽直出，缺席键 =
   *  files:[]（fileContents 缺席键纪律同款，fixture 行都要带肉防死钮）。 */
  files?: DocumentDiffFile[];
}

/** Repo surface of a project route (r2 07e/24 file tree + 24c settings
 *  rows): branch chip, file rows and the settings card values. */
export interface ProjectContent {
  /** Display name (r2 24c 名称 row); the repo slug is a separate attribute
   *  (CONTEXT.md 租户层级: repo belongs to the project, not the reverse). */
  name: string;
  branch: string;
  files: string[];
  repoName: string;
  /** True = the `Pacman 托管` chip rides beside the repo name (r2 24c). */
  hosted: boolean;
  /** repo 形态（spec 12 三形态，词表单源 = shared ProjectRepoKind；live 面
   *  = wireProject.repoKind 透传）。local = Files tab 开闸读本地仓（#1030，
   * 不可达走降级文案）。 */
  repoKind?: ProjectRepoKind;
  defaultBranch: string;
  description: string | null;
  /** 历史 segment rows (#149); fixture-frozen, newest first. */
  commits?: ProjectCommitRow[];
  /** 文件查看器 fixture 供肉(#202):文件名 → utf-8 文本。live 走
   *  GET /api/projects/{id}/file,fixture 无 server 由本映射直出;缺席
   *  的键 = 该文件不可预览(fixture 不演 base64 态)。 */
  fileContents?: Record<string, string>;
}

/** Team-route agent card (r7 12): avatar + name + model line + role line. */
export interface TeamAgentCard {
  id: string;
  displayName: string;
  /** #387 avatarUrl 语义：null/缺省 = dicebear 按 displayName 种子生成；
   *  非 null = 显式覆盖。 */
  avatarUrl?: string | null;
  /** Model line lead (`claude-sonnet-5 · 默认`, r7 12). */
  model: string;
  /** Model line carries the `· 默认` suffix for the team's default agent. */
  isDefault: boolean;
  /** Role line text; null renders the `未设置职责` placeholder (r7 12). */
  role: string | null;
  /** 服务商标识（r3 §4 样本 `provider:"r3-gw"`；records/agent.ts 同名栏）。
   *  null/缺省 = 未配置 → chart 节点不渲染服务商徽标。 */
  provider?: string | null;
}

/** Team-route content (r7 12): stats-bar count + the agent card grid. */
export interface TeamContent {
  /** Stats bar `N 个成员` — the member count includes agents (r3 §4). */
  members: number;
  agents: TeamAgentCard[];
}

/** API-key row (02 §6.2 apiKey shape subset + r3 §6 display rules). */
export interface ApiKeyRecord {
  id: string;
  /** Optional key name (r3 §6 `密钥名称（可选）`); null shows the mask alone. */
  name: string | null;
  /** List-row mask `pacman_afe07565…` (r3 §6 display rule; prefix 随品牌槽). */
  masked: string;
  gitAccess: boolean;
  mcpAccess: boolean;
  /** One-time plaintext right after creation (02 §8): rendered once beside
   *  the `请立即复制密钥，它仅显示一次。` canon, absent on every later view. */
  plaintext?: string;
}

/** API-keys route content; absent = the empty state (r2 19). */
export interface ApiKeysContent {
  keys: ApiKeyRecord[];
}

/** One deterministic content set behind a scenario id. `now` is the frozen
 *  reference instant for relative labels (capture time of the r7 shot), so
 *  fixture output never drifts with wall-clock time. */
export interface FixtureSet {
  todos: TodoRecord[];
  now: number;
  /** Detail-route display content (issue #56): the transcript and plan
   *  document of the selected todo, verbatim from the r7 captures. Board
   *  scenarios leave it absent. */
  detail?: DetailContent;
  /** Modal overlay open over the route (issue #68): detail overlays ride
   *  the detail surface, `accept` the board surface. */
  overlay?: OverlayState;
  /** Unread chief messages — the blue count badge on the 总管 FAB
   *  (r8 78–81 dark captures; absent from the r7 light set). */
  chiefUnread?: number;
  /** Overlay open-states (issue #67); absent = all closed. */
  ui?: OverlayUi;
  /** Sidebar 用量 nav row present (issue #67): the live site grew it
   *  between the r7 captures (2026-09-21, absent) and the 05b results
   *  capture (2026-09-22, present) — nav set is per-capture content. */
  usageNav?: boolean;
  /** Schedule list of the /app/schedules route (issue #71); absent or
   *  empty = the `尚无定时。` empty state (r7 11). */
  schedules?: ScheduleRecord[];
  /** Open state of the 新建定时 dialog (r3 92/92b): the selected 频率 tab.
   *  Absent = dialog closed. */
  scheduleForm?: 'hourly' | 'daily' | 'weekly' | 'once';
  /** Project route content (issue #71); absent = the r3-lifecycle repo
   *  defaults so production builds still render the pages. */
  project?: ProjectContent;
  /** Capture-state flag for /app/project/:id (r2 24 vs 24b): which of the
   *  任务|文件 tabs the capture sits on. Absent = 文件, the route default
   *  (r2 §2 route table). */
  projectTab?: 'tasks' | 'files';
  /** Team-route content (issue #70, r7 12); absent = the r7 roster. */
  team?: TeamContent;
  /** Agent 详情页的记录集（r3 §4 实测样本形状 = shared AgentRecord）。团队页
   *  的 Agent 卡只带展示投影（TeamAgentCard），不进这里——详情页要的是全
   *  记录（职责/provider/modelId/思考强度/权限四组）。live 面 = GET
   *  /api/teams/{id}/agents/{aid}。absent = 详情页走「找不到该 Agent」回退。 */
  agents?: AgentRecord[];
  /** API-keys route content (issue #70); absent = empty state (r2 19). */
  apiKeys?: ApiKeysContent;
  /** Resource-route display content (issue #69): the row sets of the six
   *  resource surfaces, verbatim from the r7 06–10 captures. Board and
   *  detail scenarios leave it absent. */
  resources?: ResourcesContent;
  /** projectId → 项目名（M5 live 面：卡面/搜索/新建 dialog 的项目 chip 走
   *  真项目名；absent = capture canon `r3-lifecycle`，fixture 面不携带）。 */
  projectNames?: Record<string, string>;
  /** Chief surface content (issue #72): the 总管 drawer overlay or the
   *  full-content 总管设置 view, verbatim from the r5 100–116 captures.
   *  Board scenarios without a chief surface leave it absent. */
  chief?: ChiefContent;
  /** 新建项目 GitHub 连接面（#361 G2-T4）：fixture 面的连接状态 + picker
   *  仓库行（live 面 = GET connection / GET /api/github/repos）。absent =
   *  未连接（认证钮面）。 */
  github?: GithubFixture;
  /** #403 看板标签筛选的 fixture 数据源：标签记录最小投影（id/name/color，
   *  TagChip 消费面同形）。absent = 筛选条不渲染（无标签数据的场景保持
   *  r7 基线零漂移）；live 面真值 = GET /api/projects/{id}/tags。 */
  tags?: Array<Pick<TagRecord, 'id' | 'name' | 'color'>>;
  /** Agent 详情概览「进行中」段的 fixture 行集（形状 = shared AgentTask）。
   *  absent 或空 = canon 空态「暂无进行中的任务」（r3 53 截图即此态）；
   *  live 面真值 = GET /api/teams/{id}/agents/{aid}/tasks。 */
  agentTasks?: AgentTask[];
}

/** GitHub 连接 fixture（#361）：connected 驱动认证钮/picker 面切换；
 *  repos = picker 行（shared GithubRepoSummary 封套同形）。 */
export interface GithubFixture {
  connected: boolean;
  login?: string;
  scope?: string;
  repos?: GithubRepoSummary[];
}

/** Skill row (r7 08): name + one-line description. */
export interface SkillRow {
  name: string;
  description: string;
}

/** MCP server row (r7 09): name + type label + endpoint url + relative
 *  creation label, all verbatim from the capture. */
export interface McpRow {
  name: string;
  kind: string;
  url: string;
  ago: string;
}

/** Machine row (spec 11 A8): the local machine pinned first (kind='local',
 *  per-runtime 品牌 mark pair, undeletable) plus one row per attached LAN/VPS
 *  machine (name + online dot). */
export interface MachineRow {
  /** Machine record id — the `data-machine-id` contract handle. */
  id?: string;
  /** `local` = the server host (pinned first); absent/`remote` = attached. */
  kind?: 'local' | 'remote';
  name: string;
  online?: boolean;
  /** Right-side status pill; absent on online machines. */
  pill?: string;
  /** Per-runtime 启用态（MACHINE_RUNTIMES subset; [] = all off）——驱动 mark
   *  原色/35% 透明两态。 */
  enabledRuntimes?: string[];
  /** 机器层 shell 访问闸（XMON-113 R3 起是行内真控件；契约单源 =
   *  shared machineRecordSchema.shellEnabled）。 */
  shellEnabled?: boolean;
  /** #895 三态读标注（spec 21 A8；live = GET /chief 封套 orchestration 块
   *  join useMachines 行集）：chiefHost = 总管主机徽标行（defaultMachineId
   *  命中）；chiefRunning = 总管回合进行中（activity.running > 0）；
   *  chiefWaiting = 总管等待机器（activity.waiting > 0，被钉 pending 回合
   *  等该机上线/开闸）。fixture 静态投影同一语义；absent = 无标注（存量
   *  capture 零漂移）。 */
  chiefHost?: boolean;
  chiefRunning?: boolean;
  chiefWaiting?: boolean;
  /** #1108 并发上限（行内并发控件与 `执行中 n/N` 读标注的数据源；契约
   *  单源 = shared machineRecordSchema.maxConcurrent）。absent = 老服务
   *  器/存量 fixture——控件退场（回到无并发面），呈现零漂移。 */
  maxConcurrent?: number;
  /** #1108 该机 claimed 步数（全 kind；`执行中 n/N` 的 n）。absent 同上。 */
  runningSteps?: number;
}

/** The six resource surfaces' row sets (issue #69). */
export interface ResourcesContent {
  skills: SkillRow[];
  mcpServers: McpRow[];
  machines: MachineRow[];
  /** providers 页 runtime tabs 数据源（spec 11 §A1-A4，#356）：pi +
   *  claude-code 两段，形状 = shared ModelSource（数据契约单源）。 */
  providerSources: ModelSource[];
  /** custom provider 记录（shared ProviderRecord 同形；live 面 = GET
   *  /api/teams/{id}/providers）。#770 起不再是模型选择器的候选源（投影
   *  只读 providerSources）——本字段保留给 providers 管理页与存量绑定
   *  上下文。absent = 无服务商。 */
  providers?: ProviderRecord[];
  /** Agent 记忆条目（shared MemoryRecord 同形；live 面 = GET
   *  /api/teams/{id}/agents/{aid}/memories）。agentId 过滤由消费面做。 */
  memories?: MemoryRecord[];
  /** 团队密钥记录（shared SecretRecord 同形；live 面 = GET
   *  /api/teams/{id}/secrets）。消费面 = Agent 详情的密钥区（#510：授权粒度
   *  是全有全无，该区只要 id 集与「有没有密钥」两件事）。密钥 route 自身
   *  的 fixture 面保持 r7 10 空态字节不变，不读本字段。 */
  secrets?: SecretRecord[];
}

/** Inline text run inside a plan-document block; `code` renders the
 *  monospace chip (r7 17: `tail -n 3 README.md` style). */
/** Inline text run inside a plan-document block: plain text, the
 *  monospace chip (r7 17: `tail -n 3 README.md` style), the blue
 *  file/commit reference span (r8 56: `README.md`, `2f47b62`) or a
 *  mention chip carrying the entity kind (issue #311, spec 08 附录 A
 *  档 2: agent / todo / skill / project / machine — the picker emits
 *  `[name](<kind>:<id>)` and the renderer parses it back into a chip
 *  with the kind-driven accent color). */
export interface DocSegment {
  text: string;
  /** `strong` = `**bold**` run (#650 — the #311-era "no bold slot" ruling is
   *  reversed by the chief-drawer markdown ticket; the inline layer now emits
   *  bold runs instead of stripping the markers). */
  style?: 'code' | 'link' | 'mention' | 'strong';
  /** Mention chip kind — required when style is 'mention'. */
  mentionKind?: 'todo' | 'skill' | 'agent' | 'project' | 'machine';
  /** Canonical entity id from the wire link (`[label](kind:id)`), set on
   *  every mention segment (#675). The todo chip consumes it for click
   *  navigation to `/app/todo/<id>` — the reference-measured behavior
   *  (todos.dev todo chip click → todo detail, live-captured 2026-10-03). */
  mentionId?: string;
}

/** One plan-document block: free paragraph, bullet (r7 17 doc pane) or
 *  markdown heading (r8 56: Context / 假设 / Changes / Verification). */
export interface DocBlock {
  kind: 'para' | 'bullet' | 'head';
  segments: DocSegment[];
}

/** Transcript row kinds observed in the r7 detail captures (16/17/26/27/
 *  28/36/38). CONTEXT.md canon: the message flow is `transcript`, not
 *  stream. */
export type TranscriptItem =
  /** Run stamp: time line + `运行在 <machine> 上` line, centered. The
   *  reused-plan build (r8 76) splits the two lines around the quoted
   *  plan card, so each half is optional. `cancelled` = 停止钮中断的运行行
   *  终态「已取消」（M7 #308，r9 §3.3；live 面 step.status 'stopped' 派生，
   *  fixture 捕获面无此态）。 */
  | { kind: 'run'; at?: string; machine?: string; cancelled?: boolean }
  /** User bubble (`开始执行任务` / `确认`); the taskline chip + title ride
   *  along only on the task-start bubble (r7 26: the 确认 bubble renders
   *  bubble + icon pair alone). #612: a real user turn may carry its raw
   *  text in `markdown` (the robot row's #469 pattern) — the renderer
   *  parses it with chat-markdown at render time; the frozen capture
   *  shapes (text-only) render unchanged. */
  | {
      kind: 'user';
      text: string;
      seq?: number;
      title?: string;
      markdown?: string;
      /** #1009 A2 行 id 贯通：live 面源 message id（React key +
       *  MessageScroller messageId 锚）；fixture 捕获形与合成行缺省。 */
      id?: string;
    }
  /** Agent prose: one or more paragraphs of inline segments (r7 36 merge
   *  row, r7 38 legacy rows). `footer` renders the message action row
   *  (copy + optional `| 完成 Ns` + optional `›`, r8 60/65); paragraph
   *  kinds carry the r8 quote/ordinal/bullet forms.
   *  #469: an agent reply may instead carry raw block markdown in
   *  `markdown` — headings / ordered+unordered lists (nested) / code
   *  fences — parsed to blocks at render time (chat-markdown.tsx). When
   *  `markdown` is present it takes precedence over `paragraphs`, so the
   *  frozen capture shapes (paragraph-only) render unchanged. */
  | {
      kind: 'robot';
      /** Object form carries the r8 quote/ordinal/bullet paragraph
       *  kinds; the plain segment-array form is the r7 prose shape.
       *  Optional — markdown replies (#469) carry `markdown` instead. */
      paragraphs?: (RobotPara | DocSegment[])[];
      /** Raw block markdown of the reply (#469). Parsed by the transcript
       *  renderer, not the mapper, so the fixture surface exercises the
       *  same parse+render path as live (spec-block.tsx precedent). */
      markdown?: string;
      footer?: RobotFooter;
      /** #1009 A2 行 id 贯通（user 行同注）：live 面源 message id。 */
      id?: string;
    }
  /** Live planning/execution row: elapsed seconds + step label (r7 16
   *  `准备工作区...`, r7 26 `处理中...`, r7 26d `调用工具：bash …`).
   *  Two time sources, one honest rule (#873): `startedAt` = the live row's
   *  real start stamp — the row ticks `Ns` itself so the count never freezes
   *  between re-renders; `seconds` = a frozen capture value (fixture
   *  surfaces only). Neither = the #471 quiescent variant (the building
   *  gap's live cue, spinner + static 执行中... label, no counter at all —
   *  never a stale number). The capture's trailing `›` now renders only
   *  where the row has a panel behind it (#634「形必须带义」, the detail twin
   *  of #822): live rows disclose the running step, capture rows carry none. */
  | {
      kind: 'streaming';
      seconds?: number;
      startedAt?: number;
      label: string;
      /** #905：label 的 t() 插值参数（`正在执行工具：{n}` 的工具名等）。 */
      labelVars?: Record<string, string | number>;
      /** #905：最近一次活动相位信号的 server 盖章时刻——披露面「最近信号
       *  Ns 前」的走表起点。缺省 = 无活动信号（fixture 捕获 / 旧 server /
       *  静默窗口），该行不渲染（#471：缺席的数，不是冻结的数）。 */
      signalAt?: number;
      /** #918：本步累计技能事实（activity 事件随行，mapper 已按在跑步 stepId
       *  过滤）——披露面逐条渲染 `▶ skill: <名>`（denied = `✕ …（已挡下）`）。
       *  缺省/空 = 本步尚无技能命中，不产任何条目（对照组）。 */
      skills?: SkillFact[];
    }
  /** #918 技能事实汇总行（详情页的持久一份）：从落库 toolcall 行派生
   *  （分类单源 shared/skill-facts，与活行判定永不漂移），read = 读到的
   *  技能名（首见序），denied = 被挡下的（同名 denied 粘滞，两列互斥）。
   *  两列全空 = 不产本条目（无技能命中的任务零噪声）。 */
  | { kind: 'skills'; read: string[]; denied: string[] }
  /** #1106 注入选择回查行（票面验收 4「选择过程在任务详情面可查」）：本
   *  build 各步 claim 落库的 skillInjection 汇总——技能 id 首见序，reason =
   *  服务端规则命中的原因原文（含规则与关键词）。skills = [] = 已计算零
   *  命中（零注入是可查事实，不是故障）。任一步有记录即产本行（live 派生
   *  面；fixture 捕获面无 step 数据源，恒不出现）。 */
  | { kind: 'injected-skills'; skills: { id: string; reason: string }[] }
  /** Collapsed plan card: `方案 · v1` row, clamped preview, action row
   *  `完成 Ns` (r7 17). `seconds` absent renders the bare `完成`
   *  (reused-plan card, r8 76). The r8 captures' trailing `›` is gone:
   *  re-measured 2026-10-02 the reference footer chevron only ever exists
   *  as a tool-group expander, and a plan card has no group (#634 follow-up). */
  | { kind: 'plan'; title: string; preview: string; seconds?: number }
  /** Tool-call group of a finished run: collapsed = `完成 Ns ▸` single row
   *  (r7 27/36); expanded = `完成 Ns ▾` + one pill per tool call + the
   *  `收起 ^` link (r7 28). #469: `outputs[i]` carries the stdout/stderr of
   *  `pills[i]` (index-aligned; null/absent = that call produced no output
   *  to show). Each non-empty output renders as its own left-aligned mono
   *  block under its pill — terminal content no longer flattens into the
   *  centered dim `.chat-note`. */
  | {
      kind: 'tools';
      seconds: number;
      expanded: boolean;
      pills: string[];
      outputs?: (string | null)[];
    }
  /** Bare elapsed row: `完成 Ns` action row (r7 36 merge round, r7 38
   *  legacy card). */
  | { kind: 'elapsed'; seconds: number }
  /** Centered dim line: a bare time stamp (`13:35`, r7 26), the merge
   *  announcement (`Xmon Dai 发起了合并`, r7 36) or the completion banner
   *  (`🎉 任务已完成`, r7 36). */
  | {
      kind: 'note';
      text: string;
      /** #1009 A2 行 id 贯通（user 行同注）：live 面源 message id。 */
      id?: string;
    }
  /** Schedule-origin marker: clock glyph + `由定时发起`, left aligned
   *  (r7 38, 02 §9.2 闭环语义). */
  | { kind: 'scheduled' }
  /** Chief-origin marker: avatar + `由总管发起` (r8 54, chief-launched
   *  build; the schedule twin is `scheduled`). */
  | { kind: 'chief' }
  /** Failed-run message: orange title line + body line + link row
   *  (`查看原始错误` / `排查指南`, r8 54/73, r5 §7 canon). */
  | { kind: 'fail'; title: string; body: string; links: string[] }
  /** AI 审核消息（M7 #330，r8 §3.1 60）：结论段 + 编号 findings 列表
   * （每条 = 严重度标签 + 标题 + 描述 + 文件:行 + 可选建议）。服务侧 emit
   * 由 server applyBuildStepAction completeStep 落库（REVIEW_VERDICT_KIND
   * system message），web mapper 拆出 verdict 形状渲染。#700：extractionError
   * 在位 = daemon verdict 提取失败（findingsError 原因）——审核面渲染
   * 「判定提取失败」行（区别于「审核未返回结论」兜底）。 */
  | {
      kind: 'review';
      conclusion: string;
      findings: ReviewFinding[];
      extractionError?: string;
      /** #1009 A2 行 id 贯通（user 行同注）：live 面源 message id。 */
      id?: string;
    }
  /** 验证步 verdict 行（#1250 / ADR 0018 层 1）：pass/fail 徽标 + 总结 +
   * 证据条目清单（path + 可选注记）——review verdict 行的验证面同族。
   *  dataSource = server VERIFY_VERDICT_KIND 消息解出的 verifyVerdict。 */
  | {
      kind: 'verify';
      passed: boolean;
      conclusion: string;
      evidence: { path: string; note?: string }[];
      extractionError?: string;
      /** #1009 A2 行 id 贯通（user 行同注）：live 面源 message id。 */
      id?: string;
    }
  /** #955 思考段行（详情页与总管抽屉共用同一张脸）：模型内部推理按段单列。 */
  | {
      kind: 'thinking';
      text: string;
      /** #1009 A2 行 id 贯通（user 行同注）：live 面源 message id。 */
      id?: string;
    };

/** AI 审核 finding 显示形态（M7 #330，r8 §3.1）：严重度 + 标题 + 描述 +
 * 引用位（文件:行）+ 可选建议。dataSource = server verdict message 解出
 * 的 reviewVerdictSchema.findings。 */
export interface ReviewFinding {
  id: string;
  severity: 'blocking' | 'suggestion' | 'info';
  summary: string;
  description?: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

/** One paragraph of a robot message (r7 prose; r8 adds the AI-review
 *  quote block and numbered finding rows, r8 60/65). */
export interface RobotPara {
  segments: DocSegment[];
  /** Indented tinted block with a left border (r8 65 review quote). */
  quote?: boolean;
  /** Numbered-list ordinal rendered as a hanging `N.` (r8 65 findings). */
  ordinal?: number;
  /** `• ` bullet marker (r8 54 result message). */
  bullet?: boolean;
}

/** Message action row payload (r8 60/65): copy + optional `| 完成 Ns`.
 *  The captures' trailing chevron is not part of the payload anymore: it
 *  renders only where a tool group gives it something to expand (#634
 *  follow-up, re-measured against the live reference). The restore glyph
 *  the captures show beside the copy is likewise not part of the payload:
 *  this product has no build-level rewind object surface for it (#884). */
export interface RobotFooter {
  seconds?: number;
}

/** One changed file in the diff pane (r7 27/27b): collapsed = file row
 *  only; expanded = unified-diff hunks below it. */
export interface DiffFile {
  path: string;
  /** Added-line count shown right-aligned on the file row (`+1`). */
  added: number;
  /** Removed-line count; absent = the row/stat shows `+N` alone (r7),
   *  present = `+A −B` pair (plan-version diffs, r8 69/71). */
  removed?: number;
  hunks: DiffHunk[];
  /** 全文槽（#225「显示完整文件」）：fixture 面数据源；live 面走
   *  GET /api/builds/{id}/changes/file 按需取（#224），不经本槽。 */
  fullContent?: string;
}

/** Unified-diff hunk: header row (`@@ -3,3 +3,4 @@` + trailing section
 *  text, r7 27b) plus numbered lines. */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  /** context/add = r7 27b; del = the `−` row of plan-version diffs
   *  (r8 72); marker = the gutter-less `\ No newline at end of file`. */
  kind: 'context' | 'add' | 'del' | 'marker';
  text: string;
  /** Line numbers per side; the add row leaves `oldNo` blank (r7 27b
   *  gutter). */
  oldNo?: number;
  newNo?: number;
}

/** The 变更 document set behind the diff pane (r7 27/27b/36): header
 *  `变更▾ v1▾ · N 个文件改动 +N` (counts derived from `files`), one row
 *  per file, hunks rendered when `expanded`. */
export interface ChangesContent {
  files: DiffFile[];
  /** Capture-state flag: 27/36 collapsed, 27b/28 expanded. */
  expanded: boolean;
}

/** Detail-route content of a scenario (issue #56, extended in #57). */
export interface DetailContent {
  /** Transcript rows, top to bottom. */
  transcript: TranscriptItem[];
  /** Plan document for the left pane; absent = `暂无方案` placeholder. */
  doc?: DocBlock[];
  /** 变更 pane data; absent = the centered `暂无可显示的变更` placeholder
   *  (r7 38 legacy card). Only consulted in changes mode. */
  changes?: ChangesContent;
  /** User-menu popover rendered over the sidebar (r7 17 / 16d / 26d /
   *  27d captures). */
  userMenuOpen?: boolean;
  /** Version dropdown rows under the doc-pane version chip, newest
   *  first (r8 63/70); absent = the chip renders the plain v1 select. */
  planVersions?: PlanVersion[];
  /** Capture-state open menu on the version chip (r8 63/64). */
  versionMenu?: 'versions' | 'compare';
  /** Plan-version diff surface replacing the plan markdown (r8 65–72). */
  planDiff?: PlanDiffContent;
  /** Diff the compare submenu's 上一版本 opens (r8 64 → 65, 70 → 71). */
  compareTarget?: PlanDiffContent;
  /** Interactive reject-loop script (issue #75 AC3). */
  revision?: RevisionStep;
}

/** One row of the version dropdown under the doc-pane version chip
 *  (r8 63/70): version word + relative age from the fixture instant. */
export interface PlanVersion {
  v: string;
  /** Version landing instant; the label is `relativeTime(at, now)`. */
  at: number;
}

/** The plan-version diff surface of the doc pane (r8 65–72): range chip
 *  `v1 → v2`, file-level unified diff of plan.md. */
export interface PlanDiffContent {
  from: string;
  to: string;
  files: DiffFile[];
  expanded: boolean;
}

/** Client-side reject-loop script (issue #75 AC3): what the composer send
 *  walks through on a confirm surface — revision streaming (r8 67), then
 *  the next plan version landing (r8 68 family). */
export interface RevisionStep {
  /** User bubble text the send produces. */
  feedback: string;
  /** Streaming row while the replan runs (r8 67). */
  streaming: { seconds: number; label: string };
  /** Doc-pane diff left open during the replan (r8 67 keeps v1→v2 up). */
  planDiff?: PlanDiffContent;
  /** State once the new version lands: chip back to 确认. */
  landed: {
    planVersions: PlanVersion[];
    doc: DocBlock[];
    transcriptTail: TranscriptItem[];
    /** Diff the 上一版本 submenu entry resolves to (r8 65). */
    planDiff: PlanDiffContent;
  };
}

// ── Chief surface (issue #72) ────────────────────────────────────────────
// r5 §2/§3.6 canon: the 总管 panel is a right-anchored drawer over the
// board; the 设置 gear swaps the whole content area to the 总管设置 view
// (4 tabs). Captures 100–104 (unbound) + 111/114/116 (bound) supply the
// static copy below.

/** Hero example card of a fresh thread (r5 100/111 2×2 grid). */
export interface ChiefExample {
  /** Traced glyph per card position (r5 100 crops). */
  icon: 'user-plus' | 'folder' | 'grid' | 'bars';
  text: string;
}

/** Inline run inside a chief stream paragraph; `todo`/`agent` render the
 *  entity chips (r5 114: `#11` indigo chip, `r5-scribe` gray chip). */
export interface ChiefSegment {
  text: string;
  code?: boolean;
  todo?: number;
  agent?: string;
  /** Bold lead-in of a bullet (r5 116 `README.md:` row heads). */
  strong?: boolean;
}

/** One row of the chief message flow (r5 114/116, r3 §3.6 roles). */
export type ChiefStreamItem =
  /** Centered dim stamp (`17:26`) or machine line (`运行在 … 上`, the
   *  machine name underlined per r5 114 — `machineName` carries it). */
  | { kind: 'note'; text: string; machineName?: string }
  /** 回合失败行（#631）：server 落的 chief_turn_error system 行投影——
   *  居中 danger 色提示 + 失败原因原文（live 面单源 = api/mappers
   *  mapChiefStream；fixture 面无此行——失败场景走 live 验证）。 */
  | { kind: 'error'; text: string }
  /** #1049 问答卡行：chief ask_user 提问的投影（live 面单源 = api/mappers
   *  collectChiefStream 的 askUserQuestionContentOf 分支；fixture 面无此行
   *  ——问答是 live 交互场景，捕获面不构造）。pending 期可答可取消；答毕/
   *  取消后只读翻面。`id` = 源 chief_message id（= requestId，答题端点位）。 */
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
  /** User bubble with avatar + the copy/restore icon pair below it.
   *  `id` = live 面 chief_message id（#615 返工恢复钮的 rewind 锚；fixture
   *  面缺省 = 确认层 accept 律关窗，零请求）。#742: a live user row may
   *  carry its raw text in `markdown` (detail-page user row #612 同款配方)
   *  — the renderer parses it with chat-markdown at render time, so the
   *  user's own mentions/markdown no longer leak as literal text; the
   *  frozen capture shapes (text-only) render unchanged. */
  | { kind: 'user'; text: string; id?: string; markdown?: string }
  /** Chief prose paragraphs + optional bullets + the `完成 Ns ›` footer
   *  row (r5 116 verification report). `tools` = 该回合的工具调用行（#615
   *  返工：foot 折叠箭头展开面；live = chief_message 的 toolcall 行投影，
   *  r5 114 捕获时折叠态未展开，fixture 行内容 [推断] 自回执文本）。
   *  #650: a live reply instead carries its raw text in `markdown` — parsed
   *  with the shared chat-markdown blocks at render time (transcript robot
   *  row #469 同律). When present it takes precedence over `paragraphs`, so
   *  the frozen capture shapes (segment arrays) render unchanged.
   *  #651: `typing` = live 打字面尾行（text_delta 缓冲投影）——无 foot
   *  （复制/完成/折叠皆属定稿行），终稿 message 落库即收敛退场。 */
  | {
      kind: 'robot';
      paragraphs?: ChiefSegment[][];
      bullets?: ChiefSegment[][];
      markdown?: string;
      typing?: boolean;
      seconds: string;
      tools?: ChiefToolRow[];
      /** #1009 A1 行 id 贯通：live 面源 chief_message id（React key +
       *  MessageScroller messageId 锚）；fixture 面与打字中尾行缺省。 */
      id?: string;
    }
  /** #739 在飞存在行：回合在飞（activeRun 非空）但还没有任何 text_delta 到达
   *  的静默窗口里，stream 尾挂此行——与详情页对话区 streaming 行同一套词汇
   *  （loading-dev Atom spinner + `处理中...` 标签，transcript.tsx 正典）。
   *  `seconds` 缺省 = 不挂秒数（#471 律：静默期没有流事件驱动重渲，秒数计数
   *  会冻结说谎；本票不加计时器）。label 走渲染层 t()。fixture 捕获面从不
   *  置 running，故既有捕获不会长出此行（零请求保证不破）。
   *  #822：`tools` = 本轮已落库但尚未归属的工具行（user 行之后的 toolcall 投
   *  影，#615 robot 行 tools 折叠同族语义）——展开面工具表的数据源；缺省 =
   *  本轮暂无工具调用，面板走 fallback 行。 */
  /** #955 段行（思考）：模型内部推理按段单列一行——折叠态一行预览、展开看
   *  全文（形态照 Multica 的 ThinkingRow）。默认折叠：思考是过程不是结论。 */
  | {
      kind: 'thinking';
      text: string;
      /** #1009 A1 行 id 贯通（robot 行同注）：live 面源 chief_message id。 */
      id?: string;
    }
  /** #955 段行（工具，仅流式期）：`activeRun` 在飞时工具行平铺进主呈现、与
   *  文本段按序交错；`running` 位 = 该次调用尚无结果（进行中，渲染层走表补
   *  秒数）。回合收口后不再产出此类行——工具退回 robot 行的 `tools` 折叠面
   *  （r5 canon 的落库形）。 */
  | {
      kind: 'tool';
      /** 行文本 = `pillOf(call)` 的产物（`bash <命令>` 族），与折叠面的
       *  `ChiefToolRow.label` 同一份投影——两处都只写工具名的话，在飞与收口
       *  两个形态会各差一截信息。 */
      label: string;
      /** 调用起点（进行中秒数的锚；缺省不挂秒数——#471 律）。 */
      startedAt?: number;
      /** 已完结调用的执行秒数（startedAt/endedAt 投影）。 */
      seconds?: number;
      running?: boolean;
      error?: boolean;
      /** #1009 A1 行 id 贯通（robot 行同注）：live 面源 chief_message id。 */
      id?: string;
    }
  | {
      kind: 'streaming';
      seconds?: number;
      label: string;
      tools?: ChiefToolRow[];
      /** #905：详情页 streaming 行同族位——label 插值参数 + 活动信号时刻。 */
      labelVars?: Record<string, string | number>;
      signalAt?: number;
    };

/** 回合工具行（#615 返工折叠展开面；ToolCallRecord 的呈现投影）。 */
export interface ChiefToolRow {
  /** 行文本 = `pillOf(call)` 的产物，**不是裸工具名**——`bash <命令>` /
   *  `edit <路径>` 族（mappers.ts 单源，与详情页工具 pill 同一份投影）。
   *  只写工具名会让「一排 Bash」读不出到底跑了什么。 */
  label: string;
  /** 执行秒数（startedAt/endedAt 投影；缺省不呈现）。 */
  seconds?: number;
  /** isError 投影（行尾错误徽标）。 */
  error?: boolean;
}

/** Thread row of the header switcher popover (r5 116). */
export interface ChiefThreadRef {
  title: string;
  /** True on the row the drawer currently shows. */
  active?: boolean;
}

export type ChiefSettingsTab = 'agent' | 'charter' | 'memory' | 'watches';

/** 压缩模型选择器行最小投影（#358，spec 11 §A10；#770 起 live = model-sources
 *  非 pi 段，api/mappers.ts `toModelOptions` 单源；fixture = canon 单行）。
 *  `provider` 位 = PATCH 值槽的 provider 归属（runtime 词表值 `claude-code`；
 *  存量 custom providerId 只出现在旧值回显，不再是候选）。 */
export interface ModelOption {
  provider: string;
  /** 显示用来源名（r5 §2 捕获行 `r3-gw · 128k` 徽标位；runtime 段 =
   *  品牌名 `Claude Code`，不译）。 */
  providerLabel: string;
  modelId: string;
  modelName: string;
}

/** The chief surface a scenario renders. `view: 'drawer'` opens the floating
 *  window (ADR 0013; the #447 / ADR 0004 docked column is retired);
 *  `view: 'settings'` replaces the content area (r5 101–104); `view: 'none'`
 *  (A0, #1009) = the minimized face — the capture form of FAB-only surfaces
 *  now that window and FAB are mutually exclusive (D4). */
export interface ChiefContent {
  view: 'drawer' | 'settings' | 'none';
  /** Settings tab rendered when `view: 'settings'`. */
  tab?: ChiefSettingsTab;
  /** Agent bound to the chief: hides the gate bar, fills the model slot
   *  and swaps the header icon set (r5 100 vs 111/114). */
  bound: boolean;
  /** #204 压缩模型槽值(settings Agent tab 选择器回显位,wire 形随 server
   *  #203);缺省/null = 默认（与 Chief 相同）。 */
  compactionModel?: { provider: string; modelId: string } | null;
  /** #895 主力机槽值（settings Agent tab 机器选择器回显位；live = GET
   *  chief 封套 chief.machineId 投影）。缺省/null = 自动；值 = resources
   *  machines 行 id（命中行集才回显机器名，悬空 = 裸串回显）。 */
  machineId?: string | null;
  /** Model slot line when bound (`claude-sonnet-5 · 默认`); `n/a` else. */
  modelSlot?: string;
  /** #444 绑定 Agent 的头像位（总管 FAB 图标源）：语义走 Avatar 原语
   *  （avatarUrl 非空覆盖优先，null = dicebear 按 displayName 种子生成）。
   *  absent = 未绑定（或数据未到位），FAB 保持静态字形。live 面由 mapChief
   *  从 GET chief 封套的 agentActor 投影，不新增请求。 */
  agent?: { id?: string; displayName: string; avatarUrl: string | null };
  /** #615 返工：模型行首 = 运行时标记（用户裁决：要运行时 SVG 不要 Agent
   *  头像）。值 = 生效模型的 provider 位（覆盖槽优先，回退绑定 Agent）；
   *  'claude-code' = Claude Code 运行时，其余（custom provider / 缺省）= pi
   *  运行时。absent = fixture 未录 provider 位，按 pi 正典呈现（r5 111）。 */
  modelProvider?: string | null;
  /** Header thread-chip label (`新主题` on a fresh thread). */
  threadTitle: string;
  /** Switcher popover open over the drawer (r5 116). */
  threadsOpen?: boolean;
  threads?: ChiefThreadRef[];
  /** Hero grid of a fresh thread; absent on a thread view. */
  examples?: ChiefExample[];
  /** Composer draft text (r5 100/111 persisted draft). */
  draft?: string;
  /** Message flow of an existing thread (r5 114/116). */
  stream?: ChiefStreamItem[];
  /** #624 回合进行中（r5 113 流式面）：live = 活动线程 `activeRun` 非空的
   *  投影（api/mappers.ts mapChief 单点判在位，开放形状不读字段）；fixture =
   *  静态表达同一状态。true = composer 占位切 steer canon（shared
   *  CHIEF_INPUT_PLACEHOLDER_STEERING）；缺省 = 空闲 canon。 */
  running?: boolean;
  /** #822 在飞存在行展开面首行：活动线程 `activeRun.tool.toolName` 的投影
   *  （已有 threads 查询的视图投影，不新增请求）；缺省 = activeRun 无工具
   *  位，面板走 fallback 行。 */
  runningTool?: string;
}
