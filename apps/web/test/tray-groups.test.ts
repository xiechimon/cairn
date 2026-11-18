import { RESEARCH_BEFORE_PLAN_SOURCE_KIND, RESEARCH_STUCK_SOURCE_KIND } from '@cairn/shared';
import { expect, test } from 'vitest';
import type { TaskEntry, TaskSection } from '../src/board/tasks-sections.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { TRAY_MAX_ROWS, trayGroups } from '../src/tray/tray-groups.js';
import { todo } from './helpers.js';

const entry = (
  seq: number,
  section: TaskSection,
  at: number,
  extra: Partial<TodoRecord> = {},
): TaskEntry => ({ todo: { ...todo(seq, 'building'), phaseAt: at, ...extra }, section });

const titles = (view: Parameters<typeof trayGroups>[0]) =>
  trayGroups(view).map((group) => [group.label, group.rows.map((row) => row.title)]);

test('research cards that serve another task never reach the tray', () => {
  const view = {
    questions: [],
    entries: [
      entry(1, 'working', 30, { title: 'Research: 退格', sourceKind: RESEARCH_BEFORE_PLAN_SOURCE_KIND }),
      entry(2, 'working', 20, { title: 'Research: CI', sourceKind: RESEARCH_STUCK_SOURCE_KIND }),
      entry(3, 'working', 10, { title: '退格', sourceKind: 'intake' }),
    ],
  };
  expect(titles(view)).toEqual([['进行中', ['退格']]]);
});

test('waiting rows come before running ones, even when the running row is newer', () => {
  const view = {
    questions: [
      { requestId: 'q', threadId: null, header: '用哪个分支？', createdAt: 5, projectId: null },
    ],
    entries: [
      entry(1, 'working', 100, { title: '在跑' }),
      entry(2, 'ready_for_review', 10, { title: '待审' }),
      entry(3, 'up_next', 200, { title: '没开始' }),
      entry(4, 'resolved', 300, { title: '做完了' }),
    ],
  };
  expect(titles(view)).toEqual([
    ['等你', ['待审', '用哪个分支？']],
    ['进行中', ['在跑']],
  ]);
});

test('running rows fill only what the waiting rows leave of the cap', () => {
  const view = {
    questions: [],
    entries: [
      ...Array.from({ length: TRAY_MAX_ROWS - 1 }, (_, i) => entry(i + 1, 'needs_input', i)),
      entry(20, 'working', 50, { title: '新' }),
      entry(21, 'working', 40, { title: '旧' }),
    ],
  };
  const groups = trayGroups(view);
  expect(groups.flatMap((group) => group.rows)).toHaveLength(TRAY_MAX_ROWS);
  expect(groups[1]?.rows.map((row) => row.title)).toEqual(['新']);
});
