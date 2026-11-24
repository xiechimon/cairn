import { RESEARCH_BEFORE_PLAN_SOURCE_KIND, RESEARCH_STUCK_SOURCE_KIND } from '@cairn/shared';
import { expect, test } from 'vitest';
import type { TaskEntry, TaskSection } from '../src/board/tasks-sections.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import {
  TRAY_MACHINE_MAX_ROWS,
  TRAY_MAX_ROWS,
  popoverGroups,
  type TrayMachine,
  trayGroups,
  trayUsage,
} from '../src/tray/tray-groups.js';
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

const MIN = 60_000;
const machine = (extra: Partial<TrayMachine>): TrayMachine => ({
  id: 'm1',
  name: 'xmon 的 MacBook Pro',
  kind: 'remote',
  online: true,
  running: [],
  queued: [],
  strain: [],
  capabilities: null,
  ...extra,
});
const thread = (id: string, startedAt: number, lastProgressAt?: number) => ({
  threadId: id,
  title: id,
  projectId: 'p',
  startedAt,
  ...(lastProgressAt === undefined ? {} : { lastProgressAt }),
});

test('a computer groups its tasks: stalled first, then running oldest first, then queued', () => {
  const now = 100 * MIN;
  const view = { questions: [], entries: [entry(9, 'working', 1, { id: 'loose', title: 'loose' })] };
  const groups = trayGroups(
    view,
    [
      machine({
        running: [thread('fresh', now - 2 * MIN), thread('old', now - 30 * MIN, now - MIN), thread('hung', now - 20 * MIN, now - 16 * MIN)],
        queued: [
          { threadId: 'full', title: 'full', projectId: 'p', reason: 'waiting', retryAt: null },
        ],
      }),
      machine({ id: 'idle', name: 'idle', running: [] }),
      machine({ id: 'off', name: 'off', online: false, running: [thread('ghost', now)] }),
    ],
    now,
  );
  expect(groups.map((g) => g.label)).toEqual(['xmon 的 MacBook Pro', 'idle', 'off', '进行中']);
  expect(groups.map((g) => g.machine?.kind)).toEqual(['unreported', 'unreported', 'offline', undefined]);
  expect(popoverGroups(groups).map((g) => g.label)).toEqual(['xmon 的 MacBook Pro', '进行中']);
  const rows = groups[0]?.rows ?? [];
  expect(rows.map((r) => [r.title, r.hint?.key, r.hint?.vars?.n, r.warn ?? false])).toEqual([
    ['hung', '{n} 分钟无进展', 16, true],
    ['old', '{n} 分', 30, false],
    ['fresh', '{n} 分', 2, false],
    ['full', '运行中', undefined, false],
  ]);
  expect(groups[3]?.rows.map((r) => r.title)).toEqual(['loose']);
});

test('a running task on a computer leaves the 进行中 group, and a long list ends in a more row', () => {
  const now = 100 * MIN;
  const running = Array.from({ length: TRAY_MACHINE_MAX_ROWS + 2 }, (_, i) => thread(`t${i}`, now - i * MIN));
  const view = { questions: [], entries: [entry(1, 'working', 5, { id: 't0' })] };
  const groups = trayGroups(view, [machine({ running })], now);
  expect(groups).toHaveLength(1);
  const rows = groups[0]?.rows ?? [];
  expect(rows).toHaveLength(TRAY_MACHINE_MAX_ROWS + 1);
  expect(rows.at(-1)?.note).toEqual({ key: '还有 {n} 个，在 Cairn 里看', vars: { n: 2 } });
});

test('a computer group carries the machine OS for the header icon', () => {
  const groups = trayGroups(
    { questions: [], entries: [] },
    [
      machine({
        running: [thread('t', 0)],
        capabilities: {
          osPlatform: 'linux',
          osDistribution: 'arch',
        } as TrayMachine['capabilities'],
      }),
    ],
    0,
  );
  expect(groups[0]?.os).toEqual({ osPlatform: 'linux', osDistribution: 'arch' });
  const bare = trayGroups(
    { questions: [], entries: [] },
    [machine({ running: [thread('t', 0)] })],
    0,
  );
  expect(bare[0]?.os).toBeNull();
});

