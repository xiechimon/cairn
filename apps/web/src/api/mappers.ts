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
  TeamMember,
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
  CHIEF_TURN_ERROR_KIND,
  chiefModelFallbackContentSchema,
  chiefTurnErrorContentSchema,
  chiefTurnStoppedContentSchema,
  classifySkillFact,
  classifyStepFailure,
  classifyUserText,
  conversationBranch,
  GATE_ANNOUNCEMENTS,
  infoReportMessageSchema,
  MODEL_SOURCE_RUNTIME_LABELS,
  PLAN_SECTIONS,
  REVIEW_VERDICT_KIND,
  reviewVerdictSchema,
  stripAnsiEscapes,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  VERIFY_VERDICT_KIND,
  verifyVerdictSchema,
} from '@cairn/shared';
import { relativeTime } from '../board/rel-time.js';
import type {
  BranchInfoContent,
  ChiefContent,
  ChiefStreamItem,
  ChiefToolRow,
  DiffFile,
  DiffLine,
  ApiKeyRecord as DisplayApiKey,
  ScheduleRecord as DisplaySchedule,
  TodoRecord as DisplayTodo,
  DocBlock,
  DocSegment,
  MachineRow,
  McpRow,
  ModelOption,
  PlanDiffContent,
  PlanVersion,
  ProjectCommitRow,
  ReviewFinding,
  RunHistoryRow,
  SkillRow,
  TeamAgentCard,
  TeamContent,
  TokenUsageContent,
  TranscriptItem,
  UsageCostContent,
} from '../fixtures/records.js';
import { activityLabel } from './activity.js';
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
}

