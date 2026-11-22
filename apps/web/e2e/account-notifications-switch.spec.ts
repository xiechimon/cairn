import { expect, type Page, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

const SUB_ENDPOINT = 'https://push.test/sub-1';
const settingsStatus = (page: Page) => page.locator('.account-card').getByRole('status');
const retrySetting = (page: Page) => page.locator('.account-card').getByRole('button', { name: '重试' });

declare global {
  interface Window {
    __pushSub: unknown;
    __pushLookup: 'reject' | 'hang' | null;
    __lookupCalls: number;
    __subscribeFails: boolean;
    __unsubscribeFails: boolean;
    __shown: string[];
    __finishPermission: (() => void) | undefined;
    __teamStream: { emit: (ev: unknown) => void } | undefined;
  }
}

function stubDevice(page: Page, subscribed: boolean, ready = true): Promise<void> {
  return page.addInitScript(
    ({ endpoint, subscribed, ready }) => {
      const sub = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'BP256dhKey', auth: 'authSecret' } }),
        unsubscribe: async () => {
          if (window.__unsubscribeFails) throw new Error('unsubscribe rejected');
          window.__pushSub = null;
          return true;
        },
      };
      window.__pushSub = subscribed ? sub : null;
      window.__lookupCalls = 0;
      window.__shown = [];
      const registration = {
        showNotification: async (title: string) => void window.__shown.push(title),
        pushManager: {
          getSubscription: async () => {
            window.__lookupCalls++;
            if (window.__pushLookup === 'reject') throw new Error('lookup rejected');
            if (window.__pushLookup === 'hang') return new Promise(() => {});
            return window.__pushSub ?? null;
          },
          subscribe: async () => {
            if (window.__subscribeFails) throw new Error('subscribe rejected');
            window.__pushSub = sub;
            return sub;
          },
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          ready: ready ? Promise.resolve(registration) : new Promise(() => {}),
          register: async () => registration,
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      });
      (window as unknown as { PushManager: unknown }).PushManager = class PushManager {};
      Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true });
      class FakeEventSource {
        readyState = 1;
        onopen: (() => void) | null = null;
        onmessage: ((e: { data: string }) => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(readonly url: string) {
          if (url.includes('/stream')) window.__teamStream = this;
          queueMicrotask(() => this.onopen?.());
        }
        close() {}
        emit(ev: unknown) {
          this.onmessage?.({ data: JSON.stringify(ev) });
        }
        addEventListener() {}
        removeEventListener() {}
      }
      Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
    },
    { endpoint: SUB_ENDPOINT, subscribed, ready },
  );
}

async function mockApi(
  page: Page,
  subscriptionReply: (method: string) => number | Promise<number> = () => 200,
  beforeKey: () => void | Promise<void> = () => {},
) {
  const calls: { method: string; body: unknown }[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/teams') return route.fulfill({ json: [{ id: 't1', name: 'Team' }] });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'u1', displayName: '我', avatarUrl: null } });
    if (path === '/api/teams/t1/chief/threads' || path === '/api/todos' || path === '/api/projects') {
      return route.fulfill({ json: [] });
    }
    if (path === '/api/teams/t1/chief') {
      return route.fulfill({
        json: {
          chief: { id: 'chief-u1-t1', userId: 'u1', teamId: 't1', agent: null, lastTurnAt: null, createdAt: 0, tz: null },
          agentActor: null,
          context: null,
          watches: [],
          wakes: [],
        },
      });
    }
    if (path === '/api/teams/t1/push/key') {
      await beforeKey();
      return route.fulfill({ json: { publicKey: 'BPdGVzdA' } });
    }
    if (path === '/api/teams/t1/push/subscriptions') {
      const method = route.request().method();
      calls.push({ method, body: route.request().postDataJSON() });
      return route.fulfill({ status: await subscriptionReply(method), json: { ok: true } });
    }
    return route.fulfill({ status: 418, json: { error: `unmocked: ${path}` } });
  });
  return calls;
}

async function notify(page: Page, id: string) {
  await expect.poll(() => page.evaluate(() => window.__teamStream !== undefined)).toBe(true);
  await page.evaluate((entityId) => {
    window.__teamStream?.emit({
      type: 'notification',
      notification: {
        teamId: 't1',
        userId: 'u1',
        type: 'build_review',
        entityId,
        entityRef: { title: entityId, projectId: 'p1', seqNum: 1 },
        agent: { name: 'Builder', avatarUrl: null },
        snippet: null,
        id: `u1:${entityId}`,
        readAt: null,
        createdAt: 1,
        channels: ['in_app'],
      },
    });
  }, id);
}

