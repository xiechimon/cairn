export const REPLY_QUOTE_LIMIT = 1500;

export interface ReplyQuoteSource {
  sourceMessageId: string;
  quote: string;
}

export interface ParsedReplyQuote {
  sourceMessageId: string | null;
  quote: string;
  body: string;
}

const SAFE_SOURCE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MARKER = /^<!-- reply(?: source=([A-Za-z0-9_.:-]{1,128}))? -->(?:\n|$)/;
const QUOTE_LINE = /^>(?: (.*))?$/;

function clip(text: string): string {
  if (text.length <= REPLY_QUOTE_LIMIT) return text;
  const last = text.charCodeAt(REPLY_QUOTE_LIMIT - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? REPLY_QUOTE_LIMIT - 1 : REPLY_QUOTE_LIMIT;
  return `${text.slice(0, end)}…`;
}

export function normalizeReplyQuote(text: string): string {
  return clip(text.replace(/\r\n?/g, '\n').trim());
}

export function encodeReplyQuote(source: ReplyQuoteSource, body: string): string {
  const marker = SAFE_SOURCE.test(source.sourceMessageId)
    ? `<!-- reply source=${source.sourceMessageId} -->`
    : '<!-- reply -->';
  const quoted = normalizeReplyQuote(source.quote)
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
  return `${marker}\n${quoted}\n\n${body.trim()}`;
}

function parseReply(content: string): { reply: ParsedReplyQuote; quoted: boolean } | null {
  const marker = MARKER.exec(content);
  if (marker === null) return null;
  const lines = content.slice(marker[0].length).split('\n');
  const quote: string[] = [];
  let index = 0;
  for (; index < lines.length; index += 1) {
    const match = QUOTE_LINE.exec(lines[index] ?? '');
    if (match === null) break;
    quote.push(match[1] ?? '');
  }
  return {
    quoted: quote.length > 0,
    reply: {
      sourceMessageId: marker[1] ?? null,
      quote: quote.join('\n'),
      body: lines.slice(index).join('\n').trim(),
    },
  };
}

export function parseReplyQuote(content: string): ParsedReplyQuote | null {
  const parsed = parseReply(content);
  return parsed?.quoted === true ? parsed.reply : null;
}

export function replyQuoteText(content: string): string {
  return parseReply(content)?.reply.body ?? content;
}
