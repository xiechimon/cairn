import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, taskEntry, THREAD } from './chief-home-mock.js';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const INP_BUDGET_MS = 200;
const LONG_TASK_BUDGET_MS = 50;
const LCP_BUDGET_MS = 2500;
const LOAD_CLS_BUDGET = 0.1;
const SLOW_NETWORK_MS = 400;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface EventEntryRecord {
  interactionId: number;
  name: string;
  duration: number;
}

interface LongTaskRecord {
  duration: number;
  startTime: number;
  name: string;
}

interface LcpRecord {
  startTime: number;
  size: number;
  tag: string;
  testId: string | null;
}

async function installInpObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __c35Events?: EventEntryRecord[];
      __c35Count?: number;
      __c35Observer?: PerformanceObserver;
    };
    w.__c35Events = [];
    w.__c35Count = 0;
    const countEvent = () => {
      w.__c35Count = (w.__c35Count ?? 0) + 1;
    };
    window.addEventListener('pointerup', countEvent, true);
    window.addEventListener('keydown', countEvent, true);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const ev = entry as PerformanceEntry & { interactionId?: number };
        if ((ev.interactionId ?? 0) > 0) {
          w.__c35Events?.push({
            interactionId: ev.interactionId ?? 0,
            name: ev.name,
            duration: ev.duration,
          });
        }
      }
    });
    observer.observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    w.__c35Observer = observer;
  });
}

async function resetInpCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __c35Events?: EventEntryRecord[];
      __c35Count?: number;
      __c35Observer?: PerformanceObserver;
    };
    w.__c35Observer?.takeRecords();
    w.__c35Events = [];
    w.__c35Count = 0;
  });
}

async function assertInpBudget(page: Page, surface: string): Promise<number[]> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const { events, totalCount } = await page.evaluate(() => {
    const w = window as unknown as {
      __c35Events?: EventEntryRecord[];
      __c35Count?: number;
      __c35Observer?: PerformanceObserver;
    };
    for (const entry of w.__c35Observer?.takeRecords() ?? []) {
      const ev = entry as PerformanceEntry & { interactionId?: number };
      if ((ev.interactionId ?? 0) > 0) {
        w.__c35Events?.push({
          interactionId: ev.interactionId ?? 0,
          name: ev.name,
          duration: ev.duration,
        });
      }
    }
    return { events: w.__c35Events ?? [], totalCount: w.__c35Count ?? 0 };
  });

  const byId = new Map<number, number>();
  for (const ev of events) {
    const prev = byId.get(ev.interactionId) ?? 0;
    if (ev.duration > prev) byId.set(ev.interactionId, ev.duration);
  }
  const samples = [...byId.values()];
  const n = Math.max(totalCount, samples.length, 1);
  while (samples.length < n) samples.push(0);
  samples.sort((a, b) => a - b);
  const p98 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.98) - 1)] ?? 0;
  const max = samples[samples.length - 1] ?? 0;
  console.log(
    `[C35] ${surface}: interactions=${n}, >=16ms=${byId.size}, p98=${p98.toFixed(1)}ms, max=${max.toFixed(1)}ms`,
  );
  expect(
    p98,
    `C35: ${surface} INP p98=${p98.toFixed(1)}ms exceeded ${INP_BUDGET_MS}ms (max=${max.toFixed(1)}ms)`,
  ).toBeLessThanOrEqual(INP_BUDGET_MS);
  return samples;
}

async function installSlowNetwork(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    await delay(SLOW_NETWORK_MS);
    await route.fallback();
  });
}