test('one switch drives both the in-app notification and this device’s push subscription', async ({
  page,
}) => {
  await stubNotification(page, 'default', 'granted');
  await stubDevice(page, false);
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(
    page.getByText('需要你处理时提醒，不急的邮件定时汇总', { exact: true }),
  ).toBeVisible();

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => calls).toEqual([
    { method: 'POST', body: { endpoint: SUB_ENDPOINT, keys: { p256dh: 'BP256dhKey', auth: 'authSecret' } } },
  ]);
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);
  await notify(page, 'todo-on');
  await expect.poll(() => page.evaluate(() => window.__shown.length)).toBe(1);

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => calls.at(-1)).toEqual({ method: 'DELETE', body: { endpoint: SUB_ENDPOINT } });
  await expect.poll(() => page.evaluate(() => window.__pushSub)).toBeNull();
  await notify(page, 'todo-off');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__shown.length)).toBe(1);
});

test('an old in-app off with this device subscribed loads as on and keeps the subscription', async ({
  page,
}) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, true);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === null) {
      localStorage.setItem('cairn.notifyEnabled', '0');
      sessionStorage.setItem('seeded', '1');
    }
  });
  const calls = await mockApi(page);
  await page.goto('/app/account');
  await expect
    .poll(() => page.evaluate(() => [localStorage.getItem('cairn.notifications'), localStorage.getItem('cairn.notifyEnabled')]))
    .toEqual(['1', null]);
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(calls.map(({ method }) => method)).toEqual(['POST', 'POST']);
});

test('a rejected browser permission leaves the switch off and explains why', async ({ page }) => {
  await stubNotification(page, 'default', 'denied');
  await stubDevice(page, false);
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await sw.click();
  await expect(page.getByText('浏览器已拒绝通知权限，需到站点设置重新允许')).toBeVisible();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(calls).toEqual([]);
});

test('legacy off keeps in-app notifications quiet when startup cannot confirm push is off', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false, false);
  await page.addInitScript(() => localStorage.setItem('cairn.notifyEnabled', '0'));
  const calls = await mockApi(page);
  await page.goto('/app/account');
  await expect(page.getByText('未能关闭推送，请重试')).toBeVisible();
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveCount(0);
  await notify(page, 'legacy-off');
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.__shown)).toEqual([]);
});

test('blocked preference storage does not prevent requesting browser permission', async ({ page }) => {
  await stubNotification(page, 'default', 'granted');
  await stubDevice(page, false);
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'cairn.notifications') throw new Error('storage blocked');
      set.call(this, key, value);
    };
  });
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await sw.click();
  await expect.poll(() => page.evaluate(() => window.__permCalls)).toBe(1);
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => calls.map(({ method }) => method)).toEqual(['POST']);
});

test('a late permission grant cannot undo an explicit off', async ({ page }) => {
  await page.addInitScript(() => {
    let permission = 'default';
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        get permission() { return permission; },
        requestPermission: () => new Promise((resolve) => {
          window.__finishPermission = () => {
            permission = 'granted';
            resolve(permission);
          };
        }),
      },
    });
  });
  await stubDevice(page, false);
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await sw.click();
  await expect(sw).not.toBeChecked();
  await expect(sw).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => page.evaluate(() => typeof window.__finishPermission)).toBe('function');
  await sw.click();
  await page.evaluate(() => window.__finishPermission?.());
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await notify(page, 'late-grant');
  await page.waitForTimeout(300);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.__shown)).toEqual([]);
});

test('turning off while a subscription is starting prevents a superseded registration', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false);
  await page.addInitScript(() => localStorage.setItem('cairn.notifications', '0'));
  const keyRequested = Promise.withResolvers<void>();
  const key = Promise.withResolvers<void>();
  const calls = await mockApi(page, undefined, () => {
    keyRequested.resolve();
    return key.promise;
  });
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await sw.click();
  await keyRequested.promise;
  await sw.click();
  key.resolve();
  await expect(sw).not.toHaveAttribute('aria-busy', 'true');
  await expect(sw).not.toBeChecked();
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.__pushSub)).toBeNull();
});

test('rapid presses during a slow POST settle on the last requested position', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false);
  await page.addInitScript(() => localStorage.setItem('cairn.notifications', '0'));
  const posted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const calls = await mockApi(page, async (method) => {
    if (method === 'POST' && calls.length === 1) {
      posted.resolve();
      await release.promise;
    }
    return 200;
  });
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await posted.promise;
  await expect(sw).toHaveAttribute('aria-busy', 'true');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click({ position: { x: 16, y: 9 } });
  await sw.click({ position: { x: 17, y: 10 }, delay: 50 });
  release.resolve();
  await expect(sw).toBeChecked();
  expect(calls.every(({ method }) => method === 'POST')).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('cairn.notifications'))).toBe('1');
});

