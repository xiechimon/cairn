import { CHIEF_DIGEST_KIND, CHIEF_DIGEST_ROW_ID_PREFIX } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { chiefMessage, chiefThread } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { buildChiefSystemPrompt, composeChiefSystemPrompt } from '../src/services/chief.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

interface Hit {
  id: string;
  role: string;
  createdAt: number;
  projectId: string | null;
  snippet: string;
}
interface SearchResult {
  trust: string;
  hits: Hit[];
  nextBefore: string | null;
}
interface ReadResult {
  trust: string;
  messages: { id: string; role: string; content: string; createdAt: number }[];
}

const BASE_TIME = 1_700_000_000_000;

function seedMessages(
  threadId: string,
  rows: { id: string; content: unknown; role?: 'user' | 'assistant'; projectId?: string }[],
): void {
  H.s.db
    .insert(chiefMessage)
    .values(
      rows.map((row, i) => ({
        id: row.id,
        threadId,
        role: row.role ?? 'user',
        content: row.content,
        projectId: row.projectId ?? null,
        createdAt: BASE_TIME + i,
      })),
    )
    .run();
}

function seedOtherThread(threadId: string, userId: string): void {
  H.s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId: H.chiefId,
      userId,
      teamId: H.teamId,
      title: 'other',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: BASE_TIME,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
}

async function search(params: Record<string, unknown>): Promise<SearchResult> {
  return (await relay('search_history', params)) as SearchResult;
}

async function status(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 0;
  } catch (err) {
    return err instanceof HttpError ? err.status : -1;
  }
}

