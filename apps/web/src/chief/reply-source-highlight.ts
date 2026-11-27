import { type ParsedReplyQuotes, parseReplyQuotes } from '@cairn/shared';
import { createContext } from 'react';
import { joinDraft, splitDraft } from '../overlay/attachment-paste.js';

export interface ReplyQuoteDraft {
  sourceMessageId: string;
  quote: string;
  range?: Range;
}

export interface StagedQuote extends ReplyQuoteDraft {
  id: string;
  reply: string;
}

let nextStagedId = 0;

export function stagedQuote(draft: ReplyQuoteDraft, reply: string): StagedQuote {
  nextStagedId += 1;
  return { ...draft, id: `staged-${nextStagedId}`, reply };
}

export function parseSentReply(text: string): ParsedReplyQuotes | null {
  const parsed = parseReplyQuotes(text);
  if (parsed === null) return null;
  const tokens: string[] = [];
  const quotes = parsed.quotes.map((quote) => {
    const split = splitDraft(quote.reply);
    tokens.push(...split.tokens);
    return { ...quote, reply: split.text.trim() };
  });
  return { quotes, body: joinDraft(tokens, parsed.body) };
}

export function draftFromSent(text: string): { quotes: StagedQuote[]; body: string } {
  const parsed = parseSentReply(text);
  if (parsed === null) return { quotes: [], body: text };
  return {
    quotes: parsed.quotes.map((quote) =>
      stagedQuote(
        { sourceMessageId: quote.sourceMessageId ?? '', quote: quote.quote },
        quote.reply,
      ),
    ),
    body: parsed.body,
  };
}

export const REPLY_SOURCE_ATTR = 'data-reply-source';

export const ReplySourceHighlightContext = createContext<ReplyQuoteDraft | null>(null);

export const REPLY_HIGHLIGHT_ATTR = 'data-reply-highlight';
