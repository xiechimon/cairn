import {
  hasBlockingFinding,
  type ReviewFinding,
  type ReviewVerdict,
  reviewFindingSchema,
  reviewVerdictSchema,
} from '@cairn/shared';

type TranscriptMessageLike = {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
};

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

export type ReviewVerdictExtraction =
  | { status: 'ok'; verdict: ReviewVerdict }
  | { status: 'failed'; reason: string };

const REASON_CHAR_LIMIT = 500;

function capReason(text: string, limit: number = REASON_CHAR_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function extractCodeFence(text: string): string | null {
  const matches = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last ? (last[1] ?? '').trim() : null;
}

export function extractReviewVerdict(
  messages: readonly TranscriptMessageLike[],
): ReviewVerdictExtraction {
  const finalLineVerdict = messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => [
      ...contentToText(message.content).matchAll(/^VERDICT:\s*(pass|block)\s*$/gim),
    ])
    .at(-1)?.[1]
    ?.toLowerCase();
  let schemaFailure: string | null = null;
  let degraded: ReviewVerdict | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const text = contentToText(m.content).trim();
    if (text === '') continue;
    const candidates: string[] = [];
    const fence = extractCodeFence(text);
    if (fence !== null) candidates.push(fence);
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
      const span = extractJsonSpan(raw);
      for (const slice of [raw, span]) {
        if (slice === null) continue;
        try {
          const parsed = JSON.parse(slice);
          const verdict = reviewVerdictSchema.safeParse(parsed);
          if (verdict.success) {
            if (finalLineVerdict === 'block' && !hasBlockingFinding(verdict.data)) {
              return {
                status: 'failed',
                reason: 'Final reviewer verdict is block; refusing an earlier passing JSON example',
              };
            }
            return { status: 'ok', verdict: verdict.data };
          }
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            ('gateLoosening' in parsed || 'evalRulerChange' in parsed)
          ) {
            return {
              status: 'failed',
              reason:
                'Safety verdict failed schema validation; refusing degradation or an older verdict',
            };
          }
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
  if (degraded !== null) {
    if (finalLineVerdict === 'block' && !hasBlockingFinding(degraded)) {
      return {
        status: 'failed',
        reason: 'Final reviewer verdict is block; refusing a degraded passing JSON example',
      };
    }
    return { status: 'ok', verdict: degraded };
  }
  return {
    status: 'failed',
    reason:
      schemaFailure !== null
        ? capReason(`verdict JSON 契约校验失败：${schemaFailure}`)
        : '审核步输出中未找到 verdict JSON（agent 未按契约输出）',
  };
}

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