describe('search_history', () => {
  test('matches every term case-insensitively, newest first, scoped to the current thread', async () => {
    seedMessages(H.threadId, [
      { id: 'm1', content: 'The Staging bucket is old' },
      { id: 'm2', content: 'unrelated' },
      { id: 'm3', role: 'assistant', content: 'bucket for staging confirmed', projectId: 'p-1' },
    ]);
    const result = await search({ query: 'STAGING Bucket' });
    expect(result.trust).toBe('untrusted-history');
    expect(result.hits.map((h) => h.id)).toEqual(['m3', 'm1']);
    expect(result.hits[0]).toMatchObject({ role: 'assistant', projectId: 'p-1' });
    expect(result.hits[0]?.createdAt).toBe(BASE_TIME + 2);
    expect(result.hits[0]?.snippet).toContain('staging confirmed');
  });

  test('the snippet is about 200 characters around the first match', async () => {
    const text = `${'a'.repeat(1000)} needle ${'b'.repeat(1000)}`;
    seedMessages(H.threadId, [{ id: 'long', content: text }]);
    const [hit] = (await search({ query: 'needle' })).hits;
    expect(hit?.snippet).toContain('needle');
    expect(hit?.snippet.length).toBeLessThanOrEqual(210);
    expect(hit?.snippet.length).toBeGreaterThanOrEqual(150);
  });

  test('the snippet stays on the match when folding changes the text length', async () => {
    seedMessages(H.threadId, [
      { id: 'f1', content: `${'a'.repeat(1000)}needle${'\uFB03'.repeat(1000)}` },
    ]);
    const [hit] = (await search({ query: 'needle' })).hits;
    expect(hit?.snippet).toContain('needle');
  });

  test('LIKE wildcards in the query match literally', async () => {
    seedMessages(H.threadId, [
      { id: 'w1', content: 'coverage reached 100% today' },
      { id: 'w2', content: 'a_b snake' },
      { id: 'w3', content: 'axb nothing' },
      { id: 'w4', content: 'path C:\\temp\\x' },
    ]);
    expect((await search({ query: '100%' })).hits.map((h) => h.id)).toEqual(['w1']);
    expect((await search({ query: '%' })).hits.map((h) => h.id)).toEqual(['w1']);
    expect((await search({ query: 'a_b' })).hits.map((h) => h.id)).toEqual(['w2']);
    expect((await search({ query: '_' })).hits.map((h) => h.id)).toEqual(['w2']);
    expect((await search({ query: 'temp\\x' })).hits.map((h) => h.id)).toEqual(['w4']);
  });

  test('another thread of the same user and another user never leak', async () => {
    seedOtherThread('chief-other-thread', H.userId);
    seedOtherThread('chief-foreign-thread', 'someone-else');
    seedMessages('chief-other-thread', [{ id: 'o1', content: 'secret-token alpha' }]);
    seedMessages('chief-foreign-thread', [{ id: 'f1', content: 'secret-token beta' }]);
    seedMessages(H.threadId, [{ id: 'mine', content: 'secret-token mine' }]);
    expect((await search({ query: 'secret-token' })).hits.map((h) => h.id)).toEqual(['mine']);
  });

  test('a thread that does not belong to the calling user is rejected', async () => {
    seedOtherThread('chief-foreign-thread', 'someone-else');
    seedMessages('chief-foreign-thread', [{ id: 'f1', content: 'beta' }]);
    expect(
      await status(
        relay('search_history', { query: 'beta' }, { threadId: 'chief-foreign-thread' }),
      ),
    ).toBe(404);
  });

  test('empty and whitespace-only queries are rejected with 400', async () => {
    expect(await status(relay('search_history', { query: '' }))).toBe(400);
    expect(await status(relay('search_history', { query: '   ' }))).toBe(400);
    expect(await status(relay('search_history', {}))).toBe(400);
  });

  test('limit defaults to 10, clamps to 50 and to at least 1', async () => {
    seedMessages(
      H.threadId,
      Array.from({ length: 70 }, (_, i) => ({ id: `n${i}`, content: `note ${i}` })),
    );
    expect((await search({ query: 'note' })).hits).toHaveLength(10);
    expect((await search({ query: 'note', limit: 100000 })).hits).toHaveLength(50);
    expect((await search({ query: 'note', limit: 0 })).hits).toHaveLength(1);
    expect((await search({ query: 'note', limit: -5 })).hits).toHaveLength(1);
    expect(await status(relay('search_history', { query: 'note', limit: 'many' }))).toBe(400);
  });

  test('before pages through older hits using nextBefore', async () => {
    seedMessages(
      H.threadId,
      Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, content: `page ${i}` })),
    );
    const first = await search({ query: 'page', limit: 2 });
    expect(first.hits.map((h) => h.id)).toEqual(['p4', 'p3']);
    expect(first.nextBefore).toBe('p3');
    const second = await search({ query: 'page', limit: 2, before: first.nextBefore });
    expect(second.hits.map((h) => h.id)).toEqual(['p2', 'p1']);
    const third = await search({ query: 'page', limit: 2, before: second.nextBefore });
    expect(third.hits.map((h) => h.id)).toEqual(['p0']);
    expect(third.nextBefore).toBeNull();
    expect(await status(relay('search_history', { query: 'page', before: 'nope' }))).toBe(404);
  });

  test('structured rows are searched by their text form and never crash', async () => {
    seedMessages(H.threadId, [
      {
        id: 's1',
        role: 'assistant',
        content: [
          { type: 'text', text: 'deploying to the quartz stage' },
          { kind: 'toolcall', call: { name: 'run_builds', isError: false, args: { secret: 'x' } } },
        ],
      },
      { id: 's2', content: { kind: CHIEF_DIGEST_KIND, items: [] } },
      { id: 's3', content: '' },
      { id: 's4', content: 42 },
    ]);
    expect((await search({ query: 'quartz' })).hits.map((h) => h.id)).toEqual(['s1']);
    expect((await search({ query: 'toolcall: run_builds' })).hits.map((h) => h.id)).toEqual(['s1']);
    expect((await search({ query: 'secret' })).hits).toEqual([]);
  });

  test('Chinese and quoted queries match', async () => {
    seedMessages(H.threadId, [
      { id: 'c1', content: '预发布环境的存储桶叫 quartz-heron-17' },
      { id: 'c2', content: 'he said "hello world" twice\nnext line' },
    ]);
    expect((await search({ query: '存储桶' })).hits.map((h) => h.id)).toEqual(['c1']);
    expect((await search({ query: '预发布 存储桶' })).hits.map((h) => h.id)).toEqual(['c1']);
    expect((await search({ query: '"hello world"' })).hits.map((h) => h.id)).toEqual(['c2']);
    expect((await search({ query: 'twice next' })).hits.map((h) => h.id)).toEqual(['c2']);
    expect((await search({ query: 'twice absent' })).hits).toEqual([]);
  });

  test('Kelvin sign and full-width Latin fold to plain letters (NFKC plus lowercase)', async () => {
    seedMessages(H.threadId, [
      { id: 'k1', content: '\u212Aelvin calibration done' },
      { id: 'k2', content: 'plain Kelvin scale' },
      { id: 'k3', content: '\uFF2B\uFF25\uFF2C\uFF36\uFF29\uFF2E full width' },
    ]);
    const ids = async (query: string) => (await search({ query })).hits.map((h) => h.id).sort();
    expect(await ids('kelvin')).toEqual(['k1', 'k2', 'k3']);
    expect(await ids('\u212Aelvin')).toEqual(['k1', 'k2', 'k3']);
    expect(await ids('\uFF2B\uFF25\uFF2C\uFF36\uFF29\uFF2E')).toEqual(['k1', 'k2', 'k3']);
  });

  test('Turkish dotted capital I lowercases to i plus a combining dot: it matches i and its own spelling, not the plain word', async () => {
    seedMessages(H.threadId, [{ id: 't1', content: '\u0130stanbul office' }]);
    const ids = async (query: string) => (await search({ query })).hits.map((h) => h.id);
    expect(await ids('\u0130stanbul')).toEqual(['t1']);
    expect(await ids('stanbul')).toEqual(['t1']);
    expect(await ids('i')).toEqual(['t1']);
    expect(await ids('istanbul')).toEqual([]);
  });

  test('non-ASCII cased text matches case-insensitively', async () => {
    seedMessages(H.threadId, [{ id: 'u1', content: 'Die Überprüfung läuft' }]);
    expect((await search({ query: 'überprüfung' })).hits.map((h) => h.id)).toEqual(['u1']);
    expect((await search({ query: 'ÜBERPRÜFUNG LÄUFT' })).hits.map((h) => h.id)).toEqual(['u1']);
  });
});

