import { describe, expect, test } from 'vitest';
import { todo } from '../src/db/schema.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { ctx, H, registerChiefHarness, toolDeps } from './chief-harness.js';

registerChiefHarness();

interface Page {
  todos: { id: string; seqNum: number; title: string; phase: string; summary: string }[];
  total: number;
  nextOffset: number | null;
}

function seed(rows: { id: string; title: string; spec: string; phase?: 'todo' | 'closed' }[]) {
  H.s.db
    .insert(todo)
    .values(
      rows.map((row, i) => ({
        id: row.id,
        teamId: H.teamId,
        projectId: H.projectId,
        seqNum: i + 1,
        title: row.title,
        spec: row.spec,
        phase: row.phase ?? 'todo',
        phaseAt: 1,
      })),
    )
    .run();
}

async function search(params: Record<string, unknown>, over?: Parameters<typeof ctx>[0]) {
  return JSON.parse(await executeChiefTool(toolDeps(), ctx(over), 'todos', params)) as Page;
}

describe('todos keyword search', () => {
  test('matches title or spec, case-insensitively, and every term must appear', async () => {
    seed([
      { id: 't-title', title: 'Fix Login redirect', spec: 'unrelated words' },
      {
        id: 't-spec',
        title: 'Something else',
        spec: `${'x '.repeat(400)}the LOGIN page redirect loops`,
      },
      { id: 't-half', title: 'Login page', spec: 'no second term here' },
      { id: 't-none', title: 'Billing', spec: 'invoices' },
    ]);
    const hits = await search({ query: 'login redirect' });
    expect(hits.todos.map((t) => t.id).sort()).toEqual(['t-spec', 't-title']);
    expect(hits.total).toBe(2);
    expect((await search({ query: 'nonexistent-term' })).total).toBe(0);
  });

  test('combines with phase and project filters, and paging counts only the matches', async () => {
    seed([
      { id: 'a', title: 'cache warmup', spec: '' },
      { id: 'b', title: 'cache purge', spec: '', phase: 'closed' },
      { id: 'c', title: 'cache stats', spec: '' },
      { id: 'd', title: 'other', spec: '' },
    ]);
    expect((await search({ query: 'cache', phase: 'closed' })).todos.map((t) => t.id)).toEqual([
      'b',
    ]);
    expect((await search({ query: 'cache', projectId: 'no-such-project' })).total).toBe(0);
    const page = await search({ query: 'cache', offset: 1 });
    expect(page.total).toBe(3);
    expect(page.todos).toHaveLength(2);
  });

  test('percent and underscore are literal characters, and another team sees nothing', async () => {
    seed([
      { id: 'pct', title: '100% done', spec: '' },
      { id: 'plain', title: '1000 done', spec: '' },
    ]);
    expect((await search({ query: '100%' })).todos.map((t) => t.id)).toEqual(['pct']);
    expect((await search({ query: 'done' }, { teamId: 'someone-else' })).total).toBe(0);
  });

  test('a blank query is rejected instead of listing everything', async () => {
    seed([{ id: 'x', title: 'x', spec: '' }]);
    await expect(search({ query: '   ' })).rejects.toMatchObject({ status: 400 });
  });

  test('too many terms or an oversized query is rejected, and repeated terms count once', async () => {
    seed([{ id: 'x', title: 'alpha beta', spec: '' }]);
    await expect(search({ query: 'a b c d e f g h i' })).rejects.toMatchObject({ status: 400 });
    await expect(search({ query: 'x'.repeat(201) })).rejects.toMatchObject({ status: 400 });
    expect(
      (await search({ query: 'alpha alpha alpha alpha alpha alpha alpha alpha alpha' })).total,
    ).toBe(1);
  });
});
