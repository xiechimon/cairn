import { type ReviewVerdict, reviewVerdictSchema } from '@cairn/shared';

export type TranscriptMessageLike = {
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

export function extractFinalReviewVerdict(
  messages: readonly TranscriptMessageLike[],
): ReviewVerdictExtraction {
  const finalText = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => contentToText(message.content).trim())
    .filter((text) => text !== '')
    .at(-1);
  const terminalFence = [...(finalText ?? '').matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].at(-1);
  const fenceIsTerminal =
    terminalFence !== undefined &&
    finalText?.slice((terminalFence.index ?? 0) + terminalFence[0].length).trim() === '';
  const raw = fenceIsTerminal ? terminalFence?.[1]?.trim() : finalText;
  try {
    const parsed = reviewVerdictSchema.safeParse(JSON.parse(raw ?? ''));
    if (parsed.success) return { status: 'ok', verdict: parsed.data };
  } catch {}
  return { status: 'failed', reason: 'Final assistant output must end with valid verdict JSON' };
}

export interface LocalMergeFacts {
  defaultBranch: string;
  currentBranch: string | null;
  worktreeClean: boolean;
  defaultHead: string;
  judgedBase: string;
  patchDigest: string;
  judgedPatchDigest: string;
}

export type LocalMergeDecision =
  | { action: 'fast-forward' }
  | { action: 'update-ref' }
  | { action: 'hold'; reason: 'worktree-dirty' | 'checkout-unknown' }
  | { action: 'recheck'; reason: 'default-head-moved' | 'patch-stale' };

export function decideLocalMerge(facts: LocalMergeFacts): LocalMergeDecision {
  if (facts.patchDigest !== facts.judgedPatchDigest) {
    return { action: 'recheck', reason: 'patch-stale' };
  }
  if (facts.defaultHead !== facts.judgedBase) {
    return { action: 'recheck', reason: 'default-head-moved' };
  }
  if (facts.currentBranch === null) return { action: 'hold', reason: 'checkout-unknown' };
  if (facts.currentBranch !== facts.defaultBranch) return { action: 'update-ref' };
  if (!facts.worktreeClean) return { action: 'hold', reason: 'worktree-dirty' };
  return { action: 'fast-forward' };
}

export function reviewedCheckoutHead(
  start: string | null,
  end: string | null,
  expected: string | null,
): string | null {
  return start !== null && /^[a-f0-9]{40}$/.test(start) && start === end && start === expected
    ? start
    : null;
}
