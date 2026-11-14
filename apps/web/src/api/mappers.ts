import type {
  AgentTodo,
  BuildRecord,
  ChiefGetResponse,
  ChiefThread,
  DocumentDiffFile,
  MachineRecord,
  McpServerRecord,
  ModelSource,
  ModelSourceRuntime,
  SecretRecord,
  SkillRecord,
  StepActivity,
  TokenUsage,
  ToolCallRecord,
  UsageCost,
  ScheduleRecord as WireSchedule,
  TodoRecord as WireTodo,
} from '@cairn/shared';
import {
  ASK_USER_QUESTION_KIND,
  askUserQuestionContentSchema,
  BRAND,
  BUILD_FAILURE_ROW_KIND,
  CHIEF_TURN_ERROR_KIND,
  CONFIRM_ANNOUNCEMENT,
  chiefDigestContentSchema,
  chiefModelFallbackContentSchema,
  chiefNoticeContentSchema,
  chiefReportContentSchema,
  chiefTurnErrorContentSchema,
  chiefTurnStoppedContentSchema,
  classifySkillFact,
  classifyStepFailure,
  classifyUserText,
  conversationBranch,
  DONE_ROW,
  derivePlaceholderTitle,
  GATE_ANNOUNCEMENTS,
  GIT_CREDENTIAL_ROW_KIND,
  infoReportMessageSchema,
  liveQuickReplies,
  MODEL_SOURCE_RUNTIME_LABELS,
  orchestratePromptHeadOf,
  PLACEHOLDER_TITLE_FALLBACK,
  PLAN_SECTIONS,
  REVIEW_VERDICT_KIND,
  RUNNER_OS_LABELS,
  replyQuoteText,
  resolvedBuildPrNumber,
  reviewVerdictSchema,
  reworkNoteWithoutReason,
  runnerOfflineContentSchema,
  SUGGEST_REPLIES_TOOL_NAME,
  type SystemRow,
  stripAnsiEscapes,
  stripSkillRouteSection,
  systemRowOf,
  TAKEOVER_HANDED_BACK,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  threadMessageContentSchema,
  threadReportContentSchema,
  toolResultText,
  toolResultValue,
  transcriptPromptRowId,
  VERIFY_VERDICT_KIND,
  verifyVerdictSchema,
  WORKSPACE_HOOK_ROW_KIND,
} from '@cairn/shared';
import { relativeTime } from '../board/rel-time.js';
import { STATUS_WORDS } from '../board/status-words.js';
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
  PlanDiffContent,
  PlanVersion,
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
import type { ApiKeyRow, PlanRow, StepRow } from './hooks.js';

function queueLabel(queue: NonNullable<StepRow['queue']>): {
  label: string;
  vars: Record<string, string | number>;
} {
  const ahead = Math.max(0, queue.position - 1);
  if (queue.hold != null) {
    return {
      label: '等额度：模型额度用尽，挂起等待恢复（下次尝试 {time}）',
      vars: { time: clockTime(queue.hold.retryAt) },
    };
  }
  const platform = queue.blocked?.platform;
  if (
    platform !== undefined &&
    queue.blocked?.kind === 'capability-missing' &&
    queue.waitingFor == null
  ) {
    return {
      label: '排队中：还没有 {platform} Runner · 需要 {platform}',
      vars: { platform: RUNNER_OS_LABELS[platform] },
    };
  }
  if (
    platform !== undefined &&
    queue.blocked?.kind === 'machine-offline' &&
    queue.waitingFor != null
  ) {
    return {
      label: '排队中：等 {machine} 上线 · 需要 {platform}（前面 {ahead} 个）',
      vars: { machine: queue.waitingFor.name, platform: RUNNER_OS_LABELS[platform], ahead },
    };
  }
  if (queue.blocked?.kind === 'capability-missing') {
    return {
      label:
        '排队中：没有机器满足能力要求（缺 {missing}）——装齐后下一拍心跳即解锁（前面 {ahead} 个）',
      vars: { missing: queue.blocked.missing.join('、'), ahead },
    };
  }
  if (queue.blocked?.kind === 'machine-offline') {
    return queue.waitingFor != null
      ? {
          label: '排队中：等 {machine} 上线（前面 {ahead} 个）',
          vars: { machine: queue.waitingFor.name, ahead },
        }
      : { label: '排队中：等机器上线（前面 {ahead} 个）', vars: { ahead } };
  }
  return queue.waitingFor != null
    ? {
        label: '排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）',
        vars: {
          machine: queue.waitingFor.name,
          running: queue.waitingFor.running,
          cap: queue.waitingFor.capacity,
          ahead,
        },
      }
    : { label: '排队中：等空闲机器（前面 {ahead} 个）', vars: { ahead } };
}

