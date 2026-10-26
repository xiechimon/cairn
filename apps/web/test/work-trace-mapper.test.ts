import type { ToolCallRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { mapTranscript, type MessageRow } from '../src/api/mappers.js';
import { todo } from './helpers.js';

function render(messages: MessageRow[]) {
  return mapTranscript({ messages, steps: [], plans: [], build: null, todo: todo(12, 'done'), machineName: null, userName: 'Ian', liveText: '' });
}

function call(id: string, name: string, args: Record<string, unknown>, at: number, timing?: Pick<ToolCallRecord, 'startedAt' | 'endedAt'>): MessageRow {
  return { id, role: 'assistant', createdAt: at, content: { kind: 'toolcall', call: { id, name, arguments: args, result: 'done', ...timing } } };
}

test('thinking and calls form maximal runs separated by assistant prose and notes', () => {
  const items = render([
    { id: 'think', role: 'assistant', content: [{ type: 'thinking', thinking: 'Full reasoning' }], createdAt: 1000 },
    call('read', 'Read', { file_path: '/home/ian/.pacman-chief/workspaces/abc/src/main.ts', offset: 2, limit: 8 }, 2500),
    { id: 'prose', role: 'assistant', content: 'Next stage', createdAt: 3000 },
    call('search', 'bash', { command: 'rg target src', description: 'Find target' }, 4000),
    { id: 'note', role: 'system', content: 'Checkpoint', createdAt: 5000 },
    call('run', 'Bash', { command: 'pnpm lint\npnpm typecheck' }, 6000),
  ]);
  expect(items.map((item) => item.kind)).toEqual(['work', 'robot', 'work', 'note', 'work']);
  const first = items[0];
  expect(first).toMatchObject({ kind: 'work', steps: [ { kind: 'think', text: 'Full reasoning', seconds: null }, { action: 'read', target: 'src/main.ts L2–9', seconds: 1.5 } ] });
  expect(items[2]).toMatchObject({ steps: [{ action: 'search', description: 'Find target', command: 'rg target src' }] });
  expect(items[4]).toMatchObject({ steps: [{ action: 'run', description: 'pnpm lint' }] });
});

test('timestamps retain subsecond precision and absent durations stay unknown', () => {
  expect(render([call('a', 'Read', { path: 'a' }, 1000)])[0]).toMatchObject({ steps: [{ seconds: null }] });
  expect(render([call('b', 'Read', { path: 'b' }, 1000, { startedAt: 100, endedAt: 350 })])[0]).toMatchObject({ steps: [{ seconds: 0.25 }] });
});

test('multi edits preserve old and new lines and external tools expose readable names', () => {
  expect(render([
    call('edit', 'MultiEdit', { file_path: 'src/a.ts', edits: [{ old_string: 'a\nb', new_string: 'c' }, { old_string: '', new_string: 'd\ne' }] }, 1000),
    call('mcp', 'mcp__browser__open', {}, 2000),
  ])[0]).toMatchObject({ steps: [
    { action: 'edit', diff: { removed: 2, added: 3 }, changes: { removed: ['a', 'b'], added: ['c', 'd', 'e'] } },
    { action: 'tool', target: 'browser · open' },
  ] });
});

test('a skill summary does not split historical calls from live thinking', () => {
  const items = mapTranscript({
    messages: [call('skill', 'read', { path: '/skills/verify/SKILL.md' }, 1000)],
    steps: [{ id: 'step', buildId: 'build', kind: 'build', machineId: null, createdAt: 500, status: 'claimed', checkpointCommit: null, skillInjection: null }],
    plans: [],
    build: { id: 'build', todoId: 'todo', withPlan: false, prevPhase: null, triggerSource: 'user', planDocId: null, errorMessage: null, prUrl: null, prNumber: null, diffHash: null, createdAt: 500 },
    todo: todo(12, 'building'), machineName: null, userName: 'Ian', liveText: '', liveThinking: 'Choosing verification',
  });
  const blocks = items.filter((item) => item.kind === 'work');
  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.steps.map((step) => step.kind)).toEqual(['call', 'think']);
  expect(items.some((item) => item.kind === 'skills')).toBe(true);
  expect(items.at(-1)?.kind).toBe('streaming');
});

test('a call left without a result only spins while its step is still running', () => {
  const unfinished: MessageRow = { id: 'cut', role: 'assistant', createdAt: 1000, content: { kind: 'toolcall', call: { id: 'cut', name: 'Bash', arguments: { command: 'sleep 60' } } } };
  const at = (status: 'claimed' | 'stopped') => mapTranscript({ messages: [unfinished], steps: [{ id: 'step', buildId: 'build', kind: 'build' as const, machineId: null, createdAt: 500, status, checkpointCommit: null, skillInjection: null }], plans: [], build: null, todo: todo(12, 'building'), machineName: null, userName: 'Ian', liveText: '' });
  expect(at('claimed')[0]).toMatchObject({ steps: [{ running: true, unfinished: false }] });
  expect(at('stopped')[0]).toMatchObject({ steps: [{ running: false, unfinished: true }] });
});

test('backend search tools count as searches', () => {
  expect(render([call('g', 'grep', { pattern: 'mergeBuild', path: 'apps/web' }, 1000)])[0]).toMatchObject({ steps: [{ action: 'search', description: 'grep mergeBuild apps/web' }] });
});
