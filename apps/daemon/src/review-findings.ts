// AI 审核步 findings 提取（M7 #330，r8 §3.1；#700 回溯扫描）：daemon 在
// done 回传前从 transcript 里解析结构化 JSON（review Verdict 形态）。
// 仅 review 步调用——其它步类无该输出契约，不提取避免假阳。
//
// 提取语义（#700：verdict 是审核步的产物本体，提取器的职责是把契约产物
// 取出来，不是猜最后一条消息）：
//   - 从尾向头扫**全部**消息：空文本 assistant 行（纯工具调用，#519 实测
//     形状：verdict JSON 之后又调了 set_task_meta）跳过继续向前扫；
//   - 消息级候选 = 末尾 ```json ...``` code fence → fence 后尾段 → 整段
//     （string | array | object 归一为 text 后解析）；
//   - 取**最后一条**含有效 verdict 的消息（契约终稿语义——续轮修订后的
//     那条才是终稿）；非 verdict 消息不挡回溯；
//   - 全程无有效 verdict = 提取失败（reason 上浮 wire findingsError，web
//     审核面区分「判定提取失败」与「审核未返回结论」）；JSON 在但
//     reviewVerdictSchema 不过 = 提取失败附 zod 原因（shared 单源校验）。
// （#808 逐 finding 降级：结论在、findings 是数组、且至少一条 finding 可用
// 时，好条目保留、坏条目丢弃（丢弃明细注记进 conclusion，不走 extractionError
// ——web 审核面把 extractionError 在位渲染成「判定提取失败」头，正常 verdict
// 伴随它会被误读；wire 双键互斥也不容同现）。结论缺席 / findings 非数组 /
// 全坏（一条可用都没有——空 findings 含义是「方案通过」，不可把全坏 verdict
// 静默折成通过）= 仍提取失败。）

import {
  type ReviewFinding,
  type ReviewVerdict,
  reviewFindingSchema,
  reviewVerdictSchema,
} from '@cairn/shared';

type TranscriptMessageLike = {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
};

