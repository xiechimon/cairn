import { createContext } from 'react';

export interface ReplyQuoteDraft {
  sourceMessageId: string;
  quote: string;
  range?: Range;
}

export const REPLY_SOURCE_ATTR = 'data-reply-source';

export const ReplySourceHighlightContext = createContext<ReplyQuoteDraft | null>(null);

export const REPLY_HIGHLIGHT_ATTR = 'data-reply-highlight';