test('an unsupported browser does not display an inert push switch', async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(window, 'PushManager'));
  const calls = await mockApi(page);
  await page.goto('/app/account');
  await expect(settingsStatus(page)).toHaveText('此浏览器不支持推送通知');
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveCount(0);
  expect(calls).toEqual([]);
});

test('a failed DELETE hides the unverified position and retries disabling', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, true);
  let status = 500;
  const calls = await mockApi(page, (method) => method === 'DELETE' ? status : 200);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(page.getByText('未能关闭推送，请重试')).toBeVisible();
  await expect(sw).toHaveCount(0);
  expect(await page.evaluate(() => window.__pushSub)).not.toBeNull();
  status = 200;
  await retrySetting(page).click();
  await expect(sw).not.toBeChecked();
  expect(calls.map(({ method }) => method)).toEqual(['POST', 'DELETE', 'DELETE']);
});

test('revoking permission while settings are open updates the switch and drops device push', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, true);
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => {
    Object.defineProperty(Notification, 'permission', { value: 'denied' });
    window.dispatchEvent(new Event('focus'));
  });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => calls.map(({ method }) => method)).toEqual(['POST', 'DELETE']);
  await expect.poll(() => page.evaluate(() => window.__pushSub)).toBeNull();
});

test('the home banner enables both channels even after an explicit off', async ({ page }) => {
  await stubNotification(page, 'default', 'granted');
  await stubDevice(page, false);
  await page.addInitScript(() => localStorage.setItem('cairn.notifications', '0'));
  const calls = await mockApi(page);
  await page.goto('/app');
  const banner = page.getByRole('region', { name: '浏览器通知未开启' });
  await banner.getByRole('button', { name: '开启' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => calls.map(({ method }) => method)).toEqual(['POST']);
  expect(await page.evaluate(() => localStorage.getItem('cairn.notifications'))).toBe('1');
  await notify(page, 'banner-on');
  await expect.poll(() => page.evaluate(() => window.__shown.length)).toBe(1);
});

test('a failed POST cleans up the browser subscription and restores off', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false);
  await page.addInitScript(() => localStorage.setItem('cairn.notifications', '0'));
  await mockApi(page, (method) => method === 'POST' ? 500 : 200);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await sw.click();
  await expect(settingsStatus(page)).toHaveText('未能开启推送，请重试');
  await expect(sw).not.toBeChecked();
  expect(await page.evaluate(() => window.__pushSub)).toBeNull();
});

test('desktop settings do not advertise a Web Push digest', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'cairnDesktop', { value: { notify: { show: () => {} } } });
  });
  await mockApi(page);
  await page.goto('/app/account');
  await expect(page.getByText('任务需要你处理时，在系统通知中心提醒', { exact: true })).toBeVisible();
  await expect(page.getByText('需要你处理时提醒，不急的邮件定时汇总', { exact: true })).toHaveCount(0);
});

test('a timed-out off lookup does not claim push is off and offers to retry disabling', async ({ page }) => {
  await page.clock.install();
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, true);
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toBeChecked();
  const lookups = await page.evaluate(() => {
    window.__pushLookup = 'hang';
    return window.__lookupCalls;
  });
  await sw.click();
  await expect.poll(() => page.evaluate(() => window.__lookupCalls)).toBeGreaterThan(lookups);
  await page.clock.runFor(2500);
  await expect(page.getByText('未能关闭推送，请重试')).toBeVisible();
  expect(calls.some(({ method }) => method === 'DELETE')).toBe(false);
  expect(await page.evaluate(() => window.__pushSub)).not.toBeNull();
  await page.evaluate(() => { window.__pushLookup = null; });
  await retrySetting(page).click();
  await expect(sw).not.toBeChecked();
  expect(calls.at(-1)?.method).toBe('DELETE');
});

test('a rejected on lookup never checks the switch and can be retried', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false);
  await page.addInitScript(() => localStorage.setItem('cairn.notifications', '0'));
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).not.toBeChecked();
  await page.evaluate(() => { window.__pushLookup = 'reject'; });
  await sw.click();
  await expect(settingsStatus(page)).toHaveText('未能开启推送，请重试');
  expect(calls).toEqual([]);
  await page.evaluate(() => { window.__pushLookup = null; });
  await retrySetting(page).click();
  await expect(sw).toBeChecked();
  expect(calls.map(({ method }) => method)).toEqual(['POST']);
});

