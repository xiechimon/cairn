export const REPLY_QUOTE_LIMIT = 1500;

export interface ReplyQuoteSource {
  sourceMessageId: string;
  quote: string;
  reply?: string;
}

export interface ParsedReplyQuoteItem {
  sourceMessageId: string | null;
  quote: string;
  reply: string;
}

export interface ParsedReplyQuotes {
  quotes: ParsedReplyQuoteItem[];
  body: string;
}

const SAFE_SOURCE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MARKER = /^<!-- reply(?: source=([A-Za-z0-9_.:-]{1,128}))?(?: lines=(\d{1,6}))? -->$/;
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

function marker(source: ReplyQuoteSource, lines: number | null): string {
  const id = SAFE_SOURCE.test(source.sourceMessageId) ? ` source=${source.sourceMessageId}` : '';
  return `<!-- reply${id}${lines === null ? '' : ` lines=${lines}`} -->`;
}

function quoted(source: ReplyQuoteSource): string {
  return normalizeReplyQuote(source.quote)
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function countedBlock(source: ReplyQuoteSource): string {
  const reply = (source.reply ?? '').trim();
  const lines = reply === '' ? 0 : reply.split('\n').length;
  const head = `${marker(source, lines)}\n${quoted(source)}`;
  return lines === 0 ? head : `${head}\n\n${reply}`;
}

export function encodeReplyQuotes(quotes: readonly ReplyQuoteSource[], body: string): string {
  const main = body.trim();
  const [only] = quotes;
  if (only === undefined) return main;
  const reply = (only.reply ?? '').trim();
  if (quotes.length === 1 && (reply === '' || main === ''))
    return `${marker(only, null)}\n${quoted(only)}\n\n${reply === '' ? main : reply}`;
  const blocks = quotes.map(countedBlock).join('\n');
  return main === '' ? blocks : `${blocks}\n\n${main}`;
}

function quoteAt(lines: readonly string[], from: number): { quote: string; next: number } | null {
  const quote: string[] = [];
  let index = from;
  for (let line = QUOTE_LINE.exec(lines[index] ?? ''); line !== null; ) {
    quote.push(line[1] ?? '');
    index += 1;
    line = index < lines.length ? QUOTE_LINE.exec(lines[index] ?? '') : null;
  }
  return quote.length === 0 ? null : { quote: quote.join('\n'), next: index };
}

function parseCounted(lines: readonly string[]): ParsedReplyQuotes {
  const quotes: ParsedReplyQuoteItem[] = [];
  let index = 0;
  for (;;) {
    const head = MARKER.exec(lines[index] ?? '');
    const block = head?.[2] === undefined ? null : quoteAt(lines, index + 1);
    if (head === null || block === null) break;
    const count = Number(head[2]);
    let next = block.next;
    let reply = '';
    if (count > 0) {
      if (lines[next] !== '' || next + 1 + count > lines.length) break;
      reply = lines.slice(next + 1, next + 1 + count).join('\n');
      next += 1 + count;
    }
    quotes.push({ sourceMessageId: head[1] ?? null, quote: block.quote, reply });
    index = next;
    if (lines[index] === '' || index >= lines.length) break;
  }
  return { quotes, body: lines.slice(index).join('\n').trim() };
}

function parseReplies(content: string): ParsedReplyQuotes | null {
  const lines = content.split('\n');
  const head = MARKER.exec(lines[0] ?? '');
  if (head === null) return null;
  if (head[2] !== undefined) return parseCounted(lines);
  const block = quoteAt(lines, 1);
  if (block === null) return { quotes: [], body: lines.slice(1).join('\n').trim() };
  return {
    quotes: [
      {
        sourceMessageId: head[1] ?? null,
        quote: block.quote,
        reply: lines.slice(block.next).join('\n').trim(),
      },
    ],
    body: '',
  };
}

export function parseReplyQuotes(content: string): ParsedReplyQuotes | null {
  const parsed = parseReplies(content);
  return parsed === null || parsed.quotes.length === 0 ? null : parsed;
}

export function replyQuoteSources(content: string): (string | null)[] {
  return parseReplyQuotes(content)?.quotes.map((quote) => quote.sourceMessageId) ?? [];
}

export function replyQuoteText(content: string): string {
  const parsed = parseReplies(content);
  if (parsed === null) return content;
  return [...parsed.quotes.map((quote) => quote.reply), parsed.body]
    .filter((text) => text !== '')
    .join('\n\n');
}

export function replySummary(content: string): string {
  const words = replyQuoteText(content);
  if (words.trim() !== '') return words;
  return (
    parseReplyQuotes(content)
      ?.quotes.map((quote) => quote.quote)
      .join('\n') ?? words
  );
}
