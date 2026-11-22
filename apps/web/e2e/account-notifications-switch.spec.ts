import { expect, type Page, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

const SUB_ENDPOINT = 'https://push.test/sub-1';

declare global {
  interface Window {
    __pushSub: unknown;
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
          window.__pushSub = null;
          return true;
        },
      };
      window.__pushSub = subscribed ? sub : null;
      window.__shown = [];
      const registration = {
        showNotification: async (title: string) => void window.__shown.push(title),
        pushManager: {
          getSubscription: async () => window.__pushSub ?? null,
          subscribe: async () => {
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
    page.getByText('可稍后处理的邮件通知并入简报，每日设两个发送时段', { exact: false }),
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
  expect(calls).toEqual([]);
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

test('legacy off still stops in-app notifications when the service worker never becomes ready', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false, false);
  await page.addInitScript(() => localStorage.setItem('cairn.notifyEnabled', '0'));
  await mockApi(page);
  await page.goto('/app/account');
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveAttribute('aria-checked', 'false');
});

test('off remains off when the service worker lookup expires', async ({ page }) => {
  await page.clock.install();
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, false, false);
  await mockApi(page);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await page.clock.runFor(10000);
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('cairn.notifications'))).toBe('0');
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
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => typeof window.__finishPermission)).toBe('function');
  await sw.click();
  await page.evaluate(() => window.__finishPermission?.());
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await notify(page, 'late-grant');
  await page.waitForTimeout(300);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.__shown)).toEqual([]);
});

test('turning off while a subscription is starting removes the resulting subscription', async ({ page }) => {
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
  await expect.poll(() => calls.map(({ method }) => method)).toEqual(['POST', 'DELETE']);
  await expect.poll(() => page.evaluate(() => window.__pushSub)).toBeNull();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('a failed DELETE restores the on state rather than claiming push stopped', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await stubDevice(page, true);
  await mockApi(page, (method) => method === 'DELETE' ? 500 : 200);
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(page.getByText('保存失败，请重试。')).toBeVisible();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__pushSub)).not.toBeNull();
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
  await expect.poll(() => calls.map(({ method }) => method)).toEqual(['DELETE']);
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
  await expect(page.getByText('保存失败，请重试。')).toBeVisible();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => window.__pushSub)).toBeNull();
});

test('desktop settings do not advertise a Web Push digest', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'cairnDesktop', { value: { notify: { show: () => {} } } });
  });
  await mockApi(page);
  await page.goto('/app/account');
  await expect(page.getByText('任务需要你处理时，在系统通知中心提醒', { exact: true })).toBeVisible();
  await expect(page.getByText('每日设两个发送时段', { exact: false })).toHaveCount(0);
});

test('fixture mode shows the single switch without touching device push', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account?scenario=13');
  await expect(page.getByRole('switch', { name: '推送通知' })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(1);
});
