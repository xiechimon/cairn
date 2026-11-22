import { expect, type Page, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

const SUB_ENDPOINT = 'https://push.test/sub-1';

declare global {
  interface Window {
    __pushSub: unknown;
    __shown: string[];
    __teamStream: { emit: (ev: unknown) => void } | undefined;
  }
}

function stubDevice(page: Page, subscribed: boolean): Promise<void> {
  return page.addInitScript(
    ({ endpoint, subscribed }) => {
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
          ready: Promise.resolve(registration),
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
    { endpoint: SUB_ENDPOINT, subscribed },
  );
}

async function mockApi(page: Page) {
  const calls: { method: string; body: unknown }[] = [];
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/teams') return route.fulfill({ json: [{ id: 't1', name: 'Team' }] });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'u1', displayName: '我', avatarUrl: null } });
    if (path === '/api/teams/t1/push/key') return route.fulfill({ json: { publicKey: 'BPdGVzdA' } });
    if (path === '/api/teams/t1/push/subscriptions') {
      calls.push({ method: route.request().method(), body: route.request().postDataJSON() });
      return route.fulfill({ json: { ok: true } });
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
  await page.reload();
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveAttribute('aria-checked', 'true');
  expect(calls).toEqual([]);
});

test('fixture mode shows the single switch without touching device push', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account?scenario=13');
  await expect(page.getByRole('switch', { name: '推送通知' })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(1);
});
