import { z } from 'zod';
import { renderAttachmentTokensToLabels } from '../attachment-token.js';
import { parseReplyQuote } from '../reply-quote.js';
import { fenceIssueText } from './prompts.js';

export const TASK_REQUEST_DIFFICULTIES = ['easy', 'standard', 'hard'] as const;
export const TASK_REQUEST_PRIORITIES = ['first', 'normal'] as const;
export const TASK_SEGMENT_AUTHORS = ['owner', 'third-party'] as const;
export type TaskSegmentAuthor = (typeof TASK_SEGMENT_AUTHORS)[number];
export type TaskTitleAuthor = TaskSegmentAuthor | 'worker' | 'coordinator';

const span = z.enum(['whole', 'quote']);

export const taskSegmentSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chat'),
    threadId: z.string().min(1),
    messageId: z.string().min(1),
    span,
  }),
  z.object({
    kind: z.literal('answer'),
    threadId: z.string().min(1),
    requestId: z.string().min(1),
    span,
  }),
  z.object({
    kind: z.literal('todo'),
    todoId: z.string().min(1),
    segment: z.number().int().min(0).nullable(),
    span,
  }),
  z.object({
    kind: z.literal('edit'),
    userId: z.string().min(1),
    at: z.number().int(),
    span: z.literal('whole'),
  }),
]);
export type TaskSegmentSource = z.infer<typeof taskSegmentSourceSchema>;

export const taskContextMessageSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
});
export type TaskContextMessage = z.infer<typeof taskContextMessageSchema>;

export const taskReplyContextSchema = z.object({
  messages: z.array(taskContextMessageSchema),
  incomplete: z.boolean(),
});
export type TaskReplyContext = z.infer<typeof taskReplyContextSchema>;

export const taskSegmentSchema = z.object({
  source: taskSegmentSourceSchema,
  author: z.enum(TASK_SEGMENT_AUTHORS),
  sourceRef: z.string().nullable(),
  text: z.string(),
  context: taskReplyContextSchema.optional(),
});
export type TaskSegment = z.infer<typeof taskSegmentSchema>;

export const taskRequestSchema = z.object({
  segments: z.array(taskSegmentSchema).min(1),
  siblings: z.array(z.string().min(1)),
  difficulty: z.enum(TASK_REQUEST_DIFFICULTIES).nullable(),
  titleSource: z.enum(['owner', 'third-party', 'worker', 'coordinator']),
  titleSourceRef: z.string().nullable(),
  research: z.object({ reason: z.string().trim().min(1).max(200) }).optional(),
});
export type TaskRequest = z.infer<typeof taskRequestSchema>;

export class RequestQuoteError extends Error {
  constructor(
    readonly quote: string,
    readonly matchedPrefix: string,
  ) {
    super(
      matchedPrefix === ''
        ? `quote not found in the cited text: "${quote}"`
        : `quote not found in the cited text: "${quote}"; the cited text only matches up to "${matchedPrefix}"`,
    );
  }
}

const blockquote = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

export function renderReplyText(text: string): string {
  const reply = parseReplyQuote(text);
  return reply === null
    ? text
    : `${blockquote(renderAttachmentTokensToLabels(reply.quote))}\n\n${reply.body}`.trimEnd();
}