describe('read_history', () => {
  test('returns full text oldest first and labels it untrusted', async () => {
    seedMessages(H.threadId, [
      { id: 'r1', content: 'first' },
      { id: 'r2', role: 'assistant', content: 'second '.repeat(2000) },
      { id: 'r3', content: 'third' },
    ]);
    const result = (await relay('read_history', { ids: ['r3', 'r2', 'r1'] })) as ReadResult;
    expect(result.trust).toBe('untrusted-history');
    expect(result.messages.map((m) => m.id)).toEqual(['r1', 'r2', 'r3']);
    expect(result.messages[1]?.content).toBe('second '.repeat(2000));
    expect(result.messages[1]?.role).toBe('assistant');
  });

  test('ids from another thread or another user are silently excluded', async () => {
    seedOtherThread('chief-other-thread', H.userId);
    seedOtherThread('chief-foreign-thread', 'someone-else');
    seedMessages('chief-other-thread', [{ id: 'o1', content: 'other' }]);
    seedMessages('chief-foreign-thread', [{ id: 'f1', content: 'foreign' }]);
    seedMessages(H.threadId, [{ id: 'mine', content: 'mine' }]);
    const result = (await relay('read_history', {
      ids: ['o1', 'f1', 'mine', 'missing'],
    })) as ReadResult;
    expect(result.messages.map((m) => m.id)).toEqual(['mine']);
    expect(JSON.stringify(result)).not.toContain('foreign');
  });

  test('more than 20 ids, an empty list and non-string ids are rejected', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `x${i}`);
    expect(await status(relay('read_history', { ids }))).toBe(400);
    expect(await status(relay('read_history', { ids: [] }))).toBe(400);
    expect(await status(relay('read_history', { ids: [1] }))).toBe(400);
    expect(await status(relay('read_history', {}))).toBe(400);
  });

  test('duplicate ids return one message; structured rows read as text', async () => {
    seedMessages(H.threadId, [
      {
        id: 'd1',
        content: [
          { type: 'text', text: 'hello' },
          { kind: 'toolcall', call: { name: 'todos' } },
        ],
      },
    ]);
    const result = (await relay('read_history', { ids: ['d1', 'd1'] })) as ReadResult;
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe('hello\n[toolcall: todos; payload omitted]');
  });
});

