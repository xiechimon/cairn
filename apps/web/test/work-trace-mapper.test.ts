import type { ToolCallRecord } from '@cairn/shared';
import { expect, test } from 'vitest';
import { mapTranscript, type MessageRow } from '../src/api/mappers.js';
import { todo } from './helpers.js';

function render(messages: MessageRow[]) {
  return mapTranscript({ messages, steps: [], build: null, todo: todo(12, 'done'), machineName: null, userName: 'Ian', liveText: '' });
}

function call(id: string, name: string, args: Record<string, unknown>, at: number, timing?: Pick<ToolCallRecord, 'startedAt' | 'endedAt'>): MessageRow {
  return { id, role: 'assistant', createdAt: at, content: { kind: 'toolcall', call: { id, name, arguments: args, result: 'done', ...timing } } };
}

test('thinking and calls form maximal runs separated by notes, absorbing leading narration preambles', () => {
  const items = render([
    { id: 'think', role: 'assistant', content: [{ type: 'thinking', thinking: 'Full reasoning' }], createdAt: 1000 },
    call('read', 'Read', { file_path: '/home/ian/.pacman-chief/workspaces/abc/src/main.ts', offset: 2, limit: 8 }, 2500),
    { id: 'prose', role: 'assistant', content: 'Next stage', createdAt: 3000 },
    call('search', 'bash', { command: 'rg target src', description: 'Find target' }, 4000),
    { id: 'note', role: 'system', content: 'Checkpoint', createdAt: 5000 },
    call('run', 'Bash', { command: 'pnpm lint\npnpm typecheck' }, 6000),
  ]);
  expect(items.map((item) => item.kind)).toEqual(['work', 'work', 'note', 'work']);
  expect(items[0]).toMatchObject({
    kind: 'work',
    steps: [
      { kind: 'think', text: 'Full reasoning', seconds: null },
      { kind: 'call', action: 'read', target: 'src/main.ts L2–9', seconds: 1.5 },
    ],
  });
  expect(items[1]).toMatchObject({
    kind: 'work',
    steps: [
      { kind: 'say', id: 'prose', text: 'Next stage' },
      { kind: 'call', action: 'search', description: 'Find target', command: 'rg target src' },
    ],
  });
  expect(items[3]).toMatchObject({ steps: [{ action: 'run', description: 'pnpm lint' }] });
});

test('trailing prose and multi-paragraph or block-markdown prose stay visible as robot replies', () => {
  const items = render([
    call('read-1', 'Read', { file_path: 'src/a.ts' }, 1000),
    { id: 'multi', role: 'assistant', content: 'First line.\n\nSecond paragraph.', createdAt: 2000 },
    call('read-2', 'Read', { file_path: 'src/b.ts' }, 3000),
    { id: 'heading', role: 'assistant', content: '## Summary', createdAt: 4000 },
    call('read-3', 'Read', { file_path: 'src/c.ts' }, 5000),
    { id: 'tail', role: 'assistant', content: 'All checks passed.', createdAt: 6000 },
  ]);
  expect(items.map((item) => item.kind)).toEqual(['work', 'robot', 'work', 'robot', 'work', 'robot']);
  expect(items[1]).toMatchObject({ kind: 'robot', markdown: 'First line.\n\nSecond paragraph.' });
  expect(items[3]).toMatchObject({ kind: 'robot', markdown: '## Summary' });
  expect(items[5]).toMatchObject({ kind: 'robot', markdown: 'All checks passed.' });
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
    build: { id: 'build', todoId: 'todo', withPlan: false, prevPhase: null, triggerSource: 'user', planDocId: null, errorMessage: null, prUrl: null, prNumber: null, diffHash: null, createdAt: 500 },
    todo: todo(12, 'building'), machineName: null, userName: 'Ian', liveText: '', liveThinking: 'Choosing verification',
  });
  const blocks = items.filter((item) => item.kind === 'work');
  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.steps.map((step) => step.kind)).toEqual(['call', 'think']);
  expect(blocks[0]?.running).toBe(true);
  expect(blocks[0]?.startedAt).toBe(500);
  expect(items.some((item) => item.kind === 'skills')).toBe(true);
  expect(items.at(-1)?.kind).toBe('work');
  expect(items.some((item) => item.kind === 'streaming')).toBe(false);
});

