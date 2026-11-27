import type { Context } from '@earendil-works/chord/context';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { defineEntry, type Harness } from '@earendil-works/pi-durable';
import type { Conversation } from './conversations.js';

export const StoppedEntry = defineEntry('cairn.stopped');

export const STOPPED_NOTE =
  '[Stopped] My turn was stopped before I finished. The latest instructions above this note that I had not finished are cancelled: I will not answer them or act on them, now or in a later reply, unless the user asks for one again or it appears again below this note. Answers already finished and work already done stay done. Nothing older than the stopped turn is affected.';

export interface StoppedTurn {
  stepId: string;
  requestIds: string[];
}

function stoppedReply(timestamp: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: STOPPED_NOTE }],
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
    const unfinished = await harness.commit(async (tx) => {
      for (const requestId of turn.requestIds) {
        const record = await tx.submissionByRequest(conversation.id, requestId);
        if (record?.type === 'input' && record.status !== 'done' && record.entry !== undefined)
          return true;
      }
      return false;
    }, context);
    if (!unfinished) continue;
    await conversation.submit(
      {
        type: 'write',
        requestId: `${StoppedEntry.kind}:${turn.stepId}`,
        entry: { kind: StoppedEntry.kind, model: [stoppedReply(Date.now())] },
      },
      context,
    );
  }
}