async function measureTypingLongTasks(
  page: Page,
  input: Locator,
  label: string,
  text: string,
): Promise<void> {
  await expect(input).toBeVisible();
  await input.click();
  await expect(input).toBeFocused();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => {
    const w = window as unknown as {
      __c36Observer?: PerformanceObserver;
      __c36LongTasks?: LongTaskRecord[];
    };
    w.__c36Observer?.disconnect();
    w.__c36LongTasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__c36LongTasks?.push({
          duration: entry.duration,
          startTime: entry.startTime,
          name: entry.name,
        });
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
    w.__c36Observer = observer;
  });

  await page.keyboard.type(text, { delay: 16 });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const tasks = await page.evaluate(() => {
    const w = window as unknown as {
      __c36Observer?: PerformanceObserver;
      __c36LongTasks?: LongTaskRecord[];
    };
    for (const entry of w.__c36Observer?.takeRecords() ?? []) {
      w.__c36LongTasks?.push({
        duration: entry.duration,
        startTime: entry.startTime,
        name: entry.name,
      });
    }
    w.__c36Observer?.disconnect();
    return w.__c36LongTasks ?? [];
  });

  const overBudget = tasks.filter((t) => t.duration > LONG_TASK_BUDGET_MS);
  const max = tasks.reduce((m, t) => Math.max(m, t.duration), 0);
  console.log(`[C36] ${label}: longTasks=${overBudget.length}, max=${max.toFixed(1)}ms`);
  expect(
    overBudget,
    `C36: ${label} blocked main thread during typing (> ${LONG_TASK_BUDGET_MS}ms): ${overBudget.map((t) => `${t.duration.toFixed(1)}ms`).join(', ')}`,
  ).toEqual([]);
}

interface SurfaceVitalsRecord {
  lcp: LcpRecord | null;
  fcpMs: number | null;
  cls: number;
}

async function installSurfaceVitalsObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __c37Lcp?: LcpRecord | null;
      __c37Fcp?: number | null;
      __c37Cls?: number;
      __c37LcpObserver?: PerformanceObserver;
      __c37PaintObserver?: PerformanceObserver;
      __c37ClsObserver?: PerformanceObserver;
    };
    w.__c37Lcp = null;
    w.__c37Fcp = null;
    w.__c37Cls = 0;

    const lcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcp = entry as PerformanceEntry & { size?: number; element?: Element | null };
        w.__c37Lcp = {
          startTime: lcp.startTime,
          size: lcp.size ?? 0,
          tag: lcp.element?.tagName.toLowerCase() ?? 'unknown',
          testId: lcp.element?.getAttribute('data-testid') ?? null,
        };
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    w.__c37LcpObserver = lcpObserver;

    const paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          w.__c37Fcp = entry.startTime;
        }
      }
    });
    paintObserver.observe({ type: 'paint', buffered: true });
    w.__c37PaintObserver = paintObserver;

    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!(shift.hadRecentInput ?? false)) {
          w.__c37Cls = (w.__c37Cls ?? 0) + (shift.value ?? 0);
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
    w.__c37ClsObserver = clsObserver;
  });
}

