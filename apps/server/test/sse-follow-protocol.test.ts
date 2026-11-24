import { expect, test, vi } from 'vitest';
import {
  ConversationStreamHub,
  StreamSessionRegistry,
  TeamStreamHub,
} from '../src/services/events.js';

test('a team publication encodes one shared payload for multiple subscribers', () => {
  const hub = new TeamStreamHub();
  const first = { send: vi.fn(async (_data: unknown) => {}), nextSeq: () => 1 };
  const second = { send: vi.fn(async (_data: unknown) => {}), nextSeq: () => 2 };
  hub.subscribe('team', first);
  hub.subscribe('team', second);
  const encode = vi.fn(() => ({ type: 'ping' }));
  hub.publish('team', () => ({ toJSON: encode }));
  expect(encode).toHaveBeenCalledTimes(1);
  const publication = { toJSON: encode };
  expect(first.send).toHaveBeenCalledWith(publication, '{"type":"ping"}');
  expect(second.send).toHaveBeenCalledWith(publication, '{"type":"ping"}');
});

test('a build publication includes its project even when the subscriber has not loaded the task', () => {
  const projectOfBuildTodo = vi.fn(() => 'project-a');
  const hub = new TeamStreamHub(projectOfBuildTodo);
  const send = vi.fn(async (_payload: object, _encoded: string) => {});
  hub.subscribe('team', { send });
  const build = {
    id: 'build-a',
    todoId: 'todo-a',
    withPlan: false,
    prevPhase: null,
    triggerSource: 'user',
    planDocId: null,
    errorMessage: null,
    prUrl: null,
    prNumber: null,
    diffHash: null,
    createdAt: 1,
  } as const;
  hub.publishBuildDoc('team', build);

  expect(projectOfBuildTodo).toHaveBeenCalledExactlyOnceWith('team', 'todo-a');
  const expected = { type: 'build', v: 1, doc: build, projectId: 'project-a' };
  expect(send).toHaveBeenCalledWith(expected, JSON.stringify(expected));
});

test('an older revision cannot change an acknowledged set and close releases the attachment', () => {
  const sessions = new StreamSessionRegistry();
  const conversations = new ConversationStreamHub();
  const conn = { send: async (_data: unknown) => {}, nextSeq: () => 1 };
  const close = sessions.open('connection', { conn, teamId: 'team', deviceId: null });
  const session = sessions.get('connection');
  if (session === undefined) throw new Error('Missing session');
  expect(sessions.setConversations(session, ['new'], conversations, 2)).toBe(2);
  expect(sessions.setConversations(session, ['old'], conversations, 1)).toBe(2);
  expect(conversations.subscriberCount('new')).toBe(1);
  expect(conversations.subscriberCount('old')).toBe(0);
  close();
  expect(sessions.get('connection')).toBeUndefined();
  expect(conversations.subscriberCount('new')).toBe(0);
});
