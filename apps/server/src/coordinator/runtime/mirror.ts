import {
  coordinatorTextSourceId,
  coordinatorToolSourceId,
  type TranscriptRow,
} from '@cairn/shared';
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

export function entryRowSources(
  stepId: string,
  entries: readonly EntryRecord[],
  storeId?: string,
  stoppedEntry?: EntryId,
): EntryRow[] {
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
      (message.stopReason === 'aborted' && entry.id !== stoppedEntry)
    ) {
      continue;
    }
    const text = textBlocks(message);
    if (text !== '') {
      rows.push({
        entryId: String(entry.id),
        row: {
          id: coordinatorTextSourceId(stepId, String(entry.id), storeId),
          role: 'assistant',
          content: [{ type: 'text', text }],
          createdAt: message.timestamp,
        },
      });
    }
    if (message.stopReason === 'aborted') continue;
    for (const block of message.content) {
      if (block.type !== 'toolCall') continue;
      const result = results.get(block.id);
      rows.push({
        entryId: String(entry.id),
        row: {
          id: storeId === undefined ? block.id : coordinatorToolSourceId(storeId, block.id),
          role: 'assistant',
          content: {
            kind: 'toolcall',
            call: {
              id: storeId === undefined ? block.id : coordinatorToolSourceId(storeId, block.id),
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

function liveStateOf(view: ConversationView): {
  taskId?: number | string;
  text: string;
} {
  const live = view.docs['pi.live'] as
    | { run?: { taskId?: number | string }; generation?: { message?: AssistantMessage } }
    | undefined;
  const message = live?.generation?.message;
  return {
    ...(live?.run?.taskId === undefined ? {} : { taskId: live.run.taskId }),
    text: message === undefined ? '' : textBlocks(message),
  };
}

export interface TurnMirror {
  onView(view: ConversationView): Promise<void>;
  suppressTask(taskId: number | string | undefined): void;
  drain(): Promise<void>;
  flush(
    entries: readonly EntryRecord[],
    stopped?: boolean,
    minStoppedEntryId?: EntryId,
  ): Promise<void>;
}

export function createTurnMirror(
  api: MachineApi,
  stepId: string,
  afterEntryId: EntryId | undefined,
  storeId?: string,
): TurnMirror {
  const posted = new Map<string, string>();
  const suppressedTasks = new Set<string>();
  let streamed = '';
  let activeView: Promise<void> = Promise.resolve();
  const post = async (entries: readonly EntryRecord[], stoppedEntry?: EntryId) => {
    for (const { row, entryId } of entryRowSources(stepId, entries, storeId, stoppedEntry)) {
      const body = JSON.stringify(row.content);
      if (posted.get(row.id) === body) continue;
      await api.transcriptRow(stepId, row, entryId);
      posted.set(row.id, body);
    }
  };
  return {
    onView: (view) => {
      const run = activeView.then(async () => {
        await post(
          view.entries.filter((entry) => afterEntryId === undefined || entry.id > afterEntryId),
        );
        const live = liveStateOf(view);
        if (live.taskId !== undefined && suppressedTasks.has(String(live.taskId))) return;
        const delta = live.text.startsWith(streamed) ? live.text.slice(streamed.length) : live.text;
        if (delta !== '') await api.transcriptDelta(stepId, delta);
        streamed = live.text;
      });
      activeView = run.catch(() => {});
      return run;
    },
    suppressTask: (taskId) => {
      if (taskId !== undefined) suppressedTasks.add(String(taskId));
      streamed = '';
    },
    drain: async () => {
      await activeView;
    },
    flush: (entries, stopped = false, minStoppedEntryId?: EntryId) =>
      post(
        entries,
        stopped
          ? entries.findLast(
              (entry) =>
                AssistantEntry.is(entry) &&
                (minStoppedEntryId === undefined || Number(entry.id) > Number(minStoppedEntryId)),
            )?.id
          : undefined,
      ),
  };
}