async function readSurfaceVitals(page: Page, surface: string): Promise<number> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const vitals = await page.evaluate((): SurfaceVitalsRecord & { ttfbMs: number } => {
    const w = window as unknown as {
      __c37Lcp?: LcpRecord | null;
      __c37Fcp?: number | null;
      __c37Cls?: number;
      __c37LcpObserver?: PerformanceObserver;
      __c37PaintObserver?: PerformanceObserver;
      __c37ClsObserver?: PerformanceObserver;
    };
    for (const entry of w.__c37LcpObserver?.takeRecords() ?? []) {
      const item = entry as PerformanceEntry & { size?: number; element?: Element | null };
      w.__c37Lcp = {
        startTime: item.startTime,
        size: item.size ?? 0,
        tag: item.element?.tagName.toLowerCase() ?? 'unknown',
        testId: item.element?.getAttribute('data-testid') ?? null,
      };
    }
    for (const entry of w.__c37PaintObserver?.takeRecords() ?? []) {
      if (entry.name === 'first-contentful-paint') {
        w.__c37Fcp = entry.startTime;
      }
    }
    for (const entry of w.__c37ClsObserver?.takeRecords() ?? []) {
      const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (!(shift.hadRecentInput ?? false)) {
        w.__c37Cls = (w.__c37Cls ?? 0) + (shift.value ?? 0);
      }
    }
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    return {
      lcp: w.__c37Lcp ?? null,
      fcpMs: w.__c37Fcp ?? null,
      cls: w.__c37Cls ?? 0,
      ttfbMs: nav?.responseStart ?? 0,
    };
  });
  expect(vitals.lcp, `C37: ${surface} produced no largest-contentful-paint entry`).not.toBeNull();
  const fcpLabel = vitals.fcpMs !== null ? `${vitals.fcpMs.toFixed(1)}ms` : 'n/a';
  console.log(
    `[C37] ${surface}: LCP=${vitals.lcp!.startTime.toFixed(1)}ms, CLS=${vitals.cls.toFixed(4)}, FCP=${fcpLabel}, TTFB=${vitals.ttfbMs.toFixed(1)}ms (tag=${vitals.lcp!.tag}, testId=${vitals.lcp!.testId ?? 'none'})`,
  );
  expect(
    vitals.lcp!.startTime,
    `C37: ${surface} LCP=${vitals.lcp!.startTime.toFixed(1)}ms exceeded ${LCP_BUDGET_MS}ms`,
  ).toBeLessThanOrEqual(LCP_BUDGET_MS);
  expect(
    vitals.cls,
    `C37: ${surface} load CLS=${vitals.cls.toFixed(4)} exceeded ${LOAD_CLS_BUDGET}`,
  ).toBeLessThanOrEqual(LOAD_CLS_BUDGET);
  return vitals.lcp!.startTime;
}