export function toDisplayTodo(w: WireTodo): DisplayTodo {
  const agentId = w.assignment?.build?.agentId ?? w.assignment?.plan?.agentId ?? null;
  return {
    id: w.id,
    teamId: w.teamId,
    projectId: w.projectId,
    title: w.title,
    spec: w.spec,
    phase: w.phase,
    phaseAt: w.phaseAt,
    seqNum: w.seqNum,
    orderIndex: w.orderIndex,
    tagIds: w.tagIds,
    assignment: agentId !== null ? { agentId } : null,
    agent: w.agent,
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
  return new Intl.DateTimeFormat('zh-CN', {
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

const MENTION_SCHEME = /\[([^\]\n]+?)\]\((agent|skill|project|machine|todo):([A-Za-z0-9_-]+)\)/g;

export function inlineSegments(text: string): DocSegment[] {
  const out: DocSegment[] = [];
  const parts = text.split(/`([^`]+)`/g);

  let delimiters = 0;
  for (let i = 0; i < parts.length; i += 2) {
    delimiters += (parts[i] ?? '').split('**').length - 1;
  }
  let budget = delimiters - (delimiters % 2);
  let strong = false;

  const pushRun = (frag: string): void => {
    if (frag === '') return;
    const pushText = (slice: string): void => {
      if (slice === '') return;
      out.push(strong ? { text: slice, style: 'strong' } : { text: slice });
    };
    let cursor = 0;
    MENTION_SCHEME.lastIndex = 0;
    for (;;) {
      const m = MENTION_SCHEME.exec(frag) as RegExpExecArray | null;
      if (m === null) break;
      pushText(frag.slice(cursor, m.index));
      out.push({
        text: m[1] ?? '',
        style: 'mention',
        mentionKind: m[2] as 'agent' | 'skill' | 'project' | 'machine' | 'todo',
        mentionId: m[3],
      });
      cursor = m.index + m[0].length;
    }
    if (cursor < frag.length) pushText(frag.slice(cursor));
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (part === '') continue;
    if (i % 2 === 1) {
      out.push({ text: part, style: 'code' });
      continue;
    }
    let rest = part;
    while (rest !== '') {
      const at = budget > 0 ? rest.indexOf('**') : -1;
      if (at < 0) {
        pushRun(rest);
        break;
      }
      pushRun(rest.slice(0, at));
      rest = rest.slice(at + 2);
      budget -= 1;
      strong = !strong;
    }
  }
  return out.length > 0 ? out : [{ text }];
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
  kind: '__tool__';
  call: ToolCallRecord;
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
  } = input;
  const head: TranscriptItem[] = [];
  if (build?.triggerSource === 'schedule') head.push({ kind: 'scheduled' });
  if (build?.triggerSource === 'chief') head.push({ kind: 'chief' });
  if (build) {
    const cancelled = steps.some((s) => s.status === 'stopped');
    head.push({
      kind: 'run',
      at: clockTime(build.createdAt),
      ...(machineName !== null ? { machine: machineName } : {}),
      ...(cancelled ? { cancelled: true } : {}),
    });
    if (steps.some((s) => s.skillInjection != null)) {
      const seen = new Map<string, string>();
      for (const s of steps) {
        for (const hit of s.skillInjection?.hits ?? []) {
          if (!seen.has(hit.id)) seen.set(hit.id, hit.reason);
        }
      }
      head.push({
        kind: 'injected-skills',
        skills: [...seen].map(([id, reason]) => ({ id, reason })),
      });
    }
  }

  const toolNameByResult = new Map<string, string>();
  for (const m of messages) {
    const paired = toolCallOfContent(m.content);
    if (paired === null) continue;
    const pairedText = resultToText(paired.result)?.trim();
    if (pairedText !== undefined && pairedText !== '')
      toolNameByResult.set(pairedText, paired.name);
  }

  const entries: TimelineEntry[] = [];
  for (const m of messages) {
    const call = toolCallOfContent(m.content);
    if (call !== null) {
      entries.push({ at: m.createdAt, item: toolItem(call) });
      continue;
    }
    const text = textOfContent(m.content).trim();
    if (m.role === 'user') {
      if (GATE_ANNOUNCEMENTS.includes(text)) {
        entries.push({
          at: m.createdAt,
          item: { kind: 'note', text: `${m.actor ?? userName} ${text}`, id: m.id },
        });
        continue;
      }
      if (classifyUserText(text, todo) !== 'user') continue;
      entries.push({ at: m.createdAt, item: { kind: 'user', text, markdown: text, id: m.id } });
      continue;
    }
    if (m.role === 'system') {
      if (systemKindOf(m.content) !== null) {
        const verdict = reviewVerdictOfContent(m.content);
        if (verdict !== null) {
          entries.push({ at: m.createdAt, item: { kind: 'review', ...verdict, id: m.id } });
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
            },
          });
          continue;
        }
        const verifyVerdict = verifyVerdictOfContent(m.content);
        if (verifyVerdict !== null) {
          entries.push({ at: m.createdAt, item: { kind: 'verify', ...verifyVerdict, id: m.id } });
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
      if (text !== '') entries.push({ at: m.createdAt, item: { kind: 'note', text, id: m.id } });
      continue;
    }
    if (text !== '') {
      entries.push({ at: m.createdAt, item: { kind: 'robot', markdown: text, id: m.id } });
      continue;
    }
    const thinking = m.role === 'assistant' ? thinkingOfContent(m.content) : null;
    if (thinking !== null)
      entries.push({ at: m.createdAt, item: { kind: 'thinking', text: thinking, id: m.id } });
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
        preview: preview.length > 90 ? `${preview.slice(0, 90)}…` : preview,
      },
    });
  });
  if (build?.withPlan === true) {
    for (const s of steps) {
      if (s.kind === 'build') {
        entries.push({ at: s.createdAt, item: { kind: 'user', text: '确认' } });
      }
    }
  }

  entries.sort((a, b) => a.at - b.at);
  const items: TranscriptItem[] = [...head];
  let toolRun: { seconds: number; pills: string[]; outputs: (string | null)[] } | null = null;
  const flushTools = () => {
    if (toolRun !== null) {
      items.push({
        kind: 'tools',
        seconds: toolRun.seconds,
        expanded: false,
        pills: toolRun.pills,
        outputs: toolRun.outputs,
      });
      toolRun = null;
    }
  };
  for (const e of entries) {
    if (e.item.kind === '__tool__') {
      const secs = durationSeconds(e.item.call);
      toolRun = toolRun ?? { seconds: 0, pills: [], outputs: [] };
      toolRun.seconds += secs;
      toolRun.pills.push(pillOf(e.item.call));
      const output = resultToText(e.item.call.result);
      toolRun.outputs.push(output !== null && isJsonPlumbing(output) ? null : output);
      continue;
    }
    flushTools();
    items.push(e.item);
  }
  flushTools();

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
    items.push({ kind: 'skills', read: readSkills, denied: skillDeniedNames });
  }

  const running = steps.find(
    (s) => s.status === 'claimed' || s.status === 'pending' || s.status === 'waiting_quota',
  );
  if (running && build) {
    if (liveThinking.trim() !== '') {
      items.push({ kind: 'thinking', text: liveThinking });
    }
    if (liveText.trim() !== '') {
      items.push({
        kind: 'robot',
        paragraphs: [{ segments: [{ text: liveText }] }],
      });
    }
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
  } else if (build && todo.phase === 'building' && !steps.some((s) => s.status === 'stopped')) {
    items.push({ kind: 'streaming', label: '执行中...' });
  }

  if (build?.errorMessage && todo.phase === 'failed') {
    items.push({
      kind: 'fail',
      title: stripAnsiEscapes(build.errorMessage),
      body: failGuidanceBody(classifyStepFailure(build.errorMessage)),
    });
  }
  return items;
}

function failGuidanceBody(kind: ReturnType<typeof classifyStepFailure>): string {
  switch (kind) {
    case 'network':
      return '请将其重新上线，或重新运行任务以改派其他机器。';
    case 'quota':
      return '模型额度已用尽，请等待额度恢复后重试。';
    case 'capacity':
      return '请求被限流，请稍后重试。';
    default:
      return '运行失败，请查看原始错误排查原因后重试。';
  }
}

function toolItem(call: ToolCallRecord): ToolEntry {
  return { kind: '__tool__', call };
}

function durationSeconds(call: ToolCallRecord): number {
  if (call.startedAt !== undefined && call.endedAt !== undefined) {
    return Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000));
  }
  return 0;
}

function resultToText(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === 'string') return result === '' ? null : result;
  if (Array.isArray(result)) {
    const joined = result
      .map(resultToText)
      .filter((s): s is string => s != null && s !== '')
      .join('\n');
    return joined === '' ? null : joined;
  }
  if (typeof result === 'object') {
    const o = result as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text === '' ? null : o.text;
    for (const key of ['content', 'output', 'stdout', 'result'] as const) {
      if (o[key] !== undefined) {
        const nested = resultToText(o[key]);
        if (nested != null && nested !== '') return nested;
      }
    }
  }
  return null;
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

export function mapCommits(
  commits: {
    sha: string;
    shortSha: string;
    message: string;
    authorName: string;
    at: number;
  }[],
): ProjectCommitRow[] {
  return commits.map((c) => ({
    id: c.sha,
    shortSha: c.shortSha,
    message: c.message,
    authorName: c.authorName,
    at: c.at,
  }));
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
    const parts = [relativeTime(entry.createdAt, now)];
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
    todo: r.todo,
  }));
}

export function mapTeam(members: TeamMember[]): TeamContent {
  const agents = members.filter((m) => m.memberType === 'agent');
  const cards: TeamAgentCard[] = agents.map((m) => {
    const a = m.actor as {
      displayName?: string;
      avatarUrl?: string | null;
      modelId?: string | null;
      description?: string | null;
      provider?: string | null;
      machineId?: string | null;
    };
    return {
      id: m.actorId,
      displayName: a.displayName ?? '',
      avatarUrl: a.avatarUrl ?? null,
      model: a.modelId ? `${a.modelId} · 默认` : '未配置模型',
      isDefault: false,
      role: a.description ?? null,
      provider: a.provider ?? null,
      machineId: a.machineId ?? null,
    };
  });
  return { members: members.length, agents: cards };
}

export function mapApiKeys(rows: ApiKeyRow[]): DisplayApiKey[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    masked: r.masked,
    gitAccess: r.gitAccess,
    mcpAccess: r.mcpAccess,
  }));
}

export function mapMachines(rows: MachineRecord[]): MachineRow[] {
  const local = rows.filter((m) => m.kind === 'local');
  const attached = rows.filter((m) => m.kind !== 'local');
  return [...local, ...attached].map((m) => ({
    id: m.id,
    kind: m.kind,
    name: m.name,
    online: m.online,
    enabledRuntimes: m.enabledRuntimes,
    ...(m.maxConcurrent !== undefined ? { maxConcurrent: m.maxConcurrent } : {}),
    ...(m.runningSteps !== undefined ? { runningSteps: m.runningSteps } : {}),
    ...(m.capabilities !== undefined ? { capabilities: m.capabilities } : {}),
    ...(m.maxConcurrentOverridden !== undefined
      ? { maxConcurrentOverridden: m.maxConcurrentOverridden }
      : {}),
    ...(m.recommendedConcurrent !== undefined
      ? { recommendedConcurrent: m.recommendedConcurrent }
      : {}),
    ...(m.concurrencySource !== undefined ? { concurrencySource: m.concurrencySource } : {}),
    ...(m.concurrencyRange !== undefined ? { concurrencyRange: m.concurrencyRange } : {}),
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
  };
}

const CHIEF_HERO_EXAMPLES = [
  { icon: 'user-plus' as const, text: '帮我组建 Agent 团队' },
  { icon: 'folder' as const, text: '帮我创建一个新项目' },
  { icon: 'grid' as const, text: '总结一下我所有项目现在的进展' },
  { icon: 'bars' as const, text: '查一下这个月的 token 用量' },
];

const WAKE_MARKER_PREFIX_RE = /^\[wake:\w+\]\s*/;

function stripWakeMarker(text: string): string {
  return text.replace(WAKE_MARKER_PREFIX_RE, '');
}

function handoffTodoOf(call: ToolCallRecord): string | null {
  if (call.name !== 'message_todo' || call.result === undefined || call.isError === true)
    return null;
  const todoId = (call.arguments as { todoId?: unknown } | null)?.todoId;
  return typeof todoId === 'string' && todoId !== '' ? todoId : null;
}

export function mapChiefStream(messages: MessageRow[], inlineTools = false): ChiefStreamItem[] {
  return collectChiefStream(messages, inlineTools).items;
}

function collectChiefStream(
  messages: MessageRow[],
  inlineTools = false,
  pendingIds: ReadonlyMap<string, 'queued' | 'held'> = new Map(),
): {
  items: ChiefStreamItem[];
  trailingTools: ChiefToolRow[];
  pending: ChiefStreamItem[];
} {
  const items: ChiefStreamItem[] = [];
  const pendingById = new Map<string, ChiefStreamItem>();
  let fallback: { model: string; stepId: string } | null = null;
  const postedTexts = new Set(
    messages
      .filter((m) => m.role === 'user' && !m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX))
      .map((m) => stripWakeMarker(textOfContent(m.content).trim())),
  );
  let pendingTools: ChiefToolRow[] = [];
  for (const m of messages) {
    if (m.role === 'user' && fallback !== null) {
      const stepOfRow = m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)
        ? m.id.slice(TRANSCRIPT_PROMPT_ROW_ID_PREFIX.length)
        : m.id;
      if (stepOfRow !== fallback.stepId) fallback = null;
    }
    const pendingState = m.role === 'user' ? pendingIds.get(m.id) : undefined;
    if (pendingState !== undefined) {
      const text = textOfContent(m.content).trim();
      pendingById.set(m.id, {
        kind: 'user',
        text,
        id: m.id,
        markdown: text,
        pending: pendingState,
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
    }
    const call = toolCallOfContent(m.content);
    if (call !== null) {
      pendingTools.push({
        label: pillOf(call),
        ...(call.startedAt !== undefined && call.endedAt !== undefined
          ? { seconds: Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000)) }
          : {}),
        ...(call.isError === true ? { error: true } : {}),
      });
      if (inlineTools) {
        items.push({
          kind: 'tool',
          label: pillOf(call),
          id: m.id,
          ...(call.startedAt !== undefined ? { startedAt: call.startedAt } : {}),
          ...(call.startedAt !== undefined && call.endedAt !== undefined
            ? { seconds: Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000)) }
            : {}),
          ...(call.result === undefined ? { running: true } : {}),
          ...(call.isError === true ? { error: true } : {}),
        });
      }
      const handoffTodoId = handoffTodoOf(call);
      if (handoffTodoId !== null)
        items.push({ kind: 'handoff', todoId: handoffTodoId, id: `${m.id}:handoff` });
      continue;
    }
    const ask = m.role === 'assistant' ? askQuestionOfContent(m.content) : null;
    if (ask !== null) {
      pendingTools = [];
      items.push({
        kind: 'question',
        id: m.id,
        requestId: ask.requestId,
        status: ask.status,
        questions: ask.questions,
        answers: ask.answers,
      });
      continue;
    }
    const rawText = textOfContent(m.content).trim();
    if (rawText === '') {
      const thinking = m.role === 'assistant' ? thinkingOfContent(m.content) : null;
      if (thinking !== null) items.push({ kind: 'thinking', text: thinking, id: m.id });
      continue;
    }
    if (m.role === 'user') {
      const text = stripWakeMarker(rawText);
      if (text === '') continue;
      if (m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX) && postedTexts.has(text)) continue;
      pendingTools = [];
      items.push({ kind: 'user', text, id: m.id, markdown: text });
      continue;
    }
    if (m.role === 'system') continue;
    items.push({
      kind: 'robot',
      markdown: rawText,
      seconds: '',
      id: m.id,
      ...(pendingTools.length > 0 ? { tools: pendingTools } : {}),
      ...(fallback !== null ? { fallbackModel: fallback.model } : {}),
    });
    pendingTools = [];
  }
  const pending = [...pendingIds.keys()].flatMap((id) => {
    const item = pendingById.get(id);
    return item === undefined ? [] : [item];
  });
  return { items, trailingTools: pendingTools, pending };
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
  const collected = active === null ? null : collectChiefStream(opts.messages, running, pendingIds);
  const chiefStream: ChiefStreamItem[] = collected?.items ?? [];
  if (running) {
    if ((opts.liveThinking ?? '').trim() !== '') {
      chiefStream.push({ kind: 'thinking', text: opts.liveThinking ?? '' });
    }
    if ((opts.liveText ?? '').trim() !== '') {
      chiefStream.push({
        kind: 'robot',
        markdown: autoCloseStrong(opts.liveText ?? ''),
        typing: true,
        seconds: '',
      });
    } else if (chiefStream[chiefStream.length - 1]?.kind !== 'robot') {
      const turnQueue = active?.turnQueue ?? null;
      if (turnQueue != null) {
        const queued = queueLabel(turnQueue);
        chiefStream.push({
          kind: 'streaming',
          label: queued.label,
          labelVars: queued.vars,
        });
      } else {
        const actLabel = opts.activity != null ? activityLabel(opts.activity) : null;
        chiefStream.push({
          kind: 'streaming',
          label: actLabel?.label ?? '处理中...',
          ...(actLabel?.vars !== undefined ? { labelVars: actLabel.vars } : {}),
          ...(opts.activity != null ? { signalAt: opts.activity.at } : {}),
          ...((collected?.trailingTools.length ?? 0) > 0
            ? { tools: collected?.trailingTools }
            : {}),
        });
      }
    }
  }
  chiefStream.push(...(collected?.pending ?? []));
  return {
    view: 'drawer',
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
    ...(opts.threads.length > 0
      ? {
          threads: opts.threads.map((t) => ({
            title: t.title,
            ...(t.id === opts.activeThreadId ? { active: true } : {}),
          })),
        }
      : {}),
    ...(active === null ? { examples: CHIEF_HERO_EXAMPLES } : { stream: chiefStream }),
    ...(running ? { running: true } : {}),
    ...(opts.activity?.phase === 'tool' && opts.activity.tool != null
      ? { runningTool: opts.activity.tool }
      : active?.activeRun?.tool != null
        ? { runningTool: active.activeRun.tool.toolName }
        : {}),
    ...(opts.draft !== undefined ? { draft: opts.draft } : {}),
    ...(env.outage != null ? { outage: env.outage } : {}),
    ...(active?.fallbackModel != null ? { fallbackModel: active.fallbackModel } : {}),
  };
}

export function mapPlanVersions(plans: PlanRow[]): PlanVersion[] {
  return [...plans].reverse().map((p) => ({ v: `v${p.version}`, at: p.createdAt }));
}

export { relativeTime };
