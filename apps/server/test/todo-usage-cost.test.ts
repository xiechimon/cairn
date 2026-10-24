import { todoRecordSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { build, tokenUsage } from '../src/db/schema.js';
import { bootServer, postProject, req } from './helpers.js';

const NO_COST = { costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, costTotal: 0 };

async function worldWithTodos(count: number) {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const todoIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: `cost probe ${i}`,
      spec: '',
    });
    todoIds.push(((await res.json()) as { id: string }).id);
  }
  return { s, todoIds };
}

function insertBuild(s: ReturnType<typeof bootServer>, id: string, todoId: string) {
  s.db
    .insert(build)
    .values({ id, todoId, withPlan: false, triggerSource: 'user', createdAt: Date.now() })
    .run();
}

async function readTodo(s: ReturnType<typeof bootServer>, id: string) {
  const res = await req(s.app, 'GET', `/api/todos/${id}`);
  expect(res.status).toBe(200);
  return todoRecordSchema.parse(await res.json());
}

describe('todo.usageCost: persisted cost columns summed over every build of the todo', () => {
  test('sums all builds and models; other todos stay out', async () => {
    const { s, todoIds } = await worldWithTodos(2);
    const [priced, other] = todoIds as [string, string];
    insertBuild(s, 'build-a', priced);
    insertBuild(s, 'build-b', priced);
    insertBuild(s, 'build-other', other);
    s.db
      .insert(tokenUsage)
      .values([
        {
          buildId: 'build-a',
          model: 'gw/m1',
          input: 10,
          output: 20,
          cacheRead: 30,
          cacheWrite: 40,
          costInput: 0.25,
          costOutput: 0.5,
          costCacheRead: 0.125,
          costCacheWrite: 0.0625,
          costTotal: 0.9375,
        },
        {
          buildId: 'build-a',
          model: 'gw/m2',
          input: 1,
          output: 1,
          cacheRead: 1,
          cacheWrite: 1,
          costInput: 0.5,
          costOutput: 1,
          costCacheRead: 0.25,
          costCacheWrite: 0.125,
          costTotal: 1.875,
        },
        {
          buildId: 'build-b',
          model: 'gw/m1',
          input: 1,
          output: 1,
          cacheRead: 1,
          cacheWrite: 1,
          costInput: 0.125,
          costOutput: 0.25,
          costCacheRead: 0.0625,
          costCacheWrite: 0.03125,
          costTotal: 0.46875,
        },
        {
          buildId: 'build-other',
          model: 'gw/m1',
          input: 5,
          output: 5,
          cacheRead: 5,
          cacheWrite: 5,
          ...NO_COST,
        },
      ])
      .run();
    expect((await readTodo(s, priced)).usageCost).toEqual({
      input: 0.875,
      output: 1.75,
      cacheRead: 0.4375,
      cacheWrite: 0.21875,
      total: 3.28125,
    });
    expect((await readTodo(s, other)).usageCost).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    });
    s.dispose();
  });

  test('a todo whose runs reported no cost carries zeros; a todo with no usage rows carries no key', async () => {
    const { s, todoIds } = await worldWithTodos(2);
    const [unpriced, untouched] = todoIds as [string, string];
    insertBuild(s, 'build-unpriced', unpriced);
    s.db
      .insert(tokenUsage)
      .values({
        buildId: 'build-unpriced',
        model: 'gw/free',
        input: 9,
        output: 9,
        cacheRead: 9,
        cacheWrite: 9,
        ...NO_COST,
      })
      .run();
    expect((await readTodo(s, unpriced)).usageCost?.total).toBe(0);
    const bare = await readTodo(s, untouched);
    expect(bare.usageCost).toBeUndefined();
    expect('usageCost' in bare).toBe(false);
    s.dispose();
  });

  test('the board list carries the same sums', async () => {
    const { s, todoIds } = await worldWithTodos(1);
    const [id] = todoIds as [string];
    insertBuild(s, 'build-list', id);
    s.db
      .insert(tokenUsage)
      .values({
        buildId: 'build-list',
        model: 'gw/m1',
        input: 1,
        output: 1,
        cacheRead: 1,
        cacheWrite: 1,
        costInput: 0.5,
        costOutput: 0.25,
        costCacheRead: 0.125,
        costCacheWrite: 0.0625,
        costTotal: 0.9375,
      })
      .run();
    const res = await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}`);
    const list = ((await res.json()) as unknown[]).map((t) => todoRecordSchema.parse(t));
    expect(list.find((t) => t.id === id)?.usageCost?.total).toBe(0.9375);
    s.dispose();
  });
});
