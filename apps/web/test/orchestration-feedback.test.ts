import { buildOrchestratePrompt, CHIEF_TURN_ERROR_KIND, type ChiefThread } from '@cairn/shared';
import { expect, test } from 'vitest';
import { type MessageRow, mapOrchestrationFeedback } from '../src/api/mappers.js';

const todo = { id: 'todo-7', title: 'Add a NEWCOMER.md file', phase: 'todo' as const, phaseAt: 100 };
const thread: ChiefThread = {
  id: 'chief-global', title: 'Coordinator', createdAt: 1,
  chiefId: 'chief-u-t', userId: 'u', teamId: 't', updatedAt: 1, lastTurnAt: 1,
  session: { runtime: 'pi', id: '', openedAt: 1 }, pendingSessionResumeAt: null,
  toolDefHashes: {}, toolResultHashes: {}, activeRun: null, turnQueue: null,
};
const running = { ...thread, activeRun: { phase: 'chief' as const } };
const request = (id: string, at: number, todoId = todo.id): MessageRow => ({
  id, role: 'user', origin: 'synthetic', createdAt: at,
  content: `【输入框选定项目：Demo（id: p1）】\n${buildOrchestratePrompt({ id: todoId, seqNum: 7, spec: 'Add a NEWCOMER.md file' })}`,
});
const reply = (id: string, at: number, text: string): MessageRow => ({ id, role: 'assistant', createdAt: at, content: text });
const owner = (id: string, at: number): MessageRow => ({ id, role: 'user', origin: 'user', createdAt: at, content: 'something else' });

const kinds = (items: ReturnType<typeof mapOrchestrationFeedback>) =>
  items.map((item) => (item.kind === 'note' ? `note:${item.text}` : item.kind));

test('no Start yet, or a Start for another task, shows nothing', () => {
  expect(mapOrchestrationFeedback(todo, thread, [owner('m1', 150)])).toEqual([]);
  expect(mapOrchestrationFeedback(todo, thread, [request('m1', 150, 'todo-8')])).toEqual([]);
});

test('a Start from before the current phase is not this attempt', () => {
  expect(mapOrchestrationFeedback({ ...todo, phase: 'failed', phaseAt: 500 }, thread, [request('m1', 150), reply('m2', 160, 'no')])).toEqual([]);
});

test('a dispatched task shows nothing even when the turn replied', () => {
  expect(mapOrchestrationFeedback({ ...todo, phase: 'queued' }, thread, [request('m1', 150), reply('m2', 160, 'ok')])).toEqual([]);
});

test('while the turn runs the pane says handed to Coordinator with task title and no seqNum', () => {
  const items = mapOrchestrationFeedback(todo, running, [
    request('m1', 150),
    { id: 'user-m1', role: 'user', origin: 'task-prompt', createdAt: 155, content: 'echo' },
  ]);
  expect(kinds(items)).toEqual(['note:已交给 Coordinator：{title}', 'streaming']);
  expect(items[0]).toMatchObject({ vars: { title: 'Add a NEWCOMER.md file' } });
  expect(items[1]).toMatchObject({ label: 'Coordinator 正在安排这个任务…', startedAt: 150 });
});

test('when Coordinator has an outage, orchestration feedback does not spin', () => {
  const items = mapOrchestrationFeedback(
    todo,
    running,
    [request('m1', 150)],
    { reason: 'quota', model: 'relay-a/claude-opus', retryAt: null },
  );
  expect(items.some((item) => item.kind === 'streaming')).toBe(false);
  expect(kinds(items)).toEqual(['note:已交给 Coordinator：{title}']);
});

test('a blocked turn shows the queue reason, not a spinner', () => {
  const blocked: ChiefThread = { ...thread, turnQueue: { position: 1, waitingFor: null, blocked: { kind: 'coordinator-provider-no-key', missing: ['deepseek'] } } };
  const items = mapOrchestrationFeedback(todo, blocked, [request('m1', 150)]);
  expect(items[1]).toMatchObject({
    kind: 'streaming',
    blocked: true,
    blockedKind: 'coordinator-provider-no-key',
    label: 'Coordinator 规则用的服务商「{name}」没有 API key',
    labelVars: { name: 'deepseek' },
  });
});

test('a finished turn that did not dispatch shows the reply and says it was not dispatched', () => {
  const items = mapOrchestrationFeedback(todo, thread, [owner('m0', 120), request('m1', 150), reply('m2', 160, '这个任务需要先选一个仓库。')]);
  expect(kinds(items)).toEqual([
    'note:已交给 Coordinator：{title}',
    'robot',
    'note:Coordinator 没有派发这个任务，原因见上方的回复。点击「开始」重试。',
  ]);
  expect(items[1]).toMatchObject({ markdown: '这个任务需要先选一个仓库。' });
});

test('a finished turn with no text says no reason was given', () => {
  expect(kinds(mapOrchestrationFeedback(todo, thread, [request('m1', 150)])).at(-1)).toBe(
    'note:Coordinator 没有派发这个任务，也没有说明原因。点击「开始」重试。',
  );
});

test('a later owner message ends the turn even while another turn runs', () => {
  const items = mapOrchestrationFeedback(todo, running, [request('m1', 150), reply('m2', 160, '先等等'), owner('m3', 170), reply('m4', 180, 'unrelated')]);
  expect(kinds(items)).toEqual(['note:已交给 Coordinator：{title}', 'robot', expect.stringContaining('没有派发')]);
});

test('a queued owner message does not end the running turn', () => {
  const queued = { ...running, pending: [{ messageId: 'm3', state: 'queued' as const }] } as ChiefThread;
  const items = mapOrchestrationFeedback(todo, queued, [request('m1', 150), owner('m3', 170)]);
  expect(kinds(items)).toEqual(['note:已交给 Coordinator：{title}', 'streaming']);
});

test('a failed turn shows its error', () => {
  const error: MessageRow = { id: 'chief-err-s1', role: 'system', createdAt: 160, content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: 'The model provider refused the request.' }) };
  const items = mapOrchestrationFeedback(todo, thread, [request('m1', 150), error]);
  expect(items.at(-1)).toMatchObject({
    kind: 'fail',
    label: '这一轮没有完成',
    body: '未能识别具体原因。通常重试即可；持续出现时，点击「详情」查看原始错误。',
    raw: 'The model provider refused the request.',
  });
  expect(items).toHaveLength(2);
});

test('on a Mac the task-page failure detail keeps the local-network guidance', () => {
  const error: MessageRow = {
    id: 'chief-err-connect',
    role: 'system',
    createdAt: 160,
    content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: 'Failed to fetch team settings' }),
  };
  const items = mapOrchestrationFeedback(todo, thread, [request('m1', 150), error], null, true);
  expect(items.at(-1)).toMatchObject({
    kind: 'fail',
    body: expect.stringContaining('本地网络'),
  });
});