function connectingLine(queue: NonNullable<StepRow['queue']>): {
  label: string;
  vars?: Record<string, string | number>;
  detail?: { label: string; vars: Record<string, string | number> };
} {
  const full = queueLabel(queue);
  if (queue.hold != null || queue.blocked != null) return full;
  return queue.waitingFor != null
    ? { label: '正在连接 {machine}...', vars: { machine: queue.waitingFor.name }, detail: full }
    : { label: '处理中...', detail: full };
}

function quotaWaitLabel(q: NonNullable<StepRow['quotaWait']>): {
  label: string;
  vars: Record<string, string | number>;
} {
  return {
    label: '等额度：{lane} {kind}，{probe} 自动探测续跑',
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
  projectId?: string | null;
}

function rowProject(row: MessageRow): { projectId?: string | null } {
  return row.projectId === undefined ? {} : { projectId: row.projectId };
}

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
  const { tokens, contextWindow } = context as { tokens?: unknown; contextWindow?: unknown };
  if (typeof tokens !== 'number' || typeof contextWindow !== 'number') return null;
  if (!Number.isFinite(tokens) || !Number.isFinite(contextWindow) || contextWindow <= 0)
    return null;
  return { tokens, contextWindow };
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
    snoozedUntil: w.snoozedUntil ?? null,
    snoozeMode: w.snoozeMode ?? null,
    seqNum: w.seqNum,
    orderIndex: w.orderIndex,
    tagIds: w.tagIds,
    githubLabelIds: w.githubLabelIds ?? [],
    assignment: null,
    agent: null,
    latestBuildId: w.latestBuildId,
    lastRunAt: w.lastRunAt,
    hasChanges: w.hasChanges,
    hasPlan: w.hasPlan,
    buildHistory: w.buildHistory,
    sourceTodo: w.sourceTodo,
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
    ...(w.routeOverride !== undefined ? { routeOverride: w.routeOverride } : {}),
  };
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