/** 把 content 归一为纯文本（与 web mappers.ts textOfContent 同形——内容可
 * 是 string / {type:"text", text} / text block 数组）。
 * #1250 起导出：verify 步的 verdict 提取（verify-verdict.ts）同用——
 * transcript 文本归一是步类无关的通用件，单源在此。 */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b !== null && typeof b === 'object') {
          const block = b as { type?: string; text?: string };
          if (block.type === 'text' && typeof block.text === 'string') return block.text;
        }
        return '';
      })
      .join('');
  }
  if (content !== null && typeof content === 'object') {
    const block = content as { type?: string; text?: string };
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

/** verdict 提取结果（#700）：ok = 契约产物取出（done body findings 位）；
 * failed = 提取失败（reason 走 done body findingsError——server / web 据此
 * 区分「判定提取失败」与「审核真的没返回」）。 */
export type ReviewVerdictExtraction =
  | { status: 'ok'; verdict: ReviewVerdict }
  | { status: 'failed'; reason: string };

/** 提取失败原因长度上限（wire findingsError 上限之内留足余量；超长截断
 * 带省略号标记——zod issues 可枚举出长串，不值得整段上浮）。 */
const REASON_CHAR_LIMIT = 500;

function capReason(text: string, limit: number = REASON_CHAR_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 从末尾 ```json ...``` code fence 取一段；无 fence = null。
 * #1250 起导出：verify 步 verdict 提取同用（code fence 抓取步类无关）。 */
export function extractCodeFence(text: string): string | null {
  // 抓最后一个 ```json ... ``` 块；容忍空尾行与 windows 换行。
  const matches = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last ? (last[1] ?? '').trim() : null;
}

/** 从消息行集中提取审核 verdict（#700 失败方式先列于此）：
 *  1. 尾部纯工具调用消息击穿（#519 现状 bug）→ 空文本 assistant 行跳过
 *     继续向前扫；
 *  2. 全程无 JSON（agent 真没按契约输出）→ failed「未找到」，诚实报
 *     提取失败，不折叠成「未返回」；
 *  3. 前面消息里有多个 JSON → 取最后一条**含有效 verdict** 的（终稿
 *     语义）——非 verdict 消息（坏 JSON / 尾部散文）不挡回溯；
 *  4. JSON 在但 schema 不过 → failed 附 zod 原因（若无更早有效 verdict）。
 * （#808 降级顺位：严格有效的 verdict（新→旧）> 逐 finding 降级（最新可降
 * 级者）> failed。降级只在「结论在 + findings 是数组 + 至少一条可用」时成
 * 立；全坏仍 failed，不误放行。） */
export function extractReviewVerdict(
  messages: readonly TranscriptMessageLike[],
): ReviewVerdictExtraction {
  // 最新的 schema 失败原因（尾→头扫首次遇到 = 最末一次 JSON 尝试）；
  // 有更早有效 verdict 时作废，全程无有效 verdict 时作为失败原因上浮。
  let schemaFailure: string | null = null;
  // 最新的可降级 verdict（#808：严格校验挂了但部分 findings 可用——严格
  // 有效者优先，按新→旧顺位；无严格有效时它才转正）。
  let degraded: ReviewVerdict | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    // 空文本 assistant 行（纯工具调用 / pi 空轮）不挡回溯（#700 失败方式 1）
    const text = contentToText(m.content).trim();
    if (text === '') continue;
    const candidates: string[] = [];
    const fence = extractCodeFence(text);
    if (fence !== null) candidates.push(fence);
    // fence 之后的「尾段」也试一次（agent 在 JSON 前先写解释段的情形）
    if (fence !== null) {
      const tail =
        text
          .split(/```[\s\S]*?```/g)
          .pop()
          ?.trim() ?? '';
      if (tail !== '' && tail !== fence) candidates.push(tail);
    }
    candidates.push(text);
    for (const raw of candidates) {
      // 候选切片两枚都试：整段（纯净 JSON 直接过）+ 首 `{...}` 跨度（JSON
      // 前后带解释段 / 尾随散文的真实输出——此前 `{` 开头的整段 parse 必败
      // 且无跨度回退，一并收口）。
      const span = extractJsonSpan(raw);
      for (const slice of [raw, span]) {
        if (slice === null) continue;
        try {
          const parsed = JSON.parse(slice);
          const verdict = reviewVerdictSchema.safeParse(parsed);
          if (verdict.success) return { status: 'ok', verdict: verdict.data };
          if (schemaFailure === null) {
            const parts = verdict.error.issues.map(
              (issue) =>
                `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
            );
            schemaFailure = capReason(parts.join('; '));
          }
          if (degraded === null) degraded = tryDegradedVerdict(parsed);
        } catch {
          // 解析失败继续下一个候选切片
        }
      }
    }
  }
  // #808：无严格有效 verdict，但最新一次 JSON 尝试可降级 → 好条目 verdict
  // 转正（丢弃明细已注记进 conclusion）；不可降级才诚实报失败。
  if (degraded !== null) return { status: 'ok', verdict: degraded };
  return {
    status: 'failed',
    reason:
      schemaFailure !== null
        ? capReason(`verdict JSON 契约校验失败：${schemaFailure}`)
        : '审核步输出中未找到 verdict JSON（agent 未按契约输出）',
  };
}

/** 逐 finding 降级（#808）：结论在、findings 是数组、且至少一条 finding
 * 可用 → 好条目保留、坏条目丢弃，丢弃明细注记进 conclusion 后返回 verdict；
 * 否则返回 null（结论缺席 / findings 非数组 / 全坏——调用方仍走 failed，
 * 不把全坏 verdict 静默折成「方案通过」的空 findings）。 */
function tryDegradedVerdict(parsed: unknown): ReviewVerdict | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as { conclusion?: unknown; findings?: unknown };
  if (typeof obj.conclusion !== 'string' || !Array.isArray(obj.findings)) return null;
  const kept: ReviewFinding[] = [];
  const dropped: string[] = [];
  obj.findings.forEach((item, index) => {
    const single = reviewFindingSchema.safeParse(item);
    if (single.success) {
      kept.push(single.data);
      return;
    }
    const rawId =
      item !== null && typeof item === 'object' && 'id' in item
        ? (item as { id?: unknown }).id
        : undefined;
    const first = single.error.issues[0];
    const where = typeof rawId === 'string' && rawId !== '' ? `id=${rawId}` : `#${index + 1}`;
    dropped.push(
      first !== undefined
        ? `findings[${index}](${where}): ${first.path.join('.')}: ${first.message}`
        : `findings[${index}](${where}): 格式错误`,
    );
  });
  if (kept.length === 0 || dropped.length === 0) return null;
  const note = capReason(
    `（注：${dropped.length} 条 finding 因格式问题被丢弃：${dropped.join('；')}）`,
    400,
  );
  return { conclusion: `${obj.conclusion}${note}`, findings: kept };
}

/** 从文本中抠出首段 `{...}` 顶层 JSON 跨度（粗略花括号配对——LLM 偶尔在
 * JSON 外补说明段）。#1250 起导出：verify 步 verdict 提取同用。 */
export function extractJsonSpan(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
