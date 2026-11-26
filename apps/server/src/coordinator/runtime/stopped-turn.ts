import { isMailWakeText } from '@cairn/shared';
import type { Context } from '@earendil-works/chord/context';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { defineEntry, type Harness } from '@earendil-works/pi-durable';
import type { Conversation } from './conversations.js';

const QUOTE_HEAD_CHARS = 150;
const QUOTE_TAIL_CHARS = 250;

export const StoppedEntry = defineEntry('cairn.stopped');

export interface StoppedTurn {
  stepId: string;
  requests: { requestId: string; quote: string }[];
}

function quoted(request: string): string {
  const text = (isMailWakeText(request) ? 'a new mail notification' : request)
    .replaceAll('<', '&lt;')
    .trim();
  const short =
    text.length <= QUOTE_HEAD_CHARS + QUOTE_TAIL_CHARS
      ? text
      : `${text.slice(0, QUOTE_HEAD_CHARS)} … ${text.slice(-QUOTE_TAIL_CHARS)}`;
  return `<stopped_request>\n${short}\n</stopped_request>`;
}

export function stoppedNote(requests: readonly string[]): string {
  return [
    '[Stopped] My turn was stopped while it was working on what is quoted below.',
    ...requests.map(quoted),
    'Whatever I had not finished for it is cancelled: I will not answer it or act on it, now or in a later reply, unless the user asks for it again. Answers already finished and work already done stay done. This stop covers no other request.',
  ].join('\n');
}

function stoppedReply(text: string, timestamp: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'cairn',
    model: 'stopped-note',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  };
}

export async function cancelStoppedRequests(
  harness: Harness,
  conversation: Conversation,
  stopped: readonly StoppedTurn[],
  context: Context,
): Promise<void> {
  for (const turn of stopped) {
    const unfinished = new Set<string>();
    for (const { requestId, quote } of turn.requests) {
      const pending = await harness.commit(async (tx) => {
        const record = await tx.submissionByRequest(conversation.id, requestId);
        return record?.type === 'input' && record.status !== 'done' && record.entry !== undefined;
      }, context);
      if (pending) unfinished.add(quote);
    }
    if (unfinished.size === 0) continue;
    await conversation.submit(
      {
        type: 'write',
        requestId: `${StoppedEntry.kind}:${turn.stepId}`,
        entry: {
          kind: StoppedEntry.kind,
          model: [stoppedReply(stoppedNote([...unfinished]), Date.now())],
        },
      },
      context,
    );
  }
}
