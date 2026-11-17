import type { ChiefGetResponse, ChiefThread } from '@cairn/shared';
import { expect, test } from 'vitest';
import { mapChief, type MessageRow } from '../src/api/mappers.js';

const ENV = {
  chief: {
    id: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    agent: { agentId: 'agent-1' },
    charter: null,
    lastTurnAt: null,
    createdAt: 0,
    tz: null,
    model: null,
  },
  agentActor: null,
  context: null,
  watches: [],
  wakes: [],
} as unknown as ChiefGetResponse;

const thread = (pending: ChiefThread['pending']): ChiefThread => ({
  id: 'chief-ttt',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: 'Coordinator',
  createdAt: 1,
  updatedAt: 1,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's1', openedAt: 1 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: { phase: 'chief' },
  pending,
});

const SENT_AT = Date.UTC(2026, 10, 16, 1, 2, 3);
const MESSAGES: MessageRow[] = [
  { id: 'first', role: 'user', content: '先看看计数', createdAt: SENT_AT - 4_000 },
  { id: 'second', role: 'user', content: '顺便看下空列', createdAt: SENT_AT },
];

const secondRow = (pending: ChiefThread['pending']) =>
  mapChief(ENV, { threads: [thread(pending)], activeThreadId: 'chief-ttt', messages: MESSAGES }).stream?.find(
    (item) => item.kind === 'user' && item.id === 'second',
  );

test('a mid-turn message keeps its send time once the thread lists it as queued', () => {
  const unlisted = secondRow([]);
  const queued = secondRow([{ messageId: 'second', state: 'queued' }]);
  expect(unlisted).toMatchObject({ createdAt: SENT_AT });
  expect(queued).toMatchObject({ pending: 'queued', createdAt: SENT_AT });
  expect(queued?.kind === 'user' && queued.at).toBe(unlisted?.kind === 'user' && unlisted.at);
});

test('a message still waiting to be read keeps the working row after a finished reply', () => {
  const messages: MessageRow[] = [
    { id: 'first', role: 'user', content: '先看看计数', createdAt: SENT_AT - 4_000 },
    {
      id: 'reply',
      role: 'assistant',
      content: [{ type: 'text', text: '看过了。' }],
      createdAt: SENT_AT - 2_000,
    },
    { id: 'second', role: 'user', content: '顺便看下空列', createdAt: SENT_AT },
  ];
  const kinds = (pending: ChiefThread['pending']) =>
    mapChief(ENV, { threads: [thread(pending)], activeThreadId: 'chief-ttt', messages }).stream?.map(
      (item) => item.kind,
    );
  expect(kinds([{ messageId: 'second', state: 'queued' }])).toEqual([
    'user',
    'robot',
    'streaming',
    'user',
  ]);
});