describe('500-turn fixture eval', () => {
  test('a rare fact from turn 20 is found at turn 500', async () => {
    seedMessages(
      H.threadId,
      Array.from({ length: 500 }, (_, i) => {
        const turn = i + 1;
        const content =
          turn === 20
            ? 'Noted: the staging bucket is named quartz-heron-17.'
            : `turn ${turn}: routine status ping about builds and todos`;
        return {
          id: `t${turn}`,
          role: turn % 2 === 0 ? ('assistant' as const) : ('user' as const),
          content,
        };
      }),
    );
    const result = await search({ query: 'staging bucket' });
    expect(result.hits.map((h) => h.id)).toEqual(['t20']);
    expect(result.hits[0]?.snippet).toContain('quartz-heron-17');
    const read = (await relay('read_history', { ids: ['t20'] })) as ReadResult;
    expect(read.messages[0]?.content).toContain('quartz-heron-17');
    const common = await search({ query: 'routine ping', limit: 50 });
    expect(common.hits).toHaveLength(50);
    expect(common.hits[0]?.id).toBe('t500');
  });
});

describe('cache-stable system prompt', () => {
  function resource() {
    return { db: H.s.db, hub: H.s.hub, user: H.s.user, skillsDir: H.s.skillsDir };
  }
  function digestRow(n: number, text: string) {
    return {
      id: `${CHIEF_DIGEST_ROW_ID_PREFIX}${n}`,
      threadId: H.threadId,
      role: 'system' as const,
      content: {
        kind: CHIEF_DIGEST_KIND,
        reason: 'daily',
        coversUntil: BASE_TIME,
        madeAt: BASE_TIME,
        items: [{ group: 'decided', text, reason: '' }],
      },
      projectId: null,
      createdAt: BASE_TIME + n,
    };
  }

  test('text is the joined sections and composeChiefSystemPrompt returns it', () => {
    const built = buildChiefSystemPrompt(resource(), H.teamId, H.threadId);
    expect(built.text).toBe(
      built.sections
        .map((s) => s.text)
        .filter((text) => text !== '')
        .join('\n')
        .trimEnd(),
    );
    expect(composeChiefSystemPrompt(resource(), H.teamId, H.threadId)).toBe(built.text);
    expect(built.sections.map((s) => s.name)).toEqual(['static', 'team', 'digests']);
    for (const section of built.sections) expect(section.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a new digest row changes only the last section and leaves the earlier prefix identical', () => {
    H.s.db.insert(chiefMessage).values(digestRow(1, 'first decision')).run();
    const before = buildChiefSystemPrompt(resource(), H.teamId, H.threadId);
    H.s.db.insert(chiefMessage).values(digestRow(2, 'second decision')).run();
    const after = buildChiefSystemPrompt(resource(), H.teamId, H.threadId);

    expect(after.sections.map((s) => s.hash).slice(0, -1)).toEqual(
      before.sections.map((s) => s.hash).slice(0, -1),
    );
    expect(after.sections.at(-1)?.hash).not.toBe(before.sections.at(-1)?.hash);
    const prefix = before.sections
      .slice(0, -1)
      .map((s) => s.text)
      .join('\n');
    expect(after.text.startsWith(prefix)).toBe(true);
    expect(after.text).toContain('second decision');
  });

  test('static content precedes team context, which precedes digests', () => {
    H.s.db.insert(chiefMessage).values(digestRow(1, 'a decision')).run();
    const { text } = buildChiefSystemPrompt(resource(), H.teamId, H.threadId);
    const order = ['## 工作约定', '## 团队资源清单', '## 记忆', '## 之前对话的摘要'].map((m) =>
      text.indexOf(m),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
