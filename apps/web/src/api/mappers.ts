// wire → display mappers（M5 汇合，#83）：live 模式把 server 的 02 §6.2
// record 形状投影成既有显示契约（fixtures/records.ts——像素矩阵冻结的组件
// props 面）。fixture 模式不经过本模块；两模式在组件处消费同一显示形状 =
// 「一个显示契约、两个数据源」的汇合缝（03 §1 R5）。
//
// 呈现规则出处：transcript 行族 = r7 16/17/26/27/36/38 + r8 54/73/76 实测；
// overlay 三件 = r7 30/31/32 + r8 77；工具 pill 形 = `<name> <主参数>`
// （r7 27b `edit README.md` 族）；运行历史行 = r3 §3.8
// `第 N 次运行 · 相对时间 · tokens · 错误`。

import type {
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
  ScheduleRecord as WireSchedule,
  TodoRecord as WireTodo,
} from '@pacman/shared';
import {
  ASK_USER_QUESTION_KIND,
  askUserQuestionContentSchema,
  BRAND,
  CHIEF_TURN_ERROR_KIND,
  chiefTurnErrorContentSchema,
  classifySkillFact,
  classifyStepFailure,
  classifyUserText,
  conversationBranch,
  GATE_ANNOUNCEMENTS,
  MODEL_SOURCE_RUNTIME_LABELS,
  PLAN_SECTIONS,
  REVIEW_VERDICT_KIND,
  reviewVerdictSchema,
  stripAnsiEscapes,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
  VERIFY_VERDICT_KIND,
  verifyVerdictSchema,
} from '@pacman/shared';
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
} from '../fixtures/records.js';
import { activityLabel } from './activity.js';
import type { ApiKeyRow, PlanRow, StepRow } from './hooks.js';

/** #1108 排队行标签（transcript / chief 两面单源）：位次 + 等待对象 →
 *  label/vars（t() 键 + 插值；queue = server 排队投影真值）。形 =
 *  shared stepJournalRowSchema.queue / chiefThreadSchema.turnQueue。
 *  #1257：额度挂起中（queue.hold）的排队行呈现「等额度」而非「等空闲机器」
 *  ——挂起 ≠ 排队，可见态钉住下次尝试时刻。
 *  #1251 blocked 位次之（成因仍先于位次——「等谁」比「排第几」更可操作）：
 *  capability-missing = 给修法（缺项点名 + 装齐即解锁）；machine-offline =
 *  给等待（等机器上线，钉选面点名机器）。hold 先于 blocked：步级挂起带
 *  下次尝试时刻，更具体。 */
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

/** #1261 等额度行标签（waiting_quota 步）：哪一路 relay + 事件类型 + 下次
 * 探测时刻——「静默窗口里板面说真话」的详情页半（queueLabel 同族）。 */
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

/** transcript 消息行（GET messages 封套行形，shared transcriptRowSchema）。
 * actor（#902）：过闸宣告行的动作主体 displayName；存量旧行/daemon 上传行 =
 * null/缺省，宣告行呈现回落当前用户名（旧语义不变）。 */
export interface MessageRow {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  createdAt: number;
  actor?: string | null;
}

// —— todo ————————————————————————————————————————————————————————————————

export function toDisplayTodo(w: WireTodo): DisplayTodo {
  // 显示契约 assignment = 扁平 {agentId}（r3 §3.0 卡面单值）；wire 双槽
  // （02 §6.2 plan/build）折向执行槽、退规划槽。
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
    // awaitingReply = 显示扩展（r5b §3.15 [推断] wire 位）——live 侧无对应
    // wire 字段，恒缺省（等待回复面由 review+composer 呈现，不造假值）。
    // #640：总管建卡判定位 = sourceBuildId（chief 实例 id，r5 §3.2 溯源层
    // 「谁建的」）——看板卡「由总管创建」芯片消费。
    chiefCreated: w.sourceBuildId !== null,
    // #1257 板面挂起态（server 读侧派生）：等机器 / 等额度——卡面挂起 chip
    // 消费；缺席 = 未挂起（正常排队 / 在跑 / 终态）。
    waitingOn: w.waitingOn ?? undefined,
    // #1261 等额度投影（板面卡态/横幅判定位）；无挂起 = null（fixture 面
    // 键缺席同形——undefined 折叠进 null）。
    quotaWait: w.quotaWait ?? null,
  };
}

// —— 数值/时间格式 ————————————————————————————————————————————————————————

/** token 计数显示形（r3 §3.8：`854` / `38.3k` / `435.5k`）。 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

/** `HH:MM` 时间戳行（r7 26 `13:35`；本地时区 = live 语义，fixture 侧另有
 * 冻结时钟）。 */
export function clockTime(ms: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms);
}

// —— 消息内容归一（pi 内容块 / 纯文本 / toolcall 行 / system JSON）———————————

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

/** content 里的 thinking 文本（#955 段行）：只在**没有非空 text** 的 assistant
 *  行上取——混合行（存量的原始块数组）仍走 text 面，思考不重复呈现。 */
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

/** 解析 REVIEW_VERDICT_KIND 系统消息的 verdict（M7 #330，r8 §3.1）：
 * server `applyBuildStepAction` 完成时 emit `{kind:'review_verdict',
 * verdict: ReviewVerdict}` system 消息；校验失败 = null（兜底退化为空
 * findings 渲染——service 侧 zod 兜底已固，不会真触发）。#700：daemon
 * 提取失败时 server 附 extractionError（原因原文）——审核面据此渲染
 * 「判定提取失败」行（区别于「审核未返回结论」兜底）。 */
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

/** 解析 VERIFY_VERDICT_KIND 系统消息的 verdict（#1250 / ADR 0018 层 1）：
 * server completeStep verify 分支 emit `{kind:'verify_verdict', verdict:
 * VerifyVerdict}` system 消息；校验失败 = null（退化退场——service 侧 zod
 * 已固）。extractionError 同 review 律（#700）：提取失败原因原文，验证面
 * 据此渲染「判定提取失败」（区别于「验证未返回结论」兜底）。 */
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

