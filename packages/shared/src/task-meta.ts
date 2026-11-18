import { ATTACHMENT_TOKEN_LINE, renderAttachmentTokensToLabels } from './attachment-token.js';
import { replyQuoteText } from './reply-quote.js';

export const PLACEHOLDER_TITLE_FALLBACK = '未命名任务';

export function derivePlaceholderTitle(spec: string): string {
  let fallback = '';
  for (const raw of replyQuoteText(spec).split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const token = ATTACHMENT_TOKEN_LINE.exec(line);
    if (token !== null) {
      if (fallback === '') fallback = token[1] ?? '';
      continue;
    }
    const rendered = renderAttachmentTokensToLabels(line);
    if (rendered === '') continue;
    return rendered.length > 50 ? `${rendered.slice(0, 50)}…` : rendered;
  }
  return fallback.length > 50 ? `${fallback.slice(0, 50)}…` : fallback;
}
