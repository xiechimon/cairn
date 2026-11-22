import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESEARCH_BEFORE_PLAN_SOURCE_KIND, RESEARCH_STUCK_SOURCE_KIND } from '@cairn/shared';
import { createTrayDataLoader, trayGroups, trayUsage } from '../src/tray-data.ts';

const minute = 60_000;
const now = 100 * minute;
const empty = { entries: [] };
const todo = (id, section, phaseAt, sourceKind) => ({
  kind: 'todo',
  id,
  title: id,
  section,
  phaseAt,
  sourceKind,
});
const machine = (overrides) => ({
  id: 'm1',
  name: 'Test Mac',
  kind: 'local',
  online: true,
  ...overrides,
});
const thread = (threadId, startedAt, lastProgressAt) => ({
  threadId,
  title: threadId,
  startedAt,
  lastProgressAt,
});

function titles(groups) {
  return groups.map((group) => [group.label.kind, group.rows.map((row) => row.title)]);
}

test('questions and waiting tasks come first and working tasks fill the six-row cap', () => {
  const tasks = {
    entries: [
      { kind: 'question', title: 'Question', createdAt: 99, projectId: 'project id' },
      ...Array.from({ length: 4 }, (_, index) => todo(`waiting-${index}`, 'needs_input', index)),
      todo('latest', 'working', 90),
      todo('earlier', 'working', 80),
      todo('research for plan', 'working', 101, RESEARCH_BEFORE_PLAN_SOURCE_KIND),
      todo('research for stalled task', 'needs_input', 102, RESEARCH_STUCK_SOURCE_KIND),
      todo('done', 'resolved', 200),
    ],
  };
  const groups = trayGroups(tasks, [], now);
  assert.deepEqual(titles(groups), [
    ['waiting', ['Question', 'waiting-3', 'waiting-2', 'waiting-1', 'waiting-0']],
    ['working', ['latest']],
  ]);
  assert.equal(groups[0].rows[0].path, '/app?project=project+id&chat=1');
});

test('online computers show stalled, running and queued tasks without duplicating working tasks', () => {
  const groups = trayGroups(
    { entries: [todo('running fresh', 'working', 0), todo('unassigned', 'working', 0)] },
    [
      machine({
        running: [
          thread('running fresh', now - 2 * minute),
          thread('running old', now - 30 * minute, now - minute),
          thread('stalled', now - 20 * minute, now - 16 * minute),
        ],
        queued: [
          { threadId: 'waiting', title: 'waiting', reason: 'waiting', retryAt: null },
          { threadId: 'rate', title: 'rate', reason: 'quota', retryAt: now + minute },
          { threadId: 'more', title: 'more', reason: 'quota', retryAt: null },
        ],
      }),
      machine({ id: 'idle' }),
      machine({ id: 'offline', online: false, running: [thread('do not show', now)] }),
    ],
    now,
  );
  assert.deepEqual(titles(groups), [
    ['machine', ['stalled', 'running old', 'running fresh', 'waiting', 'rate', undefined]],
    ['working', ['unassigned']],
  ]);
  const rows = groups[0].rows;
  assert.deepEqual(
    rows.map((row) => row.status),
    [
      { kind: 'stalled', minutes: 16 },
      { kind: 'running', minutes: 30 },
      { kind: 'running', minutes: 2 },
      { kind: 'waiting-for-runner' },
      { kind: 'quota', retryAt: now + minute },
      undefined,
    ],
  );
  assert.equal(rows[2].path, '/app?thread=running+fresh');
  assert.deepEqual(rows.at(-1), { more: 1, path: '/app' });
});

for (const [cpu, memoryPressure, strain, level, percent] of [
  [0.02, undefined, [], 'normal', 40],
  [undefined, 0.65, [], 'high', 65],
  [0.97, 0.4, [], 'full', 97],
  [0.02, 0.13, ['disk'], 'full', 13],
]) {
  test(`pressure reflects CPU and memory, not load average (${percent}%)`, () => {
    const hardware = {
      memoryPressure,
      memoryTotalMb: 1000,
      memoryAvailableMb: 600,
      cpuUtilization: cpu,
      diskFreeMb: 2048,
      loadAvg1: 50,
    };
    const groups = trayGroups(
      empty,
      [
        machine({
          strain,
          capabilities: { hardware },
          running: strain.length > 0 ? [] : [thread('working', now)],
        }),
      ],
      now,
    );
    assert.deepEqual(groups[0].label.pressure, {
      level,
      percent,
      cpu: cpu === undefined ? null : cpu * 100,
      memory: Math.round((memoryPressure ?? 0.4) * 100),
      disk: 2,
    });
  });
}

const usage = (coordinator, tasks) => ({ days: [{ coordinator, tasks }] });
const sub = (utilizations, overrides) => ({
  windows: utilizations.map((utilization) => ({ utilization })),
  ...overrides,
});

test('usage omits idle days and shows the tightest enabled quota window', () => {
  assert.equal(trayUsage(usage(0, 0), [sub([1])], now), null);
  assert.deepEqual(
    trayUsage(usage(240_000, 1_000_000), [sub([0.2, 0.38]), sub([0.8], { enabled: false })], now),
    {
      tokens: 1_240_000,
      quota: { state: 'used', percent: 38 },
    },
  );
  assert.deepEqual(trayUsage(usage(1, 2), [], now), { tokens: 3, quota: null });
});

