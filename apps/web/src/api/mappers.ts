import type {
  AgentTodo,
  AgentTodoItem,
  BuildRecord,
  ChiefGetResponse,
  ChiefPendingMessage,
  ChiefThread,
  ChiefTurnErrorContent,
  DocumentDiffFile,
  MachineRecord,
  McpServerRecord,
  ModelSource,
  ModelSourceRuntime,
  SecretRecord,
  SkillRecord,
  StepActivity,
  StepQueueBlocked,
  TokenUsage,
  ToolCallRecord,
  UsageCost,
  ScheduleRecord as WireSchedule,
  TodoRecord as WireTodo,
} from '@cairn/shared';
import {
  ASK_USER_QUESTION_KIND,
  askUserQuestionContentSchema,
  type BackgroundTask,
  BRAND,
  BUILD_FAILURE_ROW_KIND,
  backgroundTaskSchema,
  CHIEF_TURN_ERROR_KIND,
  CONFIRM_ANNOUNCEMENT,
  chiefDigestContentSchema,
  chiefModelFallbackContentSchema,
  chiefModelRestoredContentSchema,
  chiefNoticeContentSchema,
  chiefReportContentSchema,
  chiefTurnErrorContentSchema,
  chiefTurnStoppedContentSchema,
  classifySkillFact,
  classifyStepFailure,
  conversationBranch,
  DONE_ROW,
  derivePlaceholderTitle,
  failureReasonKey,
  GATE_ANNOUNCEMENTS,
  GIT_CREDENTIAL_ROW_KIND,
  INSTALL_PACKAGES_TOOL,
  infoReportMessageSchema,
  isOwnComputerTool,
  liveQuickReplies,
  MODEL_SOURCE_RUNTIME_LABELS,
  orchestratedTodoIdOf,
  orchestratePromptHeadOf,
  PACKAGES_DECLINED,
  PACKAGES_INSTALLED_PREFIX,
  PACKAGES_NOT_ANSWERED,
  PLACEHOLDER_TITLE_FALLBACK,
  PLAN_SECTIONS,
  parseAgentTodoText,
  REQUEST_SECRET_TOOL,
  RETRY_PARKED_MARK,
  REVIEW_VERDICT_KIND,
  RUNNER_OS_LABELS,
  replyQuoteText,
  reportAckContentSchema,
  resolvedBuildPrNumber,
  reviewVerdictSchema,
  reworkNoteWithoutReason,
  runnerOfflineContentSchema,
  runtimeUpdateRequired,
  SECRET_REQUEST_CANCELLED,
  SECRET_REQUEST_SAVED_PREFIX,
  SUGGEST_REPLIES_TOOL_NAME,
  type SystemRow,
  stripAnsiEscapes,
  stripSkillRouteSection,
  stripTurnContext,
  systemRowOf,
  TAKEOVER_HANDED_BACK,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  type TranscriptUserOrigin,
  type TurnErrorKind,
  threadMessageContentSchema,
  threadReportContentSchema,
  todoFromTodoWrite,
  toolResultText,
  toolResultValue,
  transcriptPromptRowId,
  turnErrorKind,
  VERIFY_VERDICT_KIND,
  verifyVerdictSchema,
  WORKSPACE_HOOK_ROW_KIND,
} from '@cairn/shared';
import { relativeTime } from '../board/rel-time.js';
import { threadTurnInFlight } from '../chief/orchestration-inflight.js';
import type {
  BranchInfoContent,
  ChiefContent,
  ChiefContextUsage,
  ChiefStreamItem,
  ChiefToolRow,
  DiffFile,
  DiffLine,
  ApiKeyRecord as DisplayApiKey,
  ScheduleRecord as DisplaySchedule,
  TodoRecord as DisplayTodo,
  DocBlock,
  MachineRow,
  McpRow,
  ModelOption,
  ReviewFinding,
  RunHistoryRow,
  SkillRow,
  TokenUsageContent,
  TranscriptItem,
  UsageCostContent,
  WorkStep,
} from '../fixtures/records.js';
import { dateTimeFormat } from '../lib/date-format.js';
import { inlineSegments } from '../lib/markdown.js';
import { activityLabel } from './activity.js';
import type { MachineProvider } from './claude-accounts.js';
import type { ApiKeyRow, StepRow } from './hooks.js';

const RUNNER_REFUSAL_LABELS: Partial<Record<StepQueueBlocked['kind'], string>> = {
  'sandbox-unavailable': '排队中：{machine} 的任务沙箱未就绪，无法接收任务',
  'runtime-disabled': '排队中：{machine} 上未检测到 {runtime}，安装后重启执行机',
  'model-unavailable': '排队中：{machine} 无法使用这一步的模型——在工作路由里更换模型',
  'local-path': '排队中：本地项目只在它所在的执行机上运行，{machine} 无法运行',
  'machine-retired':
    '排队中：{machine} 已删除或注销，这一步不会改派——重新注册这台执行机，或在工作路由里改派',
  'claude-rate-limited': '排队中：{machine} 的 Claude 被限流，恢复后自动继续',
  'claude-logged-out':
    '排队中：团队暂无可用的 Claude 订阅——在终端运行 claude setup-token，把 token 添加到模型路由',
  'devin-subscription':
    '排队中：团队暂无可用的 Devin 订阅——在已登录 Devin 的电脑上运行 cat ~/.local/share/devin/credentials.toml，把完整输出添加到模型路由',
  'antigravity-subscription':
    '排队中：团队暂无可用的 Antigravity 订阅——在执行机运行 agy acp --login 登录 Google 账号，并在模型路由添加 Antigravity 订阅',
  'account-switched':
    '排队中：Claude 账号已切换，这一步保留旧账号的进度——先停止，再点继续，会用新账号重新开始',
  'coordinator-provider-missing': 'Coordinator 规则使用的服务商「{name}」尚未添加',
  'coordinator-provider-no-key': 'Coordinator 规则用的服务商「{name}」没有 API key',
  'no-computer':
    '排队中：信息卡要在 Coordinator 的电脑里运行，团队暂无可用的电脑（需要 macOS 26 以上的 Apple 芯片 Mac，并开启 Linux 虚拟机）',
};

const UNNAMED_RUNNER_REFUSAL_LABELS: Partial<Record<StepQueueBlocked['kind'], string>> = {
  'sandbox-unavailable': '排队中：执行机的任务沙箱未就绪，无法接收任务',
  'runtime-disabled': '排队中：执行机上未检测到 {runtime}，安装后重启执行机',
  'model-unavailable': '排队中：执行机无法使用这一步的模型——在工作路由里更换模型',
  'local-path': '排队中：本地项目只在它所在的执行机上运行，这台执行机无法运行',
  'machine-retired':
    '排队中：这一步绑定的执行机已删除或注销，不会改派到其他执行机——重新注册那台执行机，或在工作路由里改派',
  'claude-rate-limited': '排队中：执行机上的 Claude 被限流，恢复后自动继续',
  'claude-logged-out':
    '排队中：团队暂无可用的 Claude 订阅——在终端运行 claude setup-token，把 token 添加到模型路由',
  'devin-subscription':
    '排队中：团队暂无可用的 Devin 订阅——在已登录 Devin 的电脑上运行 cat ~/.local/share/devin/credentials.toml，把完整输出添加到模型路由',
  'antigravity-subscription':
    '排队中：团队暂无可用的 Antigravity 订阅——在执行机运行 agy acp --login 登录 Google 账号，并在模型路由添加 Antigravity 订阅',
};

function queueLabel(queue: NonNullable<StepRow['queue']>): {
  label: string;
  vars: Record<string, string | number>;
} | null {
  if (queue.hold != null) {
    return {
      label: '等额度：模型额度用尽，挂起等待恢复（下次尝试 {time}）',
      vars: { time: clockTime(queue.hold.retryAt) },
    };
  }
  const blocked = queue.blocked;
  if (blocked === undefined || blocked.kind === 'machine-offline') return null;
  if (blocked.kind === 'blocked-by') {
    const titles = blocked.missing;
    if (titles.length === 1) return { label: '等「{title}」', vars: { title: titles[0] ?? '' } };
    if (titles.length > 1) return { label: '等 {n} 个任务', vars: { n: titles.length } };
    return { label: '等前置任务完成。', vars: {} };
  }
  if (blocked.kind === 'capability-missing') {
    return blocked.platform !== undefined && queue.waitingFor == null
      ? {
          label: '排队中：暂无 {platform} 执行机 · 需要 {platform}',
          vars: { platform: RUNNER_OS_LABELS[blocked.platform] },
        }
      : {
          label: '排队中：没有执行机满足能力要求（缺 {missing}）——装齐后下一拍心跳即解锁',
          vars: { missing: blocked.missing.join('、') },
        };
  }
  const refusal =
    (queue.waitingFor == null ? UNNAMED_RUNNER_REFUSAL_LABELS[blocked.kind] : undefined) ??
    RUNNER_REFUSAL_LABELS[blocked.kind];
  if (refusal === undefined) return null;
  return {
    label: refusal,
    vars: {
      machine: queue.waitingFor?.name ?? '',
      runtime: blocked.missing.join('、'),
      name: blocked.missing.join('、'),
    },
  };
}

function connectingLine(queue: NonNullable<StepRow['queue']>): {
  label: string;
  vars?: Record<string, string | number>;
  blocked: boolean;
} {
  const reason = queueLabel(queue);
  if (reason !== null) return { ...reason, blocked: queue.blocked != null };
  return queue.waitingFor != null
    ? { label: '正在连接 {machine}...', vars: { machine: queue.waitingFor.name }, blocked: false }
    : { label: '处理中...', blocked: false };
}

function quotaWaitLabel(q: NonNullable<StepRow['quotaWait']>): {
  label: string;
  vars: Record<string, string | number>;
} {
  return {
    label: '等额度：{lane} {kind}，{probe} 自动探测后继续运行',
    vars: {
      lane: q.label ?? q.providerId,
      kind: q.kind === 'quota' ? '额度空' : '限流',
      probe: clockTime(q.probeAt),
    },
  };
}

export interface MessageRow {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  createdAt: number;
  actor?: string | null;
  origin?: TranscriptUserOrigin | null;
  projectId?: string | null;
}

function rowProject(row: MessageRow): { projectId?: string | null } {
  return row.projectId === undefined ? {} : { projectId: row.projectId };
}

function lastWorkAt(items: readonly TranscriptItem[]): number | null {
  const last = items.at(-1);
  return last?.kind === 'work' ? (last.createdAt ?? Number.NEGATIVE_INFINITY) : null;
}

const CD_PREFIX = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/;

export function shownTaskTitle(title: string, ownerWords?: string): string {
  if (replyQuoteText(title) === title) return title;
  return (
    derivePlaceholderTitle(ownerWords ?? '') ||
    derivePlaceholderTitle(title) ||
    PLACEHOLDER_TITLE_FALLBACK
  );
}

