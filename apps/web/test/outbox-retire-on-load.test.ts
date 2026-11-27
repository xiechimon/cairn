import { describe, expect, test } from 'vitest';
import { mapChiefStream, mapTranscript } from '../src/api/mappers.js';
import {
  failedTaskOutbox,
  landTaskOutbox,
  taskOutbox,
  taskOutboxErrors,
  unlandedTaskBubbles,
} from '../src/board/task-outbox.js';
import {
  createOutbox,
  type Deliver,
  type OutboxStore,
  type StoredOutboxEntry,
  unlandedItems,
} from '../src/chief/outbox.js';

function memoryStore(initial: StoredOutboxEntry[] = []): {
  store: OutboxStore;
  removed: string[];
  rows: () => StoredOutboxEntry[];
} {
  const map = new Map(initial.map((entry) => [entry.key, entry]));
  const removed: string[] = [];
  return {
    rows: () => [...map.values()],
    removed,
    store: {
      put: async (entry) => {
        map.set(entry.key, entry);
      },
      putIfPresent: async (entry) => {
        if (map.has(entry.key)) map.set(entry.key, entry);
      },
      remove: async (key) => {
        map.delete(key);
        removed.push(key);
      },
      load: async () => [...map.values()],
    },
  };
}

describe('outbox clientMessageId retirement on server load', () => {
  test('landKnown retires sending, sent, failed, and cross-build rollover entries', async () => {
    const { store, removed } = memoryStore();
    let seq = 0;
    const box = createOutbox({ now: () => 1000, mintKey: () => `key-${++seq}`, store });
    const hang: Deliver = () => new Promise(() => {});

    const sendingKey = box.enqueue(
      {
        scope: 'u/team',
        globalThreadId: null,
        threadId: 'build-1',
        projectId: null,
        text: 'queued before reload',
        task: { todoId: 'todo-1', mode: 'queue' },
      },
      hang,
    );
    const failedKey = box.enqueue(
      {
        scope: 'u/team',
        globalThreadId: null,
        threadId: 'build-old',
        projectId: null,
        text: 'failed locally but committed remotely',
        task: { todoId: 'todo-2', mode: 'reply' },
      },
      async () => {
        throw new Error('dropped response');
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(box.entries().find((e) => e.key === failedKey)?.state).toBe('failed');

    taskOutboxErrors.set('todo-2', 'temporary network error');
    const knownClientIds = new Map([
      [sendingKey, 'q-1'],
      [failedKey, 'msg-rollover'],
    ]);
    expect(unlandedTaskBubbles(box.entries(), 'todo-1', new Set(), knownClientIds)).toEqual([]);
    expect(unlandedTaskBubbles(box.entries(), 'todo-2', new Set(), knownClientIds)).toEqual([]);

    box.landKnown(knownClientIds);
    expect(box.sentKey('q-1')).toBe(sendingKey);
    expect(box.sentKey('msg-rollover')).toBe(failedKey);
    expect(failedTaskOutbox(box.entries(), 'todo-2')).toEqual([]);
    taskOutboxErrors.clear('todo-2');
    expect(taskOutboxErrors.get('todo-2')).toBeNull();

    box.settle('build-1', new Set(['q-1']), (e) => e.task?.todoId === 'todo-1');
    box.settle('build-new', new Set(['msg-rollover']), (e) => e.task?.todoId === 'todo-2');
    expect(box.entries()).toEqual([]);
    expect(removed).toContain(sendingKey);
    expect(removed).toContain(failedKey);
  });

  test('landKnown and resume retire returned-to-draft entries even when composer subscribes after load', async () => {
    const initial: StoredOutboxEntry = {
      key: 'cm-returned-1',
      scope: 'u/team',
      owner: 'dead-tab',
      threadId: 'thread-1',
      projectId: null,
      text: 'returned draft already on server',
      state: 'returned',
      createdAt: 1000,
    };
    const { store, removed, rows } = memoryStore([initial]);
    const box = createOutbox({
      now: () => 2000,
      store,
      owner: { id: 'live-tab', live: async () => new Set() },
    });
    let notified = 0;
    const stop = box.subscribe(() => {
      notified += 1;
    });
    await box.resume('u/team', async () => ({ threadId: 'thread-1', messageId: null }));
    expect(notified).toBeGreaterThanOrEqual(1);

    box.landKnown(new Map([['cm-returned-1', 'msg-server-1']]));
    const cleaned: string[] = [];
    const unsubLate = box.subscribeLateArrival((entry) => {
      cleaned.push(entry.key);
      return true;
    });

    expect(cleaned).toEqual(['cm-returned-1']);
    expect(box.sentKey('msg-server-1')).toBe('cm-returned-1');
    expect(removed).toContain('cm-returned-1');
    expect(rows()).toEqual([]);
    unsubLate();
    stop();
  });

  test('unlandedItems suppresses Coordinator duplicates and mappers preserve clientMessageId outboxKey', () => {
    const box = createOutbox({ now: () => 1000, mintKey: () => 'cm-chief-1' });
    box.enqueue(
      { scope: 'u/team', globalThreadId: 'chief-1', threadId: 'chief-1', projectId: null, text: 'ping' },
      () => new Promise(() => {}),
    );
    const knownClientIds = new Map([['cm-chief-1', 'srv-chief-1']]);
    expect(
      unlandedItems(box.entries(), 'chief-1', new Set(), 'chief-1', null, knownClientIds),
    ).toEqual([]);

    const taskItems = mapTranscript({
      messages: [
        {
          id: 'srv-task-1',
          role: 'user',
          content: 'follow up',
          createdAt: 10,
          origin: 'user',
          clientMessageId: 'cm-task-1',
        },
      ],
      hasEarlier: false,
      steps: [],
      build: null,
      todo: {
        id: 'todo-1',
        teamId: 'team-1',
        projectId: 'project-1',
        title: 'Task',
        spec: '',
        phase: 'done',
        phaseAt: 10,
        seqNum: 1,
        orderIndex: 0,
        assignment: null,
        agent: null,
        latestBuildId: 'build-1',
        lastRunAt: 10,
        hasChanges: false,
        hasPlan: false,
        buildHistory: [],
        sourceTodo: null,
        v: 1,
      },
      machineName: null,
      userName: 'Owner',
      liveText: '',
      liveThinking: '',
      activity: null,
      agentTodo: null,
      pageTodo: null,
    });
    expect(taskItems.find((item) => item.kind === 'user')).toMatchObject({
      kind: 'user',
      id: 'srv-task-1',
      outboxKey: 'cm-task-1',
    });

    const chiefItems = mapChiefStream([
      {
        id: 'srv-chief-1',
        role: 'user',
        content: 'ping',
        createdAt: 20,
        origin: 'user',
        clientMessageId: 'cm-chief-1',
      },
    ]);
    expect(chiefItems[0]).toMatchObject({
      kind: 'user',
      id: 'srv-chief-1',
      outboxKey: 'cm-chief-1',
    });
  });

  test('resume with only returned rows updates entries snapshot reference and prevents resend when landKnown runs first', async () => {
    const returnedEntry: StoredOutboxEntry = {
      key: 'cm-returned-only',
      scope: 'u/team',
      owner: 'dead-tab',
      threadId: 'thread-1',
      projectId: null,
      text: 'returned draft waiting before load',
      state: 'returned',
      createdAt: 1000,
    };
    const sendingEntry: StoredOutboxEntry = {
      key: 'cm-sending-already-landed',
      scope: 'u/team',
      owner: 'dead-tab',
      threadId: 'thread-1',
      projectId: null,
      text: 'sending row already on server',
      state: 'sending',
      createdAt: 1001,
    };
    const { store, removed } = memoryStore([returnedEntry]);
    const boxReturned = createOutbox({
      now: () => 2000,
      store,
      owner: { id: 'live-tab', live: async () => new Set() },
    });
    const beforeSnapshot = boxReturned.entries();
    let notifications = 0;
    const stop = boxReturned.subscribe(() => {
      notifications += 1;
    });
    await boxReturned.resume('u/team', async () => ({ threadId: 'thread-1', messageId: null }));
    expect(notifications).toBeGreaterThanOrEqual(1);
    expect(Object.is(boxReturned.entries(), beforeSnapshot)).toBe(false);
    stop();

    const both = memoryStore([returnedEntry, sendingEntry]);
    const boxPreloaded = createOutbox({
      now: () => 2000,
      store: both.store,
      owner: { id: 'live-tab', live: async () => new Set() },
    });
    boxPreloaded.landKnown(
      new Map([
        ['cm-returned-only', 'srv-ret-1'],
        ['cm-sending-already-landed', 'srv-send-1'],
      ]),
    );
    let deliverCalls = 0;
    await boxPreloaded.resume('u/team', async () => {
      deliverCalls += 1;
      return { threadId: 'thread-1', messageId: 'dup-post' };
    });
    expect(deliverCalls).toBe(0);
    expect(boxPreloaded.entries()).toEqual([]);
    expect(both.removed).toContain('cm-sending-already-landed');
    expect(boxPreloaded.sentKey('srv-send-1')).toBe('cm-sending-already-landed');

    const retiredLate: string[] = [];
    const unsubLate = boxPreloaded.subscribeLateArrival((entry) => {
      retiredLate.push(entry.key);
      return true;
    });
    expect(retiredLate).toEqual(['cm-returned-only']);
    expect(both.removed).toContain('cm-returned-only');
    expect(removed).not.toContain('cm-returned-only');
    unsubLate();
  });

  test('landTaskOutbox clears taskOutboxErrors when SSE confirms a failed entry before reconcile runs', async () => {
    const key = taskOutbox.enqueue(
      {
        scope: null,
        globalThreadId: null,
        threadId: 'build-sse-err',
        projectId: null,
        text: 'timed out then arrived on SSE',
        task: { todoId: 'todo-sse-err', mode: 'reply' },
      },
      async () => {
        throw new Error('timeout');
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    taskOutboxErrors.set('todo-sse-err', 'Send failed. Try again.');
    expect(failedTaskOutbox(taskOutbox.entries(), 'todo-sse-err')).toHaveLength(1);

    landTaskOutbox('todo-sse-err', key, 'srv-msg-sse');
    expect(failedTaskOutbox(taskOutbox.entries(), 'todo-sse-err')).toEqual([]);
    expect(taskOutboxErrors.get('todo-sse-err')).toBeNull();
    taskOutbox.settle('build-sse-err', new Set(['srv-msg-sse']), (e) => e.task?.todoId === 'todo-sse-err');
  });
});