test('usage shows exhaustion with the first reset time, if known', () => {
  const exhausted = (cooldownUntil) => sub([], { state: 'exhausted', cooldownUntil });
  assert.deepEqual(trayUsage(usage(1, 0), [exhausted(null)], now)?.quota, {
    state: 'exhausted',
    retryAt: null,
  });
  assert.deepEqual(trayUsage(usage(1, 0), [exhausted(now + 20), exhausted(now + 10)], now)?.quota, {
    state: 'exhausted',
    retryAt: now + 10,
  });
  assert.equal(trayUsage(usage(1, 0), [exhausted(now - 10)], now)?.quota, null);
});

test('an unavailable quota feed does not hide working task and usage feeds', async (t) => {
  let quotaUnavailable = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const { pathname } = url;
    if (pathname === '/api/user/me') return Response.json({ displayName: 'Local owner' });
    if (pathname === '/api/teams') return Response.json([{ id: 'team' }]);
    if (pathname === '/api/tasks') return Response.json(empty);
    if (pathname.endsWith('/machines')) {
      return Response.json(
        quotaUnavailable ? [machine({ running: [thread('Fresh task', now)] })] : [],
      );
    }
    if (pathname.endsWith('/chief/threads')) return Response.json([]);
    if (pathname.endsWith('/usage/daily')) return Response.json(usage(1, 2));
    if (pathname.endsWith('/claude-subscriptions')) {
      return quotaUnavailable ? new Response(null, { status: 503 }) : Response.json([sub([0.42])]);
    }
    assert.fail(`unexpected request ${pathname}`);
  });
  const load = createTrayDataLoader('http://127.0.0.1:5110', 'test-owner');
  await load(() => false);
  quotaUnavailable = true;
  const after = await load(() => false);
  assert.equal(after.groups[0].rows[0].title, 'Fresh task');
  assert.deepEqual(after.usage, { tokens: 3, quota: { state: 'used', percent: 42 } });
});

test('a total outage retains the last snapshot, and changing workspaces clears it', async (t) => {
  let team = 'one';
  let online = false;
  t.mock.method(globalThis, 'fetch', async ({ pathname }) => {
    if (pathname === '/api/user/me') return Response.json({ displayName: 'Local owner' });
    if (pathname === '/api/teams') return Response.json([{ id: team }]);
    if (!online) return new Response(null, { status: 503 });
    if (pathname === '/api/tasks') return Response.json(empty);
    if (pathname.endsWith('/usage/daily')) return Response.json(usage(team === 'one' ? 5 : 10, 2));
    return Response.json([]);
  });
  const load = createTrayDataLoader('http://127.0.0.1:5110', 'test-owner');
  const noQuota = () => false;
  assert.deepEqual(await load(noQuota), { status: 'unavailable' });
  online = true;
  const ready = await load(noQuota);
  assert.equal(ready.usage.tokens, 7);
  online = false;
  assert.deepEqual(await load(noQuota), ready);
  team = 'two';
  assert.deepEqual(await load(noQuota), { status: 'unavailable' });
  online = true;
  assert.equal((await load(noQuota)).usage.tokens, 12);
});

test('reads the local workspace as one bounded snapshot and keeps cached quota on refresh failure', async (t) => {
  const origin = 'http://127.0.0.1:5110';
  const seen = [];
  let today = usage(1, 2);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer test-owner');
    assert.ok(options.signal instanceof AbortSignal);
    const { pathname, searchParams } = url;
    seen.push([pathname, options.method]);
    if (pathname === '/api/user/me') return Response.json({ displayName: 'Local owner' });
    if (pathname === '/api/teams') return Response.json([{ id: 'team' }]);
    if (pathname === '/api/tasks') {
      assert.equal(searchParams.get('teamId'), 'team');
      assert.equal(searchParams.get('sectioned'), '1');
      return Response.json(empty);
    }
    if (pathname.endsWith('/machines')) return Response.json([]);
    if (pathname.endsWith('/chief/threads')) return Response.json([{ activeRun: {} }]);
    if (pathname.endsWith('/usage/daily')) return Response.json(today);
    if (pathname.endsWith('/claude-subscriptions')) return Response.json([sub([0.42])]);
    if (pathname.endsWith('/claude-subscriptions/quota'))
      return new Response(null, { status: 503 });
    assert.fail(`unexpected request ${pathname}`);
  });
  const load = createTrayDataLoader(origin, 'test-owner');
  assert.deepEqual(await load(() => true), {
    status: 'ready',
    displayName: 'Local owner',
    coordinatorBusy: true,
    groups: [],
    usage: {
      tokens: 3,
      quota: { state: 'used', percent: 42 },
    },
  });
  assert.deepEqual(
    seen.filter(([, method]) => method === 'POST'),
    [['/api/teams/team/claude-subscriptions/quota', 'POST']],
  );
  seen.length = 0;
  await load(() => false);
  assert.equal(
    seen.some(([, method]) => method === 'POST'),
    false,
  );
  const claimQuota = t.mock.fn(() => true);
  today = usage(0, 0);
  assert.equal((await load(claimQuota)).usage, null);
  assert.equal(claimQuota.mock.callCount(), 0);
  assert.equal(
    seen.some(([, method]) => method === 'POST'),
    false,
  );
  today = usage(1, 2);
  await load(claimQuota);
  assert.equal(claimQuota.mock.callCount(), 1);
  assert.equal(
    seen.some(([, method]) => method === 'POST'),
    true,
  );
});