test('a subscribe rejection on startup is visible and retryable rather than on', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false);
  await page.addInitScript(() => {
    localStorage.setItem('cairn.notifications', '1');
    window.__subscribeFails = true;
  });
  const calls = await mockApi(page);
  await page.goto('/app/account');
  await expect(settingsStatus(page)).toHaveText('未能开启推送，请重试');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).not.toBeChecked();
  expect(calls).toEqual([]);
  await page.evaluate(() => { window.__subscribeFails = false; });
  await retrySetting(page).click();
  await expect(sw).toBeChecked();
  expect(calls.map(({ method }) => method)).toEqual(['POST']);
});

test('after DELETE succeeds, a rejected unsubscribe does not restore on', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, true);
  await page.addInitScript(() => { window.__unsubscribeFails = true; });
  const calls = await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect.poll(() => calls.at(-1)?.method).toBe('DELETE');
  await expect(page.getByText('未能关闭推送，请重试')).toBeVisible();
  await expect(sw).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('cairn.notifications'))).toBe('0');
  expect(await page.evaluate(() => window.__pushSub)).not.toBeNull();
  await sw.click();
  await expect(sw).toBeChecked();
  expect(calls.map(({ method }) => method)).toEqual(['POST', 'DELETE', 'POST']);
});

test('the Mac shell removes a stale Web Push subscription before using native notifications', async ({ page }) => {
  await stubDevice(page, true);
  await stubNotification(page, 'granted', 'granted');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'cairnDesktop', {
      value: { notify: { show: ({ title }: { title: string }) => window.__shown.push(title) } },
    });
  });
  const calls = await mockApi(page);
  await page.goto('/app/account');
  await expect.poll(() => calls.map(({ method }) => method)).toEqual(['DELETE']);
  await expect.poll(() => page.evaluate(() => window.__pushSub)).toBeNull();
  await expect(page.getByText('无法确认系统通知权限，请在系统设置中管理')).toBeVisible();
  await notify(page, 'native-only');
  await expect.poll(() => page.evaluate(() => window.__shown.length)).toBe(1);
});

test('a send-only native bridge does not claim macOS permission is granted', async ({ page }) => {
  await stubDevice(page, false);
  await stubNotification(page, 'denied', 'denied');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'cairnDesktop', { value: { notify: { show: () => {} } } });
  });
  await mockApi(page);
  await page.goto('/app/account');
  await expect(page.getByText('无法确认系统通知权限，请在系统设置中管理')).toBeVisible();
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveCount(0);
});

test('the banner retries a failed POST after browser permission has been granted', async ({ page }) => {
  await stubDevice(page, false);
  await stubNotification(page, 'default', 'granted');
  let status = 500;
  const calls = await mockApi(page, () => status);
  await page.goto('/app');
  const banner = page.getByRole('region', { name: '浏览器通知未开启' });
  await banner.getByRole('button', { name: '开启' }).click();
  await expect.poll(() => calls.length).toBe(1);
  await expect(banner.getByRole('button', { name: '重试' })).toBeVisible();
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  status = 200;
  await banner.getByRole('button', { name: '重试' }).click();
  await expect(banner).toHaveCount(0);
  expect(calls.map(({ method }) => method)).toEqual(['POST', 'POST']);
});

test('a waiting takeover stops offering push when the banner finishes enabling it', async ({ page }) => {
  await stubDevice(page, false);
  await stubNotification(page, 'default', 'granted');
  const key = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  const calls = await mockApi(page, undefined, () => {
    requested.resolve();
    return key.promise;
  });
  await page.route('**/api/teams/t1/chief/threads', (route) => route.fulfill({ json: [{ id: 'chief-one', title: '登录', updatedAt: 1 }] }));
  await page.route('**/api/conversations/chief-one/messages*', (route) => route.fulfill({ json: {
    messages: [{ id: 'm1', role: 'assistant', content: { kind: 'toolcall', call: { id: 'c-m1', name: 'request_takeover', arguments: { reason: '请登录' }, startedAt: Date.now() } }, createdAt: Date.now() }],
    nextCursor: null, chips: null, historyEpoch: 0, steerPending: [], activeRun: null,
  } }));
  await page.goto('/app');
  const card = page.getByTestId('chief-takeover');
  const enable = card.getByTestId('chief-takeover-push-on');
  await expect(enable).toBeVisible();
  const banner = page.getByRole('region', { name: '浏览器通知未开启' });
  await banner.getByRole('button', { name: '开启' }).click();
  await requested.promise;
  await expect(enable).toBeVisible();
  key.resolve();
  await expect.poll(() => calls.map(({ method }) => method)).toEqual(['POST']);
  await expect(enable).toHaveCount(0);
  await expect(card).toBeVisible();
});

test('fixture mode shows the single switch without touching device push', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account?scenario=13');
  await expect(page.getByRole('switch', { name: '推送通知' })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(1);
});