/** 工具 pill 文案（r7 27b `edit README.md` / `bash <命令>` 族；命令全长随
 * CSS ellipsis 截断——mapper 不截，行形与 fixture 一致）。 */
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

// —— plan.md → DocBlock（文档 pane；四段卡软结构，r3 §3.3）———————————————

/** Mention scheme scan (r9 wire): `[label](kind:id)` for all five schemes.
 *  #675: `todo:` joins the family — the chief system prompt instructs the
 *  exact shape `[#n](todo:<id>)` (services/chief.ts) and the reference wire
 *  carries it (todos.dev chief messages + todo specs, live-captured
 *  2026-10-03), so dropping it leaked raw markdown literals into the
 *  transcript. The composer-side plain `#seq` form (r9 §3.2, emitted by
 *  overlay/mention-token.ts serializeMention) stays plain text by design:
 *  recovering a chip from a bare `#N` needs a seq→todo lookup table that
 *  does not exist yet, and an unguarded `#N` pattern would eat prose
 *  ("PR #487"). Single global regex, reset before each use. */
const MENTION_SCHEME = /\[([^\]\n]+?)\]\((agent|skill|project|machine|todo):([A-Za-z0-9_-]+)\)/g;

/** 行内 `code` 芯片 + `**bold**` strong 段 + 提及方案切分（r7 17 段内 mono
 * chip）。#650：bold 位补进显示契约（#311 时「无 bold 位、`**` 只剥不渲染」
 * 的旧裁决被总管抽屉实测推翻）——成对 `**` 定界符之间的文本切 strong 段，
 * 落单的定界符按 CommonMark 语义留字面（不吞尾段）。#311：mention 方案的
 * `[name](agent:<id>)` / `[name](skill:<id>)` / `[name](project:<id>)` /
 * `[name](machine:<id>)`，以及 #675 补上的 `[#n](todo:<id>)`，都切出独立
 * mention 段,带 mentionKind + mentionId 给 segments 渲染对应 accent 与
 * todo 位的点击导航。mention 段内不展开嵌套 scheme（r9 wire 形只一层）；
 * strong 段内 mention 照常出 chip（chip 形压过粗体，同单层律）。 */
