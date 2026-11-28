import { describe, expect, test } from 'vitest';
import { message } from '../src/db/schema.js';
import { bootServer, ownBuildConversation, req } from './helpers.js';

const todoWrite = (
  id: string,
  createdAt: number,
  todos: { content: string; status: string }[],
) => ({
  id,
  conversationId: 'build-1',
  role: 'assistant' as const,
  createdAt,
  content: {
    kind: 'toolcall',
    call: { id, name: 'TodoWrite', arguments: { todos }, result: 'ok', isError: false },
  },
});

async function pageTodo(s: ReturnType<typeof bootServer>, query = '') {
  const res = await req(s.app, 'GET', `/api/conversations/build-1/messages${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { agentTodo?: unknown }).agentTodo;
}

describe('messages page agent todo', () => {
  test('returns the latest persisted snapshot across steps, beyond the loaded page', async () => {
    const s = bootServer();
    ownBuildConversation(s, 'build-1');
    s.db
      .insert(message)
      .values([
        todoWrite('old', 100, [{ content: 'Old plan', status: 'pending' }]),
        {
          id: 'plan',
          conversationId: 'build-1',
          role: 'assistant',
          createdAt: 200,
          content: {
            kind: 'toolcall',
            call: {
              id: 'plan',
              name: 'plan',
              arguments: {},
              result: '',
              isError: false,
              todo: [
                { text: 'Read the config', state: 'done' },
                { text: 'Fix the parser', state: 'doing' },
              ],
            },
          },
        },
        {
          id: 'failed',
          conversationId: 'build-1',
          role: 'assistant',
          createdAt: 250,
          content: {
            kind: 'toolcall',
            call: {
              id: 'failed',
              name: 'TodoWrite',
              arguments: { todos: [{ content: 'Rejected', status: 'pending' }] },
              result: 'denied',
              isError: true,
            },
          },
        },
        {
          id: 'user-checklist',
          conversationId: 'build-1',
          role: 'user',
          createdAt: 260,
          content: '- [ ] a user line is not the agent todo',
        },
        ...Array.from({ length: 250 }, (_, i) => ({
          id: `chat-${i}`,
          conversationId: 'build-1',
          role: 'assistant' as const,
          createdAt: 300 + i,
          content: `reply ${i}`,
        })),
      ])
      .run();
    expect(await pageTodo(s, '?limit=10')).toEqual([
      { text: 'Read the config', state: 'done' },
      { text: 'Fix the parser', state: 'doing' },
    ]);
    expect(await pageTodo(s, '?limit=10&before=chat-5')).toBeNull();
  });

  test('a later assistant checklist wins, and no snapshot gives null', async () => {
    const s = bootServer();
    ownBuildConversation(s, 'build-1');
    expect(await pageTodo(s)).toBeNull();
    s.db
      .insert(message)
      .values([
        todoWrite('tw', 100, [{ content: 'From TodoWrite', status: 'completed' }]),
        {
          id: 'text',
          conversationId: 'build-1',
          role: 'assistant',
          createdAt: 200,
          content: 'Plan:\n- [x] Read\n- [~] Write',
        },
      ])
      .run();
    expect(await pageTodo(s)).toEqual([
      { text: 'Read', state: 'done' },
      { text: 'Write', state: 'doing' },
    ]);
  });
});