test('the popover shows an idle computer only when strained, with a pressure percent and level in the header', () => {
  const hardware = { cpuCores: 10, memoryTotalMb: 16_384, memoryAvailableMb: 1_024, loadAvg1: 2, loadAvg5: 7, cpuUtilization: 0.02, memoryPressure: 0.94, diskFreeMb: 2_048 };
  const groups = trayGroups(
    { questions: [], entries: [] },
    [machine({ strain: ['memory', 'disk'], capabilities: { hardware } as TrayMachine['capabilities'] })],
    0,
  );
  expect(popoverGroups(groups)).toHaveLength(1);
  expect(groups[0]?.machine).toEqual({
    kind: 'online',
    memory: 0.94,
    cpu: 0.02,
    load: 2,
    cores: 10,
    diskGb: 2,
    strain: ['memory', 'disk'],
  });
  expect(groups[0]?.rows).toEqual([]);
  const meta = groups[0]?.meta;
  expect(meta?.warn).toBe(true);
  expect(meta?.percent).toBe(94);
  expect(meta?.level).toBe('full');
  expect(meta?.tip).toEqual({
    key: '内存压力 {mem}%；CPU {cpu}%；剩余磁盘 {disk} GB',
    vars: { mem: 94, cpu: 2, disk: 2 },
  });
  expect(meta && Object.keys(meta).sort()).toEqual(['level', 'percent', 'tip', 'warn']);
});

test('the header percent is the worse of CPU utilization and memory pressure', () => {
  const hardware = (over: Record<string, number>) => ({
    cpuCores: 8,
    memoryTotalMb: 16_384,
    memoryAvailableMb: 9_830,
    loadAvg1: 12.4,
    loadAvg5: 12.1,
    cpuUtilization: 0.03,
    memoryPressure: 0.4,
    diskFreeMb: 500_000,
    ...over,
  });
  const metaOf = (hw: Record<string, number>, strain: TrayMachine['strain'] = []) =>
    trayGroups({ questions: [], entries: [] }, [
      machine({
        strain,
        running: [thread('t', 0)],
        capabilities: { hardware: hardware(hw) } as TrayMachine['capabilities'],
      }),
    ])[0]?.meta;
  expect(metaOf({})).toMatchObject({ percent: 40, level: 'normal' });
  expect(metaOf({ cpuUtilization: 0.75 })).toMatchObject({ percent: 75, level: 'high' });
  expect(metaOf({ cpuUtilization: 0.97 })).toMatchObject({ percent: 97, level: 'full' });
  expect(metaOf({ memoryPressure: 0.94 }, ['memory'])).toMatchObject({ percent: 94, level: 'full' });
  expect(metaOf({ memoryPressure: 0.13 }, ['disk'])).toMatchObject({ percent: 13, level: 'full' });
});

test('a Mac with load 12 on 8 cores and idle CPU reads as its CPU and memory, not 100%', () => {
  const hardware = {
    cpuCores: 8,
    memoryTotalMb: 16_384,
    memoryAvailableMb: 6_062,
    loadAvg1: 12.4,
    loadAvg5: 12.1,
    cpuUtilization: 0.03,
    memoryPressure: 0.63,
    diskFreeMb: 182_000,
  };
  const meta = trayGroups({ questions: [], entries: [] }, [
    machine({
      running: [thread('t', 0)],
      capabilities: { hardware } as TrayMachine['capabilities'],
    }),
  ])[0]?.meta;
  expect(meta).toMatchObject({ percent: 63, level: 'high', warn: false });
  expect(meta?.tip.vars).toEqual({ mem: 63, cpu: 3, disk: 178 });
});

test('a Runner that reports no CPU utilization falls back to memory pressure alone', () => {
  const hardware = {
    cpuCores: 8,
    memoryTotalMb: 16_384,
    memoryAvailableMb: 9_830,
    loadAvg1: 40,
    loadAvg5: 30,
    diskFreeMb: 500_000,
  };
  const meta = trayGroups({ questions: [], entries: [] }, [
    machine({
      running: [thread('t', 0)],
      capabilities: { hardware } as TrayMachine['capabilities'],
    }),
  ])[0]?.meta;
  expect(meta).toMatchObject({ percent: 40, level: 'normal' });
});

test('usage is hidden before anything ran today and reports the tightest Claude window', () => {
  const day = (coordinator: number, tasks: number) => ({
    days: [{ date: '2026-11-18', coordinator, tasks, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: {}, projects: {}, todos: [], cost: null }],
    models: [],
    projects: [],
  });
  const sub = (utilization: number[], extra = {}) => ({
    id: String(utilization),
    kind: 'claude-subscription' as const,
    label: 'x',
    expiresAt: null,
    createdAt: 0,
    windows: utilization.map((u) => ({ name: 'w', utilization: u, resetsAt: null, observedAt: 0 })),
    ...extra,
  });
  expect(trayUsage(day(0, 0), [sub([0.5])], 0)).toBeNull();
  expect(trayUsage(day(240_000, 1_000_000), [sub([0.2, 0.38]), sub([0.1])], 0)).toEqual({
    tokens: '1.24M',
    quota: { key: 'Claude 额度 {pct}%', vars: { pct: 38 } },
  });
  expect(trayUsage(day(1, 0), [sub([1], { state: 'exhausted', cooldownUntil: 50 })], 10)?.quota?.key).toBe(
    'Claude 额度用完 · {at} 恢复',
  );
});
