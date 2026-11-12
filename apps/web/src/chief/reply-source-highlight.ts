import { createContext } from 'react';
import type { ReplyQuoteDraft } from './selection-reply.js';

export const ReplySourceHighlightContext = createContext<ReplyQuoteDraft | null>(null);

export const REPLY_HIGHLIGHT_ATTR = 'data-reply-highlight';

export const REPLY_HIGHLIGHT_CLS =
  'data-reply-highlight:rounded-(--radius-card) data-reply-highlight:outline-8 data-reply-highlight:outline-(--menu-hover)';
