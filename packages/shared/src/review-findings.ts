import { replaceBracketLinks } from './linear-text.js';
export const CAIRN_REVIEW_HOLD_LABEL = 'cairn-review-hold';

export const REVIEW_BOT_LOGINS = ['chatgpt-codex-connector'] as const;

export function isReviewBotAuthor(login: string, type: string): boolean {
  return type === 'Bot' && REVIEW_BOT_LOGINS.some((bot) => login.replace(/\[bot\]$/, '') === bot);
}

export function reviewFindingBadge(body: string): string | null {
  return /^\s*\*\*<sub><sub>!\[(P[0-3]) Badge\]/.exec(body)?.[1] ?? null;
}

export function reviewFindingTitle(body: string): string {
  for (const line of body.split('\n')) {
    const text = replaceBracketLinks(
      line.replace(/<\/?sub>/g, ''),
      { opener: /!\[(?=P[0-3] Badge\])/, labelEnd: /\]/, head: '](', targetEnd: /\)/ },
      () => '',
    )
      .replace(/\*\*/g, '')
      .trim();
    if (text) return text;
  }
  return '';
}

export interface PrReviewFinding {
  id: string;
  path: string;
  line: number | null;
  badge: string | null;
  body: string;
  url: string;
}