export function renderTaskText(request: Pick<TaskRequest, 'segments'>): string {
  const parts: string[] = [];
  const shown = new Set<string>();
  let fence: { ref: string | null; texts: string[] } | null = null;
  const flush = () => {
    if (fence !== null) parts.push(fenceIssueText(fence.ref, fence.texts.join('\n\n')));
    fence = null;
  };
  for (const segment of request.segments) {
    if (segment.author === 'third-party') {
      if (fence !== null && fence.ref === segment.sourceRef) fence.texts.push(segment.text);
      else {
        flush();
        fence = { ref: segment.sourceRef, texts: [segment.text] };
      }
      continue;
    }
    flush();
    const wholeChatKey =
      segment.source.kind === 'chat' && segment.source.span === 'whole'
        ? `${segment.source.threadId}:${segment.source.messageId}`
        : null;
    if (segment.context !== undefined) {
      const context = segment.context.messages.flatMap((message) => {
        const key = `${message.threadId}:${message.messageId}`;
        if (shown.has(key)) return [];
        shown.add(key);
        const text =
          message.role === 'assistant'
            ? renderAttachmentTokensToLabels(message.text)
            : renderReplyText(message.text);
        return [`${message.role === 'user' ? 'Owner' : 'Coordinator'}:\n${text}`];
      });
      if (segment.context.incomplete) context.push('Some quoted source context is unavailable.');
      if (context.length > 0)
        parts.push(
          `[Context from Coordinator]\n${context.join('\n\n')}\n[End of Coordinator context]`,
        );
    }
    if (wholeChatKey !== null && shown.has(wholeChatKey)) continue;
    const text = renderReplyText(segment.text);
    parts.push(segment.source.span === 'quote' ? blockquote(text) : text);
    if (wholeChatKey !== null) shown.add(wholeChatKey);
  }
  flush();
  return parts.join('\n\n');
}

export function segmentKey(source: TaskSegmentSource): string {
  switch (source.kind) {
    case 'chat':
      return `chat:${source.messageId}`;
    case 'answer':
      return `answer:${source.requestId}`;
    case 'todo':
      return `todo:${source.todoId}:${source.segment ?? 'text'}`;
    case 'edit':
      return `edit:${source.userId}:${source.at}`;
  }
}

function longestMatchedPrefix(text: string, quote: string): string {
  let length = 0;
  while (length < quote.length && text.includes(quote.slice(0, length + 1))) length += 1;
  return quote.slice(0, length);
}

export interface CitedSegment {
  segment: TaskSegment;
  quoteSource: TaskSegmentSource;
}

export function quoteSegments(
  cited: readonly CitedSegment[],
  quotes: readonly string[],
): TaskSegment[] {
  const located = quotes.map((raw) => {
    const wanted = raw.normalize('NFC').trim();
    const index = cited.findIndex((c) => c.segment.text.normalize('NFC').includes(wanted));
    if (index === -1 || wanted === '') {
      const best = cited
        .map((c) => longestMatchedPrefix(c.segment.text.normalize('NFC'), wanted))
        .sort((a, b) => b.length - a.length)[0];
      throw new RequestQuoteError(raw, best ?? '');
    }
    const at = cited[index]?.segment.text.normalize('NFC').indexOf(wanted) ?? 0;
    return { index, at, wanted };
  });
  return located
    .sort((a, b) => a.index - b.index || a.at - b.at)
    .map(({ index, wanted }) => {
      const from = cited[index] as CitedSegment;
      const reply = parseReplyQuote(wanted);
      return {
        source: { ...from.quoteSource, span: 'quote' } as TaskSegmentSource,
        author: from.segment.author,
        sourceRef: from.segment.sourceRef,
        text: wanted,
        ...(from.segment.context !== undefined &&
        reply !== null &&
        reply.sourceMessageId !== null &&
        reply.sourceMessageId === parseReplyQuote(from.segment.text)?.sourceMessageId
          ? { context: from.segment.context }
          : {}),
      };
    });
}

export function uncoveredText(
  cited: readonly CitedSegment[],
  quoted: readonly TaskSegment[],
): string[] {
  return cited.flatMap((c) => {
    const text = c.segment.text.normalize('NFC');
    const key = segmentKey({ ...c.quoteSource, span: 'quote' } as TaskSegmentSource);
    const covered = new Array<boolean>(text.length).fill(false);
    for (const q of quoted) {
      if (segmentKey(q.source) !== key) continue;
      let from = text.indexOf(q.text);
      while (from !== -1) {
        covered.fill(true, from, from + q.text.length);
        from = text.indexOf(q.text, from + 1);
      }
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