test('a call left without a result only spins while its step is still running', () => {
  const unfinished: MessageRow = { id: 'cut', role: 'assistant', createdAt: 1000, content: { kind: 'toolcall', call: { id: 'cut', name: 'Bash', arguments: { command: 'sleep 60' } } } };
  const at = (status: 'claimed' | 'stopped') => mapTranscript({ messages: [unfinished], steps: [{ id: 'step', buildId: 'build', kind: 'build' as const, machineId: null, createdAt: 500, status, checkpointCommit: null, skillInjection: null }], build: null, todo: todo(12, 'building'), machineName: null, userName: 'Ian', liveText: '' });
  expect(at('claimed')[0]).toMatchObject({ steps: [{ running: true, unfinished: false }] });
  expect(at('stopped')[0]).toMatchObject({ steps: [{ running: false, unfinished: true }] });
});

test('backend search tools count as searches', () => {
  expect(render([call('g', 'grep', { pattern: 'mergeBuild', path: 'apps/web' }, 1000)])[0]).toMatchObject({ steps: [{ action: 'search', description: 'grep mergeBuild apps/web' }] });
});

test('a running call with only a start time shows no duration instead of the gap before it', () => {
  const live: MessageRow = { id: 'live', role: 'assistant', createdAt: 9000, content: { kind: 'toolcall', call: { id: 'live', name: 'Bash', arguments: { command: 'pnpm test' }, startedAt: 8500 } } };
  const items = mapTranscript({ messages: [{ id: 'think', role: 'assistant', content: [{ type: 'thinking', thinking: 'plan' }], createdAt: 1000 }, live], steps: [{ id: 'step', buildId: 'build', kind: 'build', machineId: null, createdAt: 500, status: 'claimed', checkpointCommit: null, skillInjection: null }], build: null, todo: todo(12, 'building'), machineName: null, userName: 'Ian', liveText: '' });
  expect(items[0]).toMatchObject({ steps: [{ kind: 'think' }, { running: true, seconds: null }] });
});

test('a call cut off in an earlier step stays unfinished when the same build resumes', () => {
  const cut: MessageRow = { id: 'old', role: 'assistant', createdAt: 1000, content: { kind: 'toolcall', call: { id: 'old', name: 'Bash', arguments: { command: 'pnpm test' } } } };
  const live: MessageRow = { id: 'new', role: 'assistant', createdAt: 6000, content: { kind: 'toolcall', call: { id: 'new', name: 'Bash', arguments: { command: 'pnpm lint' }, startedAt: 6000 } } };
  const items = mapTranscript({
    messages: [cut, live],
    steps: [
      { id: 'failed', buildId: 'build', kind: 'build', machineId: null, createdAt: 500, status: 'failed', checkpointCommit: null, skillInjection: null },
      { id: 'resumed', buildId: 'build', kind: 'build', machineId: null, createdAt: 5000, status: 'claimed', checkpointCommit: null, skillInjection: null },
    ],
    build: null, todo: todo(12, 'building'), machineName: null, userName: 'Ian', liveText: '',
  });
  expect(items[0]).toMatchObject({ steps: [{ running: false, unfinished: true }, { running: true, unfinished: false }] });
});

test('only calls interrupted by a stopped step are labelled cancelled after continuation', () => {
  const items = mapTranscript({
    messages: [
      { id: 'cut', role: 'assistant', createdAt: 1000, content: { kind: 'toolcall', call: { id: 'cut', name: 'bash', arguments: { command: 'pnpm test' } } } },
      { id: 'complete', role: 'assistant', createdAt: 1100, content: { kind: 'toolcall', call: { id: 'complete', name: 'read', arguments: {}, result: 'done' } } },
      { id: 'live', role: 'assistant', createdAt: 6000, content: { kind: 'toolcall', call: { id: 'live', name: 'bash', arguments: { command: 'pnpm lint' } } } },
    ],
    steps: [
      { id: 'stopped', buildId: 'build', kind: 'build', status: 'stopped', machineId: null, createdAt: 500, checkpointCommit: null, skillInjection: null },
      { id: 'next', buildId: 'build', kind: 'build', status: 'claimed', machineId: null, createdAt: 5000, checkpointCommit: null, skillInjection: null },
    ],
    build: null, todo: todo(12, 'building'), machineName: null, userName: 'Owner', liveText: '',
  });
  expect(items[0]).toMatchObject({ steps: [{ cancelled: true, running: false }, { cancelled: false }, { cancelled: false, running: true }] });
});
