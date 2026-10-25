import { type BrowserContext, expect, type Page, test } from '@playwright/test';

const TEAM = { id: 't1', name: '团队' };
const USER = { id: 'u1', displayName: '我', avatarUrl: null };

const THREADS = [
  {
    id: 'chief-bbb',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: '线程乙',
    createdAt: 2,
    updatedAt: 2,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's2', openedAt: 2 },
    pendingSessionResumeAt: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: null,
  },
  {
    id: 'chief-aaa',
    chiefId: 'chief-u1-t1',
    userId: 'u1',
    teamId: 't1',
    title: '线程甲',
    createdAt: 1,
    updatedAt: 1,
    lastTurnAt: null,
    session: { runtime: 'pi', id: 's1', openedAt: 1 },
    pendingSessionResumeAt: null,
    toolDefHashes: {},
    toolResultHashes: {},
    activeRun: null,
  },
];

declare global {
  interface Window {
    __es: { url: string; readyState: number; emit: (ev: unknown) => void }[];
    __swNotifs: { title: string; options: { body?: string; tag?: string; data?: unknown } }[];
    __pageNotifs: { title: string; options: unknown; onclick: (() => void) | null }[];
    __stay?: string;
  }
}

function stubEventSource(page: Page) {
  return page.addInitScript(() => {
    window.__es = [];
    class FakeEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        window.__es.push(this as unknown as (typeof window.__es)[number]);
        queueMicrotask(() => this.onopen?.());
      }
      close() {
        this.readyState = 2;
      }
      emit(ev: unknown) {
        this.onmessage?.({ data: JSON.stringify(ev) });
      }
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
  });
}

function stubNotification(page: Page) {
  return page.addInitScript(() => {
    window.__pageNotifs = [];
    function StubNotification(this: unknown, title: string, options: unknown) {
      const self = this as { title: string; options: unknown; onclick: null };
      self.title = title;
      self.options = options;
      self.onclick = null;
      window.__pageNotifs.push(self as never);
    }
    Object.defineProperty(StubNotification, 'permission', { get: () => 'granted' });
    StubNotification.requestPermission = () => Promise.resolve('granted' as never);
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: StubNotification,
    });
  });
}

function hideDocument(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true });
  });
}

function spySwShowNotification(page: Page) {
  return page.addInitScript(() => {
    window.__swNotifs = [];
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      window.__swNotifs.push({ title, options: options ?? {} });
      return Promise.resolve();
    };
  });
}

function mockLiveApi(page: Page) {
  const json = (body: unknown) => ({
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  return page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === '/api/teams') return route.fulfill(json([TEAM]));
    if (p === '/api/user/me') return route.fulfill(json(USER));
    if (p === '/api/teams/t1/notifications') return route.fulfill(json({ unreadThreadIds: [] }));
    if (p === '/api/teams/t1/chief/threads') return route.fulfill(json(THREADS));
    if (p === '/api/teams/t1/chief') {
      return route.fulfill(
        json({
          chief: {
            id: 'chief-u1-t1',
            userId: 'u1',
            teamId: 't1',
            agent: null,
            charter: null,
            lastTurnAt: null,
            createdAt: 0,
            tz: null,
          },
          agentActor: null,
          context: null,
          watches: [],
          wakes: [],
        }),
      );
    }
    if (p.startsWith('/api/conversations/')) return route.fulfill(json({ messages: [] }));
    if (p === '/api/todos' || p === '/api/projects') return route.fulfill(json([]));
    if (
      p === '/api/teams/t1/members' ||
      p === '/api/teams/t1/machines' ||
      p === '/api/skills'
    ) {
      return route.fulfill(json([]));
    }
    return route.fulfill({ status: 418, ...json({ error: `unmocked: ${p}` }) });
  });
}

async function activeSw(context: BrowserContext, page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => context.serviceWorkers().length).toBe(1);
  return context.serviceWorkers()[0];
}

async function patchWindowPrimitives(worker: {
  evaluate: (fn: () => void) => Promise<unknown>;
}) {
  await worker.evaluate(() => {
    const s = self as unknown as Record<string, unknown>;
    s.__focused = 0;
    s.__opened = [];
    WindowClient.prototype.focus = function (this: WindowClient) {
      s.__focused = (s.__focused as number) + 1;
      return Promise.resolve(this);
    };
    Clients.prototype.openWindow = (url: string) => {
      (s.__opened as string[]).push(url);
      return Promise.resolve(null);
    };
  });
}

