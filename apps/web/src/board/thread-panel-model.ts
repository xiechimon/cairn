import type { TaskRequest } from '@cairn/shared';
import type { ChiefStreamItem, TodoRecord, TranscriptItem } from '../fixtures/records.js';

export const MAX_UPDATE_LINES = 3;

const UPDATE_PHASES = new Set<TodoRecord['phase']>(['review', 'needs_input', 'confirm']);

export interface ThreadUpdates {
  lines: string[];
  at: number | null;
}

export interface ThreadOrigin {
  messageId: string;
  text: string;
  at: number | null;
}

export interface ThreadChatStream {
  items: readonly ChiefStreamItem[];
  at: readonly number[];
}

function firstLine(markdown: string): string {
  const line = markdown
    .split('\n')
    .map((row) => row.replace(/^[#>*\-\s`]+/, '').trim())
    .find((row) => row !== '');
  return line ?? '';
}

function robotText(item: Extract<TranscriptItem, { kind: 'robot' }>): string {
  if (item.markdown !== undefined) return firstLine(item.markdown);
  const first = item.paragraphs?.[0];
  const segments = first === undefined ? [] : Array.isArray(first) ? first : first.segments;
  return segments
    .map((segment) => ('text' in segment && typeof segment.text === 'string' ? segment.text : ''))
    .join('')
    .trim();
}

export function threadUpdates(
  todo: Pick<TodoRecord, 'phase' | 'phaseAt'>,
  transcript: readonly TranscriptItem[],
): ThreadUpdates | null {
  if (!UPDATE_PHASES.has(todo.phase)) return null;
  const lines: string[] = [];
  let latestAt: number | null = null;
  const note = (text: string, createdAt: number | undefined) => {
    if (text === '' || lines.length >= MAX_UPDATE_LINES || lines.includes(text)) return;
    lines.push(text);
    if (createdAt !== undefined && (latestAt === null || createdAt > latestAt))
      latestAt = createdAt;
  };
  for (const item of transcript) {
    if (item.kind === 'question' && item.status === 'pending') {
      for (const question of item.questions) note(question.question, undefined);
    }
  }
  const verify = transcript.findLast((item) => item.kind === 'verify');
  if (verify?.kind === 'verify') note(verify.conclusion.trim(), verify.createdAt);
  const review = transcript.findLast((item) => item.kind === 'review');
  if (review?.kind === 'review') note(review.conclusion.trim(), review.createdAt);
  const report = transcript.findLast((item) => item.kind === 'report');
  if (report?.kind === 'report') note(firstLine(report.markdown), report.createdAt);
  const plan = transcript.findLast((item) => item.kind === 'plan');
  if (todo.phase === 'confirm' && plan?.kind === 'plan') note(plan.title, plan.createdAt);
  if (lines.length === 0 && todo.phase === 'review') {
    for (const item of transcript.toReversed()) {
      if (item.kind !== 'robot') continue;
      const text = robotText(item);
      if (text === '') continue;
      note(text, item.createdAt);
      break;
    }
  }
  if (lines.length === 0) return null;
  return { lines, at: latestAt ?? todo.phaseAt };
}

export function threadOrigin(
  request: TaskRequest | null | undefined,
  stream: ThreadChatStream | undefined,
): ThreadOrigin | null {
  const segment = request?.segments.find(
    (candidate) => candidate.author === 'owner' && candidate.source.kind === 'chat',
  );
  if (segment === undefined || segment.source.kind !== 'chat') return null;
  const messageId = segment.source.messageId;
  const text = segment.text;
  const index = stream?.items.findIndex((item) => item.kind === 'user' && item.id === messageId);
  if (stream === undefined || index === undefined || index < 0)
    return { messageId, text, at: null };
  const item = stream.items[index];
  const stamped = item?.kind === 'user' ? item.createdAt : undefined;
  return { messageId, text, at: stamped ?? stream.at[index] ?? null };
}

export function clockTime(ts: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ts);
}

export function threadPurpose(todo: Pick<TodoRecord, 'spec' | 'title'>): string {
  const line = firstLine(todo.spec);
  return line === todo.title ? '' : line;
}
