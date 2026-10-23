import { type BrowserContext, expect, type Page, test } from '@playwright/test';

// XMON-106 acceptance: 推送通知点击闭环。链路 = SSE notification 事件 →
// fireDesktopNotification（document.hidden 且权限 granted）→ SW
// registration.showNotification（挂 data.href）→ sw.js notificationclick
// （r1 冻结原件，本票不改）→ 已开窗口聚焦 + postMessage 客户端路由 /
// 无窗口 openWindow(href) 新开；PwaBridge 消费 message 并清 pending-nav
// 槽（防下次冷启动误跳旧 href）。
//
// 失败方式枚举（先列后钉）：
//  1. 已开窗口点击不路由（href 未挂 / message 未消费）—— T1
//  2. 无已开窗口点击不开新窗（openWindow 路径断）—— T2
//  3. 通知本体不走 SW，落回页内裸 new Notification（= 原 bug：点击无响应）—— T3b
//  4. href 映射错：todo 类 → /app/todo/<entityId>，chief_message → /app?chief=<entityId>—— T3b
//  5. SW 不可用/就绪超时后通知整个丢失（无回退）—— T3a
//  6. 回退通知点击不跳转（onclick 未接）—— T3a
//  7. 快路径路由后 pending-nav 槽残留，下次冷启动误跳—— T1
//  8. wake 消费路径（openWindow 落地页 consumePendingNav）不收敛—— T2
//  9. chief 深链参数不被消费：drawer 不开 / 开错线程 / 参数残留 URL—— T4
// 10. chief 深链指向不存在的线程：必须安静降级（不开 drawer、参数照清、不崩）—— T4
// 11. 帐号开关关档（#1031 本地偏好覆盖 cairn.notifyEnabled=0）不落到通知
//     本体：权限 granted + 偏好 off 时 SSE 通知照弹 —— T5

const TEAM = { id: 't1', name: '团队' };
const USER = { id: 'u1', displayName: '我', avatarUrl: null };

/** 线程乙是深链目标；列表序 = 新在前（乙后建排前）。 */
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

/** window 侧观测槽的类型声明（init script 写入）。 */
declare global {
  interface Window {
    __es: { url: string; readyState: number; emit: (ev: unknown) => void }[];
    __swNotifs: { title: string; options: { body?: string; tag?: string; data?: unknown } }[];
    __pageNotifs: { title: string; options: unknown; onclick: (() => void) | null }[];
    __stay?: string;
  }
}

/** 替身 EventSource：sse-connection 的 connect() 只消费 constructor(url) /
 *  onopen / onmessage / readyState / close() + 静态 OPEN。实例全部登记在
 *  window.__es，测试用 emit() 直接推业务帧（不经网络）。 */
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

/** Notification 桩：permission 恒 granted（fireDesktopNotification 的闸门
 *  输入）；构造器计数进 __pageNotifs——SW 路径不得触它（T3b 断言 0），回退
 *  路径必须触它且挂 onclick（T3a 断言 1）。 */
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

/** 钉死「页面在后台」输入（fireDesktopNotification 只读 document.hidden；
 *  可见性本身不是被测单元）。 */
function hideDocument(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true });
  });
}

/** 包 showNotification 为纯观测（不真弹 OS 通知）：调用参数进 __swNotifs。 */
function spySwShowNotification(page: Page) {
  return page.addInitScript(() => {
    window.__swNotifs = [];
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      window.__swNotifs.push({ title, options: options ?? {} });
      return Promise.resolve();
    };
  });
}

/** live 面 API mock（无 scenario 参 = live 模式）。未覆盖的路径 418 +
 *  {error}，react-query retry:1 落定后安静失败——断言面（drawer/URL）不吃
 *  这些查询。 */
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

/** 等 SW active 并返回 Playwright 的 worker 句柄。 */
async function activeSw(context: BrowserContext, page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => context.serviceWorkers().length).toBe(1);
  return context.serviceWorkers()[0];
}

/** 合成 notificationclick 不带 Chromium 的用户激活信任位：WindowClient.focus()
 *  与 Clients.openWindow() 两个平台原语会被拒（InvalidAccessError）。这两个
 *  不是被测单元（冻结 sw.js 调它们、Chromium 兑现它们），打桩成可观测：
 *  focus 计数、openWindow 记录目标 URL 后 resolve null。被测的仍是自家接线
 *  ——href 映射、postMessage 路由、pending 槽存取。 */
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

/** 在 SW 全局里合成一次 notificationclick（冻结 sw.js 的真 handler 全程
 *  处理：notification 载荷以子类 getter 挂入，不靠宿主对象 expando）。 */
