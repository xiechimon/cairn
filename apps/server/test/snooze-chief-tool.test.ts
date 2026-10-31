import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_TOOL_COUNT,
  CHIEF_TOOL_NAMES,
  type TodoRecord,
} from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { H, registerChiefHarness, relay } from './chief-harness.js';
import { bootServer, postProject, req } from './helpers.js';

registerChiefHarness();

afterEach(() => vi.useRealTimers());

async function newTodo(title = 'Snoozable'): Promise<string> {
  const res = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/todos`, { title, spec: '' });
  return ((await res.json()) as { id: string }).id;
}

const fetchTodo = async (id: string): Promise<TodoRecord> =>
  (await (await req(H.s.app, 'GET', `/api/todos/${id}`)).json()) as TodoRecord;

describe('snooze_todos chief tool', () => {
  test('is part of the chief vocabulary with a schema requiring todoIds and until', () => {
    expect(CHIEF_TOOL_NAMES).toContain('snooze_todos');
    expect(CHIEF_REMOTE_TOOLS).toHaveLength(CHIEF_TOOL_COUNT);
    const def = CHIEF_REMOTE_TOOLS.find((tool) => tool.name === 'snooze_todos');
    expect(def?.parameters).toMatchObject({ required: ['todoIds', 'until'] });
  });

  test('until needed sets the mode and the API shows it', async () => {
    const id = await newTodo();
    expect(await relay('snooze_todos', { todoIds: [id], until: 'needed' })).toEqual({
      snoozed: [{ id, snoozeMode: 'needed', snoozedUntil: null }],
      skipped: [],
    });
    expect(await fetchTodo(id)).toMatchObject({ snoozeMode: 'needed', snoozedUntil: null });
  });

  test('until tomorrow honours the zone: 23:30 -> 08:00 next day, 02:00 -> 08:00 same day', async () => {
    const id = await newTodo();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-02T23:30:00+08:00') });
    await relay('snooze_todos', { todoIds: [id], until: 'tomorrow', tz: 'Asia/Shanghai' });
    expect(await fetchTodo(id)).toMatchObject({
      snoozeMode: 'until',
      snoozedUntil: Date.parse('2026-11-03T08:00:00+08:00'),
    });
    vi.setSystemTime(Date.parse('2026-11-02T02:00:00+08:00'));
    await relay('snooze_todos', { todoIds: [id], until: 'tomorrow', tz: 'Asia/Shanghai' });
    expect((await fetchTodo(id)).snoozedUntil).toBe(Date.parse('2026-11-02T08:00:00+08:00'));
  });

  test('snoozes several threads and accepts epoch ms as a digit string', async () => {
    const a = await newTodo('a');
    const b = await newTodo('b');
    const until = Date.now() + 7_200_000;
    const result = (await relay('snooze_todos', { todoIds: [a, b], until: String(until) })) as {
      snoozed: { id: string }[];
    };
    expect(result.snoozed.map((entry) => entry.id)).toEqual([a, b]);
    expect((await fetchTodo(b)).snoozedUntil).toBe(until);
  });

  test('ids from another team or unknown ids are skipped, not snoozed', async () => {
    const other = bootServer();
    const otherProject = await postProject(other.app);
    const foreign = (await (
      await req(other.app, 'POST', `/api/projects/${otherProject}/todos`, { title: 'x', spec: '' })
    ).json()) as { id: string };
    const mine = await newTodo();
    const result = await relay('snooze_todos', {
      todoIds: [mine, 'missing', foreign.id],
      until: 'needed',
    });
    expect(result).toMatchObject({ skipped: ['missing', foreign.id] });
    expect((await fetchTodo(mine)).snoozeMode).toBe('needed');
  });

  test.each([
    ['a bad preset', { until: 'someday' }],
    ['a past timestamp', { until: 1000 }],
    ['a missing until', {}],
  ])('rejects %s with 400 and snoozes nothing', async (_name, extra) => {
    const id = await newTodo();
    await expect(relay('snooze_todos', { todoIds: [id], ...extra })).rejects.toMatchObject({
      status: 400,
    });
    expect((await fetchTodo(id)).snoozeMode ?? null).toBeNull();
  });

  test('unschedule_todo ends a snooze like a cleared schedule', async () => {
    const id = await newTodo();
    await relay('schedule_todo', { todoId: id, kind: 'daily', at: Date.now() + 3_600_000 });
    await relay('snooze_todos', { todoIds: [id], until: 'needed' });
    await relay('unschedule_todo', { todoId: id });
    expect((await fetchTodo(id)).snoozeMode ?? null).toBeNull();
  });
});