test.describe('C35: INP <= 200ms across interactions under 400ms slow network', () => {
  test('new-task row, Coordinator composer, settings rows and thread panel paint within 200ms', async ({
    page,
  }) => {
    const allSamples: number[] = [];
    await installInpObserver(page);

    const confirmTodo = {
      ...TASK,
      id: 'todo-1',
      phase: 'confirm',
      latestBuildId: 'build-1',
      section: 'needs_input',
    };
    const runningTodo = {
      ...TASK,
      id: 'todo-run',
      seqNum: 10,
      phase: 'building',
      latestBuildId: 'build-run',
      section: 'working',
    };
    const providerRecord = {
      kind: 'custom',
      providerId: 'relay-fixture',
      label: 'Relay connection',
      baseUrl: 'https://gateway.example.invalid/v1',
      api: 'openai-completions',
      authHeader: false,
      compat: {},
      models: [{ id: 'small-model', name: 'Small model' }],
      id: 'prov-relay',
      createdBy: 'u1',
      createdAt: 1,
      updatedAt: 1,
      configurationFingerprint: 'a'.repeat(32),
    };
    const subRecord = {
      id: 's1',
      kind: 'claude-subscription',
      label: 'Claude subscription',
      expiresAt: null,
      createdAt: Date.now() - 3_600_000,
      windows: [{ name: 'five_hour', utilization: 0.38, resetsAt: Date.now() + 3_600_000, observedAt: Date.now() }],
      lastUsedAt: Date.now() - 120_000,
      stepsLast24h: 7,
    };

    await mockLive(
      page,
      {
        threads: [THREAD],
        messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: 10 }],
        todos: [confirmTodo, runningTodo],
        tasks: [
          taskEntry({ id: 'todo-1', phase: 'confirm', latestBuildId: 'build-1', section: 'needs_input' }),
          taskEntry({ id: 'todo-run', seqNum: 10, phase: 'building', latestBuildId: 'build-run', section: 'working' }),
        ],
      },
      (path, route, json) => {
        if (path === `/api/projects/${PROJECT.id}/todos` && route.request().method() === 'POST') {
          return json(
            taskEntry({ id: 'todo-new', title: 'New slow task', section: 'up_next', phase: 'todo' }),
            201,
          );
        }
        if (path === '/api/teams/t1/claude-subscriptions') return json([subRecord]);
        if (path === '/api/teams/t1/providers') {
          return json({ presets: [], providers: [providerRecord], canTestConnection: true });
        }
        if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
        if (path === '/api/teams/t1/claude-subscriptions/s1/verify') {
          return json({ ok: true, check: { at: Date.now(), ok: true, reason: null, check: 'sign-in', command: 'GET', model: null, durationMs: 120 } });
        }
        if (path === '/api/teams/t1/providers/prov-relay/test') {
          return json({
            configurationFingerprint: providerRecord.configurationFingerprint,
            status: 'ok',
            reason: null,
            failure: null,
            httpStatus: null,
            detail: null,
            latencyMs: 120,
          });
        }
        if (path === '/api/todos/todo-1') return json(confirmTodo);
        if (path === '/api/builds/build-1') {
          return json({ id: 'build-1', todoId: 'todo-1', status: 'waiting_confirm', errorMessage: null });
        }
        if (path === '/api/builds/build-1/steps') {
          if (route.request().method() === 'POST') return json({ delegated: true });
          return json([{ id: 'step-1', buildId: 'build-1', kind: 'plan', status: 'done', machineId: 'm-ready' }]);
        }
        if (path === '/api/todos/todo-run') return json(runningTodo);
        if (path === '/api/builds/build-run') {
          return json({ id: 'build-run', todoId: 'todo-run', status: 'running', errorMessage: null });
        }
        if (path === '/api/builds/build-run/steps') {
          return json([{ id: 'step-run', buildId: 'build-run', kind: 'session', status: 'claimed', machineId: 'm-ready' }]);
        }
        if (path === '/api/builds/build-run/stop' && route.request().method() === 'POST') {
          return json({ delegated: true });
        }
        if (/^\/api\/conversations\/build-[^/]+\/messages$/.test(path)) {
          return json({
            messages: [{ id: 'u1', role: 'user', content: 'Fix bug', createdAt: 1000 }],
            nextCursor: null,
          });
        }
        if (path === '/api/todos/todo-1/messages' && route.request().method() === 'POST') {
          return json({ conversationId: 'build-1' });
        }
        return undefined;
      },
    );
    await installSlowNetwork(page);

    const projectsLoaded = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/projects',
    );
    await page.goto('/app?pane=tasks');
    await projectsLoaded;
    const panel = page.getByRole('complementary', { name: '任务' });
    await expect(panel.getByTestId('tasks-section').first()).toBeVisible();
    await expect(panel.getByTestId('tasks-new')).toBeVisible();
    await resetInpCounter(page);
    await panel.getByTestId('tasks-new').click();
    const taskInput = panel.getByTestId('tasks-add-input');
    await expect(taskInput).toBeFocused();
    await taskInput.click();
    await page.keyboard.type('Check INP', { delay: 20 });
    await taskInput.press('Enter');
    await expect(panel.getByTestId('tasks-add-submit'), 'C35: add-task pending state must paint within 200ms').toBeDisabled({ timeout: 200 });
    await page.keyboard.press('Escape');
    allSamples.push(...(await assertInpBudget(page, 'new-task row')));

    const home = page.getByTestId('home-c');
    const chiefInput = home.getByTestId('chief-composer-input');
    await expect(chiefInput).toBeVisible();
    await resetInpCounter(page);
    await home.getByTestId('composer-plus').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('[data-base-ui-inert]')).toHaveCount(0);
    await chiefInput.click();
    await page.keyboard.type('Coordinator INP check', { delay: 20 });
    await chiefInput.press('Enter');
    await expect(
      home.getByTestId('chief-bubble').filter({ hasText: 'Coordinator INP check' }),
      'C35: Coordinator optimistic bubble must paint within 200ms',
    ).toBeVisible({ timeout: 200 });
    allSamples.push(...(await assertInpBudget(page, 'Coordinator composer')));

    await page.goto('/app/settings/routing');
    await expect(page.getByTestId('subscription-verify')).toBeVisible();
    await expect(page.getByTestId('provider-instance').filter({ hasText: 'Relay connection' })).toBeVisible();
    await resetInpCounter(page);
    await page.getByTestId('subscription-verify').click();
    await expect(
      page.getByTestId('subscription-verify-feedback'),
      'C35: verify checking popover must paint within 200ms',
    ).toHaveAttribute('data-phase', 'checking', { timeout: 200 });
    await page.keyboard.press('Escape');
    await page.getByTestId('provider-instance').filter({ hasText: 'Relay connection' }).click();
    await page.getByTestId('provider-test-all').click();
    await expect(
      page.getByTestId('model-test-result'),
      'C35: provider test checking popover must paint within 200ms',
    ).toHaveAttribute('data-phase', 'checking', { timeout: 200 });
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: '设置分区' }).getByRole('link', { name: '账号' }).click();
    await expect(page.getByTestId('account-appearance')).toBeVisible();
    await page.getByRole('radio', { name: '浅色' }).click();
    await page.getByRole('radio', { name: '深色' }).click();
    allSamples.push(...(await assertInpBudget(page, 'settings rows')));

    await page.goto('/app?thread=todo-1');
    const sidePanel = page.getByTestId('side-chat-panel');
    await expect(sidePanel.getByTestId('side-chat-action')).toBeVisible();
    await resetInpCounter(page);
    await sidePanel.getByTestId('side-chat-action').getByRole('button', { name: '批准计划' }).click();
    await expect(
      sidePanel.getByTestId('side-chat-action').getByRole('button', { name: '批准计划' }),
      'C35: thread action pending state must paint within 200ms',
    ).toBeDisabled({ timeout: 200 });
    const threadInput = sidePanel.locator('[data-testid="composer-card"] textarea');
    await threadInput.click();
    await page.keyboard.type('Reply INP', { delay: 20 });
    await threadInput.press('Enter');
    await expect(
      sidePanel.getByTestId('user-bubble').filter({ hasText: 'Reply INP' }),
      'C35: thread optimistic bubble must paint within 200ms',
    ).toBeVisible({ timeout: 200 });
    allSamples.push(...(await assertInpBudget(page, 'thread panel (confirm)')));

    await page.goto('/app?thread=todo-run');
    const stopBtn = page.getByTestId('side-chat-panel').locator('.composer-stop');
    await expect(stopBtn).toBeVisible();
    await resetInpCounter(page);
    await stopBtn.click();
    await expect(stopBtn, 'C35: thread stop pending state must paint within 200ms').toBeDisabled({ timeout: 200 });
    allSamples.push(...(await assertInpBudget(page, 'thread panel (stop)')));

    allSamples.sort((a, b) => a - b);
    const overallP98 =
      allSamples[Math.min(allSamples.length - 1, Math.ceil(allSamples.length * 0.98) - 1)] ?? 0;
    const overallMax = allSamples[allSamples.length - 1] ?? 0;
    console.log(
      `[C35] overall: total=${allSamples.length}, p98=${overallP98.toFixed(1)}ms, max=${overallMax.toFixed(1)}ms`,
    );
    expect(
      overallP98,
      `C35: overall INP p98=${overallP98.toFixed(1)}ms exceeded ${INP_BUDGET_MS}ms`,
    ).toBeLessThanOrEqual(INP_BUDGET_MS);
  });
});