export function threadContextOf(source: unknown): ChiefContextUsage | null {
  if (source == null || typeof source !== 'object') return null;
  const context = (source as { context?: unknown }).context;
  if (context == null || typeof context !== 'object') return null;
  const { tokens, contextWindow, compactAt, resumeExpiresAt, cache } = context as {
    tokens?: unknown;
    contextWindow?: unknown;
    compactAt?: unknown;
    resumeExpiresAt?: unknown;
    cache?: ChiefContextUsage['cache'];
  };
  if (typeof tokens !== 'number' || typeof contextWindow !== 'number') return null;
  if (!Number.isFinite(tokens) || !Number.isFinite(contextWindow) || contextWindow <= 0)
    return null;
  return {
    tokens,
    contextWindow,
    ...(typeof compactAt === 'number' && Number.isFinite(compactAt) && compactAt > 0
      ? { compactAt }
      : {}),
    ...(typeof resumeExpiresAt === 'number' && Number.isFinite(resumeExpiresAt)
      ? { resumeExpiresAt }
      : {}),
    ...(cache != null ? { cache } : {}),
  };
}

export function toDisplayTodo(w: WireTodo): DisplayTodo {
  return {
    id: w.id,
    teamId: w.teamId,
    projectId: w.projectId,
    title: shownTaskTitle(
      w.title,
      w.request?.segments[0]?.context?.messages.find((message) => message.role === 'user')?.text ??
        w.request?.segments[0]?.text,
    ),
    spec: w.spec,
    ...(w.request !== undefined ? { request: w.request } : {}),
    phase: w.phase,
    phaseAt: w.phaseAt,
    archivedAt: w.archivedAt ?? null,
    seqNum: w.seqNum,
    orderIndex: w.orderIndex,
    githubLabelIds: w.githubLabelIds ?? [],
    assignment: null,
    agent: null,
    latestBuildId: w.latestBuildId,
    lastRunAt: w.lastRunAt,
    hasChanges: w.hasChanges,
    hasPlan: w.hasPlan,
    buildHistory: w.buildHistory,
    sourceTodo: w.sourceTodo,
    ...(w.blockedBy != null && w.blockedBy.length > 0 ? { blockedBy: w.blockedBy } : {}),
    v: w.v,
    chiefCreated: w.sourceBuildId !== null,
    waitingOn: w.waitingOn ?? undefined,
    quotaWait: w.quotaWait ?? null,
    sourceKind: w.sourceKind,
    sourceRef: w.sourceRef,
    usageCost: w.usageCost,
    context: threadContextOf(w),
    owner: w.owner,
    output: w.output,
    section: w.section ?? null,
    ...(w.verified !== undefined ? { verified: w.verified } : {}),
    ...(w.deliverables !== undefined
      ? {
          deliverables: w.deliverables,
          ...(w.deliverables.items[0] !== undefined
            ? { madeKind: w.deliverables.items[0].kind }
            : {}),
        }
      : {}),
    ...(w.routeOverride !== undefined ? { routeOverride: w.routeOverride } : {}),
  };
}

export function cacheHitShare(usage: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number | null {
  const total = usage.input + usage.cacheRead + usage.cacheWrite;
  return total === 0 ? null : usage.cacheRead / total;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

export const NO_PRICE_REASON = '无价格来源：模型未声明费率，或该运行未上报费用';

export function formatUsd(n: number): string {
  return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
}

export function usageCostKnown(cost: UsageCost): boolean {
  if (cost.priced === false) return false;
  if (cost.priced === true) return true;
  return cost.total > 0;
}

export function mapUsageCost(cost: UsageCost | undefined): UsageCostContent | null {
  if (cost === undefined || !usageCostKnown(cost)) return null;
  const split = cost.input + cost.output + cost.cacheRead + cost.cacheWrite > 0 || cost.total === 0;
  return {
    total: formatUsd(cost.total),
    cacheRead: split ? formatUsd(cost.cacheRead) : '—',
    input: split ? formatUsd(cost.input + cost.cacheWrite) : '—',
    output: split ? formatUsd(cost.output) : '—',
  };
}

export function clockTime(ms: number): string {
  return dateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms);
}

export function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block !== null && typeof block === 'object') {
          const b = block as { type?: string; text?: string };
          if (b.type === 'text' && typeof b.text === 'string') return b.text;
        }
        return '';
      })
      .join('');
  }
  if (content !== null && typeof content === 'object') {
    const b = content as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') return b.text;
  }
  return '';
}

export function thinkingOfContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  let sawText = false;
  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: string; thinking?: string };
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') sawText = true;
    if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim() !== '') {
      parts.push(b.thinking);
    }
  }
  if (sawText || parts.length === 0) return null;
  return parts.join('');
}

function backgroundTaskOfContent(content: unknown): BackgroundTask | null {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  const c = content as { kind?: string; task?: unknown };
  if (c.kind !== 'bg_task') return null;
  const parsed = backgroundTaskSchema.safeParse(c.task);
  return parsed.success ? parsed.data : null;
}

export function toolCallOfContent(content: unknown): ToolCallRecord | null {
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const c = content as { kind?: string; call?: ToolCallRecord };
    if (c.kind === 'toolcall' && c.call) return c.call;
  }
  return null;
}

function systemKindOf(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content) as { kind?: string };
    return typeof parsed?.kind === 'string' ? parsed.kind : null;
  } catch {
    return null;
  }
}

function reviewVerdictOfContent(
  content: unknown,
): { conclusion: string; findings: ReviewFinding[]; extractionError?: string } | null {
  if (typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: string }).kind !== REVIEW_VERDICT_KIND
  ) {
    return null;
  }
  const verdict = reviewVerdictSchema.safeParse((parsed as { verdict?: unknown }).verdict);
  if (!verdict.success) return null;
  const extractionError = (parsed as { extractionError?: unknown }).extractionError;
  return {
    conclusion: verdict.data.conclusion,
    findings: verdict.data.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      summary: f.summary,
      ...(f.description !== undefined ? { description: f.description } : {}),
      ...(f.file !== undefined ? { file: f.file } : {}),
      ...(f.line !== undefined ? { line: f.line } : {}),
      ...(f.suggestion !== undefined ? { suggestion: f.suggestion } : {}),
    })),
    ...(typeof extractionError === 'string' ? { extractionError } : {}),
  };
}

function verifyVerdictOfContent(content: unknown): {
  passed: boolean;
  conclusion: string;
  evidence: { path: string; note?: string }[];
  extractionError?: string;
} | null {
  if (typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: string }).kind !== VERIFY_VERDICT_KIND
  ) {
    return null;
  }
  const verdict = verifyVerdictSchema.safeParse((parsed as { verdict?: unknown }).verdict);
  if (!verdict.success) return null;
  const extractionError = (parsed as { extractionError?: unknown }).extractionError;
  return {
    passed: verdict.data.passed,
    conclusion: verdict.data.conclusion,
    evidence: verdict.data.evidence.map((e) => ({
      path: e.path,
      ...(e.note !== undefined ? { note: e.note } : {}),
    })),
    ...(typeof extractionError === 'string' ? { extractionError } : {}),
  };
}

export function pillOf(call: ToolCallRecord): string {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const primary =
    typeof args.file_path === 'string'
      ? args.file_path
      : typeof args.path === 'string'
        ? args.path
        : typeof args.command === 'string'
          ? args.command
          : '';
  return primary === '' ? call.name : `${call.name} ${primary}`;
}

function planSectionHead(line: string): { label: string; rest: string } | null {
  const m = /^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s*(.*)$/.exec(line);
  if (m == null) return null;
  const label = m[1]?.trim() ?? '';
  if (!PLAN_SECTIONS.some((s) => s.toLowerCase() === label.toLowerCase())) return null;
  return { label, rest: m[2] ?? '' };
}