export function inlineSegments(text: string): DocSegment[] {
  const out: DocSegment[] = [];
  // First pass — extract `code` segments (split is lossless, even
  // alternation indices are non-code, odd are code). Code runs are pulled
  // out before any emphasis scan, so asterisks inside a code span never
  // act as delimiters.
  const parts = text.split(/`([^`]+)`/g);

  // Second pass (#650) — count the `**` delimiters across the non-code
  // runs, in document order. They pair up (0,1), (2,3), …; an odd trailing
  // delimiter is a literal character, not a marker. Pairing runs across
  // code spans (the strong state survives a code run), so a bold lead-in
  // wrapping an inline chip keeps its chain.
  let delimiters = 0;
  for (let i = 0; i < parts.length; i += 2) {
    delimiters += (parts[i] ?? '').split('**').length - 1;
  }
  let budget = delimiters - (delimiters % 2);
  let strong = false;

  // Plain-text run → mention chips + text segments (bold flag rides along).
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
        // #675: the wire id rides along — the todo chip's click navigation
        // (detail/segments.tsx) resolves its route from it, no re-parse.
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

/** `Context: …` section label → head + the rest of the line (XMON-55 P2).
 *  plan.md's four canonical sections are written by the LLM as bare
 *  `Label:` openers far more often than as markdown headings, and they used
 *  to render as undifferentiated body text — the pane showed four topics at
 *  one size with nothing marking where each began. The label vocabulary is
 *  the wire canon (PLAN_SECTIONS, packages/shared/records/plan.ts), so this
 *  reads the contract rather than guessing at structure. */
function planSectionHead(line: string): { label: string; rest: string } | null {
  const m = /^([A-Za-z][A-Za-z ]{0,24}?)\s*:\s*(.*)$/.exec(line);
  if (m == null) return null;
  const label = m[1]?.trim() ?? '';
  if (!PLAN_SECTIONS.some((s) => s.toLowerCase() === label.toLowerCase())) return null;
  return { label, rest: m[2] ?? '' };
}

/** plan.md markdown-lite → DocBlock[]（# 标题 / - 列表 / 段落 / 四段标签；
 *  四段正文仍为 LLM 自由文本，只认标签行，不解析其内容，r3 §3.3）。 */
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

// —— diff（unified → 显示契约；双侧行号展开 = 渲染层义务，01 §4.1）———————

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
  /** #244: to 版本 plan.md 全文（plans 读面已载）→ 单文件 fullContent 槽，
   *  plan-diff 面「显示完整文件」数据源。files[0] 位置安全：document-diff
   *  单文件 plan.md 由 server 构造保证（documents.ts computeUnifiedDiff
   *  `files: [file]`）。 */
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

// —— transcript 组装（时间线 = 消息行 + 步标记 + plan 卡 + live 尾部）——————

/** 工具行中间形态（组装期折叠成 tools 组用；不进产物）。 */
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
  /** conversation stream text_delta 累积（live 打字面；'' = 无进行中文本）。 */
  liveText: string;
  /** conversation stream thinking_delta 累积（#1308；'' = 无在飞思考）。 */
  liveThinking?: string;
  /** 停止钮确认后的过渡态（M7 #308，r9 §3.3「正在停止…」）：stop 已被
   * 受理、步终态未回（live 面本地旗标；缺省 false = 捕获面不受扰）。 */
  stopping?: boolean;
  /** #905 步活动相位（activityStore 读侧；缺省/null = 无信号——旧 server、
   *  fixture 捕获或静默窗口，streaming 行回落既有基础标签）。消费侧带
   *  stepId 过滤：陈旧步的相位不挂到在跑步头上（W1）。 */
  activity?: StepActivity | null;
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
  } = input;
  const head: TranscriptItem[] = [];
  if (build?.triggerSource === 'schedule') head.push({ kind: 'scheduled' });
  if (build?.triggerSource === 'chief') head.push({ kind: 'chief' });
  if (build) {
    // 运行行终态「已取消」（M7 #308，r9 §3.3）：本 build 有 stopped 步 =
    // 被停止的运行（数据面 = step.status 词表，shared stepStatusSchema）。
    const cancelled = steps.some((s) => s.status === 'stopped');
    head.push({
      kind: 'run',
      at: clockTime(build.createdAt),
      ...(machineName !== null ? { machine: machineName } : {}),
      ...(cancelled ? { cancelled: true } : {}),
    });
    // #1106 注入选择回查行（票面验收 4）：本 build 各步 claim 落库的
    // step.skillInjection 汇总——技能 id 首见序、reason 取首见条目。任一步
    // 有记录（含 hits=[]，已计算零命中）即产行；全部 null（chief 面 / 旧
    // server）不产行零噪声。
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

  // #634: host 工具结果回声（pi 的 tool-result 消息以 role=system 文本块落库）
  // 与它的 toolcall 行按结果文本配对——配对结果决定回声拿人类面孔还是退场。
  const toolNameByResult = new Map<string, string>();
  for (const m of messages) {
    const paired = toolCallOfContent(m.content);
    if (paired === null) continue;
    const pairedText = resultToText(paired.result);
    if (pairedText !== null && pairedText !== '') toolNameByResult.set(pairedText, paired.name);
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
      // 宣告行 content = shared 单源常量（server 写入端同款）：合并 r3 §3.6，
      // 审核 r8 §3.1，确认/done 落地 #902——同族 note 行形，不是气泡。
      // actor 位（#902）：行自带主体（人/chief Agent displayName）优先，
      // 存量旧行无 actor 回落当前用户名（旧行呈现逐字不变）。
      if (GATE_ANNOUNCEMENTS.includes(text)) {
        entries.push({
          at: m.createdAt,
          item: { kind: 'note', text: `${m.actor ?? userName} ${text}`, id: m.id },
        });
        continue;
      }
      // 系统合成 prompt 行（#612，词表单源 = shared records/prompts）：
      // 任务文本（title+spec）不成气泡——用户原话的唯一展示面是线程列首的
      // 描述区，本行是它的 daemon 侧合成版，呈现即双渲染（用户报的套娃）；
      // 续轮指令 / replan/restart 模板 / 审核材料整行退场——都不是用户的话。
      if (classifyUserText(text, todo) !== 'user') continue;
      // 真实用户话语带 markdown 槽（robot 行 #469 同款）：渲染期走
      // chat-markdown，用户写的围栏/列表/标题不再按字面裸排。taskline
      // （seq/title）不挂：它是 capture 里任务开头气泡的装饰，任务文本行
      // 退场后没有合法宿主——且本循环按落库序迭代、显示序在 sort 之后才
      // 成立，「首条」在 steer 早于终稿上传落库时会认错行；#seq+标题的真值
      // 展示位是 dhead。fixture 捕获面自带 seq/title，渲染路径保留。
      entries.push({ at: m.createdAt, item: { kind: 'user', text, markdown: text, id: m.id } });
      continue;
    }
    if (m.role === 'system') {
      // machine_selected JSON 行 = run 戳数据面（顶部已渲染）——不重复成行。
      if (systemKindOf(m.content) !== null) {
        // AI 审核 verdict 消息（M7 #330，r8 §3.1）= 结论段 + 编号 findings +
        // 严重度标签；不是抽象 system kind（具形状）。
        const verdict = reviewVerdictOfContent(m.content);
        if (verdict !== null) {
          entries.push({ at: m.createdAt, item: { kind: 'review', ...verdict, id: m.id } });
          continue;
        }
        // 验证步 verdict 消息（#1250）= pass/fail 徽标 + 总结 + 证据清单。
        const verifyVerdict = verifyVerdictOfContent(m.content);
        if (verifyVerdict !== null) {
          entries.push({ at: m.createdAt, item: { kind: 'verify', ...verifyVerdict, id: m.id } });
        }
        continue;
      }
      // #634: 回声行不裸排 JSON——配对到 toolcall 的按工具拿人类面孔（无面孔
      // 即退场）；未配对的纯 JSON system 行同律退场（管线无人类面孔）。
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
    // assistant 文本行 → robot 块级 markdown（#469：原文直入 markdown 槽，
    // 标题/有序无序列表/代码围栏由 chat-markdown 渲染器在渲染期解析——不再
    // 把块结构摊平成 chat-para；行内 code 仍走 inlineSegments 的 .chat-code
    // 芯片。空文本行跳过——pi 工具轮的空 content）。
    if (text !== '') {
      entries.push({ at: m.createdAt, item: { kind: 'robot', markdown: text, id: m.id } });
      continue;
    }
    // #955：思考段行——无正文的 assistant 行若是 thinking 块，单列一行（与
    // 总管抽屉同一张脸；两面同改，不给共享层加分支）。
    const thinking = m.role === 'assistant' ? thinkingOfContent(m.content) : null;
    if (thinking !== null)
      entries.push({ at: m.createdAt, item: { kind: 'thinking', text: thinking, id: m.id } });
  }

  // 步标记：确认气泡（withPlan 的执行步入队时刻 = 确认点击，r7 26d）+
  // plan 卡（第 i 个规划步 ↔ plan v(i+1)，方案就绪时刻 = 步 createdAt 近似）。
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
  // 连续工具行折叠成 tools 组（r7 27 collapsed `完成 Ns ▸` + pills）。#469：
  // 每个 call 的 stdout/stderr（call.result）按 index 平行收进 outputs，渲染
  // 层在展开的组里给每个 pill 挂一块左对齐等宽输出——终端内容不再摊平进
  // .chat-note 居中灰通知。
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
      // #634: 纯 JSON 结果（host 工具回声同族管线）不挂输出板——展开组里那
      // 条灰板正是用户红圈一的不协调源；终端文本输出照旧（#469 律）。
      const output = resultToText(e.item.call.result);
      toolRun.outputs.push(output !== null && isJsonPlumbing(output) ? null : output);
      continue;
    }
    flushTools();
    items.push(e.item);
  }
  flushTools();

  // #918 技能事实汇总（详情页的持久一份）：从落库 toolcall 行派生——终态行
  // 才计（result 在位；开始半行会被同 id 的终态 upsert 覆盖）。分类单源
  // shared/skill-facts（与 daemon 活行判定同一函数，两面永不漂移）。同名去重、
  // denied 粘滞（daemon tracker 同律）：挡下的技能不再出现在读列。无命中 =
  // 不产条目（对照组：无技能的任务零噪声）。
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

  // live 尾部：进行中文本（打字面）+ streaming 行（r7 16 `准备工作区...` /
  // 26 `处理中...`）。running 步存在才挂尾。#1261 增 waiting_quota（配额挂起
  // 步在跑语义：agent 不在跑但步在飞——标签走「等额度」而非「处理中」，
  // 静默窗口里板面说真话）。
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
    // #905：活动相位接管行标签——stepId 对在跑步过滤（W1 陈旧相位不跨步）；
    // stopping 过渡态优先级更高（停止在途比模型相位更要解释）；无信号 =
    // 既有基础标签原样（fixture 捕获 / 旧 server 零回归）。
    // #1108 排队位优先于以上全部：步仍 pending（无人认领）且带投影 →
    // 「排队中」+ 位次 + 等待对象——「处理中」对 pending 是谎（用户实测
    // 18 分钟静默阻塞）。投影缺席（老 server / fixture）= 既有标签原样，
    // 零回归。
    const act = activity != null && activity.stepId === running.id ? activity : null;
    const actLabel = act != null && !stopping ? activityLabel(act) : null;
    const queued =
      running.status === 'pending' && running.queue != null ? queueLabel(running.queue) : null;
    // #1261 等额度标签（waiting_quota 步）：优先于活动相位——挂起步不在跑，
    // act 是断粮前轮的陈旧信号（用户实测「正在连接模型」跨整段静默期说谎，
    // live 探针两跑两形复现）；queued 是 pending 专属恒不冲突。投影缺席
    // （老 server / fixture 无该字段）= 落回既有标签，零回归。
    const quota =
      running.status === 'waiting_quota' && running.quotaWait != null
        ? quotaWaitLabel(running.quotaWait)
        : null;
    items.push({
      kind: 'streaming',
      // #873：不在投影期把「已用秒数」算成一个死数——投影只在别的事件驱动
      // 重渲时才跑，静默窗口里那个数会冻住说谎（用户实测卡在 1s）。挂真实
      // 起点，走秒归渲染层的 1s 计时器（live-row 的 useLiveSeconds）。
      startedAt: running.createdAt,
      label:
        queued != null
          ? queued.label
          : quota != null
            ? quota.label
            : actLabel != null
              ? actLabel.label
              : stopping
                ? '正在停止…' // 停止过渡态（M7 #308，r9 §3.3：中断在途）
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
      // 排队行不挂相位面（signalAt/skills 是执行态信号——步没在跑，相位是
      // 上一步残留；W1 的 stepId 过滤管跨步，这里管「排队的当前步」）。#1261
      // 等额度行同律：act 是断粮前轮的陈旧信号（挂起期步不在跑），不随行披露。
      ...(queued == null && quota == null && actLabel != null && act != null
        ? { signalAt: act.at }
        : {}),
      // #918：本步技能事实清单随 activity 事件进披露面（stepId 过滤已由上面
      // 的 act 判定承担——陈旧步的技能条目不跨步串场）。空/缺省不产字段。
      ...(queued == null && quota == null && act?.skills !== undefined && act.skills.length > 0
        ? { skills: act.skills }
        : {}),
    });
  } else if (build && todo.phase === 'building' && !steps.some((s) => s.status === 'stopped')) {
    // 静止态 live 线索（#471）：building 的步间隙 / agent 非流式窗口没有
    // claimed/pending 步——对话区不能全静（实测唯一线索只剩头部「执行中」
    // chip）。挂同族 streaming 行（spinner reel + 静态标签，渲染共用
    // transcript 组件）；不挂秒数计数：静止期没有流事件驱动重渲，挂上去
    // 只会冻结说谎。stopped 步在场 = 本轮已被停止钮终结（run 行挂「已取
    // 消」终态），phase 未翻篇的窗口里不再自称执行中。
    items.push({ kind: 'streaming', label: '执行中...' });
  }

  // 失败行（r8 54/73 canon：橙色标题 + 指引 + 链接行）。#1262：显示侧纯文本
  // 兜底——写入侧（daemon 落库前）已剥，这里再剥一次覆盖存量脏行与漏网路径
  // （幂等，无转义输入零改动）。#1258：links 硬编码死链出账——查看原始错误
  // 由渲染层接成真按钮（弹窗给 title 全文），排查指南无文档落点不渲染
  // （裁决全文见 transcript.tsx FailRow / records.ts 注）。
  if (build?.errorMessage && todo.phase === 'failed') {
    items.push({
      kind: 'fail',
      title: stripAnsiEscapes(build.errorMessage),
      body: failGuidanceBody(classifyStepFailure(build.errorMessage)),
    });
  }
  return items;
}

/** #1285 失败行指引按分类分族，不走一刀切机器离线文案。
 *  - network → 连接断（机器离线族）→ 上线 / 改派指引
 *  - quota → 额度空 → 等待恢复指引
 *  - capacity → 限流 → 稍后重试指引
 *  - other → 模型错误/上下文超长/未知 → 通用排查指引 */
function failGuidanceBody(kind: ReturnType<typeof classifyStepFailure>): string {
  switch (kind) {
    case 'network':
      return '请将其重新上线，或重新运行任务以改派其他机器。';
    case 'quota':
      return '模型额度已用尽，请等待额度恢复后重试。';
    case 'capacity':
      return '请求被限流，请稍后重试。';
    default:
      // 模型错误、上下文超长、认证失败、未知失败等，不再套机器离线族文案
      return '运行失败，请查看原始错误排查原因后重试。';
  }
}

/** 工具行的中间形态（组装期折叠用；不出现在产物里）。 */
function toolItem(call: ToolCallRecord): ToolEntry {
  return { kind: '__tool__', call };
}

function durationSeconds(call: ToolCallRecord): number {
  if (call.startedAt !== undefined && call.endedAt !== undefined) {
    return Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000));
  }
  return 0;
}

/** 工具执行结果 → 可显示文本（#469 工具输出块的数据面）。pi 的 `call.result`
 * 是 z.unknown()：bash 多为纯串或 `{type:'text',text}` / `[{type:'text',…}]`
 * 内容块，宿主工具可能是 `{content|output|stdout|result: …}` 包一层。逐层拆出
 * 文本；空/不可解析 → null（渲染层跳过该块，不产空框）。不做 JSON 兜底串——
 * 结构化结果没有稳定的「显示文本」语义，宁可不出块也不糊一坨 JSON。 */
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

/** #634 机器管线文本判定：纯 JSON 对象/数组（host 工具结果回声、relay 封套）
 *  不是给人看的行——参考站对话流里从无原始 JSON（实测 2026-10-02）。 */
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

/** #634 host 工具结果回声的人类面孔：参考站把这类副作用写成居中灰注（实测
 *  样本 `记忆已更新 · 新增 1 条`），原始 JSON 从不进对话流。null = 该回声没有
 *  人类面孔、整行退场（set_task_meta 的标题真值在 dhead 已可见）。 */
function echoNoteOf(toolName: string): string | null {
  if (toolName === 'set_task_meta') return null;
  if (toolName.includes('memory')) return '记忆已更新';
  if (toolName.includes('skill')) return '技能已更新';
  return null;
}

// —— overlay 三件（Token 用量 / 分支与 PR / 运行历史）———————————————————

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
  // #777: hit rate over the input side (input excludes the cached part —
  // the four terms above sum to the grand total, so this ratio stays <= 100%).
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

/** 提交历史行（#149 文件|历史 分段「历史」；server 已按新→旧序返回，
 *  sha → 行 id）。 */
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

/** 运行历史行（r3 §3.8 顺序 = 新行在前；tokens 位 = 调用方按 build 供数，
 * 缺省行只显示相对时间）。 */
export function mapRunHistory(
  todo: WireTodo,
  builds: BuildRecord[],
  now: number,
  tokensByBuild?: Map<string, number>,
): RunHistoryRow[] {
  const byId = new Map(builds.map((b) => [b.id, b]));
  const rows: RunHistoryRow[] = [];
  const history = [...todo.buildHistory].reverse(); // 新行在前（r8 77）
  history.forEach((entry, idx) => {
    const n = todo.buildHistory.length - idx; // 第 N 次运行（时序编号）
    const b = byId.get(entry.buildId);
    const isCurrent = todo.latestBuildId === entry.buildId;
    const failed = b?.errorMessage != null && b.errorMessage !== '';
    const parts = [relativeTime(entry.createdAt, now)];
    const tokens = tokensByBuild?.get(entry.buildId);
    if (tokens !== undefined) parts.push(`${formatTokens(tokens)} tokens`);
    // #1262 显示侧纯文本兜底（与失败行同律）：存量脏行的转义残片不进 meta。
    if (failed && b) parts.push(stripAnsiEscapes(b.errorMessage ?? ''));
    rows.push({
      label: `第 ${n} 次运行`,
      meta: parts.join(' · '),
      status: isCurrent ? (failed ? 'failed-current' : 'current') : failed ? 'failed' : 'done',
    });
  });
  return rows;
}

// —— schedules / team / resources ————————————————————————————————

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

/** machines 页投影（spec 11 A8，#357）：本机行（kind='local'）钉列表首，
 * 接入机保持 API 序；enabledRuntimes 原样透传 = 品牌 mark 亮度分态数据源。 */
export function mapMachines(rows: MachineRecord[]): MachineRow[] {
  const local = rows.filter((m) => m.kind === 'local');
  const attached = rows.filter((m) => m.kind !== 'local');
  return [...local, ...attached].map((m) => ({
    id: m.id,
    kind: m.kind,
    name: m.name,
    online: m.online,
    enabledRuntimes: m.enabledRuntimes,
    shellEnabled: m.shellEnabled,
    // #1108 并发面：字段缺席（老 server）= undefined——控件与读标注退场，
    // 行回到 shell 闸单控件面（存量 capture 零漂移）。
    ...(m.maxConcurrent !== undefined ? { maxConcurrent: m.maxConcurrent } : {}),
    ...(m.runningSteps !== undefined ? { runningSteps: m.runningSteps } : {}),
    // #1251 能力清单：三态原样透传（清单 / null = 未上报 / absent = 老
    // server——读标注退场，maxConcurrent 同律）。
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

// —— chief（总管 drawer / 设置面）———————————————————————————————

/** runtime 显示名（品牌/runtime 名不译，不走 t()）——单源已上提 shared
 * MODEL_SOURCE_RUNTIME_LABELS（#627：server chief models 工具的
 * providerLabel 行语义与 toModelOptions 对齐，同源共消费）；本名保留为
 * web 侧消费入口。消费面：providers-page runtime tablist + chief 压缩
 * 模型选择器（toModelOptions）。 */
export const RUNTIME_LABELS: Record<ModelSourceRuntime, string> = MODEL_SOURCE_RUNTIME_LABELS;

/** 思考强度只读行的档位投影（XMON-16 / #499 B3 裁决 A）：存值须是能力读面
 * 给的词表里的那一档才呈现，否则 null（调用面落 r3 §4 观测形「默认」）。
 * 只读行不说引擎没有的档位——词表即白名单，本层不另存一份档位集，也不
 * 排序（序由读面给）。返回 null 而非「默认」文案：词典键单源在调用面的
 * t()，本层不碰 i18n。 */
export function toThinkingLevelDisplay(
  value: string | null,
  levels: readonly string[],
): string | null {
  return value !== null && levels.includes(value) ? value : null;
}

/** 压缩模型选择器候选投影（#358，spec 11 §A10；#770 起 providers 段已除：
 *  只剩非 pi runtime 段模型（claude-code = server 直读 ~/.claude/settings.json
 *  的槽位；provider 位 = runtime 词表值，未安装段 models 恒空天然无贡献）。
 *  #1288 翻案（spec 11 A10 superseded-in-part）：pi/relay 段重新进入候选——
 *  relay /v1/models 探活目录为全量模型源（含不在槽位清单的模型）；跨族按
 *  model id 去重，活性取严（任一源标 dead 则该 id 标 dead）。
 *  custom providers 的建/改/删（providers 管理页）与存量绑定执行面（daemon
 *  backendFor 按 agent.provider 原值解析）都不动——本投影只决定 picker 里
 *  能新选什么，不管已存值与执行。存量 provider 模型值读出来命中不了选项，
 *  走 model-select-core 的裸串兜底（`provider/modelId` 即名，不空白不崩）。 */
export function toModelOptions(sources: ModelSource[]): ModelOption[] {
  // #1288：先扫全量收集活性（跨族 strict：任一源标 dead → dead）。
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
    // #1259：同 provider 内两台机器同模型 id → 两行都留（创建弹窗按
    //  归属机过滤消费）。跨 pi/claude-code 段按 model id 去重——pi（relay
    //  目录）与 claude-code（槽位）同一模型 id 只留一行。
    const ccDim = option.provider === 'claude-code' && option.machineId !== undefined;
    const key = ccDim ? `${option.provider}/${option.machineId}/${option.modelId}` : option.modelId; // #1288 跨族按 model id 去重
    if (seen.has(key)) return;
    seen.add(key);
    // 活性取严：跨族已合并的活性填回行。
    const lv = livenessByModelId.get(option.modelId);
    if (lv !== undefined && lv !== 'unknown') option.liveness = lv;
    options.push(option);
  };
  for (const source of sources) {
    // #1288：pi/relay 段重新进入候选（不再 continue 跳过）。
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

/** 解析 CHIEF_TURN_ERROR_KIND 系统消息（#631）：server 落的 chief 回合失败
 *  行 content 为 JSON 串（machine_selected 同族）；非该 kind / 坏形状 = null
 *  （空 content 的 pi 尾行等照旧走跳过路径）。toast 触发面与流渲染面共用。 */
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

/** 解析 ASK_USER_QUESTION_KIND 问答行（#1049）：server 落的 ask_user 提问
 * assistant 行 content 为 JSON 串；非该 kind / 坏形状 = null（照旧走跳过
 * 路径——问答卡不渲染坏形，不给假卡）。 */
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

/** r5 100/111 hero 网格 canon（卡序 = 抓包序；与 fixtures CHIEF_EXAMPLES
 * 同源文案——live 面单源在此，fixture 面保持自有副本不动）。 */
const CHIEF_HERO_EXAMPLES = [
  { icon: 'user-plus' as const, text: '帮我组建 Agent 团队' },
  { icon: 'folder' as const, text: '帮我创建一个新项目' },
  { icon: 'grid' as const, text: '总结一下我所有项目现在的进展' },
  { icon: 'bars' as const, text: '查一下这个月的 token 用量' },
];

/** 内部 wake 标记（server chief.ts WAKE_PROMPT_PREFIX + parseChiefTrigger
 *  同族 gate/settle/failed/wake）：用户可见边界统一剥离前导 marker，只动
 *  显示层，存量数据不动。只剥前导一次：句中出现保持原样（用户原文），
 *  assistant 行不动（协议 token 永不经该面产生，动了会 corrupt 正常引用）。 */
const WAKE_MARKER_PREFIX_RE = /^\[wake:\w+\]\s*/;

function stripWakeMarker(text: string): string {
  return text.replace(WAKE_MARKER_PREFIX_RE, '');
}

export function mapChiefStream(messages: MessageRow[], inlineTools = false): ChiefStreamItem[] {
  return collectChiefStream(messages, inlineTools).items;
}

/** #822 内部组装：items + 本轮尾部尚未归属的工具行（user 行之后的 toolcall
 *  投影——调用方决定其归属面：定稿 robot 行由本函数内直挂；在飞 streaming 行
 *  由 mapChief 挂展开面）。数据源不变（messages 参数），不新增请求。 */
function collectChiefStream(
  messages: MessageRow[],
  /** #955：回合在飞（`activeRun` 非空）时工具行**平铺进主呈现**并与文本段按序
   *  交错；收口后恢复 r5 canon 的折叠形（工具折进后续 robot 行的披露）。 */
  inlineTools = false,
): {
  items: ChiefStreamItem[];
  trailingTools: ChiefToolRow[];
} {
  const items: ChiefStreamItem[] = [];
  // #667 回声行去重：用户回合双落库——POST 行（server sendChiefMessage，
  // id = newRecordId 无前缀）+ daemon transcript 回声行（id = `user-<stepId>`，
  // TRANSCRIPT_PROMPT_ROW_ID_PREFIX）。正本 = POST 行（发送即上屏 + rewind
  // 锚）；回声行是执行记录面，wake 轮无 POST 行时又是唯一 user 行。判据 =
  // id 前缀 + 同线程内容孪生（trim + #778 marker 剥离双归一，与渲染同源）：
  // POST 行永不跳过 → 连发同文各自渲染恰一次；wake 回声行无孪生 → 剥 marker
  // 后保留 remainder。比对按全集不按
  // 邻接——chiefThreadMessages 只按 createdAt 排序，同毫秒并列时行序无保证。
  // #667 回声行有非前缀孪生 → 跳过（POST 行承载同一句话的呈现与锚）。
  // #778 去重键吃剥离后文本（与渲染同源）：wake 回声行剥 marker 后与 POST
  // 行同文即孪生，仍恰渲染一条。
  const postedTexts = new Set(
    messages
      .filter((m) => m.role === 'user' && !m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX))
      .map((m) => stripWakeMarker(textOfContent(m.content).trim())),
  );
  // #615 返工：工具行不再丢弃——缓冲进下一个 robot 回合的 tools 折叠面
  // （foot 折叠箭头展开内容；Multica OuterProcessFold 同族语义）。
  let pendingTools: ChiefToolRow[] = [];
  for (const m of messages) {
    // #631 失败行：server 落的 chief_turn_error system 行先于通用 system
    // 跳过解析（其余 system 行维持跳过不变）。
    const turnError = m.role === 'system' ? chiefTurnErrorOfContent(m.content) : null;
    if (turnError !== null) {
      pendingTools = [];
      items.push({ kind: 'error', text: turnError });
      continue;
    }
    const call = toolCallOfContent(m.content);
    if (call !== null) {
      pendingTools.push({
        // #958 后续：行文本走 pillOf 单源（`bash <命令>` 族）——只留工具名会
        // 让一排 Bash 读不出跑了什么，而 command/file_path/path 本来就在
        // ToolCallRecord.arguments 里，与详情页工具 pill 是同一份数据。
        label: pillOf(call),
        ...(call.startedAt !== undefined && call.endedAt !== undefined
          ? { seconds: Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000)) }
          : {}),
        ...(call.isError === true ? { error: true } : {}),
      });
      // #955：在飞期间工具行平铺（顺序由 createdAt 承载，段行必排在它之后）；
      // 收口后不产出——工具回到 robot 行的 `tools` 折叠面（r5 canon）。
      if (inlineTools) {
        items.push({
          kind: 'tool',
          label: pillOf(call),
          // #1009 A1 行 id 贯通：toolcall 行是独立 message，m.id 直投
          // （React key + MessageScroller messageId 锚；视图侧投影，wire 零触碰）。
          id: m.id,
          ...(call.startedAt !== undefined ? { startedAt: call.startedAt } : {}),
          ...(call.startedAt !== undefined && call.endedAt !== undefined
            ? { seconds: Math.max(0, Math.round((call.endedAt - call.startedAt) / 1000)) }
            : {}),
          ...(call.result === undefined ? { running: true } : {}),
          ...(call.isError === true ? { error: true } : {}),
        });
      }
      continue; // 工具行不进 chief 流主呈现（r5 114/116 折叠态无工具行）
    }
    // #1049 问答行：assistant 行 content 为 ask_user_question JSON 串——
    // 单列问答卡（选项可点/多选/自由文本；不落 robot 文本面，raw JSON 不
    // 渲染）。坏形状不产卡（不给假卡）。
    const ask = m.role === 'assistant' ? askQuestionOfContent(m.content) : null;
    if (ask !== null) {
      pendingTools = []; // 问答是回合边界内的显式停驻点，前导工具行就地折叠
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
      // #955：思考段行——无正文的 assistant 行若是 thinking 块，单列一行。
      const thinking = m.role === 'assistant' ? thinkingOfContent(m.content) : null;
      // #1009 A1 行 id 贯通（tool 行同注）：thinking 行源 message 独立成行。
      if (thinking !== null) items.push({ kind: 'thinking', text: thinking, id: m.id });
      continue;
    }
    if (m.role === 'user') {
      // #778 用户可见边界剥离内部 marker（显示层，落库不动）。
      const text = stripWakeMarker(rawText);
      // 纯 marker 行（无 remainder）不渲染。
      if (text === '') continue;
      // #667 回声行有非前缀孪生 → 跳过（POST 行承载同一句话的呈现与锚）。
      if (m.id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX) && postedTexts.has(text)) continue;
      pendingTools = []; // 回合边界：用户行之前的工具行属上一回合且已无归属面
      // #742: live 用户行进 markdown 槽（详情页用户行 #612 同款配方，本
      // 函数 robot 行 #650 同律）——槽值 = 剥 marker 后文本逐字（#778 显示层），
      // 块结构归渲染期 chat-markdown 解析。去重键（postedTexts，吃剥离后文本）与
      // 复制载荷照旧读 text 位，rewind 锚照旧读 id 位；fixture 面不经本
      // mapper，捕获形无槽、DOM 零漂移。
      items.push({ kind: 'user', text, id: m.id, markdown: text });
      continue;
    }
    if (m.role === 'system') continue;
    // #650: live replies carry their raw text in the `markdown` slot and
    // render through the shared chat-markdown blocks (transcript robot row
    // #469 同律) — the hand-rolled paragraph/bullet projection that leaked
    // literal `**` asterisks is gone. Fixture captures keep their segment
    // arrays (records.ts ChiefStreamItem: markdown takes precedence when
    // present, frozen shapes render unchanged).
    items.push({
      kind: 'robot',
      markdown: rawText,
      seconds: '',
      // #1009 A1 行 id 贯通（tool 行同注）：定稿 robot 行 = 源 message 本尊。
      id: m.id,
      ...(pendingTools.length > 0 ? { tools: pendingTools } : {}),
    });
    pendingTools = [];
  }
  return { items, trailingTools: pendingTools };
}

/** Streaming partial-markdown guard (#651): an unclosed strong marker at the
 *  live buffer tail would leak literal asterisks until its partner streams in,
 *  so the typing face appends the virtual closer (bold-from-opener, the
 *  mainstream streaming-markdown behavior); the converged final row parses the
 *  true stored text. Counting skips inline code spans (asterisks inside a chip
 *  are text) and bails out inside an unclosed code fence, where markers are
 *  literal fence content and the parser already renders them verbatim. */
function autoCloseStrong(text: string): string {
  // Fence openers at line starts (chat-markdown FENCE family, marker only):
  // an odd count means the buffer tail sits inside an open fence.
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
    /** #651 conversation stream text_delta 累积（liveTextStore 读侧，
     *  use-chief-surface 注入）：回合进行中且非空 → stream 尾挂 typing
     *  robot 行；缺省 = fixture 面 / 未订阅，stream 与现状一致。 */
    liveText?: string;
    /** #1308 思考增量。非空时在打字行之前挂一条 thinking 行。 */
    liveThinking?: string;
    /** #905 步活动相位（activityStore 读侧，use-chief-surface 注入）：在飞
     *  存在行的标签/工具名/最近信号数据源。chief 封套不带 step id，陈旧防
     *  线 = hub 单槽 + 步终态清（server/web 镜像律）+ activeRun 门（回合已
     *  收即不渲染尾行）。缺省 = fixture 面 / 旧 server，行为与现状一致。 */
    activity?: StepActivity | null;
  },
): ChiefContent {
  const bound = env.chief.agent !== null;
  const active =
    opts.activeThreadId !== null
      ? (opts.threads.find((t) => t.id === opts.activeThreadId) ?? null)
      : null;
  const running = active?.activeRun != null;
  // #822：在飞展开面数据源（已有 messages 投影的二次归属，不新增请求）。
  const collected = active === null ? null : collectChiefStream(opts.messages, running);
  const chiefStream: ChiefStreamItem[] = collected?.items ?? [];
  // #651 打字面尾行 / #739 在飞存在行：回合进行中（activeRun 非空）才挂尾行，
  // 且两行按 liveText 空/非空互斥——尾部恒至多一行（#739 F1 无二重身）。
  // activeRun 是陈旧缓冲的 gate（关抽屉/断线窗口里缓冲可能残留上一轮文本，
  // 回合已收即不渲染）。收敛律 = 详情页同款：终稿 message 事件 clear 缓冲 +
  // messages 重取接管，尾行随之退场，不重复不残留。
  if (running) {
    if ((opts.liveThinking ?? '').trim() !== '') {
      chiefStream.push({ kind: 'thinking', text: opts.liveThinking ?? '' });
    }
    if ((opts.liveText ?? '').trim() !== '') {
      // 增量文本已到 → 打字面尾行（#651）。
      chiefStream.push({
        kind: 'robot',
        markdown: autoCloseStrong(opts.liveText ?? ''),
        typing: true,
        seconds: '',
      });
    } else if (chiefStream[chiefStream.length - 1]?.kind !== 'robot') {
      // #739 在飞存在行：回合在飞但首 token 未至（机器 wake → claim → pi 会话
      // 开启 → 模型首 token 的静默窗口，绑定慢模型时被放大到分钟级）——挂
      // loading-dev Atom + `处理中...`，与详情页 streaming 行同族，消除「发一
      // 句话就什么也没有」。不挂秒数（#471：静默期无流事件驱动重渲，秒数会
      // 冻结说谎；本票不加计时器）。首 delta 到达即被上面的 typing 行取代。
      //
      // 收敛律「终稿落库 → 尾行退场」的 gate = 尾部不是已落库的 robot 行。
      // text_delta 只进 liveText（上面 typing 分支），终稿 assistant message 才
      // 落库重取成 robot 尾行——故终稿一到，尾即 robot，存在行当场退场，不赌
      // activeRun 被 step 事件（#684 失效 chiefThreads）收口的时机：message →
      // step 的窗口零闪烁。工具行被 mapChiefStream 缓冲进下一个 robot 行，纯
      // 工具静默期尾仍是 user 行，存在行照常呈现。
      //
      // 僵尸边界（#739 F2，#706 liveness sweeper 落地前接受并注记）：机器死了
      // 无人收 activeRun、且终稿从不落库 → 尾恒 user 行 → 存在行随 activeRun
      // 生死（与 composer 占位同一 running 投影单源，不另立状态）。
      //
      // #822：本轮尚未归属的工具行挂展开面（tools 缺省 = 本轮暂无工具调用，
      // 面板走 fallback 行；typing 接管后本行缺席，工具归宿回归终稿 robot
      // 行，单时刻无双面）。
      // #1108 排队位（turnQueue 非空 = 回合在飞但步仍 pending）：标签切
      // 「排队中」+ 位次 + 等待对象（位次/机器 = server 投影真值，非本地推
      // 测）。优先于活动相位——步未领走时本无活动信号（防御位：陈旧相位不
      // 盖排队态）。被领取（step 事件失效 chiefThreads）→ turnQueue 消失，
      // 回落 #905 活动标签 / 「处理中...」既有收敛。
      const turnQueue = active?.turnQueue ?? null;
      if (turnQueue != null) {
        const queued = queueLabel(turnQueue);
        chiefStream.push({
          kind: 'streaming',
          label: queued.label,
          labelVars: queued.vars,
        });
      } else {
        // #905：活动相位接管存在行标签（详情页同一条 activityLabel 单源）；
        // 无信号回落「处理中...」原样。
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
  return {
    view: 'drawer',
    bound,
    ...(bound && env.agentActor
      ? {
          // #1260：行值 = 绑定 Agent 自身模型（chief 无覆盖槽）。
          modelSlot: env.agentActor.modelId ?? 'n/a',
          // #444: FAB 头像位 = 绑定 Agent 全记录里的既有字段（封套已带，
          // 零新增请求）；id 供 team chart 组织图定位根节点（同一封套，
          // 同为零新增请求）。
          agent: {
            id: env.agentActor.id,
            displayName: env.agentActor.displayName,
            avatarUrl: env.agentActor.avatarUrl,
          },
          // 运行时标记位 = 绑定 Agent 的 provider。
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
    // #624：回合进行中位 = 活动线程 activeRun 非空（r5 §3.5 开放形状，只判
    // 在位不读字段）——抽屉占位据此切 steer canon；新主题视图（active null）
    // 恒空闲。刷新节奏骑 chiefSend invalidateAll / conversation SSE 既有重取。
    ...(running ? { running: true } : {}),
    // #822：在飞展开面首行 = activeRun.tool.toolName（已有 threads 查询的视
    // 图投影，不新增请求）；activeRun 无工具位即缺省，面板走 fallback 行。
    // #905：activity 相位是活信号（daemon 实时上报），activeRun.tool 是
    // [推断] 形状且全库无写入方——tool 相位在位时以前者为准。
    ...(opts.activity?.phase === 'tool' && opts.activity.tool != null
      ? { runningTool: opts.activity.tool }
      : active?.activeRun?.tool != null
        ? { runningTool: active.activeRun.tool.toolName }
        : {}),
    ...(opts.draft !== undefined ? { draft: opts.draft } : {}),
  };
}

/** plan 版本下拉行（r8 63/70：`vN · 相对时间`，新在前；相对时间由显示层
 * 以 `at` 对 now 求值）。 */
export function mapPlanVersions(plans: PlanRow[]): PlanVersion[] {
  return [...plans].reverse().map((p) => ({ v: `v${p.version}`, at: p.createdAt }));
}

export { relativeTime };