async function dispatchNotificationClick(
  worker: { evaluate: (fn: (href: string) => void, arg: string) => Promise<unknown> },
  href: string,
) {
  await worker.evaluate((h) => {
    class FakeClick extends ExtendableEvent {

      declare _n: { data: { href: string }; close(): void };
      constructor() {
        super('notificationclick');
        this._n = { data: { href: h }, close() {} };
      }
      get notification() {
        return this._n;
      }
    }
    self.dispatchEvent(new FakeClick());
  }, href);
}

async function fireTeamNotification(page: Page, notification: Record<string, unknown>) {
  await expect
    .poll(() => page.evaluate(() => window.__es.some((es) => es.url.includes('/stream'))))
    .toBe(true);
  await page.evaluate((n) => {
    const es = window.__es.find((x) => x.url.includes('/stream'));
    es?.emit({ type: 'notification', notification: n });
  }, notification);
}

function makeRecord(over: Record<string, unknown>): Record<string, unknown> {
  return {
    teamId: 't1',
    userId: 'u1',
    type: 'build_review',
    entityId: 'todo-x',
    entityRef: { title: '修一下按钮', projectId: 'p1', seqNum: 42 },
    agent: { name: 'Builder', avatarUrl: null },
    snippet: null,
    id: 'u1:todo-x',
    readAt: null,
    createdAt: 1,
    channels: ['in_app'],
    ...over,
  };
}

const DETAIL_HREF = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16';

