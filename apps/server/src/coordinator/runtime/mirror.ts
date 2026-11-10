import type { TranscriptRow } from '@cairn/shared';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import {
  AssistantEntry,
  type ConversationView,
  type EntryId,
  type EntryRecord,
  ToolResultEntry,
} from '@earendil-works/pi-durable';
import type { MachineApi } from './machine-api.js';

function textBlocks(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();
}

export interface EntryRow {
  row: TranscriptRow;
  entryId: string;
}

export function entryRowSources(stepId: string, entries: readonly EntryRecord[]): EntryRow[] {
  const results = new Map<string, ToolResultMessage>();
  for (const entry of entries) {
    const message = entry.model?.[0];
    if (ToolResultEntry.is(entry) && message?.role === 'toolResult') {
      results.set(message.toolCallId, message);
    }
  }
  const rows: EntryRow[] = [];
  for (const entry of entries) {
    const message = entry.model?.[0];
    if (
      !AssistantEntry.is(entry) ||
      message?.role !== 'assistant' ||
      message.stopReason === 'aborted'
    ) {
      continue;
    }
    const text = textBlocks(message);
    if (text !== '') {
      rows.push({
        entryId: String(entry.id),
        row: {
          id: `${stepId}-e${entry.id}`,
          role: 'assistant',
          content: [{ type: 'text', text }],
          createdAt: message.timestamp,
        },
      });
    }
    for (const block of message.content) {
      if (block.type !== 'toolCall') continue;
      const result = results.get(block.id);
      rows.push({
        entryId: String(entry.id),
        row: {
          id: block.id,
          role: 'assistant',
          content: {
            kind: 'toolcall',
            call: {
              id: block.id,
              name: block.name,
              arguments: block.arguments,
              startedAt: message.timestamp,
              ...(result === undefined
                ? {}
                : { result: result.content, isError: result.isError, endedAt: result.timestamp }),
            },
          },
          createdAt: message.timestamp,
        },
      });
    }
  }
  return rows;
}

function streamingText(view: ConversationView): string {
  const live = view.docs['pi.live'] as { generation?: { message?: AssistantMessage } } | undefined;
  const message = live?.generation?.message;
  return message === undefined ? '' : textBlocks(message);
}

export interface TurnMirror {
  onView(view: ConversationView): Promise<void>;
  flush(entries: readonly EntryRecord[]): Promise<void>;
}

export function createTurnMirror(
  api: MachineApi,
  stepId: string,
  afterEntryId: EntryId | undefined,
): TurnMirror {
  const posted = new Map<string, string>();
  let streamed = '';
  const post = async (entries: readonly EntryRecord[]) => {
    for (const { row, entryId } of entryRowSources(stepId, entries)) {
      const body = JSON.stringify(row.content);
      if (posted.get(row.id) === body) continue;
      await api.transcriptRow(stepId, row, entryId);
      posted.set(row.id, body);
    }
  };
  return {
    onView: async (view) => {
      await post(
        view.entries.filter((entry) => afterEntryId === undefined || entry.id > afterEntryId),
      );
      const text = streamingText(view);
      const delta = text.startsWith(streamed) ? text.slice(streamed.length) : text;
      if (delta !== '') await api.transcriptDelta(stepId, delta);
      streamed = text;
    },
    flush: post,
  };
}
