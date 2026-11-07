import { AssistantEntry, type EntryRecord, ToolResultEntry } from '@earendil-works/pi-durable';
import { type CoordinatorTurnSpanRecord, emitCoordinatorTurnSpans } from '../../runtime-otel.js';

interface OpenCall {
  name: string;
  arguments: unknown;
  at: number;
}

export function turnSpanRecords(
  entries: readonly EntryRecord[],
  now: () => number,
): CoordinatorTurnSpanRecord[] {
  const records: CoordinatorTurnSpanRecord[] = [];
  const open = new Map<string, OpenCall>();
  const ordered = [...entries].sort((a, b) => Number(a.id) - Number(b.id));
  for (const entry of ordered) {
    const message = entry.model?.[0];
    if (AssistantEntry.is(entry) && message?.role === 'assistant') {
      const at = message.timestamp ?? now();
      records.push({
        kind: 'chat',
        at,
        provider: message.provider,
        model: message.model,
        ...(message.responseModel !== undefined ? { responseModel: message.responseModel } : {}),
        finishReason: message.stopReason,
        ...(message.rawStopReason !== undefined ? { rawFinishReason: message.rawStopReason } : {}),
        usage: {
          input: message.usage.input,
          output: message.usage.output,
          cacheRead: message.usage.cacheRead,
          cacheWrite: message.usage.cacheWrite,
        },
        ...(message.usage.cost?.total !== undefined ? { costUsd: message.usage.cost.total } : {}),
        ...(message.errorMessage !== undefined ? { errorMessage: message.errorMessage } : {}),
      });
      for (const block of message.content) {
        if (block.type === 'toolCall') {
          open.set(block.id, { name: block.name, arguments: block.arguments, at });
        }
      }
    } else if (ToolResultEntry.is(entry) && message?.role === 'toolResult') {
      const call = open.get(message.toolCallId);
      if (call === undefined) continue;
      open.delete(message.toolCallId);
      records.push({
        kind: 'tool',
        id: message.toolCallId,
        name: call.name,
        arguments: call.arguments,
        result: message.content,
        isError: message.isError,
        startAt: call.at,
        endAt: message.timestamp ?? now(),
      });
    }
  }
  return records;
}

export function emitTurnSpans(
  turn: { threadId: string; stepId: string; provider: string; model: string },
  entries: readonly EntryRecord[],
  now: () => number,
): void {
  try {
    emitCoordinatorTurnSpans(turn, turnSpanRecords(entries, now));
  } catch {}
}
