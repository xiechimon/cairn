import { createOutbox, type Deliver, type OutboxEntry } from '../chief/outbox.js';

export interface OptimisticTaskUser {
  id: string;
  outboxKey: string;
  text: string;
  createdAt: number;
  delivery?: 'sending';
}

const queueOnlyKeys = new Set<string>();
const rolloverKeys = new Set<string>();
const errorsByTodo = new Map<string, string>();
const errorListeners = new Set<() => void>();

function notifyErrorListeners(): void {
  for (const listener of errorListeners) listener();
}

export const taskOutbox = createOutbox();

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

export function enqueueTaskSend(input: {
  todoId: string;
  buildId: string;
  text: string;
  queueOnly: boolean;
  deliver: Deliver;
  onError: (error: unknown) => void;
}): string {
  taskOutboxErrors.clear(input.todoId);
  const key = taskOutbox.enqueue(
    {
      scope: input.todoId,
      threadId: input.buildId,
      globalThreadId: null,
      projectId: null,
      text: input.text,
    },
    async (entry) => {
      try {
        return await input.deliver(entry);
      } catch (error) {
        input.onError(error);
        throw error;
      }
    },
    { awaitRefetch: !input.queueOnly },
  );
  if (input.queueOnly) queueOnlyKeys.add(key);
  return key;
}

export function markTaskRollover(key: string): void {
  rolloverKeys.add(key);
}

export function consumeTaskRollover(key: string): boolean {
  return rolloverKeys.delete(key);
}

export function discardTaskFailed(key: string): string | null {
  queueOnlyKeys.delete(key);
  rolloverKeys.delete(key);
  return taskOutbox.discard(key)?.text ?? null;
}

export function failedTaskOutbox(entries: readonly OutboxEntry[], todoId: string): OutboxEntry[] {
  return entries.filter((entry) => entry.scope === todoId && entry.state === 'failed');
}

export function unlandedTaskBubbles(
  entries: readonly OutboxEntry[],
  todoId: string,
  known: ReadonlySet<string>,
): OptimisticTaskUser[] {
  return entries.flatMap((entry) =>
    entry.scope !== todoId ||
    entry.state === 'failed' ||
    queueOnlyKeys.has(entry.key) ||
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