test.describe('push notification click loop (XMON-106)', () => {
  test('T1: click with an open window → client-side routing to href, no full reload, pending slot cleared', async ({
    page,
    context,
  }) => {
    await page.goto('/app?scenario=01');
    await expect(page.locator('[data-route="board"]')).toBeVisible();
    const worker = await activeSw(context, page);
    await patchWindowPrimitives(worker);
    await page.evaluate(() => {
      window.__stay = 'no-reload';
    });

    await dispatchNotificationClick(worker, DETAIL_HREF);

    await expect.poll(() => page.url()).toContain(DETAIL_HREF);
    await expect(page.locator('[data-route="todo-detail"]')).toBeVisible();

    expect(await page.evaluate(() => window.__stay)).toBe('no-reload');

    expect(await worker.evaluate(() => (self as unknown as Record<string, unknown>).__focused)).toBe(
      1,
    );

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open('nav');
          return (await cache.match('/__pending-nav')) === undefined;
        }),
      )
      .toBe(true);
  });

  test('T2: click with no open window → openWindow(href) + pending slot handoff, landing page consumes the route', async ({
    page,
    context,
  }) => {
    await page.goto('/app?scenario=01');
    await expect(page.locator('[data-route="board"]')).toBeVisible();
    const worker = await activeSw(context, page);
    await patchWindowPrimitives(worker);

    await page.goto('data:text/html,<p>gone</p>');
    await dispatchNotificationClick(worker, DETAIL_HREF);

    await expect
      .poll(() => worker.evaluate(() => (self as unknown as Record<string, unknown>).__opened))
      .toEqual([DETAIL_HREF]);

    const woken = await context.newPage();
    await woken.goto('/app?scenario=01');
    await expect.poll(() => woken.url()).toContain(DETAIL_HREF);
    await expect(woken.locator('[data-route="todo-detail"]')).toBeVisible();
    await expect
      .poll(() =>
        woken.evaluate(async () => {
          const cache = await caches.open('nav');
          return (await cache.match('/__pending-nav')) === undefined;
        }),
      )
      .toBe(true);
    await woken.close();
  });

  test('T3b: SSE notification → goes through SW showNotification with per-class href mapping (zero in-page constructor calls)', async ({
    page,
  }) => {
    await stubNotification(page);
    await stubEventSource(page);
    await hideDocument(page);
    await spySwShowNotification(page);
    await mockLiveApi(page);
    await page.goto('/app');
    await expect(page.locator('[data-route="board"]')).toBeVisible();

    await fireTeamNotification(page, makeRecord({}));
    await fireTeamNotification(
      page,
      makeRecord({
        type: 'plan_ready',
        entityId: 'todo-def',
        id: 'u1:todo-def',
      }),
    );
    await fireTeamNotification(
      page,
      makeRecord({
        type: 'chief_message',
        entityId: 'chief-xyz',
        entityRef: { title: '线程主题', projectId: null, seqNum: null },
        snippet: '消息全文',
        id: 'u1:chief-xyz',
      }),
    );

    await expect.poll(() => page.evaluate(() => window.__swNotifs.length)).toBe(3);
    const calls = await page.evaluate(() => window.__swNotifs);

    expect(calls[0].title).toBe('构建待审核');
    expect(calls[0].options.body).toBe('#42 修一下按钮');
    expect(calls[0].options.tag).toBe('u1:todo-x');
    expect(calls[0].options.data).toEqual({ href: '/app/todo/todo-x' });

    expect(calls[1].title).toBe('方案已就绪');
    expect(calls[1].options.data).toEqual({ href: '/app/todo/todo-def' });

    expect(calls[2].title).toBe('线程主题');
    expect(calls[2].options.body).toBe('消息全文');
    expect(calls[2].options.data).toEqual({ href: '/app?chief=chief-xyz' });

    expect(await page.evaluate(() => window.__pageNotifs.length)).toBe(0);
  });

  test('T3a: SW registration failure → falls back to in-page Notification, onclick full-page jumps to href', async ({
    page,
    context,
  }) => {

    await context.route('**/sw.js', (route) => route.abort());
    await stubNotification(page);
    await stubEventSource(page);
    await hideDocument(page);
    await mockLiveApi(page);
    await page.goto('/app');
    await expect(page.locator('[data-route="board"]')).toBeVisible();

    await fireTeamNotification(page, makeRecord({ entityId: 'todo-fb', id: 'u1:todo-fb' }));

    await expect.poll(() => page.evaluate(() => window.__pageNotifs.length), { timeout: 10_000 }).toBe(1);
    const fallen = await page.evaluate(() => {
      const n = window.__pageNotifs[0];

      return { title: n.title, onclickType: typeof n.onclick };
    });
    expect(fallen.title).toBe('构建待审核');
    expect(fallen.onclickType).toBe('function');

    await page.evaluate(() => window.__pageNotifs[0].onclick?.());
    await page.waitForURL('**/app/todo/todo-fb');
  });

  test('T4: chief deep link → drawer opens on the target thread, params consumed once and stripped from the URL', async ({ page }) => {
    await stubEventSource(page);
    await mockLiveApi(page);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();

    const chip = drawer.getByRole('button', { name: '主题', exact: true });
    await expect(chip.locator('span')).toHaveText('线程乙');

    await expect.poll(() => page.url()).not.toContain('chief=');
    expect(page.url()).toContain('/app');
  });

  test('T4b: chief deep link pointing at a missing thread → drawer does not open, params still cleared', async ({ page }) => {
    await stubEventSource(page);
    await mockLiveApi(page);
    await page.goto('/app?chief=chief-zzz');

    await expect.poll(() => page.url()).not.toContain('chief=');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toHaveCount(1);
    await expect(drawer).toBeHidden();

    await expect(page.locator('[data-route="board"]')).toBeVisible();
  });

  test('T5: account switch off tier (preference override) → SSE notification does not pop; turning back on restores (#1031)', async ({
    page,
  }) => {

    await page.addInitScript(() => localStorage.setItem('cairn.notifyEnabled', '0'));
    await stubNotification(page);
    await stubEventSource(page);
    await hideDocument(page);
    await spySwShowNotification(page);
    await mockLiveApi(page);
    await page.goto('/app');
    await expect(page.locator('[data-route="board"]')).toBeVisible();

    await fireTeamNotification(page, makeRecord({}));

    await page.evaluate(() => localStorage.setItem('cairn.notifyEnabled', '1'));
    await fireTeamNotification(page, makeRecord({ entityId: 'todo-y', id: 'u1:todo-y' }));
    await expect.poll(() => page.evaluate(() => window.__swNotifs.length)).toBe(1);
    expect(await page.evaluate(() => window.__swNotifs[0].options.data)).toEqual({
      href: '/app/todo/todo-y',
    });
    expect(await page.evaluate(() => window.__pageNotifs.length)).toBe(0);
  });
});
