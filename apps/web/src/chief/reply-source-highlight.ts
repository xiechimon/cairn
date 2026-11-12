import { createContext } from 'react';

export interface ReplyQuoteDraft {
  sourceMessageId: string;
  quote: string;
}

export const REPLY_SOURCE_ATTR = 'data-reply-source';

export const ReplySourceHighlightContext = createContext<ReplyQuoteDraft | null>(null);

export const REPLY_HIGHLIGHT_ATTR = 'data-reply-highlight';

export const REPLY_HIGHLIGHT_CLS = 'data-reply-highlight:bg-(--bubble-highlight)';
