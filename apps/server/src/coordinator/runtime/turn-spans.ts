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

interface TurnIdentity {
  threadId: string;
  stepId: string;
  provider: string;
  model: string;
}

export interface SetupTiming {
  begin(turn: TurnIdentity): void;
  mark(threadId: string, name: string): void;
  end(threadId: string): void;
}

export function createSetupTiming(now: () => number = Date.now): SetupTiming {
  const open = new Map<string, { turn: TurnIdentity; marks: { name: string; at: number }[] }>();
  return {
    begin: (turn) => {
      open.set(turn.threadId, { turn, marks: [{ name: 'start', at: now() }] });
    },
    mark: (threadId, name) => {
      open.get(threadId)?.marks.push({ name, at: now() });
    },
    end: (threadId) => {
      const setup = open.get(threadId);
      if (setup === undefined) return;
      open.delete(threadId);
      const { marks } = setup;
      try {
        emitCoordinatorTurnSpans(
          setup.turn,
          marks.slice(1).map((mark, i) => ({
            kind: 'setup',
            name: mark.name,
            startAt: marks[i]?.at ?? mark.at,
            endAt: mark.at,
          })),
        );
      } catch {}
    },
  };
}

export function emitTurnSpans(
  turn: TurnIdentity,
  entries: readonly EntryRecord[],
  now: () => number,
  redactText = false,
): void {
  try {
    emitCoordinatorTurnSpans(
      { ...turn, ...(redactText ? { redactText: true } : {}) },
      turnSpanRecords(entries, now),
    );
  } catch {}
}
