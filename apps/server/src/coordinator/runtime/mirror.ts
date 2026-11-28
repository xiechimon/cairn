import {
  coordinatorModelCallSourceId,
  coordinatorTextSourceId,
  coordinatorThinkingSourceId,
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

function thinkingBlocks(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => (block.type === 'thinking' ? [block.thinking] : []))
    .join('\n')
    .trim();
}

export interface EntryRow {
  row: TranscriptRow;
  entryId: string;
  lastOfEntry: boolean;
}

function modelCallContent(message: AssistantMessage): {
  kind: 'modelCall';
  model: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  startedAt: number | null;
  endedAt: number | null;
} {
  const usage = message.usage;
  return {
    kind: 'modelCall',
    model: message.responseModel ?? message.model ?? null,
    usage:
      usage === undefined
        ? null
        : {
            input: usage.input ?? 0,
            output: usage.output ?? 0,
            cacheRead: usage.cacheRead ?? 0,
            cacheWrite: usage.cacheWrite ?? 0,
          },
    startedAt: message.timestamp,
    endedAt: message.durationMs === undefined ? null : message.timestamp + message.durationMs,
  };
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
  const rows: Omit<EntryRow, 'lastOfEntry'>[] = [];
  for (const entry of entries) {
    const message = entry.model?.[0];
    if (
      !AssistantEntry.is(entry) ||
      message?.role !== 'assistant' ||
      (message.stopReason === 'aborted' && entry.id !== stoppedEntry)
    ) {
      continue;
    }
    if (message.stopReason !== 'aborted') {
      rows.push({
        entryId: String(entry.id),
        row: {
          id: coordinatorModelCallSourceId(stepId, String(entry.id), storeId),
          role: 'assistant',
          content: modelCallContent(message),
          createdAt: message.timestamp,
        },
      });
    }
    const thinking = thinkingBlocks(message);
    if (thinking !== '') {
      rows.push({
        entryId: String(entry.id),
        row: {
          id: coordinatorThinkingSourceId(stepId, String(entry.id), storeId),
          role: 'assistant',
          content: [{ type: 'thinking', thinking }],
          createdAt: message.timestamp,
        },
      });
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
  return rows.map((row, index) => ({
    ...row,
    lastOfEntry: rows[index + 1]?.entryId !== row.entryId,
  }));
}

function liveStateOf(view: ConversationView): {
  taskId?: number | string;
  text: string;
  timestamp?: number;
} {
  const live = view.docs['pi.live'] as
    | { run?: { taskId?: number | string }; generation?: { message?: AssistantMessage } }
    | undefined;
  const message = live?.generation?.message;
  return {
    ...(live?.run?.taskId === undefined ? {} : { taskId: live.run.taskId }),
    text: message === undefined ? '' : textBlocks(message),
    ...(message?.timestamp === undefined ? {} : { timestamp: message.timestamp }),
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
  let lastCommittedAssistantTs: number | undefined;
  let activeView: Promise<void> = Promise.resolve();
  const post = async (entries: readonly EntryRecord[], stoppedEntry?: EntryId) => {
    let assistantTextTs: number | undefined;
    for (const { row, entryId, lastOfEntry } of entryRowSources(
      stepId,
      entries,
      storeId,
      stoppedEntry,
    )) {
      const body = JSON.stringify(row.content);
      if (posted.get(row.id) === body) continue;
      await api.transcriptRow(stepId, row, entryId, lastOfEntry);
      posted.set(row.id, body);
      if (
        row.role === 'assistant' &&
        Array.isArray(row.content) &&
        row.content[0]?.type === 'text'
      ) {
        assistantTextTs = row.createdAt;
      }
    }
    return assistantTextTs;
  };
  return {
    onView: (view) => {
      const run = activeView.then(async () => {
        const committedTs = await post(
          view.entries.filter((entry) => afterEntryId === undefined || entry.id > afterEntryId),
        );
        const live = liveStateOf(view);
        if (committedTs !== undefined) {
          lastCommittedAssistantTs = committedTs;
          if (live.timestamp !== lastCommittedAssistantTs) streamed = '';
        }
        if (live.taskId !== undefined && suppressedTasks.has(String(live.taskId))) return;
        if (live.timestamp !== undefined && live.timestamp === lastCommittedAssistantTs) {
          streamed = live.text;
          return;
        }
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
    flush: async (entries, stopped = false, minStoppedEntryId?: EntryId) => {
      await post(
        entries,
        stopped
          ? entries.findLast(
              (entry) =>
                AssistantEntry.is(entry) &&
                (minStoppedEntryId === undefined || Number(entry.id) > Number(minStoppedEntryId)),
            )?.id
          : undefined,
      );
    },
  };
}
