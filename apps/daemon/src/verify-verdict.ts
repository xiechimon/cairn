// 验证步 verdict 提取（#1250 / ADR 0018 层 1）：daemon 在 done 回传前从
// transcript 解析结构化 JSON（verifyVerdict 形态）。仅 verify 步调用——其它
// 步类无该输出契约（findings 的 review 律同源）。
//
// 扫描语义与 review-findings.ts 同族（尾→头扫全部消息、空文本 assistant 行
// 跳过、fence/尾段/整段候选、取最后一条含有效 verdict 的消息）；文本归一与
// 候选切片的通用件从 review-findings.ts 导入单源消费，不复制第二份。
// 降级顺位（#808 同思想，verify 面简化）：严格有效的 verdict > evidence 逐条
// 降级（passed/conclusion 在、evidence 是数组、至少一条可用——好条目保留、
// 坏条目丢弃、丢弃明细注记进 conclusion）> failed；全坏仍 failed——不把
// 「evidence 全坏」静默折成通过。

import { type VerifyVerdict, verifyEvidenceSchema, verifyVerdictSchema } from '@cairn/shared';
import { contentToText, extractCodeFence, extractJsonSpan } from './review-findings.js';

type TranscriptMessageLike = {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
};

export type VerifyVerdictExtraction =
  | { status: 'ok'; verdict: VerifyVerdict }
  | { status: 'failed'; reason: string };

const REASON_CHAR_LIMIT = 500;

function capReason(text: string, limit: number = REASON_CHAR_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 从消息行集中提取验证 verdict（提取器职责 = 取出契约产物，不是猜最后一条
 *  消息——#700 同律）。 */
export function extractVerifyVerdict(
  messages: readonly TranscriptMessageLike[],
): VerifyVerdictExtraction {
  let schemaFailure: string | null = null;
  let degraded: VerifyVerdict | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const text = contentToText(m.content).trim();
    if (text === '') continue;
    const candidates: string[] = [];
    const fence = extractCodeFence(text);
    if (fence !== null) candidates.push(fence);
    candidates.push(text);
    for (const raw of candidates) {
      const span = extractJsonSpan(raw);
      for (const slice of [raw, span]) {
        if (slice === null) continue;
        try {
          const parsed = JSON.parse(slice);
          const verdict = verifyVerdictSchema.safeParse(parsed);
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
  if (degraded !== null) return { status: 'ok', verdict: degraded };
  return {
    status: 'failed',
    reason:
      schemaFailure !== null
        ? capReason(`verdict JSON 契约校验失败：${schemaFailure}`)
        : '验证步输出中未找到 verdict JSON（agent 未按契约输出）',
  };
}

/** evidence 逐条降级：passed/conclusion 在、evidence 是数组、至少一条可用 →
 *  好条目保留、坏条目丢弃（明细注记进 conclusion）；否则 null（调用方仍走
 *  failed——不把全坏 verdict 静默折成通过）。 */
function tryDegradedVerdict(parsed: unknown): VerifyVerdict | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as { passed?: unknown; conclusion?: unknown; evidence?: unknown };
  if (typeof obj.passed !== 'boolean' || typeof obj.conclusion !== 'string') return null;
  if (!Array.isArray(obj.evidence)) return null;
  const kept: VerifyVerdict['evidence'] = [];
  const dropped: string[] = [];
  obj.evidence.forEach((item, index) => {
    const single = verifyEvidenceSchema.safeParse(item);
    if (single.success) {
      kept.push(single.data);
      return;
    }
    const first = single.error.issues[0];
    dropped.push(
      first !== undefined
        ? `evidence[${index}]: ${first.path.join('.')}: ${first.message}`
        : `evidence[${index}]: 格式错误`,
    );
  });
  if (kept.length === 0 || dropped.length === 0) return null;
  const note = capReason(
    `（注：${dropped.length} 条 evidence 因格式问题被丢弃：${dropped.join('；')}）`,
    400,
  );
  return { passed: obj.passed, conclusion: `${obj.conclusion}${note}`, evidence: kept };
}