export function mapPlanDoc(content: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', segments: inlineSegments(para.join(' ')) });
      para = [];
    }
  };
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    if (line.startsWith('#')) {
      flushPara();
      blocks.push({ kind: 'head', segments: inlineSegments(line.replace(/^#+\s*/, '')) });
      continue;
    }
    const section = planSectionHead(line.trim());
    if (section != null) {
      flushPara();
      blocks.push({ kind: 'head', segments: inlineSegments(section.label) });
      if (section.rest.trim() !== '') para.push(section.rest.trim());
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      flushPara();
      blocks.push({ kind: 'bullet', segments: inlineSegments(line.replace(/^[-*•]\s+/, '')) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

export function mapDiffFiles(files: DocumentDiffFile[]): DiffFile[] {
  return files.map((f) => ({
    path: f.path,
    added: f.additions,
    removed: f.deletions,
    hunks: f.hunks.map((h) => {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(h.header);
      let oldNo = m ? Number(m[1]) : 1;
      let newNo = m ? Number(m[2]) : 1;
      const lines: DiffLine[] = [];
      for (const line of h.lines) {
        if (line.startsWith('\\')) {
          lines.push({ kind: 'marker', text: line.slice(1).trim() });
          continue;
        }
        if (line.startsWith('+')) {
          lines.push({ kind: 'add', text: line.slice(1), newNo });
          newNo += 1;
        } else if (line.startsWith('-')) {
          lines.push({ kind: 'del', text: line.slice(1), oldNo });
          oldNo += 1;
        } else {
          const text = line.startsWith(' ') ? line.slice(1) : line;
          lines.push({ kind: 'context', text, oldNo, newNo });
          oldNo += 1;
          newNo += 1;
        }
      }
      return { header: h.header, lines };
    }),
  }));
}

interface ToolEntry {
  kind: '__work__';
  step: WorkStep;
}

interface TimelineEntry {
  at: number;
  item: TranscriptItem | ToolEntry;
}

export interface TranscriptInput {
  messages: MessageRow[];
  steps: StepRow[];
  build: BuildRecord | null;
  todo: DisplayTodo;
  machineName: string | null;
  userName: string;
  liveText: string;
  liveThinking?: string;
  stopping?: boolean;
  activity?: StepActivity | null;
  agentTodo?: AgentTodo | null;
  pageTodo?: AgentTodoItem[] | null;
  hasEarlier?: boolean;
}

function transcriptHead(
  messages: TranscriptInput['messages'],
  steps: TranscriptInput['steps'],
  build: TranscriptInput['build'],
  machineName: TranscriptInput['machineName'],
): TranscriptItem[] {
  const head: TranscriptItem[] = [];
  if (
    build?.triggerSource === 'schedule' &&
    !messages.some((m) => m.role === 'system' && systemKindOf(m.content) === 'schedule-wake')
  )
    head.push({ kind: 'scheduled' });
  if (build?.triggerSource === 'chief') head.push({ kind: 'chief' });
  if (build) {
    const cancelled = steps.some((s) => s.status === 'stopped');
    head.push({
      kind: 'run',
      at: clockTime(build.createdAt),
      ...(machineName !== null ? { machine: machineName } : {}),
      ...(cancelled ? { cancelled: true } : {}),
    });
  }
  return head;
}

export function mapTranscript(input: TranscriptInput): TranscriptItem[] {
  const {
    messages,
    steps,
    build,
    todo,
    machineName,
    userName,
    liveText,
    liveThinking = '',
    stopping = false,
    activity = null,
    agentTodo = null,
    pageTodo = null,
    hasEarlier = false,
  } = input;
  const head = hasEarlier ? [] : transcriptHead(messages, steps, build, machineName);

  const toolNameByResult = new Map<string, string>();
  for (const m of messages) {
    const paired = toolCallOfContent(m.content);
    if (paired === null) continue;
    const pairedText = toolResultText(paired.result)?.trim();
    if (pairedText !== undefined && pairedText !== '')
      toolNameByResult.set(pairedText, paired.name);
  }

  const backgroundTasks = messages
    .flatMap((m) => {
      const task = backgroundTaskOfContent(m.content);
      return task === null ? [] : [task];
    })
    .sort((a, b) => a.startedAt - b.startedAt);
  const backgroundBySpawn = new Map(
    backgroundTasks.flatMap((task) =>
      task.toolCallId !== undefined ? [[task.toolCallId, task] as const] : [],
    ),
  );
  const childSteps = new Map<string, WorkStep[]>();

  const scheduledStepIds = new Set(
    messages.flatMap((m) => {
      if (m.role !== 'system' || systemKindOf(m.content) !== 'schedule-wake') return [];
      const wake = JSON.parse(m.content as string) as { stepId?: unknown };
      return typeof wake.stepId === 'string' ? [wake.stepId] : [];
    }),
  );
  const promptOrigins = new Map(
    steps.flatMap((s) =>
      s.promptOrigin !== undefined ? [[transcriptPromptRowId(s.id), s.promptOrigin] as const] : [],
    ),
  );
  const stepPromptIds = new Set(steps.map((step) => transcriptPromptRowId(step.id)));
  const claimedSince = steps.find((s) => s.status === 'claimed')?.createdAt ?? null;
  const entries: TimelineEntry[] = [];
  const todoSnapshots: { at: number; order: number; items: AgentTodoItem[] }[] = [];
  let previousAt: number | null = null;
  for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
    const m = messages[msgIndex];
    if (!m) continue;
    const seconds =
      previousAt !== null && m.createdAt > previousAt ? (m.createdAt - previousAt) / 1000 : null;
    previousAt = m.createdAt;
    if (backgroundTaskOfContent(m.content) !== null) continue;
    const call = toolCallOfContent(m.content);
    if (call?.parent !== undefined) {
      const siblings = childSteps.get(call.parent) ?? [];
      siblings.push(
        workCall(call, seconds, claimedSince !== null && m.createdAt >= claimedSince, false),
      );
      childSteps.set(call.parent, siblings);
      continue;
    }
    if (call !== null) {
      const callTodo = call.todo ?? todoFromTodoWrite(call.name, call.arguments);
      if (callTodo !== null && callTodo.length > 0 && call.isError !== true) {
        todoSnapshots.push({ at: m.createdAt, order: msgIndex, items: callTodo });
      }
      if ((call.name === 'TodoWrite' || call.todo !== undefined) && call.isError !== true) continue;
      const owner = steps
        .filter((s) => s.createdAt <= m.createdAt)
        .sort((a, b) => a.createdAt - b.createdAt)
        .at(-1);
      const step = workCall(
        call,
        seconds,
        claimedSince !== null && m.createdAt >= claimedSince,
        owner?.status === 'stopped',
      );
      const spawned = backgroundBySpawn.get(call.id);
      entries.push({
        at: m.createdAt,
        item: {
          kind: '__work__',
          step:
            spawned !== undefined && step.kind === 'call'
              ? { ...step, background: true, description: spawned.description }
              : step,
        },
      });
      continue;
    }
    const ask = m.role === 'assistant' ? askQuestionOfContent(m.content) : null;
    if (ask !== null) {
      entries.push({
        at: m.createdAt,
        item: {
          kind: 'question',
          id: m.id,
          requestId: ask.requestId,
          status: ask.status,
          questions: ask.questions,
          answers: ask.answers,
        },
      });
      continue;
    }
    const text = textOfContent(m.content).trim();
    if (m.role === 'user') {
      if ([...scheduledStepIds].some((id) => m.id === transcriptPromptRowId(id))) continue;
      const origin = promptOrigins.get(m.id);
      if (origin !== undefined) {
        entries.push({
          at: m.createdAt,
          item: { kind: 'step-prompt', id: m.id, origin, raw: text },
        });
        continue;
      }
      if (stepPromptIds.has(m.id)) continue;
      if (GATE_ANNOUNCEMENTS.includes(text)) {
        if (text === CONFIRM_ANNOUNCEMENT && m.actor === SERVER_ACTOR) continue;
        entries.push({
          at: m.createdAt,
          item: {
            kind: 'note',
            text: `{name} ${text}`,
            vars: { name: m.actor ?? userName },
            id: m.id,
          },
        });
        continue;
      }
      if (m.origin === 'task-prompt' || m.origin === 'synthetic') continue;
      entries.push({
        at: m.createdAt,
        item: { kind: 'user', text, markdown: text, id: m.id, createdAt: m.createdAt },
      });
      continue;
    }
    if (m.role === 'system') {
      const row = systemRowOf(m.content);
      if (row !== null) {
        entries.push({ at: m.createdAt, item: systemRowItem(row, m.id, m.createdAt) });
        continue;
      }
      if (m.id.startsWith(RETRY_PARKED_ID_PREFIX) || text.startsWith(RETRY_PARKED_MARK)) {
        entries.push({
          at: m.createdAt,
          item: { ...failItem(text), id: m.id, createdAt: m.createdAt },
        });
        continue;
      }
      if (text.startsWith(REWORK_REUSE_HEAD)) {
        entries.push({
          at: m.createdAt,
          item: { kind: 'note', text: reworkNoteWithoutReason(text), id: m.id },
        });
        continue;
      }
      if (systemKindOf(m.content) !== null) {
        if (systemKindOf(m.content) === 'schedule-wake') {
          const wake = JSON.parse(m.content as string) as { stepId?: unknown };
          if (typeof wake.stepId === 'string')
            entries.push({
              at: m.createdAt,
              item: { kind: 'scheduled', id: m.id, stepId: wake.stepId },
            });
          continue;
        }
        const verdict = reviewVerdictOfContent(m.content);
        if (verdict !== null) {
          entries.push({
            at: m.createdAt,
            item: { kind: 'review', ...verdict, id: m.id, createdAt: m.createdAt },
          });
          continue;
        }
        const report = infoReportMessageSchema.safeParse(JSON.parse(m.content as string));
        if (report.success) {
          entries.push({
            at: m.createdAt,
            item: {
              kind: 'report',
              markdown: report.data.content,
              id: m.id,
              createdAt: m.createdAt,
            },
          });
          continue;
        }
        const verifyVerdict = verifyVerdictOfContent(m.content);
        if (verifyVerdict !== null) {
          entries.push({
            at: m.createdAt,
            item: { kind: 'verify', ...verifyVerdict, id: m.id, createdAt: m.createdAt },
          });
        }
        continue;
      }
      const echoName = toolNameByResult.get(text);
      if (echoName !== undefined) {
        const note = echoNoteOf(echoName);
        if (note !== null)
          entries.push({ at: m.createdAt, item: { kind: 'note', text: note, id: m.id } });
        continue;
      }
      if (isJsonPlumbing(text) || text === DONE_ROW) continue;
      if (text !== '') entries.push({ at: m.createdAt, item: { kind: 'note', text, id: m.id } });
      continue;
    }
    if (text !== '') {
      const textTodo = parseAgentTodoText(text);
      if (textTodo !== null) {
        todoSnapshots.push({ at: m.createdAt, order: msgIndex, items: textTodo });
      }
      entries.push({
        at: m.createdAt,
        item: { kind: 'robot', markdown: text, id: m.id, createdAt: m.createdAt },
      });
      continue;
    }
    const thinking = m.role === 'assistant' ? thinkingOfContent(m.content) : null;
    if (thinking !== null)
      entries.push({
        at: m.createdAt,
        item: { kind: '__work__', step: { kind: 'think', text: thinking, id: m.id, seconds } },
      });
  }

  if (build?.withPlan === true) {
    const confirmations = messages.filter(
      (m) => m.role === 'user' && textOfContent(m.content).trim() === CONFIRM_ANNOUNCEMENT,
    );
    for (const s of steps) {
      const confirmedBy = confirmations.findLast((m) => m.createdAt <= s.createdAt)?.actor;
      if (s.kind === 'build' && !scheduledStepIds.has(s.id) && confirmedBy !== SERVER_ACTOR) {
        entries.push({
          at: s.createdAt,
          item: { kind: 'user', text: '确认', createdAt: s.createdAt },
        });
      }
    }
  }

  const loadedFrom = hasEarlier
    ? (messages[0]?.createdAt ?? Number.POSITIVE_INFINITY)
    : Number.NEGATIVE_INFINITY;
  const loaded = entries.filter((entry) => entry.at >= loadedFrom).sort((a, b) => a.at - b.at);
  const running = steps.find(
    (s) => s.status === 'claimed' || s.status === 'pending' || s.status === 'waiting_quota',
  );
  const items: TranscriptItem[] = [...head];
  const workAhead: boolean[] = [];
  for (let index = loaded.length - 1, ahead = false; index >= 0; index--) {
    const kind = loaded[index]?.item.kind;
    workAhead[index] = ahead;
    if (kind === '__work__') ahead = true;
    else if (kind !== 'robot') ahead = false;
  }
  for (let index = 0; index < loaded.length; index++) {
    const entry = loaded[index];
    if (!entry) continue;
    if (
      entry.item.kind === 'robot' &&
      entry.item.markdown !== undefined &&
      lastWorkAt(items) !== null &&
      (workAhead[index] === true ||
        (running !== undefined &&
          entry.at >= running.createdAt &&
          (lastWorkAt(items) ?? Number.NEGATIVE_INFINITY) >= running.createdAt))
    ) {
      const id = entry.item.id ?? `say-${entry.at}`;
      const say: WorkStep = { kind: 'say', id, text: entry.item.markdown };
      const previous = items.at(-1);
      if (previous?.kind === 'work') {
        previous.steps.push(say);
        previous.createdAt = entry.at;
      } else items.push({ kind: 'work', id, steps: [say], createdAt: entry.at });
      continue;
    }
    if (entry.item.kind === '__work__') {
      const previous = items.at(-1);
      if (previous?.kind === 'work') {
        previous.steps.push(entry.item.step);
        previous.createdAt = entry.at;
      } else {
        items.push({
          kind: 'work',
          id: entry.item.step.id,
          steps: [entry.item.step],
          createdAt: entry.at,
        });
      }
    } else items.push(entry.item);
  }

  const skillReadNames: string[] = [];
  const skillDeniedNames: string[] = [];
  for (const m of messages) {
    const skillCall = toolCallOfContent(m.content);
    if (skillCall === null) continue;
    const fact = classifySkillFact(skillCall);
    if (fact === null) continue;
    const names = fact.denied ? skillDeniedNames : skillReadNames;
    if (!names.includes(fact.name)) names.push(fact.name);
  }
  const readSkills = skillReadNames.filter((n) => !skillDeniedNames.includes(n));
  if (readSkills.length > 0 || skillDeniedNames.length > 0) {
    items.splice(head.length, 0, { kind: 'skills', read: readSkills, denied: skillDeniedNames });
  }

  const persistedTodo =
    todoSnapshots.sort((a, b) => a.at - b.at || a.order - b.order).at(-1)?.items ??
    (pageTodo !== null && pageTodo.length > 0 ? pageTodo : null);
  const liveReply: TranscriptItem | null =
    liveText.trim() === ''
      ? null
      : { kind: 'robot', paragraphs: [{ segments: [{ text: liveText }] }] };
  if (!running && liveReply !== null) items.push(liveReply);
  if (running && build) {
    const act = activity != null && activity.stepId === running.id ? activity : null;
    const runOutput = act?.tokens !== undefined && act.tokens.output > 0 ? act.tokens.output : null;
    if (liveThinking.trim() !== '') {
      const step: WorkStep = {
        kind: 'think',
        id: 'live-thinking',
        text: liveThinking,
        seconds: null,
        running: true,
      };
      const previous = items.at(-1);
      if (previous?.kind === 'work') previous.steps.push(step);
      else items.push({ kind: 'work', id: step.id, steps: [step] });
    }
    const sayTail = items.at(-1);
    const turnWork =
      sayTail?.kind === 'work' &&
      (sayTail.createdAt ?? Number.NEGATIVE_INFINITY) >= running.createdAt
        ? sayTail
        : null;
    const shownReply = turnWork !== null ? null : liveReply;
    if (liveReply !== null && turnWork !== null)
      turnWork.steps.push({ kind: 'say', id: 'live-say', text: liveText });
    const tailWork = items.at(-1);
    const hasActiveTailWork =
      shownReply === null &&
      tailWork?.kind === 'work' &&
      (tailWork.steps.some(
        (step) =>
          (step.kind === 'call' && step.running) ||
          (step.kind === 'think' && step.running === true),
      ) ||
        (tailWork.createdAt ?? Number.NEGATIVE_INFINITY) >= running.createdAt);
    if (hasActiveTailWork && tailWork?.kind === 'work') {
      tailWork.running = true;
      tailWork.startedAt = running.createdAt;
      if (runOutput !== null) tailWork.outputTokens = runOutput;
    }
    if (shownReply !== null) items.push(shownReply);
    const liveTodo = agentTodo != null && agentTodo.stepId === running.id ? agentTodo : null;
    const shownTodo = liveTodo?.items ?? persistedTodo;
    const backgroundRunning = backgroundTasks.filter((task) => task.status === 'running').length;
    const anchor = turnWork ?? (hasActiveTailWork ? tailWork : null);
    const placeAboveWork = (row: TranscriptItem) => {
      const workAt = anchor == null ? -1 : items.indexOf(anchor);
      if (workAt === -1) items.push(row);
      else items.splice(workAt, 0, row);
    };
    if (backgroundRunning > 0)
      placeAboveWork({
        kind: 'bg-tasks',
        buildId: build.id,
        tasks: backgroundTasks
          .filter((task) => task.status === 'running' || (task.endedAt ?? 0) >= running.createdAt)
          .map((task) => ({
            taskId: task.taskId,
            type: task.type,
            description: task.description,
            ...(task.prompt !== undefined ? { prompt: task.prompt } : {}),
            status: task.status,
            startedAt: task.startedAt,
            ...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
            ...(task.toolUses !== undefined ? { toolUses: task.toolUses } : {}),
            steps:
              (task.toolCallId !== undefined ? childSteps.get(task.toolCallId) : undefined) ?? [],
          })),
      });
    if (shownTodo !== null && shownTodo.length > 0)
      placeAboveWork({
        kind: 'agent-todo',
        id: 'agent-todo',
        items: shownTodo,
        ...(backgroundRunning > 0 ? { backgroundRunning } : {}),
      });
    const waiting = running.status === 'pending' && running.queue != null;
    const actLabel = act != null && !stopping && !waiting ? activityLabel(act) : null;
    const queued = waiting && running.queue != null ? queueLabel(running.queue) : null;
    const quota =
      running.status === 'waiting_quota' && running.quotaWait != null
        ? quotaWaitLabel(running.quotaWait)
        : null;
    if (queued != null || quota != null || stopping || !hasActiveTailWork) {
      items.push({
        kind: 'streaming',
        startedAt: running.createdAt,
        ...(runOutput !== null && queued == null && quota == null
          ? { outputTokens: runOutput }
          : {}),
        ...(queued != null && running.queue?.blocked != null
          ? { blocked: true as const, blockedKind: running.queue.blocked.kind }
          : {}),
        label:
          queued != null
            ? queued.label
            : quota != null
              ? quota.label
              : shownReply !== null && !stopping
                ? ''
                : actLabel != null
                  ? actLabel.label
                  : stopping
                    ? '正在停止…'
                    : running.kind === 'plan' && steps.length === 1 && running.status === 'pending'
                      ? '准备工作区...'
                      : '处理中...',
        ...(queued != null
          ? { labelVars: queued.vars }
          : quota != null
            ? { labelVars: quota.vars }
            : actLabel?.vars !== undefined && shownReply === null
              ? { labelVars: actLabel.vars }
              : {}),
      });
    }
  } else if (
    build &&
    todo.phase === 'building' &&
    resolvedBuildPrNumber(build) == null &&
    !steps.some((s) => s.status === 'stopped')
  ) {
    items.push({ kind: 'streaming', label: '执行中...' });
  }

  if (
    build?.errorMessage &&
    todo.phase === 'failed' &&
    !items.some(
      (item) =>
        item.kind === 'fail' &&
        (item.id?.startsWith(RETRY_PARKED_ID_PREFIX) === true ||
          failureReasonKey(item.raw) === failureReasonKey(build.errorMessage ?? '')),
    )
  ) {
    items.push({ ...failItem(build.errorMessage), createdAt: todo.phaseAt });
  }
  if (
    !running &&
    todo.phase !== 'done' &&
    todo.phase !== 'review' &&
    persistedTodo !== null &&
    persistedTodo.length > 0 &&
    persistedTodo.some((it) => it.state !== 'done')
  ) {
    items.push({
      kind: 'agent-todo',
      id: 'agent-todo',
      items: persistedTodo.map((it) =>
        it.state === 'doing' ? { ...it, state: 'todo' as const } : it,
      ),
    });
  }
  const folded: TranscriptItem[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
    folded.push(item);
    if (
      item.kind !== 'scheduled' ||
      !item.stepId ||
      steps.find((s) => s.id === item.stepId)?.status !== 'done'
    )
      continue;
    const turn: TranscriptItem[] = [];
    while (index + 1 < items.length) {
      const next = items[index + 1];
      if (!next || ['user', 'scheduled', 'streaming', 'fail', 'agent-todo'].includes(next.kind))
        break;
      turn.push(next);
      index++;
    }
    folded.push({ kind: 'scheduled-turn', id: `turn-${item.stepId}`, items: turn });
    folded.push({ kind: 'automation-completed', id: `completed-${item.stepId}` });
  }
  return folded;
}

const SERVER_ACTOR = 'server';
const REWORK_REUSE_HEAD = '返工回到本分支继续';

const CREDENTIAL_SOURCE_DETAIL = {
  integration: 'integration：每步下发的 token',
  machine: 'machine：执行机本机的 git 凭据',
} as const;

function systemRowItem(row: SystemRow, id: string, createdAt: number): TranscriptItem | ToolEntry {
  switch (row.kind) {
    case WORKSPACE_HOOK_ROW_KIND:
      return {
        kind: '__work__',
        step: {
          kind: 'call',
          id,
          action: 'setup',
          label: `.agents/${row.name}`,
          description: `.agents/${row.name} hook`,
          output:
            row.output === ''
              ? null
              : row.omittedChars > 0
                ? `${row.output}\n… (${row.omittedChars})`
                : row.output,
          error: row.status !== 'ok',
          running: false,
          unfinished: false,
          seconds: row.ms / 1000,
        },
      };
    case GIT_CREDENTIAL_ROW_KIND:
      return {
        kind: '__work__',
        step: {
          kind: 'call',
          id,
          action: 'setup',
          label: 'git',
          description: 'git 凭据',
          output: CREDENTIAL_SOURCE_DETAIL[row.source],
          localized: true,
          error: false,
          running: false,
          unfinished: false,
          seconds: null,
        },
      };
    case BUILD_FAILURE_ROW_KIND:
      return {
        ...failItem(row.reason),
        id,
        createdAt,
        facts: {
          files: row.fileCount,
          commits: row.commits.map((commit) => commit.slice(0, 9)),
          pr: row.pr?.number ?? null,
        },
      };
  }
}

const RETRY_PARKED_ID_PREFIX = 'retry-parked-';

const FAIL_KIND_LABELS: Partial<Record<ReturnType<typeof classifyStepFailure>, string>> = {
  quota: '模型额度已用尽',
  capacity: '请求被限流',
  network: '连接服务商时中断',
  model_unavailable: '模型不可用',
};

function failLabel(raw: string): { label: string; labelVars?: Record<string, string> } {
  const plain = runtimeUpdatePlain(raw);
  if (plain !== null) return { label: plain.key, labelVars: plain.vars };
  if (raw.startsWith(RETRY_PARKED_MARK)) {
    const retries = /automatic retries exhausted \((\d+)\)/.exec(raw)?.[1];
    if (retries !== undefined)
      return { label: '自动重试 {n} 次后仍失败，已暂停', labelVars: { n: retries } };
    const hourly = /(\d+) failed builds in one hour/.exec(raw)?.[1];
    if (hourly !== undefined)
      return { label: '一小时内失败 {n} 次，已暂停', labelVars: { n: hourly } };
    if (/model unavailable/i.test(raw)) return { label: '模型不可用，已暂停' };
    return { label: '已暂停自动重试' };
  }
  return { label: FAIL_KIND_LABELS[classifyStepFailure(raw)] ?? '本步异常结束' };
}

function failItem(reason: string): Extract<TranscriptItem, { kind: 'fail' }> {
  const raw = stripAnsiEscapes(reason);
  return { kind: 'fail', ...failLabel(raw), body: failGuidanceBody(classifyStepFailure(raw)), raw };
}

export function runtimeUpdatePlain(
  raw: string,
): { key: string; vars: Record<string, string> } | null {
  const update = runtimeUpdateRequired(raw);
  if (update === null) return null;
  const vars = {
    runtime: update.runtime ?? 'Claude Code',
    current: update.current ?? '',
    required: update.required,
  };
  return {
    key:
      update.current === null
        ? '这个模型需要 {runtime} {required} 或更新的版本'
        : 'Cairn 自带的 {runtime} {current} 太旧，这个模型需要 {required} 或更新的版本',
    vars,
  };
}

function failGuidanceBody(kind: ReturnType<typeof classifyStepFailure>): string {
  switch (kind) {
    case 'runtime_outdated':
      return '更新 Cairn 后重新运行这个任务。';
    case 'network':
      return '连接服务商时超时或断开，通常是暂时的，重新运行即可。';
    case 'quota':
      return '模型额度已用尽，请等待额度恢复后重试。';
    case 'capacity':
      return '请求被限流，请稍后重试。';
    default:
      return '';
  }
}

function workCall(
  call: ToolCallRecord,
  fallbackSeconds: number | null,
  stepRunning: boolean,
  cancelled: boolean,
): WorkStep {
  const args = (call.arguments ?? {}) as Record<string, unknown>;
  const name = call.name.toLowerCase();
  const path = String(args.file_path ?? args.path ?? '').replace(
    /^\/(?:home|Users)\/[^/]+\/\.(?:pacman-chief|cairn)\/(?:workspaces|plans)\/[^/]+\//,
    '',
  );
  const output = toolResultText(call.result);
  const seconds =
    call.startedAt !== undefined && call.endedAt !== undefined
      ? Math.max(0, (call.endedAt - call.startedAt) / 1000)
      : call.startedAt !== undefined
        ? null
        : fallbackSeconds;
  const base = {
    kind: 'call' as const,
    id: call.id,
    label: call.name,
    output: output !== null && isJsonPlumbing(output) ? null : output,
    error: call.isError === true,
    running: call.result === undefined && stepRunning,
    unfinished: call.result === undefined && !stepRunning,
    cancelled: call.result === undefined && cancelled,
    seconds,
  };
  if (name === 'read') {
    const offset = typeof args.offset === 'number' ? args.offset : null;
    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : null;
    const range =
      offset === null && limit === null
        ? ''
        : limit === null
          ? ` L${offset}+`
          : ` L${offset ?? 1}–${(offset ?? 1) + limit - 1}`;
    return { ...base, action: 'read', target: path + range };
  }
  if (name === 'edit' || name === 'write' || name === 'multiedit') {
    const edits = name === 'multiedit' && Array.isArray(args.edits) ? args.edits : [args];
    const removed: string[] = [];
    const added: string[] = [];
    for (const edit of edits) {
      if (edit === null || typeof edit !== 'object') continue;
      const values = edit as Record<string, unknown>;
      const oldText = values.old_string ?? values.oldText;
      const newText = values.new_string ?? values.newText ?? values.content;
      if (typeof oldText === 'string' && oldText !== '') removed.push(...oldText.split('\n'));
      if (typeof newText === 'string' && newText !== '') added.push(...newText.split('\n'));
    }
    return {
      ...base,
      action: 'edit',
      target: path,
      diff: { added: added.length, removed: removed.length },
      changes: { removed, added },
    };
  }
  if (name === 'grep' || name === 'find' || name === 'ls' || name === 'glob') {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    return {
      ...base,
      action: 'search',
      description: [call.name, pattern, path].filter((part) => part !== '').join(' '),
    };
  }
  if (name === 'bash') {
    const command = typeof args.command === 'string' ? args.command : '';
    const description =
      typeof args.description === 'string'
        ? args.description
        : (command.replace(CD_PREFIX, '').split('\n')[0] ?? '');
    return {
      ...base,
      action: /^(grep|rg|find|git grep)\b/.test(command.trim()) ? 'search' : 'run',
      description,
      command,
    };
  }
  return { ...base, action: 'tool', target: call.name.replace(/^mcp__/, '').replace(/__/g, ' · ') };
}

export function isJsonPlumbing(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function echoNoteOf(toolName: string): string | null {
  if (toolName === 'set_task_meta') return null;
  if (toolName.includes('memory')) return '记忆已更新';
  if (toolName.includes('skill')) return '技能已更新';
  return null;
}

export function mapTokenUsage(usage: TokenUsage[]): TokenUsageContent {
  const totals = usage.reduce(
    (acc, u) => ({
      input: acc.input + u.input,
      output: acc.output + u.output,
      cacheRead: acc.cacheRead + u.cacheRead,
      cacheWrite: acc.cacheWrite + u.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const total = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  const model = usage[0]?.model ?? 'n/a';
  const hit = cacheHitShare(totals);
  const cacheHitRate = hit === null ? '—' : `${(hit * 100).toFixed(1).replace(/\.0$/, '')}%`;
  return {
    total: formatTokens(total),
    model,
    modelTotal: formatTokens(total),
    input: formatTokens(totals.input),
    output: formatTokens(totals.output),
    cacheRead: formatTokens(totals.cacheRead),
    cacheWrite: formatTokens(totals.cacheWrite),
    cacheHitRate,
  };
}

export function mapBranchInfo(
  buildId: string,
  steps: StepRow[],
  machines: MachineRecord[],
): BranchInfoContent {
  const lastCheckpoint = [...steps].reverse().find((s) => s.checkpointCommit !== null);
  const machineId = [...steps].reverse().find((s) => s.machineId !== null)?.machineId ?? null;
  const machine = machines.find((m) => m.id === machineId);
  return {
    branch: conversationBranch(buildId),
    commit: lastCheckpoint?.checkpointCommit?.slice(0, 7) ?? '—',
    machine: machine?.name ?? '—',
    directory: `~/${BRAND.homeDirName}/workspaces/${buildId}`,
  };
}

export function mapRunHistory(
  todo: WireTodo,
  builds: BuildRecord[],
  now: number,
  tokensByBuild?: Map<string, number>,
): RunHistoryRow[] {
  const byId = new Map(builds.map((b) => [b.id, b]));
  const rows: RunHistoryRow[] = [];
  const history = [...todo.buildHistory].reverse();
  history.forEach((entry, idx) => {
    const n = todo.buildHistory.length - idx;
    const b = byId.get(entry.buildId);
    const isCurrent = todo.latestBuildId === entry.buildId;
    const failed = b?.errorMessage != null && b.errorMessage !== '';
    const parts = [relativeTime(entry.createdAt, now)].filter((part) => part !== '');
    const tokens = tokensByBuild?.get(entry.buildId);
    if (tokens !== undefined) parts.push(`${formatTokens(tokens)} tokens`);
    if (failed && b) parts.push(stripAnsiEscapes(b.errorMessage ?? ''));
    rows.push({
      label: `第 ${n} 次运行`,
      meta: parts.join(' · '),
      status: isCurrent ? (failed ? 'failed-current' : 'current') : failed ? 'failed' : 'done',
    });
  });
  return rows;
}

export function mapSchedules(rows: WireSchedule[]): DisplaySchedule[] {
  return rows.map((r) => ({
    id: r.id,
    teamId: r.teamId,
    projectId: r.projectId,
    todoId: r.todoId,
    kind: r.kind,
    at: r.at,
    tz: r.tz,
    nextRunAt: r.nextRunAt ?? 0,
    triggerSpec: r.triggerSpec,
    webhookMasked: r.webhookMasked,
    webhookLastUsedAt: r.webhookLastUsedAt,
    missedRunWindowMs: r.missedRunWindowMs,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    enabled: r.enabled,
    pausedReason: r.pausedReason,
    todo: r.todo,
  }));
}

export function mapApiKeys(rows: ApiKeyRow[]): DisplayApiKey[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    masked: r.masked,
    gitAccess: r.gitAccess,
    mcpAccess: r.mcpAccess,
    machineAccess: r.machineAccess,
  }));
}

export function mapMachines(
  rows: (MachineRecord & { providers?: MachineProvider[] })[],
): MachineRow[] {
  const local = rows.filter((m) => m.kind === 'local');
  const attached = rows.filter((m) => m.kind !== 'local');
  return [...local, ...attached].map((m) => ({
    id: m.id,
    kind: m.kind,
    name: m.name,
    ...(m.hostname !== undefined ? { hostname: m.hostname } : {}),
    online: m.online,
    ...(m.lastSeenAt !== undefined ? { lastSeenAt: m.lastSeenAt } : {}),
    enabledRuntimes: m.enabledRuntimes,
    ...(m.runningSteps !== undefined ? { runningSteps: m.runningSteps } : {}),
    ...(m.capabilities !== undefined ? { capabilities: m.capabilities } : {}),
    ...(m.claudeLogin !== undefined ? { claudeLogin: m.claudeLogin } : {}),
    ...(m.providers !== undefined ? { providers: m.providers } : {}),
  }));
}

export function mapSkills(rows: SkillRecord[]): SkillRow[] {
  return rows.map((s) => ({ name: s.name, description: s.description ?? '' }));
}

export function mapSecrets(rows: SecretRecord[]): { name: string; description: string | null }[] {
  return rows.map((s) => ({ name: s.name, description: s.description }));
}

export function mapMcpServers(rows: McpServerRecord[], now: number): McpRow[] {
  return rows.map((m) => ({
    name: m.label,
    kind: m.transport === 'http' ? 'HTTP' : 'stdio',
    url: m.transport === 'http' ? m.url : m.slug,
    ago: relativeTime(m.createdAt, now),
  }));
}

export const RUNTIME_LABELS: Record<ModelSourceRuntime, string> = MODEL_SOURCE_RUNTIME_LABELS;

export function toThinkingLevelDisplay(
  value: string | null,
  levels: readonly string[],
): string | null {
  return value !== null && levels.includes(value) ? value : null;
}

function thinkingOf(
  m: ModelSource['models'][number],
): Pick<
  ModelOption,
  'thinkingLevels' | 'thinkingDefault' | 'coordinatorThinkingLevels' | 'coordinatorThinkingDefault'
> {
  const inServer = m.inServerThinkingLevels !== undefined;
  const coordinatorLevels = inServer ? m.inServerThinkingLevels : m.thinkingLevels;
  const coordinatorDefault = inServer ? m.inServerThinkingDefault : m.thinkingDefault;
  return {
    ...(m.thinkingLevels !== undefined ? { thinkingLevels: m.thinkingLevels } : {}),
    ...(m.thinkingDefault !== undefined ? { thinkingDefault: m.thinkingDefault } : {}),
    ...(coordinatorLevels !== undefined ? { coordinatorThinkingLevels: coordinatorLevels } : {}),
    ...(coordinatorDefault !== undefined ? { coordinatorThinkingDefault: coordinatorDefault } : {}),
  };
}

export function toModelOptions(sources: ModelSource[]): ModelOption[] {
  const keyOf = (source: ModelSource, id: string) => {
    const provider = source.provider ?? source.runtime;
    return source.runtime === 'claude-code' && source.machineId !== undefined
      ? `${provider}/${source.machineId}/${id}`
      : `${provider}/${id}`;
  };
  const livenessByKey = new Map<string, 'alive' | 'dead' | 'unknown'>();
  for (const source of sources) {
    for (const m of source.models) {
      if (m.id === '') continue;
      const lv = m.liveness ?? 'unknown';
      const key = keyOf(source, m.id);
      const prev = livenessByKey.get(key);
      if (prev === undefined || (lv === 'dead' && prev !== 'dead')) {
        livenessByKey.set(key, lv);
      }
    }
  }
  const options: ModelOption[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const provider = source.provider ?? source.runtime;
    const providerLabel =
      source.providerLabel || (RUNTIME_LABELS[source.runtime] ?? source.runtime);
    for (const m of source.models) {
      if (m.id === '') continue;
      const key = keyOf(source, m.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const lv = livenessByKey.get(key);
      options.push({
        runtime: source.runtime,
        provider,
        providerLabel,
        modelId: m.id,
        modelName: m.name,
        ...(source.machineId !== undefined ? { machineId: source.machineId } : {}),
        ...(lv !== undefined && lv !== 'unknown' ? { liveness: lv } : {}),
        ...(m.updateRequired !== undefined ? { updateRequired: m.updateRequired } : {}),
        ...thinkingOf(m),
      });
    }
  }
  return options;
}

export type TurnErrorFacts = Omit<ChiefTurnErrorContent, 'kind'>;

export type TurnFailureAction =
  | 'update'
  | 'retry'
  | 'continue'
  | 'swap'
  | 'pick'
  | 'provider'
  | 'key'
  | 'settings';

export interface TurnErrorCopy {
  kind: TurnErrorKind;
  title: string;
  why: string;
  vars: Record<string, string>;
  actions: TurnFailureAction[];
}

export function turnErrorCopy(error: TurnErrorFacts, onMac: boolean): TurnErrorCopy {
  const kind = turnErrorKind(error.message);
  const named = error.provider !== undefined;
  const vars: Record<string, string> = {
    provider: error.provider ?? '',
    model: error.model ?? '',
    minutes: String(Math.round((error.elapsedMs ?? 0) / 60_000)),
  };
  const copy = (title: string, why: string, actions: TurnFailureAction[]): TurnErrorCopy => ({
    kind,
    title,
    why,
    vars,
    actions,
  });
  switch (kind) {
    case 'timeout':
      return copy(
        '模型响应超时',
        (error.elapsedMs ?? 0) < 60_000
          ? '模型没有响应，本轮已停止。通常是服务商响应慢，重试即可；频繁出现时，请为 Coordinator 更换模型。'
          : named && error.model !== undefined
            ? '{model}（{provider}）{minutes} 分钟没有响应，本轮已停止。通常是服务商响应慢，重试即可；频繁出现时，请为 Coordinator 更换模型。'
            : '模型 {minutes} 分钟没有响应，本轮已停止。通常是服务商响应慢，重试即可；频繁出现时，请为 Coordinator 更换模型。',
        ['retry', 'swap'],
      );
    case 'connect':
      return copy(
        '无法连接服务商',
        named
          ? onMac
            ? 'Cairn 无法连接 {provider}。可能是地址填写有误、网络或代理不可用，或本地模型未启动。模型在这台 Mac 或局域网里时，还需在「系统设置 → 隐私与安全性 → 本地网络」里打开 Cairn。'
            : 'Cairn 无法连接 {provider}。可能是地址填写有误、网络或代理不可用，或本地模型未启动。'
          : onMac
            ? '可能是地址填写有误、网络或代理不可用，或本地模型未启动。模型在这台 Mac 或局域网里时，还需在「系统设置 → 隐私与安全性 → 本地网络」里打开 Cairn。'
            : '可能是地址填写有误、网络或代理不可用，或本地模型未启动。',
        ['provider', 'retry'],
      );
    case 'key':
      return copy(
        named ? '{provider} 不接受这个 API key' : '服务商不接受这个 API key',
        'API key 填写有误或已失效。请重新填写后重试。',
        ['key', 'retry'],
      );
    case 'quota':
      return copy(
        named ? '{provider} 的额度用完了' : '模型额度用完了',
        '这个账号的额度已用完。请充值或等待额度恢复后重试，或为 Coordinator 更换模型。',
        ['swap', 'retry'],
      );
    case 'busy':
      return copy(
        named ? '{provider} 当前繁忙' : '服务商当前繁忙',
        '服务商暂时无法处理这个请求，与你的设置无关。请几分钟后重试，或为 Coordinator 更换模型。',
        ['retry', 'swap'],
      );
    case 'model':
      return copy(
        error.model !== undefined ? '{model} 不可用' : '这个模型不可用',
        '服务商已下线这个模型，或这个账号无法使用它。请为 Coordinator 更换一个可用的模型。',
        ['swap'],
      );
    case 'context':
      return copy(
        '对话太长，模型读不下了',
        '这段对话超过了模型可读取的长度，自动压缩后仍然超出。请更换上下文更长的模型后重试。',
        ['swap', 'retry'],
      );
    case 'provider':
      return copy(
        named ? '{provider} 这次出错了' : '服务商返回了错误',
        '服务商返回了错误，本轮未完成。请稍后重试；频繁出现时，请为 Coordinator 更换模型。',
        ['retry', 'swap'],
      );
    case 'no-model':
      return copy(
        'Coordinator 暂无可用的模型',
        'Coordinator 的模型没有选，或者它的服务商已经删掉了。选一个模型后再重试。',
        ['pick', 'retry'],
      );
    case 'interrupted':
      return copy(
        '这一轮被打断了',
        'Cairn 在回复途中重启或断开，本轮未完成。已完成的操作不会撤回；重试会重新发送刚才的消息。',
        ['retry'],
      );
    case 'runtime-update': {
      const plain = runtimeUpdatePlain(error.message);
      Object.assign(vars, plain?.vars ?? {});
      return copy(plain?.key ?? '这个模型需要更新的 Claude Code', '更新 Cairn 后再重试。', [
        'update',
      ]);
    }
    case 'turn-limit':
      return copy(
        '这一轮的步数用完了',
        'Coordinator 连续执行了很多步仍未完成，已暂停。点击「继续」让它继续执行。',
        ['continue'],
      );
    case 'unknown':
      return copy(
        '这一轮没有完成',
        '未能识别具体原因。通常重试即可；持续出现时，点击「详情」查看原始错误。',
        ['retry', 'settings'],
      );
  }
}

export function chiefTurnErrorOfContent(content: unknown): TurnErrorFacts | null {
  if (typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: unknown }).kind !== CHIEF_TURN_ERROR_KIND
  ) {
    return null;
  }
  const row = chiefTurnErrorContentSchema.safeParse(parsed);
  if (!row.success) return null;
  const { kind: _kind, ...facts } = row.data;
  return facts;
}

const WATCH_PROVENANCE_PREFIX = 'watch:';

export function askQuestionOfContent(content: unknown): {
  requestId: string;
  status: 'pending' | 'answered' | 'cancelled';
  questions: {
    header: string;
    question: string;
    options: { label: string; description?: string }[];
    multiSelect?: boolean;
  }[];
  answers: { header: string; choices?: string[]; text?: string }[] | null;
  todoId?: string;
} | null {
  let parsed: unknown = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { kind?: unknown }).kind !== ASK_USER_QUESTION_KIND
  ) {
    return null;
  }
  const row = askUserQuestionContentSchema.safeParse(parsed);
  if (!row.success) return null;
  return {
    requestId: row.data.requestId,
    status: row.data.status,
    questions: row.data.questions,
    answers: row.data.answers,
    ...(row.data.provenance?.startsWith(WATCH_PROVENANCE_PREFIX)
      ? { todoId: row.data.provenance.slice(WATCH_PROVENANCE_PREFIX.length) }
      : {}),
  };
}

const WAKE_MARKER_PREFIX_RE = /^\[wake:\w+\]\s*/;

function isChiefPromptEcho(m: MessageRow): boolean {
  if (m.origin === 'user') return false;
  return (
    m.origin === 'task-prompt' ||
    m.origin === 'synthetic' ||
    m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)
  );
}

function chiefUserText(raw: string): string {
  return stripTurnContext(stripSkillRouteSection(raw.replace(WAKE_MARKER_PREFIX_RE, ''))).trim();
}

function takeoverItemOf(call: ToolCallRecord, id: string): ChiefStreamItem {
  const args = call.arguments as { reason?: unknown; phone?: unknown } | null;
  const reason = args?.reason;
  const phone = args?.phone;
  const finished = call.result !== undefined || call.endedAt !== undefined || call.isError === true;
  const handedBack =
    finished &&
    call.isError !== true &&
    (toolResultText(call.result) ?? '').includes(TAKEOVER_HANDED_BACK);
  return {
    kind: 'takeover',
    id,
    reason: typeof reason === 'string' ? reason : '',
    ...(typeof phone === 'string' && phone.trim() !== '' ? { phone: phone.trim() } : {}),
    startedAt: call.startedAt ?? null,
    endedAt: call.endedAt ?? null,
    outcome: !finished ? 'waiting' : handedBack ? 'handed-back' : 'not-done',
  };
}

function secretRequestItemOf(call: ToolCallRecord, id: string): ChiefStreamItem {
  const args = call.arguments as {
    name?: unknown;
    scope?: unknown;
    projectId?: unknown;
    description?: unknown;
  } | null;
  const finished = call.result !== undefined || call.endedAt !== undefined || call.isError === true;
  const text = call.isError === true ? '' : (toolResultText(call.result) ?? '');
  const projectId = typeof args?.projectId === 'string' ? args.projectId : null;
  return {
    kind: 'secret-request',
    id,
    name: typeof args?.name === 'string' ? args.name : '',
    scope: args?.scope === 'project' && projectId !== null ? 'project' : 'team',
    projectId: args?.scope === 'project' ? projectId : null,
    description: typeof args?.description === 'string' ? args.description : '',
    outcome: !finished
      ? 'waiting'
      : text.startsWith(SECRET_REQUEST_SAVED_PREFIX)
        ? 'saved'
        : text === SECRET_REQUEST_CANCELLED
          ? 'cancelled'
          : 'failed',
  };
}

function packageInstallItemOf(call: ToolCallRecord, id: string): ChiefStreamItem {
  const asked = (call.arguments as { packages?: unknown } | null)?.packages;
  const packages = Array.isArray(asked)
    ? asked.filter((name): name is string => typeof name === 'string')
    : [];
  const finished = call.result !== undefined || call.endedAt !== undefined || call.isError === true;
  const text = call.isError === true ? '' : (toolResultText(call.result) ?? '');
  return {
    kind: 'package-install',
    id,
    packages,
    outcome: !finished
      ? 'waiting'
      : text.startsWith(PACKAGES_INSTALLED_PREFIX)
        ? 'installed'
        : text === PACKAGES_DECLINED
          ? 'declined'
          : text === PACKAGES_NOT_ANSWERED
            ? 'not-answered'
            : 'failed',
  };
}

function handoffTodoOf(call: ToolCallRecord): string | null {
  if (call.name !== 'message_todo' || call.result === undefined || call.isError === true)
    return null;
  const todoId = (call.arguments as { todoId?: unknown } | null)?.todoId;
  return typeof todoId === 'string' && todoId !== '' ? todoId : null;
}

function createdTodoOf(call: ToolCallRecord): {
  todoId: string;
  projectId: string | null;
  seq: number | null;
  title: string | null;
} | null {
  if (call.name !== 'create_todo' || call.result === undefined || call.isError === true)
    return null;
  const result = toolResultValue(call.result);
  const record = result as { id?: unknown; seqNum?: unknown; title?: unknown } | null;
  const todoId = record?.id;
  if (typeof todoId !== 'string' || todoId === '') return null;
  const projectId = (call.arguments as { projectId?: unknown } | null)?.projectId;
  return {
    todoId,
    projectId: typeof projectId === 'string' ? projectId : null,
    seq: typeof record?.seqNum === 'number' ? record.seqNum : null,
    title:
      typeof record?.title === 'string' && record.title !== ''
        ? shownTaskTitle(record.title)
        : null,
  };
}

function archivedTodoIdsOf(call: ToolCallRecord): string[] {
  if (call.name !== 'archive_todos' || call.result === undefined || call.isError === true)
    return [];
  const value = toolResultValue(call.result) as { archived?: unknown } | null;
  return Array.isArray(value?.archived)
    ? value.archived.filter((id): id is string => typeof id === 'string')
    : [];
}

const RAW_API_ERROR_RE = /^API Error: /;

export function mapChiefStream(messages: MessageRow[]): ChiefStreamItem[] {
  return collectChiefStream(messages).items;
}

function dropThinkingOfFailedTurns(items: ChiefStreamItem[], itemsAt: number[]): void {
  const drop = new Set<number>();
  let turn: number[] = [];
  let answered = false;
  items.forEach((item, index) => {
    if (item.kind === 'user') {
      turn = [];
      answered = false;
    } else if (item.kind === 'robot') answered = true;
    else if (item.kind === 'thinking') turn.push(index);
    else if (item.kind === 'error' && !answered) for (const at of turn) drop.add(at);
  });
  for (let index = items.length - 1; index >= 0; index--) {
    if (!drop.has(index)) continue;
    items.splice(index, 1);
    itemsAt.splice(index, 1);
  }
}

function collectChiefStream(
  messages: MessageRow[],
  pendingIds: ReadonlyMap<string, ChiefPendingMessage['state']> = new Map(),
): {
  items: ChiefStreamItem[];
  itemsAt: number[];
  trailingTools: ChiefToolRow[];
  pending: ChiefStreamItem[];
  eventTurn: boolean;
} {
  const items: ChiefStreamItem[] = [];
  const itemsAt: number[] = [];
  let lastAt = 0;
  const pendingById = new Map<string, ChiefStreamItem>();
  let fallback: { model: string; stepId: string } | null = null;
  let pendingTools: ChiefToolRow[] = [];
  let pendingCards: ChiefStreamItem[] = [];
  const flushCards = () => {
    items.push(...pendingCards);
    pendingCards = [];
  };
  let eventTurn = false;
  for (const m of messages) {
    while (itemsAt.length < items.length) itemsAt.push(lastAt);
    lastAt = m.createdAt;
    if (
      m.role === 'system' &&
      m.content === '' &&
      m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)
    ) {
      eventTurn = false;
      pendingTools = [];
      fallback = null;
      flushCards();
      continue;
    }
    if (m.role === 'user' && fallback !== null) {
      const stepOfRow = m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)
        ? m.id.slice(TRANSCRIPT_PROMPT_ROW_ID_PREFIX.length)
        : m.id;
      if (stepOfRow !== fallback.stepId) fallback = null;
    }
    if (m.role === 'user' && isChiefPromptEcho(m)) {
      eventTurn = WAKE_MARKER_PREFIX_RE.test(textOfContent(m.content).trim());
      if (eventTurn) pendingTools = [];
      continue;
    }
    const pendingState = m.role === 'user' ? pendingIds.get(m.id) : undefined;
    if (m.role === 'user' && pendingState === undefined) eventTurn = false;
    if (pendingState !== undefined) {
      const text = textOfContent(m.content).trim();
      pendingById.set(m.id, {
        kind: 'user',
        text,
        id: m.id,
        markdown: text,
        pending: pendingState,
        at: clockTime(m.createdAt),
        createdAt: m.createdAt,
        ...rowProject(m),
      });
      continue;
    }
    const turnError = m.role === 'system' ? chiefTurnErrorOfContent(m.content) : null;
    if (turnError !== null) {
      pendingTools = [];
      const last = items.at(-1);
      if (last?.kind === 'error' && last.error === undefined) items.pop();
      items.push({ kind: 'error', text: turnError.message, error: turnError, id: m.id });
      continue;
    }
    if (m.role === 'system') {
      let parsed: unknown = null;
      try {
        parsed = typeof m.content === 'string' ? JSON.parse(m.content) : null;
      } catch {
        parsed = null;
      }
      const report = threadReportContentSchema.safeParse(parsed);
      if (report.success) {
        items.push({
          ...report.data,
          title: shownTaskTitle(report.data.title),
          id: m.id,
          ...rowProject(m),
        });
        continue;
      }
      const direct = threadMessageContentSchema.safeParse(parsed);
      if (direct.success) {
        items.push({
          ...direct.data,
          title: shownTaskTitle(direct.data.title),
          id: m.id,
          ...rowProject(m),
        });
        continue;
      }
      const stopped = chiefTurnStoppedContentSchema.safeParse(parsed);
      if (stopped.success) {
        pendingTools = [];
        items.push({ kind: 'stopped', todos: stopped.data.todos, id: m.id });
        continue;
      }
      const switched = chiefModelFallbackContentSchema.safeParse(parsed);
      if (switched.success) {
        fallback = { model: switched.data.to, stepId: switched.data.stepId };
        if (switched.data.announced === true) {
          items.push({
            kind: 'note',
            text: '主模型 {from} 暂时不可用，这轮改用 {to}',
            vars: { from: switched.data.from, to: switched.data.to },
            id: m.id,
          });
        }
        continue;
      }
      const restored = chiefModelRestoredContentSchema.safeParse(parsed);
      if (restored.success) {
        items.push({
          kind: 'note',
          text: '主模型 {model} 恢复了，这轮起改回 {model}',
          vars: { model: restored.data.model },
          id: m.id,
        });
        continue;
      }
      const notice = chiefNoticeContentSchema.safeParse(parsed);
      if (notice.success) {
        pendingTools = [];
        const update = notice.data.runtimeUpdate;
        items.push({
          kind: 'robot',
          markdown: notice.data.message,
          ...(update !== undefined
            ? {
                plain: {
                  key:
                    update.current === null
                      ? '任务「{task}」已暂停：它的模型需要 {runtime} {required} 或更新的版本。更新 Cairn 后再重试。'
                      : '任务「{task}」已暂停：Cairn 自带的 {runtime} {current} 太旧，它的模型需要 {required} 或更新的版本。更新 Cairn 后再重试。',
                  vars: {
                    task: update.task,
                    runtime: update.runtime ?? 'Claude Code',
                    current: update.current ?? '',
                    required: update.required,
                  },
                },
              }
            : {}),
          seconds: '',
          id: m.id,
          ...(notice.data.report !== undefined ? { report: notice.data.report } : {}),
        });
        continue;
      }
      const ack = reportAckContentSchema.safeParse(parsed);
      if (ack.success) {
        items.push({
          kind: 'report-ack',
          id: m.id,
          todoId: ack.data.todoId,
          buildId: ack.data.buildId,
        });
        continue;
      }
      const runnerOffline = runnerOfflineContentSchema.safeParse(parsed);
      if (runnerOffline.success) {
        pendingTools = [];
        items.push({ kind: 'runner-offline', id: m.id, notice: runnerOffline.data });
        continue;
      }
      const dailyReport = chiefReportContentSchema.safeParse(parsed);
      if (dailyReport.success) {
        pendingTools = [];
        items.push({ kind: 'daily-report', id: m.id, report: dailyReport.data });
        continue;
      }
      if (chiefDigestContentSchema.safeParse(parsed).success) continue;
    }
    const call = toolCallOfContent(m.content);
    if (call?.name === SUGGEST_REPLIES_TOOL_NAME) continue;
    if (call?.name === 'request_takeover') {
      items.push(takeoverItemOf(call, m.id));
      continue;
    }
    if (call?.name === REQUEST_SECRET_TOOL) {
      items.push(secretRequestItemOf(call, m.id));
      continue;
    }
    if (call?.name === INSTALL_PACKAGES_TOOL) {
      items.push(packageInstallItemOf(call, m.id));
      continue;
    }
    if (call !== null && isOwnComputerTool(call.name)) continue;
    if (call !== null) {
      const created = createdTodoOf(call);
      if (created !== null)
        pendingCards.push({ kind: 'task-card', id: `${m.id}:task-card`, ...created });
      const undone = new Set(archivedTodoIdsOf(call));
      if (undone.size > 0)
        pendingCards = pendingCards.filter(
          (card) => card.kind !== 'task-card' || !undone.has(card.todoId),
        );
      if (eventTurn) continue;
      pendingTools.push({
        label: pillOf(call),
        ...(call.startedAt !== undefined && call.endedAt !== undefined
          ? { seconds: Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000)) }
          : {}),
        ...(call.isError === true ? { error: true } : {}),
        ...(call.result === undefined && call.endedAt === undefined && call.isError !== true
          ? { running: true }
          : {}),
      });
      const handoffTodoId = handoffTodoOf(call);
      if (handoffTodoId !== null)
        items.push({ kind: 'handoff', todoId: handoffTodoId, id: `${m.id}:handoff` });
      continue;
    }
    const ask = m.role === 'assistant' ? askQuestionOfContent(m.content) : null;
    if (ask !== null) {
      items.push({
        kind: 'question',
        id: m.id,
        requestId: ask.requestId,
        status: ask.status,
        questions: ask.questions,
        answers: ask.answers,
        ...(ask.todoId !== undefined ? { todoId: ask.todoId } : {}),
      });
      continue;
    }
    if (eventTurn && m.role === 'assistant') continue;
    const rawText = textOfContent(m.content).trim();
    if (rawText === '') {
      const thinking = m.role === 'assistant' ? thinkingOfContent(m.content) : null;
      if (thinking !== null) items.push({ kind: 'thinking', text: thinking, id: m.id });
      continue;
    }
    if (m.role === 'user') {
      const text = chiefUserText(rawText);
      if (text === '') continue;
      pendingTools = [];
      flushCards();
      const head = orchestratePromptHeadOf(text);
      items.push(
        head === null
          ? {
              kind: 'user',
              text,
              id: m.id,
              markdown: text,
              at: clockTime(m.createdAt),
              createdAt: m.createdAt,
              ...rowProject(m),
            }
          : {
              kind: 'user',
              text: head,
              id: m.id,
              at: clockTime(m.createdAt),
              createdAt: m.createdAt,
              ...rowProject(m),
            },
      );
      continue;
    }
    if (m.role === 'system') continue;
    if (RAW_API_ERROR_RE.test(rawText)) {
      pendingTools = [];
      items.push({ kind: 'error', text: rawText, id: m.id });
      continue;
    }
    items.push({
      kind: 'robot',
      markdown: rawText,
      seconds: '',
      id: m.id,
      createdAt: m.createdAt,
      ...(pendingTools.length > 0
        ? { tools: pendingTools.map(({ running: _settled, ...tool }) => tool) }
        : {}),
      ...(fallback !== null ? { fallbackModel: fallback.model } : {}),
      ...rowProject(m),
    });
    pendingTools = [];
    flushCards();
  }
  flushCards();
  while (itemsAt.length < items.length) itemsAt.push(lastAt);
  dropThinkingOfFailedTurns(items, itemsAt);
  items.forEach((item, index) => {
    if (
      item.kind === 'user' ||
      item.kind === 'robot' ||
      item.kind === 'error' ||
      item.kind === 'stopped'
    )
      item.createdAt = itemsAt[index] ?? lastAt;
  });
  const pending = [...pendingIds.keys()].flatMap((id) => {
    const item = pendingById.get(id);
    return item === undefined ? [] : [item];
  });
  return { items, itemsAt, trailingTools: pendingTools, pending, eventTurn };
}