test.describe('C36: zero long tasks over 50ms while typing', () => {
  test('typing in Coordinator composer (fixture + live) and add-task row triggers no long tasks', async ({
    page,
  }) => {
    await page.goto('/app?scenario=home-c');
    await measureTypingLongTasks(
      page,
      page.getByTestId('home-c').getByTestId('chief-composer-input'),
      'Coordinator composer (fixture home-c)',
      '检查输入响应与长任务：check-typing-perf-0123456789',
    );

    await mockLive(page, {
      threads: [THREAD],
      messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: 10 }],
      todos: [TASK],
      tasks: [taskEntry({ section: 'working', title: TASK.title })],
    });
    await page.goto('/app?pane=tasks');
    await measureTypingLongTasks(
      page,
      page.getByTestId('home-c').getByTestId('chief-composer-input'),
      'Coordinator composer (live mock)',
      '检查主对话实时草稿输入性能：live-draft-perf-0123456789',
    );

    const panel = page.getByRole('complementary', { name: '任务' });
    await panel.getByTestId('tasks-new').click();
    await measureTypingLongTasks(
      page,
      panel.getByTestId('tasks-add-input'),
      'Add-task row',
      '新增任务输入框性能测试：add-task-typing-perf-012345',
    );
  });
});

test.describe('C37: Core Web Vitals LCP <= 2.5s and load CLS <= 0.1 on fixture stack', () => {
  test('opening Coordinator home, tasks panel, settings and thread panel meets CWV budgets', async ({
    page,
  }) => {
    await installSurfaceVitalsObserver(page);

    await page.goto('/app?scenario=home-c');
    await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toBeVisible();
    await expect(page.getByTestId('home-c').locator('.chief-composer')).toBeVisible();
    await readSurfaceVitals(page, 'Coordinator home');

    await page.goto('/app?scenario=home-c&pane=tasks');
    await expect(page.getByRole('complementary', { name: '任务' }).getByTestId('tasks-section').first()).toBeVisible();
    await readSurfaceVitals(page, 'Tasks panel');

    await page.goto('/app/settings/routing?scenario=model-routing');
    await expect(page.getByTestId('provider-instance').first()).toBeVisible();
    await readSurfaceVitals(page, 'Settings routing');

    await page.goto('/app/settings/account?scenario=01');
    await expect(page.getByTestId('account-appearance')).toBeVisible();
    await readSurfaceVitals(page, 'Settings account');

    await page.goto('/app?scenario=home-c&thread=home-c-review');
    await expect(page.getByTestId('side-chat-panel').getByTestId('transcript-col')).toBeVisible();
    await readSurfaceVitals(page, 'Thread panel direct open');
  });

  test('switching threads in tasks panel paints useful content within 2.5s', async ({ page }) => {
    await page.goto('/app?scenario=home-c&pane=tasks');
    const panel = page.getByRole('complementary', { name: '任务' });
    await expect(panel.getByTestId('tasks-section').first()).toBeVisible();

    const switches = [
      { title: 'Fold finished turns into purpose and duration', id: 'home-c-review' },
      { title: 'Push for finished threads', id: 'home-c-working-a' },
      { title: 'Connect a Claude subscription token', id: 'home-c-confirm' },
    ];

    for (const target of switches) {
      const row = panel.locator('[data-slot="task-row"]', { hasText: target.title });
      await expect(row).toBeVisible();
      const start = await page.evaluate(() => performance.now());
      await row.click();
      await expect(page.locator(`[data-testid="side-chat"][data-todo-id="${target.id}"]`)).toBeVisible();
      await expect(page.getByTestId('side-chat-panel').getByTestId('transcript-col')).toBeVisible();
      const elapsed = await page.evaluate(
        (t0) =>
          new Promise<number>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0))),
          ),
        start,
      );
      console.log(`[C37] thread switch (${target.id}): ${elapsed.toFixed(1)}ms`);
      expect(
        elapsed,
        `C37: thread switch to ${target.id} took ${elapsed.toFixed(1)}ms (> ${LCP_BUDGET_MS}ms)`,
      ).toBeLessThanOrEqual(LCP_BUDGET_MS);
    }
  });
});
