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
        } catch {}
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