function autoCloseStrong(text: string): string {
  const fences = text.match(/^ {0,3}(?:`{3,}|~{3,})/gm);
  if (fences != null && fences.length % 2 === 1) return text;
  const parts = text.split(/`([^`]+)`/g);
  let delimiters = 0;
  for (let i = 0; i < parts.length; i += 2) {
    delimiters += (parts[i] ?? '').split('**').length - 1;
  }
  return delimiters % 2 === 1 ? `${text}**` : text;
}

export function mapChief(
  env: ChiefGetResponse,
  opts: {
    threads: ChiefThread[];
    activeThreadId: string | null;
    messages: MessageRow[];
    draft?: string;
    liveText?: string;
    liveThinking?: string;
    activity?: StepActivity | null;
  },
): ChiefContent {
  const bound = env.chief.agent !== null;
  const active =
    opts.activeThreadId !== null
      ? (opts.threads.find((t) => t.id === opts.activeThreadId) ?? null)
      : null;
  const pendingIds = new Map((active?.pending ?? []).map((p) => [p.messageId, p.state] as const));
  const parked = [...pendingIds.values()].includes('held');
  const running = active?.activeRun != null && !parked;
  const collected = active === null ? null : collectChiefStream(opts.messages, pendingIds);
  const chiefStream: ChiefStreamItem[] = collected?.items ?? [];
  const trailingTools = collected?.trailingTools ?? [];
  let waitingTurn: ChiefContent['waitingTurn'];
  const liveReply: ChiefStreamItem | null =
    collected?.eventTurn === true || (opts.liveText ?? '').trim() === ''
      ? null
      : {
          kind: 'robot',
          markdown: autoCloseStrong(opts.liveText ?? ''),
          typing: true,
          seconds: '',
          ...(trailingTools.length > 0 ? { tools: trailingTools } : {}),
        };
  if (!running && liveReply !== null) chiefStream.push(liveReply);
  if (running && collected?.eventTurn !== true) {
    if ((opts.liveThinking ?? '').trim() !== '') {
      chiefStream.push({ kind: 'thinking', text: opts.liveThinking ?? '' });
    }
    if (liveReply !== null) {
      chiefStream.push(liveReply);
    } else if (
      chiefStream.findLast((item) => item.kind !== 'task-card')?.kind !== 'robot' ||
      trailingTools.length > 0 ||
      (collected?.pending.length ?? 0) > 0
    ) {
      const lastUser = collected?.items.findLastIndex((item) => item.kind === 'user') ?? -1;
      const turnStartedAt = lastUser >= 0 ? collected?.itemsAt[lastUser] : undefined;
      const turnQueue = active?.turnQueue ?? null;
      if (turnQueue != null) {
        const queued = connectingLine(turnQueue);
        const waitKind = turnQueue.blocked?.kind;
        if (waitKind === 'no-computer' || waitKind === 'machine-offline') {
          chiefStream.push({
            kind: 'streaming',
            label: waitKind === 'no-computer' ? '排队中：等电脑就绪' : '排队中：等执行机上线',
            queueWait: {
              kind: waitKind,
              ...(turnQueue.waitingFor != null ? { machine: turnQueue.waitingFor.name } : {}),
            },
          });
        } else {
          chiefStream.push({
            kind: 'streaming',
            ...(queued.blocked && turnQueue.blocked != null
              ? { blocked: true as const, blockedKind: turnQueue.blocked.kind }
              : {}),
            label: queued.label,
            ...(queued.vars !== undefined ? { labelVars: queued.vars } : {}),
          });
        }
      } else {
        const actLabel = opts.activity != null ? activityLabel(opts.activity) : null;
        chiefStream.push({
          kind: 'streaming',
          ...(turnStartedAt !== undefined ? { startedAt: turnStartedAt } : {}),
          label: actLabel?.label ?? '处理中...',
          ...(actLabel?.vars !== undefined ? { labelVars: actLabel.vars } : {}),
          ...(opts.activity != null ? { signalAt: opts.activity.at } : {}),
          ...(trailingTools.length > 0 ? { tools: trailingTools } : {}),
        });
      }
    }
  }
  const waitingQueue =
    running && collected?.eventTurn !== true ? (active?.turnQueue ?? null) : null;
  if (waitingQueue != null) {
    const asked = collected?.items.find(
      (item) => item.kind === 'user' && item.id !== undefined && item.id === waitingQueue.stepId,
    );
    if (asked?.kind === 'user' && asked.id !== undefined)
      waitingTurn = { messageId: asked.id, text: asked.markdown ?? asked.text };
  }
  chiefStream.push(...(collected?.pending ?? []));
  const quickReplies =
    active === null
      ? []
      : liveQuickReplies(opts.messages, {
          running: active.activeRun != null,
          runningStepId: opts.activity?.stepId ?? null,
        });
  return {
    bound,
    ...(bound && env.agentActor
      ? {
          modelSlot: env.agentActor.modelId ?? 'n/a',
          agent: {
            id: env.agentActor.id,
            displayName: env.agentActor.displayName,
            avatarUrl: env.agentActor.avatarUrl,
          },
          modelProvider: env.agentActor.provider,
        }
      : {}),
    threadTitle: active?.title ?? '新主题',
    ...(active !== null ? { threadId: active.id } : {}),
    ...(opts.threads.length > 0
      ? {
          threads: opts.threads.map((t) => ({
            title: t.title,
            ...(t.id === opts.activeThreadId ? { active: true } : {}),
          })),
        }
      : {}),
    ...(active === null ? {} : { stream: chiefStream, streamAt: collected?.itemsAt ?? [] }),
    ...(running ? { running: true } : {}),
    ...(opts.activity?.phase === 'tool' && opts.activity.tool != null
      ? { runningTool: opts.activity.tool }
      : active?.activeRun?.tool != null
        ? { runningTool: active.activeRun.tool.toolName }
        : {}),
    ...(waitingTurn !== undefined ? { waitingTurn } : {}),
    ...(opts.draft !== undefined ? { draft: opts.draft } : {}),
    ...(env.outage != null ? { outage: env.outage } : {}),
    ...(active?.fallbackModel != null ? { fallbackModel: active.fallbackModel } : {}),
    ...(quickReplies.length > 0 ? { quickReplies } : {}),
  };
}

export function mapOrchestrationFeedback(
  todo: Pick<WireTodo, 'id' | 'phase' | 'phaseAt'>,
  thread: ChiefThread | null,
  messages: readonly MessageRow[],
): TranscriptItem[] {
  if (thread === null || (todo.phase !== 'todo' && todo.phase !== 'failed')) return [];
  const start = messages.findLastIndex(
    (m) =>
      m.role === 'user' &&
      m.createdAt >= todo.phaseAt &&
      orchestratedTodoIdOf(textOfContent(m.content)) === todo.id,
  );
  const request = messages[start];
  if (request === undefined) return [];
  const pending = new Set((thread.pending ?? []).map((p) => p.messageId));
  const rest = messages.slice(start + 1);
  const next = rest.findIndex((m) => m.role === 'user' && !pending.has(m.id));
  const turn = next === -1 ? rest : rest.slice(0, next);
  const items: TranscriptItem[] = [{ kind: 'note', text: '已交给 Coordinator 安排' }];
  for (const m of turn) {
    const error = m.role === 'system' ? chiefTurnErrorOfContent(m.content) : null;
    if (error !== null) {
      const copy = turnErrorCopy(error, false);
      items.push({ kind: 'note', text: copy.title, vars: copy.vars, id: m.id });
      return items;
    }
    const text = m.role === 'assistant' ? textOfContent(m.content).trim() : '';
    if (text !== '')
      items.push({ kind: 'robot', markdown: text, id: m.id, createdAt: m.createdAt });
  }
  const replied = items.length > 1;
  if (next === -1 && threadTurnInFlight(thread)) {
    if (thread.turnQueue != null) {
      const queued = connectingLine(thread.turnQueue);
      items.push({
        kind: 'streaming',
        ...(queued.blocked && thread.turnQueue.blocked != null
          ? { blocked: true as const, blockedKind: thread.turnQueue.blocked.kind }
          : {}),
        label: queued.label,
        ...(queued.vars !== undefined ? { labelVars: queued.vars } : {}),
      });
    } else {
      items.push({
        kind: 'streaming',
        label: 'Coordinator 正在安排这个任务...',
        startedAt: request.createdAt,
      });
    }
    return items;
  }
  items.push({
    kind: 'note',
    text: replied
      ? 'Coordinator 没有派发这个任务，原因见上方的回复。点击「开始」重试。'
      : 'Coordinator 没有派发这个任务，也没有说明原因。点击「开始」重试。',
  });
  return items;
}

export { relativeTime };
