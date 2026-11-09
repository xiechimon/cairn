import { z } from 'zod';
import { fenceIssueText } from './prompts.js';

export const TASK_REQUEST_DIFFICULTIES = ['easy', 'standard', 'hard'] as const;
export const TASK_REQUEST_PRIORITIES = ['first', 'normal'] as const;
export const TASK_REQUEST_AUTHORS = ['owner', 'third-party'] as const;
export type TaskRequestAuthor = (typeof TASK_REQUEST_AUTHORS)[number];

export const taskRequestSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chat'),
    threadId: z.string().min(1),
    messageIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal('todo'),
    todoId: z.string().min(1),
    author: z.enum(TASK_REQUEST_AUTHORS),
  }),
]);
export type TaskRequestSource = z.infer<typeof taskRequestSourceSchema>;

export const taskRequestQuoteSchema = z.object({
  source: z.number().int().min(0),
  text: z.string().min(1),
});
export type TaskRequestQuote = z.infer<typeof taskRequestQuoteSchema>;

export const taskRequestSchema = z.object({
  sources: z.array(taskRequestSourceSchema).min(1),
  quotes: z.array(taskRequestQuoteSchema).nullable(),
  siblings: z.array(z.string().min(1)),
  difficulty: z.enum(TASK_REQUEST_DIFFICULTIES).nullable(),
  titleSource: z.enum(['owner', 'worker']),
});
export type TaskRequest = z.infer<typeof taskRequestSchema>;

export interface RequestSourceText {
  author: TaskRequestAuthor;
  text: string;
  sourceRef: string | null;
}

export class RequestQuoteError extends Error {
  constructor(
    readonly quote: TaskRequestQuote,
    readonly matchedPrefix: string,
  ) {
    super(
      matchedPrefix === ''
        ? `quote not found in source ${quote.source}: "${quote.text}"`
        : `quote not found in source ${quote.source}: "${quote.text}"; the source only matches up to "${matchedPrefix}"`,
    );
  }
}

const normalized = (text: string) => text.normalize('NFC');

function longestMatchedPrefix(source: string, quote: string): string {
  let length = 0;
  while (length < quote.length && source.includes(quote.slice(0, length + 1))) length += 1;
  return quote.slice(0, length);
}

function locate(sources: readonly RequestSourceText[], quote: TaskRequestQuote) {
  const source = sources[quote.source];
  const wanted = normalized(quote.text).trim();
  if (source === undefined || wanted === '') throw new RequestQuoteError(quote, '');
  const text = normalized(source.text);
  const start = text.indexOf(wanted);
  if (start === -1) throw new RequestQuoteError(quote, longestMatchedPrefix(text, wanted));
  return { start, end: start + wanted.length, text: wanted };
}

const blockquote = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

function renderSource(source: RequestSourceText, body: string, quoted: boolean): string {
  if (source.author === 'third-party') return fenceIssueText(source.sourceRef, body);
  return quoted ? blockquote(body) : body;
}

export function assembleRequestSpec(
  sources: readonly RequestSourceText[],
  quotes: readonly TaskRequestQuote[] | null,
): string {
  if (quotes === null) {
    return sources.map((source) => renderSource(source, source.text, false)).join('\n\n');
  }
  const located = quotes.map((quote) => ({ quote, at: locate(sources, quote) }));
  return sources
    .flatMap((source, index) => {
      const own = located
        .filter((entry) => entry.quote.source === index)
        .sort((a, b) => a.at.start - b.at.start)
        .map((entry) => entry.at.text);
      if (own.length === 0) return [];
      if (source.author === 'third-party') return [renderSource(source, own.join('\n\n'), true)];
      return [own.map(blockquote).join('\n\n')];
    })
    .join('\n\n');
}

export function uncoveredRequestText(
  sources: readonly RequestSourceText[],
  quotes: readonly TaskRequestQuote[],
): string[] {
  return sources.flatMap((source, index) => {
    const text = normalized(source.text);
    const covered = new Array<boolean>(text.length).fill(false);
    for (const quote of quotes) {
      if (quote.source !== index) continue;
      const at = locate(sources, quote);
      covered.fill(true, at.start, at.end);
    }
    return text
      .split('')
      .map((unit, i) => (covered[i] ? '\n' : unit))
      .join('')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /[\p{L}\p{N}]/u.test(line));
  });
}
