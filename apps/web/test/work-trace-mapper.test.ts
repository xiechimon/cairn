import { type ToolCallRecord, workspaceHookRowContent } from '@cairn/shared';
import { expect, test } from 'vitest';
import { mapTranscript, type MessageRow, plainFailureOf } from '../src/api/mappers.js';
import { todo } from './helpers.js';

function render(messages: MessageRow[]) {
  return mapTranscript({ messages, steps: [], build: null, todo: todo(12, 'done'), machineName: null, userName: 'Ian', liveText: '' });
}

function call(id: string, name: string, args: Record<string, unknown>, at: number, timing?: Pick<ToolCallRecord, 'startedAt' | 'endedAt'>): MessageRow {
  return { id, role: 'assistant', createdAt: at, content: { kind: 'toolcall', call: { id, name, arguments: args, result: 'done', ...timing } } };
}

test('one run of work folds its calls and the prose between them, and only a non-prose row splits it', () => {
  const items = render([
    { id: 'think', role: 'assistant', content: [{ type: 'thinking', thinking: 'Full reasoning' }], createdAt: 1000 },
    call('read', 'Read', { file_path: '/home/ian/.pacman-chief/workspaces/abc/src/main.ts', offset: 2, limit: 8 }, 2500),
    { id: 'prose', role: 'assistant', content: 'Next stage', createdAt: 3000 },
    call('search', 'bash', { command: 'rg target src', description: 'Find target' }, 4000),
    { id: 'note', role: 'system', content: 'Checkpoint', createdAt: 5000 },
    call('run', 'Bash', { command: 'pnpm lint\npnpm typecheck' }, 6000),
  ]);
  expect(items.map((item) => item.kind)).toEqual(['work', 'note', 'work']);
  expect(items[0]).toMatchObject({
    kind: 'work',
    steps: [
      { kind: 'think', text: 'Full reasoning', seconds: null },
      { kind: 'call', action: 'read', target: 'src/main.ts L2–9', seconds: 1.5 },
      { kind: 'say', id: 'prose', text: 'Next stage' },
      { kind: 'call', action: 'search', description: 'Find target', command: 'rg target src' },
    ],
  });
  expect(items[2]).toMatchObject({ steps: [{ action: 'run', description: 'pnpm lint' }] });
});

test('prose of any length between calls folds in order; only the prose after the last call stays as the reply', () => {
  const items = render([
    call('read-1', 'Read', { file_path: 'src/a.ts' }, 1000),
    { id: 'multi', role: 'assistant', content: 'First line.\n\nSecond paragraph.', createdAt: 2000 },
    call('read-2', 'Read', { file_path: 'src/b.ts' }, 3000),
    { id: 'heading', role: 'assistant', content: '## Summary', createdAt: 4000 },
    call('read-3', 'Read', { file_path: 'src/c.ts' }, 5000),
    { id: 'tail', role: 'assistant', content: 'All checks passed.', createdAt: 6000 },
  ]);
  expect(items.map((item) => item.kind)).toEqual(['work', 'robot']);
  expect(items[0]).toMatchObject({
    steps: [
      { kind: 'call', target: 'src/a.ts' },
      { kind: 'say', text: 'First line.\n\nSecond paragraph.' },
      { kind: 'call', target: 'src/b.ts' },
      { kind: 'say', text: '## Summary' },
      { kind: 'call', target: 'src/c.ts' },
    ],
  });
  expect(items[1]).toMatchObject({ kind: 'robot', markdown: 'All checks passed.' });
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

test('info-card computer tools (shell, read_file, write_file, list_files, submit_report) map cleanly with task dir stripped', () => {
  const dir = '/home/agent/tasks/01a20cbc-b485-7ab6-922c-f66596bf2c99';
  const items = render([
    call('c1', 'mcp__cairn__shell', { command: 'pdftoppm -png resume.pdf page' }, 1000),
    call('c2', 'shell', { command: 'rg foo bar' }, 2000),
    call('c3', 'mcp__cairn__read_file', { path: `${dir}/deliverables/images/resume_p1.png` }, 3000),
    call('c4', 'mcp__cairn__write_file', { path: `${dir}/report.md`, content: '# Export\nok' }, 4000),
    call('c5', 'list_files', { path: `${dir}/deliverables` }, 5000),
    call('c6', 'mcp__cairn__submit_report', { path: `${dir}/report.md` }, 6000),
  ]);
  expect(items[0]).toMatchObject({
    kind: 'work',
    steps: [
      { kind: 'call', action: 'run', command: 'pdftoppm -png resume.pdf page', description: 'pdftoppm -png resume.pdf page' },
      { kind: 'call', action: 'search', command: 'rg foo bar' },
      { kind: 'call', action: 'read', target: 'deliverables/images/resume_p1.png' },
      { kind: 'call', action: 'edit', target: 'report.md', diff: { added: 2, removed: 0 } },
      { kind: 'call', action: 'search', description: 'list_files deliverables' },
      { kind: 'call', action: 'tool', target: 'submit_report · report.md' },
    ],
  });
});

test('a failed setup hook with a missing command shows plain localized copy in the trace and fail row', () => {
  const hookRow: MessageRow = {
    id: 'hook-setup-s1',
    role: 'system',
    createdAt: 1000,
    content: workspaceHookRowContent({
      name: 'setup',
      status: 'failed',
      exitCode: 127,
      output: '.agents/setup: line 6: pnpm: command not found',
      totalChars: 46,
      ms: 80,
    }),
  };
  const items = mapTranscript({
    messages: [hookRow],
    steps: [],
    build: {
      id: 'build',
      todoId: 'todo',
      withPlan: false,
      prevPhase: null,
      triggerSource: 'user',
      planDocId: null,
      errorMessage: 'workspace hook .agents/setup exited 127 (missing command: pnpm) — .agents/setup: line 6: pnpm: command not found',
      prUrl: null,
      prNumber: null,
      diffHash: null,
      createdAt: 500,
    },
    todo: todo(12, 'failed'),
    machineName: null,
    userName: 'Owner',
    liveText: '',
  });
  expect(items.find((item) => item.kind === 'work')).toMatchObject({
    kind: 'work',
    steps: [
      {
        action: 'setup',
        description: '缺少命令 {command}',
        localized: true,
        localizedVars: { command: 'pnpm' },
        error: true,
      },
    ],
  });
  expect(items.find((item) => item.kind === 'fail')).toMatchObject({
    kind: 'fail',
    plain: { key: '环境准备缺少命令 {command}', vars: { command: 'pnpm' } },
    body: '安装缺少的工具后重新运行这个任务。',
  });
  expect(plainFailureOf('.../.agents/setup: line 6: uv: command not found')).toEqual({
    key: '环境准备缺少命令 {command}',
    vars: { command: 'uv' },
  });
});
