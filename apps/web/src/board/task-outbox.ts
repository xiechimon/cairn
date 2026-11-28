import { onConnectionRestored } from '../api/connection-state.js';
import {
  createOutbox,
  type Deliver,
  indexedDbOutboxStore,
  type OutboxEntry,
  pageLockOwner,
  type SendFailed,
  type TaskSendMode,
} from '../chief/outbox.js';

export interface OptimisticTaskUser {
  id: string;
  outboxKey: string;
  text: string;
  createdAt: number;
  delivery?: 'sending';
}

const readyToSettleKeys = new Set<string>();
const errorsByTodo = new Map<string, string>();
const errorListeners = new Set<() => void>();

function notifyErrorListeners(): void {
  for (const listener of errorListeners) listener();
}

export const taskOutbox = createOutbox({
  store: indexedDbOutboxStore('cairn-task-outbox'),
  owner: pageLockOwner(),
  reconnect: onConnectionRestored,
});

export const taskOutboxErrors = {
  subscribe(listener: () => void): () => void {
    errorListeners.add(listener);
    return () => errorListeners.delete(listener);
  },
  get(todoId: string): string | null {
    return errorsByTodo.get(todoId) ?? null;
  },
  set(todoId: string, message: string): void {
    if (errorsByTodo.get(todoId) === message) return;
    errorsByTodo.set(todoId, message);
    notifyErrorListeners();
  },
  clear(todoId: string): void {
    if (!errorsByTodo.delete(todoId)) return;
    notifyErrorListeners();
  },
};

const watchers = new Map<string, number>();

export function watchTask(todoId: string): () => void {
  watchers.set(todoId, (watchers.get(todoId) ?? 0) + 1);
  return () => {
    const left = (watchers.get(todoId) ?? 1) - 1;
    if (left === 0) watchers.delete(todoId);
    else watchers.set(todoId, left);
  };
}

export function taskIsWatched(todoId: string): boolean {
  return watchers.has(todoId);
}

export function enqueueTaskSend(input: {
  account: string | null;
  todoId: string;
  buildId: string;
  text: string;
  mode: TaskSendMode;
  deliver: Deliver;
  onFailed: SendFailed;
}): string {
  taskOutboxErrors.clear(input.todoId);
  return taskOutbox.enqueue(
    {
      scope: input.account,
      threadId: input.buildId,
      globalThreadId: null,
      projectId: null,
      text: input.text,
      task: { todoId: input.todoId, mode: input.mode },
    },
    input.deliver,
    { awaitRefetch: input.mode === 'reply', onFailed: input.onFailed },
  );
}

export function markTaskReadyToSettle(key: string): void {
  readyToSettleKeys.add(key);
}

export function consumeTaskReadyToSettle(key: string): boolean {
  return readyToSettleKeys.delete(key);
}

export function discardTaskFailed(key: string): string | null {
  readyToSettleKeys.delete(key);
  return taskOutbox.discard(key)?.text ?? null;
}

export function failedTaskOutbox(entries: readonly OutboxEntry[], todoId: string): OutboxEntry[] {
  return entries.filter((entry) => entry.task?.todoId === todoId && entry.state === 'failed');
}

export function acknowledgeTaskFailed(todoId: string): void {
  for (const entry of failedTaskOutbox(taskOutbox.entries(), todoId)) {
    taskOutbox.acknowledge(entry.key);
  }
}

function retireClearedTaskError(todoId: string, retire: () => void): void {
  const hadFailed = failedTaskOutbox(taskOutbox.entries(), todoId).length > 0;
  retire();
  if (hadFailed && failedTaskOutbox(taskOutbox.entries(), todoId).length === 0) {
    taskOutboxErrors.clear(todoId);
  }
}

export function landTaskOutbox(todoId: string, clientMessageId: string, messageId: string): void {
  retireClearedTaskError(todoId, () => taskOutbox.land(clientMessageId, messageId));
}

export function landKnownTaskOutbox(
  todoId: string,
  knownClientIds: ReadonlyMap<string, string>,
): void {
  if (knownClientIds.size === 0) return;
  retireClearedTaskError(todoId, () => taskOutbox.landKnown(knownClientIds));
}

export function unlandedTaskBubbles(
  entries: readonly OutboxEntry[],
  todoId: string,
  known: ReadonlySet<string>,
  knownClientIds?: ReadonlyMap<string, string> | ReadonlySet<string>,
): OptimisticTaskUser[] {
  return entries.flatMap((entry) =>
    entry.task?.todoId !== todoId ||
    entry.state === 'failed' ||
    (entry.task.mode !== 'reply' && entry.state !== 'sending') ||
    knownClientIds?.has(entry.key) === true ||
    (entry.messageId !== null && known.has(entry.messageId))
      ? []
      : [
          {
            id: entry.key,
            outboxKey: entry.key,
            text: entry.text,
            createdAt: entry.createdAt,
            ...(entry.state === 'sending' ? { delivery: 'sending' as const } : {}),
          },
        ],
  );
}
