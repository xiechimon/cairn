import { conversationMessagesResponseSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { chiefMessage } from '../src/db/schema.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { req } from './helpers.js';

registerChiefHarness();

interface Page {
  messages: { id: string; createdAt: number; projectId?: string | null }[];
  nextCursor: string | null;
}

const messagesUrl = (query = '') => `/api/conversations/${H.threadId}/messages${query}`;

function seed(count: number, createdAt: (i: number) => number = (i) => 1_000 + i) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `m-${String(i).padStart(5, '0')}`,
    threadId: H.threadId,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `message ${i}`,
    projectId: null,
    createdAt: createdAt(i),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    H.s.db
      .insert(chiefMessage)
      .values(rows.slice(i, i + 500))
      .run();
  }
  return rows.map((r) => r.id);
}

async function readPage(query = ''): Promise<Page> {
  const res = await req(H.s.app, 'GET', messagesUrl(query));
  expect(res.status).toBe(200);
  const body = await res.json();
  conversationMessagesResponseSchema.parse(body);
  return body as Page;
}

describe('GET /api/conversations/:chiefThread/messages pages the Coordinator history', () => {
  test('7,000 rows: the first response is the newest 100, oldest first, plus a cursor', async () => {
    const ids = seed(7_000);
    const page = await readPage();
    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(-100));
    expect(page.nextCursor).toBe(ids[6_900]);
  });

  test('walking the before cursor returns every message exactly once, in order', async () => {
    const ids = seed(250);
    const pages: Page[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await readPage(cursor ? `?before=${cursor}` : '');
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(pages.map((p) => p.messages.length)).toEqual([100, 100, 50]);
    expect(pages.reverse().flatMap((p) => p.messages.map((m) => m.id))).toEqual(ids);
  });

  test('rows sharing one timestamp page by insertion order without gaps or repeats', async () => {
    const ids = seed(150, () => 5_000);
    const first = await readPage();
    expect(first.messages.map((m) => m.id)).toEqual(ids.slice(50));
    const second = await readPage(`?before=${first.nextCursor}`);
    expect(second.messages.map((m) => m.id)).toEqual(ids.slice(0, 50));
    expect(second.nextCursor).toBeNull();
  });

  test('a short history comes back whole with no cursor', async () => {
    const ids = seed(3);
    const page = await readPage();
    expect(page.messages.map((m) => m.id)).toEqual(ids);
    expect(page.nextCursor).toBeNull();
  });

  test('each row carries the project channel it was sent in', async () => {
    H.s.db
      .insert(chiefMessage)
      .values([
        {
          id: 'in-site',
          threadId: H.threadId,
          role: 'user',
          content: 'a',
          projectId: 'p-site',
          createdAt: 1,
        },
        {
          id: 'in-home',
          threadId: H.threadId,
          role: 'user',
          content: 'b',
          projectId: null,
          createdAt: 2,
        },
      ])
      .run();
    const page = await readPage();
    expect(page.messages.map((m) => [m.id, m.projectId])).toEqual([
      ['in-site', 'p-site'],
      ['in-home', null],
    ]);
  });

  test('limit sets the page size and is bounded', async () => {
    const ids = seed(30);
    const page = await readPage('?limit=10');
    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(-10));
    expect(page.nextCursor).toBe(ids[20]);
    expect((await req(H.s.app, 'GET', messagesUrl('?limit=0'))).status).toBe(400);
    expect((await req(H.s.app, 'GET', messagesUrl('?limit=201'))).status).toBe(400);
  });

  test('a cursor that is not a message of this thread answers 404', async () => {
    seed(3);
    expect((await req(H.s.app, 'GET', messagesUrl('?before=nope'))).status).toBe(404);
  });
});