async function dispatchNotificationClick(
  worker: { evaluate: (fn: (href: string) => void, arg: string) => Promise<unknown> },
  href: string,
) {
  await worker.evaluate((h) => {
    class FakeClick extends ExtendableEvent {
      // declare 字段：esbuild 转译的 #private 形态在 evaluate 序列化后缺 helper。
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

/** 推一条 SSE notification 帧到 team stream。 */
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

test.describe('推送通知点击闭环（XMON-106）', () => {
  test('T1: 已开窗口点击 → 客户端路由到 href 且不整页重载，pending 槽被清', async ({
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
    // 客户端路由证据：页面标记仍在（无整页重载）。
    expect(await page.evaluate(() => window.__stay)).toBe('no-reload');
    // 既有窗口被聚焦（focus 原语的调用计数）。
    expect(await worker.evaluate(() => (self as unknown as Record<string, unknown>).__focused)).toBe(
      1,
    );
    // 快路径路由后 pending-nav 槽必须清掉——否则下次冷启动误跳旧 href。
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open('nav');
          return (await cache.match('/__pending-nav')) === undefined;
        }),
      )
      .toBe(true);
  });

  test('T2: 无已开窗口点击 → openWindow(href) + pending 槽交接，落地页消费路由', async ({
    page,
    context,
  }) => {
    await page.goto('/app?scenario=01');
    await expect(page.locator('[data-route="board"]')).toBeVisible();
    const worker = await activeSw(context, page);
    await patchWindowPrimitives(worker);

    // data: URL = 不透明源，恒不在 SW 的 window client 集里（模拟「窗口未开」）。
    await page.goto('data:text/html,<p>gone</p>');
    await dispatchNotificationClick(worker, DETAIL_HREF);

    // 无窗口可走 → handler 调 openWindow(href) 新开（合成事件下 Chromium 拒绝
    // 真开窗，桩记录目标 URL 钉住意图），pending 槽先行落盘。
    await expect
      .poll(() => worker.evaluate(() => (self as unknown as Record<string, unknown>).__opened))
      .toEqual([DETAIL_HREF]);

    // wake 消费路径：任一冷启动页面落地即拉槽路由并删槽（iOS 挂起页同一份收敛）。
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

  test('T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用）', async ({
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
    // build_review：标题 canon + body = `#seq title` + href 直指 todo 详情。
    expect(calls[0].title).toBe('构建待审核');
    expect(calls[0].options.body).toBe('#42 修一下按钮');
    expect(calls[0].options.tag).toBe('u1:todo-x');
    expect(calls[0].options.data).toEqual({ href: '/app/todo/todo-x' });
    // plan_ready：标题 canon，href 同律。
    expect(calls[1].title).toBe('方案已就绪');
    expect(calls[1].options.data).toEqual({ href: '/app/todo/todo-def' });
    // chief_message：标题 = 线程题、body = 消息全文、href = 看板 chief 深链。
    expect(calls[2].title).toBe('线程主题');
    expect(calls[2].options.body).toBe('消息全文');
    expect(calls[2].options.data).toEqual({ href: '/app?chief=chief-xyz' });
    // 页内 new Notification 恒零调用——通知本体必须走 SW（原 bug 的反向钉）。
    expect(await page.evaluate(() => window.__pageNotifs.length)).toBe(0);
  });

  test('T3a: SW 注册失败 → 回退页内 Notification，onclick 整页跳 href', async ({
    page,
    context,
  }) => {
    // 掐掉 sw.js → registration reject → navigator.serviceWorker.ready 永不
    // resolve → 就绪超时后走回退（真浏览器，无属性手术）。
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
      // 函数过不了 evaluate 序列化——onclick 在页面侧读 typeof。
      return { title: n.title, onclickType: typeof n.onclick };
    });
    expect(fallen.title).toBe('构建待审核');
    expect(fallen.onclickType).toBe('function');

    await page.evaluate(() => window.__pageNotifs[0].onclick?.());
    await page.waitForURL('**/app/todo/todo-fb');
  });

  test('T4: chief 深链 → drawer 开在目标线程，参数一次性消费后从 URL 剥离', async ({ page }) => {
    await stubEventSource(page);
    await mockLiveApi(page);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    // #950 载体：.chief-chip-title → 主题 chip 钮（aria-label 主题）内唯一 span。
    const chip = drawer.getByRole('button', { name: '主题', exact: true });
    await expect(chip.locator('span')).toHaveText('线程乙');
    // 参数已剥离（replace，不积历史），其余面不受影响。
    await expect.poll(() => page.url()).not.toContain('chief=');
    expect(page.url()).toContain('/app');
  });

  test('T4b: chief 深链指向不存在的线程 → 不开 drawer、参数照清', async ({ page }) => {
    await stubEventSource(page);
    await mockLiveApi(page);
    await page.goto('/app?chief=chief-zzz');

    await expect.poll(() => page.url()).not.toContain('chief=');
    // #1009 A0（ADR 0013 D6）：悬浮窗是根 host 常驻单实例——「不开窗」的
    // 载体从 count-0 翻成 hidden + count-1（关 = 在 DOM 但 inert）。
    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toHaveCount(1);
    await expect(drawer).toBeHidden();
    // 看板本体照常渲染（安静降级，不崩）。
    await expect(page.locator('[data-route="board"]')).toBeVisible();
  });

  test('T5: 帐号开关关档（偏好覆盖）→ SSE 通知不弹；开回来即恢复（#1031）', async ({
    page,
  }) => {
    // 偏好 off 先落存储再进页面：fireDesktopNotification 的闸门读的就是
    // localStorage 的 cairn.notifyEnabled（帐号页开关「关」的落地面）。
    await page.addInitScript(() => localStorage.setItem('cairn.notifyEnabled', '0'));
    await stubNotification(page);
    await stubEventSource(page);
    await hideDocument(page);
    await spySwShowNotification(page);
    await mockLiveApi(page);
    await page.goto('/app');
    await expect(page.locator('[data-route="board"]')).toBeVisible();

    await fireTeamNotification(page, makeRecord({}));
    // 阴性断言不吃盲等：紧接着的阳性对照（偏好开回来 → 第二条必达）若链路
    // 断了会超时红；若抑制闸没生效，第一条会被记进 __swNotifs，终值 2 ≠ 1
    // 同样红——两个失败方向都收敛到同一条 poll。
    await page.evaluate(() => localStorage.setItem('cairn.notifyEnabled', '1'));
    await fireTeamNotification(page, makeRecord({ entityId: 'todo-y', id: 'u1:todo-y' }));
    await expect.poll(() => page.evaluate(() => window.__swNotifs.length)).toBe(1);
    expect(await page.evaluate(() => window.__swNotifs[0].options.data)).toEqual({
      href: '/app/todo/todo-y',
    });
    expect(await page.evaluate(() => window.__pageNotifs.length)).toBe(0);
  });
});