export function mapPlanDiff(diff: {
  fromVersion: number;
  toVersion: number;
  files: DocumentDiffFile[];
  toContent?: string;
}): PlanDiffContent {
  const files = mapDiffFiles(diff.files);
  const first = files[0];
  if (diff.toContent !== undefined && first !== undefined) {
    first.fullContent = diff.toContent;
  }
  return {
    from: `v${diff.fromVersion}`,
    to: `v${diff.toVersion}`,
    files,
    expanded: false,
  };
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
  plans: PlanRow[];
  build: BuildRecord | null;
  todo: DisplayTodo;
  machineName: string | null;
  userName: string;
  liveText: string;
  liveThinking?: string;
  stopping?: boolean;
  activity?: StepActivity | null;
  agentTodo?: AgentTodo | null;
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
    plans,
    build,
    todo,
    machineName,
    userName,
    liveText,
    liveThinking = '',
    stopping = false,
    activity = null,
    agentTodo = null,
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
  let previousAt: number | null = null;
  for (const m of messages) {
    const seconds =
      previousAt !== null && m.createdAt > previousAt ? (m.createdAt - previousAt) / 1000 : null;
    previousAt = m.createdAt;
    const call = toolCallOfContent(m.content);
    if (call !== null) {
      const owner = steps
        .filter((s) => s.createdAt <= m.createdAt)
        .sort((a, b) => a.createdAt - b.createdAt)
        .at(-1);
      entries.push({
        at: m.createdAt,
        item: {
          kind: '__work__',
          step: workCall(
            call,
            seconds,
            claimedSince !== null && m.createdAt >= claimedSince,
            owner?.status === 'stopped',
          ),
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
          item: { kind: 'note', text: `${m.actor ?? userName} ${text}`, id: m.id },
        });
        continue;
      }
      if (classifyUserText(text, todo) !== 'user') continue;
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
              markdown: `${report.data.attachmentToken}\n\n${report.data.content}`,
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
      if (isJsonPlumbing(text)) continue;
      if (text === DONE_ROW) {
        entries.push({
          at: m.createdAt,
          item: {
            kind: 'note',
            text: STATUS_WORDS.done,
            id: m.id,
          },
        });
        continue;
      }
      if (text !== '') entries.push({ at: m.createdAt, item: { kind: 'note', text, id: m.id } });
      continue;
    }
    if (text !== '') {
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

  const planSteps = steps.filter((s) => s.kind === 'plan');
  plans.forEach((p, i) => {
    const step = planSteps[i];
    const preview =
      p.content
        .split('\n')
        .map((l) => l.replace(/^#+\s*/, '').replace(/`/g, ''))
        .find((l) => l.trim() !== '') ?? '';
    entries.push({
      at: (step?.createdAt ?? p.createdAt) + 1,
      item: {
        kind: 'plan',
        title: `方案 · v${p.version}`,
        createdAt: p.createdAt,
        preview: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview,
      },
    });
  });
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
  const items: TranscriptItem[] = [...head];
  for (const entry of loaded) {
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

  const running = steps.find(
    (s) => s.status === 'claimed' || s.status === 'pending' || s.status === 'waiting_quota',
  );
  const liveReply: TranscriptItem | null =
    liveText.trim() === ''
      ? null
      : { kind: 'robot', paragraphs: [{ segments: [{ text: liveText }] }] };
  if (!running && liveReply !== null) items.push(liveReply);
  if (running && build) {
    if (liveThinking.trim() !== '') {
      const step: WorkStep = {
        kind: 'think',
        id: 'live-thinking',
        text: liveThinking,
        seconds: null,
      };
      const previous = items.at(-1);
      if (previous?.kind === 'work') previous.steps.push(step);
      else items.push({ kind: 'work', id: step.id, steps: [step] });
    }
    if (liveReply !== null) items.push(liveReply);
    const liveTodo = agentTodo != null && agentTodo.stepId === running.id ? agentTodo : null;
    if (liveTodo !== null && liveTodo.items.length > 0) {
      items.push({ kind: 'agent-todo', items: liveTodo.items });
    }
    const act = activity != null && activity.stepId === running.id ? activity : null;
    const actLabel = act != null && !stopping ? activityLabel(act) : null;
    const queued =
      running.status === 'pending' && running.queue != null ? queueLabel(running.queue) : null;
    const quota =
      running.status === 'waiting_quota' && running.quotaWait != null
        ? quotaWaitLabel(running.quotaWait)
        : null;
    items.push({
      kind: 'streaming',
      startedAt: running.createdAt,
      label:
        queued != null
          ? queued.label
          : quota != null
            ? quota.label
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
          : actLabel?.vars !== undefined
            ? { labelVars: actLabel.vars }
            : {}),
      ...(queued == null && quota == null && actLabel != null && act != null
        ? { signalAt: act.at }
        : {}),
      ...(queued == null && quota == null && act?.skills !== undefined && act.skills.length > 0
        ? { skills: act.skills }
        : {}),
    });
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
      (item) => item.kind === 'fail' && item.raw === stripAnsiEscapes(build.errorMessage ?? ''),
    )
  ) {
    items.push({
      kind: 'fail',
      title: stripAnsiEscapes(build.errorMessage),
      createdAt: todo.phaseAt,
      body: failGuidanceBody(classifyStepFailure(build.errorMessage)),
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
      if (!next || ['user', 'scheduled', 'streaming', 'fail'].includes(next.kind)) break;
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
    case BUILD_FAILURE_ROW_KIND: {
      const headline =
        /^(.+?\(exit -?\d+\))/.exec(row.reason)?.[1] ?? row.reason.split('\n')[0] ?? '';
      return {
        kind: 'fail',
        id,
        createdAt,
        title: stripAnsiEscapes(headline),
        body: failGuidanceBody(classifyStepFailure(row.reason)),
        facts: {
          files: row.fileCount,
          commits: row.commits.map((commit) => commit.slice(0, 9)),
          pr: row.pr?.number ?? null,
        },
        raw: stripAnsiEscapes(row.reason),
      };
    }
  }
}

function failGuidanceBody(kind: ReturnType<typeof classifyStepFailure>): string {
  switch (kind) {
    case 'network':
      return '请将这台机器重新上线。这一步不会改派到其他机器。';
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
      typeof args.description === 'string' ? args.description : (command.split('\n')[0] ?? '');
    return {
      ...base,
      action: /^(grep|rg|find|git grep)\b/.test(command.trim()) ? 'search' : 'run',
      description,
      command,
    };
  }
  return { ...base, action: 'tool', target: call.name.replace(/^mcp__/, '').replace(/__/g, ' · ') };
}

function isJsonPlumbing(text: string): boolean {
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
  const hitBase = totals.input + totals.cacheRead;
  const cacheHitRate =
    hitBase === 0 ? '—' : `${((totals.cacheRead / hitBase) * 100).toFixed(1).replace(/\.0$/, '')}%`;
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
    at: r.at ?? 0,
    tz: r.tz,
    nextRunAt: r.nextRunAt ?? 0,
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
    online: m.online,
    ...(m.lastSeenAt !== undefined ? { lastSeenAt: m.lastSeenAt } : {}),
    enabledRuntimes: m.enabledRuntimes,
    ...(m.maxConcurrent !== undefined ? { maxConcurrent: m.maxConcurrent } : {}),
    ...(m.runningSteps !== undefined ? { runningSteps: m.runningSteps } : {}),
    ...(m.running !== undefined ? { runningHere: m.running } : {}),
    ...(m.capabilities !== undefined ? { capabilities: m.capabilities } : {}),
    ...(m.maxConcurrentOverridden !== undefined
      ? { maxConcurrentOverridden: m.maxConcurrentOverridden }
      : {}),
    ...(m.recommendedConcurrent !== undefined
      ? { recommendedConcurrent: m.recommendedConcurrent }
      : {}),
    ...(m.concurrencySource !== undefined ? { concurrencySource: m.concurrencySource } : {}),
    ...(m.concurrencyRange !== undefined ? { concurrencyRange: m.concurrencyRange } : {}),
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

export function toModelOptions(sources: ModelSource[]): ModelOption[] {
  const livenessByModelId = new Map<string, 'alive' | 'dead' | 'unknown'>();
  for (const source of sources) {
    for (const m of source.models) {
      if (m.id === '') continue;
      const lv = m.liveness ?? 'unknown';
      const prev = livenessByModelId.get(m.id);
      if (prev === undefined || (lv === 'dead' && prev !== 'dead')) {
        livenessByModelId.set(m.id, lv);
      }
    }
  }

  const options: ModelOption[] = [];
  const seen = new Set<string>();
  const push = (option: ModelOption) => {
    const ccDim = option.provider === 'claude-code' && option.machineId !== undefined;
    const key = ccDim ? `${option.provider}/${option.machineId}/${option.modelId}` : option.modelId;
    if (seen.has(key)) return;
    seen.add(key);
    const lv = livenessByModelId.get(option.modelId);
    if (lv !== undefined && lv !== 'unknown') option.liveness = lv;
    options.push(option);
  };
  for (const source of sources) {
    const providerLabel = RUNTIME_LABELS[source.runtime] ?? source.runtime;
    for (const m of source.models) {
      if (m.id === '') continue;
      push({
        provider: source.runtime,
        providerLabel,
        modelId: m.id,
        modelName: m.name,
        ...(source.machineId !== undefined ? { machineId: source.machineId } : {}),
      });
    }
  }
  return options;
}

export function chiefTurnErrorOfContent(content: unknown): string | null {
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
  return row.success ? row.data.message : null;
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

function chiefUserText(raw: string): string {
  return stripSkillRouteSection(raw.replace(WAKE_MARKER_PREFIX_RE, '')).trim();
}

function takeoverItemOf(call: ToolCallRecord, id: string): ChiefStreamItem {
  const reason = (call.arguments as { reason?: unknown } | null)?.reason;
  const finished = call.result !== undefined || call.endedAt !== undefined || call.isError === true;
  const handedBack =
    finished &&
    call.isError !== true &&
    (toolResultText(call.result) ?? '').includes(TAKEOVER_HANDED_BACK);
  return {
    kind: 'takeover',
    id,
    reason: typeof reason === 'string' ? reason : '',
    startedAt: call.startedAt ?? null,
    endedAt: call.endedAt ?? null,
    outcome: !finished ? 'waiting' : handedBack ? 'handed-back' : 'not-done',
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

export function mapChiefStream(messages: MessageRow[]): ChiefStreamItem[] {
  return collectChiefStream(messages).items;
}

function collectChiefStream(
  messages: MessageRow[],
  pendingIds: ReadonlyMap<string, 'queued' | 'held'> = new Map(),
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
  const postedTexts = new Set(
    messages
      .filter((m) => m.role === 'user' && !m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX))
      .map((m) => chiefUserText(textOfContent(m.content).trim())),
  );
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
    if (m.role === 'user' && m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)) {
      eventTurn = WAKE_MARKER_PREFIX_RE.test(textOfContent(m.content).trim());
      if (eventTurn) {
        pendingTools = [];
        continue;
      }
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
        ...rowProject(m),
      });
      continue;
    }
    const turnError = m.role === 'system' ? chiefTurnErrorOfContent(m.content) : null;
    if (turnError !== null) {
      pendingTools = [];
      items.push({ kind: 'error', text: turnError });
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
        continue;
      }
      const notice = chiefNoticeContentSchema.safeParse(parsed);
      if (notice.success) {
        pendingTools = [];
        items.push({ kind: 'robot', markdown: notice.data.message, seconds: '', id: m.id });
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
      const digest = chiefDigestContentSchema.safeParse(parsed);
      if (digest.success) {
        if (digest.data.items.length === 0) continue;
        pendingTools = [];
        items.push({
          kind: 'digest',
          id: m.id,
          reason: digest.data.reason,
          madeAt: digest.data.madeAt,
          items: digest.data.items,
        });
        continue;
      }
    }
    const call = toolCallOfContent(m.content);
    if (call?.name === SUGGEST_REPLIES_TOOL_NAME) continue;
    if (call?.name === 'request_takeover') {
      items.push(takeoverItemOf(call, m.id));
      continue;
    }
    if (call !== null) {
      const created = createdTodoOf(call);
      if (created !== null)
        pendingCards.push({ kind: 'task-card', id: `${m.id}:task-card`, ...created });
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
      if (m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX) && postedTexts.has(text)) continue;
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
    } else if (chiefStream[chiefStream.length - 1]?.kind !== 'robot' || trailingTools.length > 0) {
      const lastUser = collected?.items.findLastIndex((item) => item.kind === 'user') ?? -1;
      const turnStartedAt = lastUser >= 0 ? collected?.itemsAt[lastUser] : undefined;
      const turnQueue = active?.turnQueue ?? null;
      if (turnQueue != null) {
        const queued = connectingLine(turnQueue);
        chiefStream.push({
          kind: 'streaming',
          label: queued.label,
          ...(queued.vars !== undefined ? { labelVars: queued.vars } : {}),
          ...(queued.detail !== undefined ? { labelDetail: queued.detail } : {}),
        });
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
    view: 'none',
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

export function mapPlanVersions(plans: PlanRow[]): PlanVersion[] {
  return [...plans].reverse().map((p) => ({ v: `v${p.version}`, at: p.createdAt }));
}

export { relativeTime };
