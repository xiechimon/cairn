import type { AgentTodo, StepJournalRow, ToolCallRecord } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import type { MessageRow } from '../src/api/mappers.js';
import { liveEngineRun } from '../src/board/live-engine-run.js';

const NOW = 1_700_000_000_000;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${counter++}`;

function step(
  status: StepJournalRow['status'],
  harness: 'claude-code' | 'pi' | 'devin' | null = 'claude-code',
): StepJournalRow {
  return {
    id: nextId('step'),
    buildId: 'build-1',
    kind: 'build',
    machineId: 'machine-1',
    createdAt: NOW - 60_000,
    status,
    checkpointCommit: null,
    skillInjection: null,
    ...(harness === null ? {} : { route: { harness, modelId: 'm-1' } }),
  };
}

function text(text: string, role: MessageRow['role'] = 'assistant'): MessageRow {
  return { id: nextId('msg'), role, content: text, createdAt: NOW };
}

function call(call: Partial<ToolCallRecord> & { name: string }): MessageRow {
  const record: ToolCallRecord = { id: nextId('call'), arguments: {}, ...call };
  return { id: nextId('msg'), role: 'assistant', content: { kind: 'toolcall', call: record }, createdAt: NOW };
}

describe('liveEngineRun', () => {
  test('is absent until a step is routed to an engine', () => {
    expect(liveEngineRun({ messages: [], steps: [], agentTodo: null })).toBeNull();
    expect(
      liveEngineRun({ messages: [], steps: [step('pending', null), step('claimed', null)], agentTodo: null }),
    ).toBeNull();
  });

  test('names the run after the harness of the latest engine step', () => {
    const run = liveEngineRun({
      messages: [],
      steps: [step('done', 'claude-code'), step('claimed', 'pi')],
      agentTodo: null,
    });
    expect(run?.engine).toBe('Cairn');
    expect(run?.state).toBe('running');
  });

  test.each([
    [{ status: 'claimed' }, 'running'],
    [{ status: 'pending' }, 'running'],
    [{ status: 'done' }, 'finished'],
    [{ status: 'failed' }, 'failed'],
    [{ status: 'stopped' }, 'stopped'],
  ] as const)('a %o engine step leaves the run %s', ({ status }, state) => {
    expect(
      liveEngineRun({ messages: [], steps: [step(status)], agentTodo: null })?.state,
    ).toBe(state);
  });

  test('a failed step wins over a stopped one and an active one wins over a settled tail', () => {
    expect(
      liveEngineRun({
        messages: [],
        steps: [step('failed'), step('stopped')],
        agentTodo: null,
      })?.state,
    ).toBe('failed');
    expect(
      liveEngineRun({
        messages: [],
        steps: [step('done'), step('claimed')],
        agentTodo: null,
      })?.state,
    ).toBe('running');
  });

  test('maps assistant text and known tools into engine events', () => {
    const run = liveEngineRun({
      messages: [
        text('先看下载接口怎么设置文件名。'),
        call({ name: 'Read', arguments: { file_path: 'server/routes/attachments.ts' }, result: 'line1\nline2\nline3', startedAt: NOW, endedAt: NOW + 400 }),
        call({
          name: 'Edit',
          arguments: { file_path: 'a.ts', old_string: 'old\nline', new_string: 'new\nline\nmore' },
          result: 'ok',
          startedAt: NOW,
          endedAt: NOW + 200,
        }),
        call({ name: 'Bash', arguments: { command: 'pnpm test' }, result: 'Tests  7 passed (7)', startedAt: NOW, endedAt: NOW + 38_000 }),
        call({ name: 'WebSearch', arguments: { query: 'x' }, result: { hits: 2 }, startedAt: NOW, endedAt: NOW + 1_000 }),
        text('改好了。'),
        text('owner reply', 'user'),
      ],
      steps: [step('done')],
      agentTodo: null,
    });
    expect(run?.events.map((event) => event.kind)).toEqual([
      'text',
      'read',
      'edit',
      'run',
      'unknown',
      'text',
    ]);
    const read = run?.events[1];
    expect(read).toMatchObject({ kind: 'read', path: 'server/routes/attachments.ts', lines: 3 });
    const edit = run?.events[2];
    expect(edit).toMatchObject({
      kind: 'edit',
      file: { path: 'a.ts', added: 3, removed: 2 },
    });
    const bash = run?.events[3];
    expect(bash).toMatchObject({ kind: 'run', command: 'pnpm test', exit: 0, seconds: 38 });
    const unknown = run?.events[4];
    expect(unknown?.kind).toBe('unknown');
    if (unknown?.kind === 'unknown') {
      expect(unknown.type).toBe('WebSearch');
      expect(unknown.payload).toContain('hits');
    }
  });

  test('marks an unfinished command as still running and an erroring one as failed', () => {
    const run = liveEngineRun({
      messages: [
        call({ name: 'Bash', arguments: { command: 'pnpm test' } }),
        call({ name: 'Bash', arguments: { command: 'pnpm lint' }, result: 'oops', isError: true }),
      ],
      steps: [step('claimed')],
      agentTodo: null,
    });
    expect(run?.events[0]).toMatchObject({ kind: 'run', exit: null });
    expect(run?.events[1]).toMatchObject({ kind: 'run', exit: 1 });
  });

  test('carries the live todo list as the run plan when it belongs to this build', () => {
    const running = step('claimed');
    const agentTodo: AgentTodo = {
      stepId: running.id,
      at: NOW,
      items: [
        { text: '找到设置文件名的地方', state: 'done' },
        { text: '改编码', state: 'doing' },
        { text: '跑测试', state: 'todo' },
      ],
    };
    const run = liveEngineRun({ messages: [], steps: [running], agentTodo });
    expect(run?.plan).toEqual(agentTodo.items);
    expect(
      liveEngineRun({
        messages: [],
        steps: [running],
        agentTodo: { ...agentTodo, stepId: 'other-step' },
      })?.plan,
    ).toEqual([]);
  });

  test('without a live todo the plan comes from the newest persisted snapshot, then the page', () => {
    const running = step('claimed');
    const page = [{ text: '旧计划', state: 'todo' as const }];
    expect(liveEngineRun({ messages: [], steps: [running], agentTodo: null, pageTodo: page })?.plan).toEqual(page);
    const run = liveEngineRun({
      messages: [
        call({ name: 'plan', todo: [{ text: '改编码', state: 'done' }] }),
        text('- [x] 改编码\n- [~] 跑测试'),
        text('- [ ] owner line', 'user'),
      ],
      steps: [running],
      agentTodo: null,
      pageTodo: page,
    });
    expect(run?.plan).toEqual([
      { text: '改编码', state: 'done' },
      { text: '跑测试', state: 'doing' },
    ]);
  });

  test('synthesizes the raw log from the same events, in the fixture format', () => {
    const run = liveEngineRun({
      messages: [
        text('先看下载接口怎么设置文件名。'),
        call({ name: 'Read', arguments: { file_path: 'a.ts' }, result: 'x\ny', startedAt: NOW, endedAt: NOW + 1 }),
        call({ name: 'Bash', arguments: { command: 'pnpm test' }, result: 'Tests  7 passed (7)', startedAt: NOW, endedAt: NOW + 2 }),
      ],
      steps: [step('done')],
      agentTodo: null,
    });
    expect(run?.rawOutput).toContain('● 先看下载接口怎么设置文件名。');
    expect(run?.rawOutput).toContain('● Read(a.ts)');
    expect(run?.rawOutput).toContain('● Bash(pnpm test)');
    expect(run?.rawOutput).toContain('Tests  7 passed (7)');
  });

  test('keeps cost and elapsed unset so the usage popover keeps the real numbers', () => {
    const run = liveEngineRun({ messages: [], steps: [step('done')], agentTodo: null });
    expect(run?.elapsedSeconds).toBeNull();
    expect(run?.costUsd).toBeNull();
  });
});
