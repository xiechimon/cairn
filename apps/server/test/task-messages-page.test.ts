import { conversationMessagesResponseSchema } from '@cairn/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { message } from '../src/db/schema.js';
import { bootServer, req, type TestServer } from './helpers.js';

interface Page {
  messages: { id: string; createdAt: number }[];
  nextCursor: string | null;
  queuedMessages?: unknown[];
}

const BUILD = 'build-paged';
const messagesUrl = (query = '', conversationId = BUILD) =>
  `/api/conversations/${conversationId}/messages${query}`;

let s: TestServer;
beforeEach(() => {
  s = bootServer();
});

function seed(
  count: number,
  createdAt: (i: number) => number = (i) => 1_000 + i,
  conversationId = BUILD,
) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `${conversationId}-${String(i).padStart(5, '0')}`,
    conversationId,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `message ${i}`,
    createdAt: createdAt(i),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    s.db
      .insert(message)
      .values(rows.slice(i, i + 500))
      .run();
  }
  return rows.map((r) => r.id);
}

async function readPage(query = ''): Promise<Page> {
  const res = await req(s.app, 'GET', messagesUrl(query));
  expect(res.status).toBe(200);
  const body = await res.json();
  conversationMessagesResponseSchema.parse(body);
  return body as Page;
}

describe('GET /api/conversations/:build/messages pages the task history', () => {
  test('1,000 rows: the first response is the newest 100, oldest first, plus a cursor', async () => {
    const ids = seed(1_000);
    const page = await readPage();
    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(-100));
    expect(page.nextCursor).toBe(ids[900]);
    expect(page.queuedMessages).toEqual([]);
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

  test('limit sets the page size and is bounded', async () => {
    const ids = seed(30);
    const page = await readPage('?limit=10');
    expect(page.messages.map((m) => m.id)).toEqual(ids.slice(-10));
    expect(page.nextCursor).toBe(ids[20]);
    expect((await req(s.app, 'GET', messagesUrl('?limit=0'))).status).toBe(400);
    expect((await req(s.app, 'GET', messagesUrl('?limit=201'))).status).toBe(400);
  });

  test('a cursor from another conversation answers 404', async () => {
    seed(3);
    const [foreign] = seed(3, (i) => i, 'build-other');
    expect((await req(s.app, 'GET', messagesUrl(`?before=${foreign}`))).status).toBe(404);
  });
});
