import { expect, test, type Page } from '@playwright/test';
import { stubNotification } from './helpers.js';

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null, type: 'user' };
const SUB_ENDPOINT = 'https://push.test/sub-1';

export function stubPushManager(page: Page): Promise<void> {
  return page.addInitScript(({ endpoint }) => {
    const sub = {
      endpoint,
      toJSON: () => ({
        endpoint,
        keys: { p256dh: 'BP256dhKey', auth: 'authSecret' },
        expirationTime: null,
      }),
      unsubscribe: async () => {
        (window as unknown as { __pushSub: unknown }).__pushSub = null;
        return true;
      },
    };
    const registration = {
      pushManager: {
        getSubscription: async () =>
          (window as unknown as { __pushSub: unknown }).__pushSub ?? null,
        subscribe: async () => {
          (window as unknown as { __pushSub: unknown }).__pushSub = sub;
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
    (window as unknown as { __pushSub: unknown }).__pushSub = null;
  }, { endpoint: SUB_ENDPOINT });
}

test('设备推送开关：打开 subscribe + 上行订阅，关闭退订 + 删除（W1–W4）', async ({ page }) => {
  await stubPushManager(page);
  await stubNotification(page, 'granted', 'granted');
  const posts: unknown[] = [];
  const deletes: unknown[] = [];
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/teams/team-1/push/key', (route) =>
    route.fulfill({ json: { publicKey: 'BPdGVzdA' } }),
  );
  await page.route('**/api/teams/team-1/push/subscriptions', (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    deletes.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });

  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '在这台设备上接收推送' });
  await expect(sw).toBeVisible();
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({
    endpoint: SUB_ENDPOINT,
    keys: { p256dh: 'BP256dhKey', auth: 'authSecret' },
  });
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  await sw.click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(deletes[0]).toEqual({ endpoint: SUB_ENDPOINT });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('fixture 场景模式不渲染设备推送开关（W5）', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account?scenario=13');
  await expect(
    page.getByRole('switch', { name: '在这台设备上接收推送' }),
  ).toHaveCount(0);
});
