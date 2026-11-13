import type { AgentTodoItem } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import type { TranscriptMessage } from '../src/journal.js';
import type { MachineApi } from '../src/machine-client.js';
import { StepTranscriptStream } from '../src/step-transcript-stream.js';

function harness(options: { now?: () => number; rowFails?: boolean } = {}) {
  const calls: string[] = [];
  const rows: TranscriptMessage[] = [];
  const todos: AgentTodoItem[][] = [];
  const logs: string[] = [];
  const client = {
    transcriptDelta: async (_stepId: string, text: string) => {
      calls.push(`text:${text}`);
    },
    thinkingDelta: async (_stepId: string, text: string) => {
      calls.push(`thinking:${text}`);
    },
    transcriptRow: async (_stepId: string, row: { id: string }) => {
      calls.push(`row:${row.id}`);
      if (options.rowFails === true) throw new Error('relay down');
    },
  } as unknown as MachineApi;
  const stream = new StepTranscriptStream({
    stepId: 's1',
    client,
    transcript: { upsert: (row) => rows.push(row) },
    agentTodo: { report: (items) => todos.push([...items]) },
    now: options.now ?? (() => 100),
    log: (line) => logs.push(line),
  });
  return { stream, calls, rows, todos, logs };
}

describe('StepTranscriptStream', () => {
  test('a sealed segment flushes pending deltas before its row is relayed', async () => {
    const h = harness();
    h.stream.pushThinking('hmm');
    h.stream.pushText('hello');
    await h.stream.segments.append('text', 'hello');
    await h.stream.segments.seal();
    expect(h.calls).toEqual(['thinking:hmm', 'text:hello', 'row:msg-s1-1']);
    expect(h.rows).toEqual([
      {
        id: 'msg-s1-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        createdAt: 100,
      },
    ]);
  });

  test('row timestamps and message ids stay strictly increasing under a frozen clock', () => {
    const h = harness();
    expect([h.stream.rowCreatedAt(), h.stream.rowCreatedAt(), h.stream.rowCreatedAt()]).toEqual([
      100, 101, 102,
    ]);
    expect([h.stream.nextMessageId(), h.stream.nextMessageId()]).toEqual(['msg-s1-1', 'msg-s1-2']);
  });

  test('a text segment carrying a todo list reports it', async () => {
    const h = harness();
    await h.stream.segments.append('text', '- [x] read\n- [ ] write');
    await h.stream.segments.seal();
    expect(h.todos).toEqual([
      [
        { text: 'read', state: 'done' },
        { text: 'write', state: 'todo' },
      ],
    ]);
  });

  test('a failed row relay is logged and the row is still kept locally', async () => {
    const h = harness({ rowFails: true });
    await h.stream.segments.append('text', 'x');
    await h.stream.segments.seal();
    expect(h.rows).toHaveLength(1);
    expect(h.logs).toEqual(['segment row relay failed: relay down']);
  });

  test('discarded deltas are never sent', async () => {
    const h = harness();
    h.stream.pushText('dropped');
    h.stream.discardDeltas();
    h.stream.flushDeltas();
    await Promise.resolve();
    expect(h.calls).toEqual([]);
  });
});
