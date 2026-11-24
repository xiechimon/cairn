import { expect, test, type Page } from '@playwright/test';
import { stubNotification } from './helpers.js';

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null, type: 'user' };
const SUB_ENDPOINT = 'https://push.test/sub-1';
const WEB_HINT = '需要你处理时提醒，不急的邮件定时汇总';
const DESKTOP_HINT = '任务需要你处理时，在系统通知中心提醒';
const LOCK_SCREEN = '开启锁屏推送';

interface PushStubOptions {
  subscribed?: boolean;
  readyHangs?: boolean;
}

export function stubPushManager(page: Page, options: PushStubOptions = {}): Promise<void> {
  return page.addInitScript(
    ({ endpoint, subscribed, readyHangs }) => {
      const holder = window as unknown as { __pushSub: unknown };
      const sub = {
        endpoint,
        toJSON: () => ({
          endpoint,
          keys: { p256dh: 'BP256dhKey', auth: 'authSecret' },
          expirationTime: null,
        }),
        unsubscribe: async () => {
          holder.__pushSub = null;
          return true;
        },
      };
      const registration = {
        pushManager: {
          getSubscription: async () => holder.__pushSub ?? null,
          subscribe: async () => {
            holder.__pushSub = sub;
            return sub;
          },
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          ready: readyHangs ? new Promise(() => {}) : Promise.resolve(registration),
          register: async () => registration,
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      });
      (window as unknown as { PushManager: unknown }).PushManager = class PushManager {};
      holder.__pushSub = subscribed ? sub : null;
    },
    {
      endpoint: SUB_ENDPOINT,
      subscribed: options.subscribed === true,
      readyHangs: options.readyHangs === true,
    },
  );
}

interface LiveOptions {
  pref?: '1' | '0';
  hold?: { POST?: boolean; DELETE?: boolean };
  fail?: { POST?: boolean; DELETE?: boolean };
}

async function mockLive(page: Page, options: LiveOptions = {}) {
  const log: string[] = [];
  const posts: unknown[] = [];
  const deletes: unknown[] = [];
  const held: Array<() => Promise<void>> = [];
  const fail = { POST: options.fail?.POST === true, DELETE: options.fail?.DELETE === true };
  const hold = { POST: options.hold?.POST === true, DELETE: options.hold?.DELETE === true };
  if (options.pref !== undefined) {
    await page.addInitScript((pref) => {
      if (sessionStorage.getItem('__prefSeeded') === null) {
        localStorage.setItem('cairn.notifyEnabled', pref);
        sessionStorage.setItem('__prefSeeded', '1');
      }
    }, options.pref);
  }
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/teams/team-1/push/key', (route) =>
    route.fulfill({ json: { publicKey: 'BPdGVzdA' } }),
  );
  await page.route('**/api/teams/team-1/push/subscriptions', (route) => {
    const method = route.request().method() === 'POST' ? 'POST' : 'DELETE';
    log.push(`${method} start`);
    (method === 'POST' ? posts : deletes).push(route.request().postDataJSON());
    const finish = () => {
      log.push(`${method} end`);
      if (fail[method]) return route.fulfill({ status: 500, json: { error: 'boom' } });
      return method === 'POST'
        ? route.fulfill({ json: { ok: true } })
        : route.fulfill({ status: 204 });
    };
    if (hold[method]) {
      held.push(finish);
      return;
    }
    return finish();
  });
  return {
    log,
    posts,
    deletes,
    fail,
    hold,
    release: async () => {
      for (const finish of held.splice(0)) await finish();
    },
    pref: () => page.evaluate(() => localStorage.getItem('cairn.notifyEnabled')),
    subscription: () =>
      page.evaluate(() => (window as unknown as { __pushSub: unknown }).__pushSub !== null),
  };
}

const pushSwitch = (page: Page) => page.getByRole('switch', { name: '推送通知', exact: true });

const STORED_COMBOS = [
  { pref: '1', subscribed: false, checked: 'true', action: 1 },
  { pref: '1', subscribed: true, checked: 'true', action: 0 },
  { pref: '0', subscribed: true, checked: 'true', action: 0 },
  { pref: '0', subscribed: false, checked: 'false', action: 0 },
] as const;

for (const combo of STORED_COMBOS) {
  test(`behavior 2: stored pref=${combo.pref} subscribed=${combo.subscribed} renders one switch and changes nothing until a press`, async ({
    page,
  }) => {
    await stubPushManager(page, { subscribed: combo.subscribed });
    await stubNotification(page, 'granted', 'granted');
    const live = await mockLive(page, { pref: combo.pref });
    await page.goto('/app/account');
    await expect(page.getByRole('switch')).toHaveCount(1);
    await expect(pushSwitch(page)).toHaveAttribute('aria-checked', combo.checked);
    await expect(page.getByRole('button', { name: LOCK_SCREEN })).toHaveCount(combo.action);
    expect(await live.pref()).toBe(combo.pref);
    expect(await live.subscription()).toBe(combo.subscribed);
    expect(live.log).toEqual([]);
  });
}

test('behavior 3: off writes the preference before the removal lands, then removes the subscription (W3/W4)', async ({
  page,
}) => {
  await stubPushManager(page, { subscribed: true });
  await stubNotification(page, 'granted', 'granted');
  const live = await mockLive(page, { pref: '1', hold: { DELETE: true } });
  await page.goto('/app/account');
  const sw = pushSwitch(page);
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => live.deletes.length).toBe(1);
  expect(await live.pref()).toBe('0');
  expect(live.log).toEqual(['DELETE start']);

  await live.release();
  await expect.poll(() => live.subscription()).toBe(false);
  expect(live.deletes[0]).toEqual({ endpoint: SUB_ENDPOINT });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('behavior 3: a failed removal puts the switch back on and says so', async ({ page }) => {
  await stubPushManager(page, { subscribed: true });
  await stubNotification(page, 'granted', 'granted');
  const live = await mockLive(page, { pref: '1', fail: { DELETE: true } });
  await page.goto('/app/account');
  const sw = pushSwitch(page);
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  await sw.click();
  await expect.poll(() => live.deletes.length).toBe(1);
  await expect(page.locator('[data-sonner-toast]').first()).toContainText('保存失败，请重试。');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await live.subscription()).toBe(true);
});

test('behavior 4: on writes the preference, asks permission once and subscribes this device (W1/W2)', async ({
  page,
}) => {
  await stubPushManager(page);
  await stubNotification(page, 'default', 'granted');
  const live = await mockLive(page, { pref: '0' });
  await page.goto('/app/account');
  const sw = pushSwitch(page);
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await live.pref()).toBe('1');
  await expect.poll(() => live.posts.length).toBe(1);
  expect(live.posts[0]).toEqual({
    endpoint: SUB_ENDPOINT,
    keys: { p256dh: 'BP256dhKey', auth: 'authSecret' },
  });
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);
  await expect(page.getByRole('button', { name: LOCK_SCREEN })).toHaveCount(0);
  await expect(sw).toHaveAttribute('aria-checked', 'true');
});

test('behavior 4: a failed subscribe keeps the switch on and offers the lock-screen action, which subscribes', async ({
  page,
}) => {
  await stubPushManager(page);
  await stubNotification(page, 'granted', 'granted');
  const live = await mockLive(page, { pref: '0', fail: { POST: true } });
  await page.goto('/app/account');
  const sw = pushSwitch(page);

  await sw.click();
  await expect.poll(() => live.posts.length).toBe(1);
  const action = page.getByRole('button', { name: LOCK_SCREEN });
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute('data-variant', 'outline');
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  live.fail.POST = false;
  await action.click();
  await expect.poll(() => live.posts.length).toBe(2);
  await expect(action).toHaveCount(0);
  await expect(sw).toHaveAttribute('aria-checked', 'true');
});

test('behavior 5: the Mac desktop shell shows one switch for Cairn alerts with no permission warning or lock-screen action', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { cairnDesktop: unknown }).cairnDesktop = { notify: { show: () => {} } };
  });
  await stubPushManager(page);
  await stubNotification(page, 'denied', 'denied');
  const live = await mockLive(page, { pref: '1' });
  await page.goto('/app/account');
  const sw = pushSwitch(page);
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(DESKTOP_HINT)).toBeVisible();
  await expect(page.locator('.account-notify-blocked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: LOCK_SCREEN })).toHaveCount(0);

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(await live.pref()).toBe('0');
  expect(live.log).toEqual([]);
});

test('behavior 5: a hung subscription lookup never hides or disables the switch', async ({ page }) => {
  await stubPushManager(page, { readyHangs: true });
  await stubNotification(page, 'granted', 'granted');
  const live = await mockLive(page);
  await page.goto('/app/account');
  const sw = pushSwitch(page);
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(sw).toBeEnabled();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(await live.pref()).toBe('0');
});

test('behavior 5: a browser without Web Push shows the same single switch', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
  });
  await stubNotification(page, 'granted', 'granted');
  const live = await mockLive(page, { pref: '1' });
  await page.goto('/app/account');
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: LOCK_SCREEN })).toHaveCount(0);
  await pushSwitch(page).click();
  await expect(pushSwitch(page)).toHaveAttribute('aria-checked', 'false');
  expect(await live.pref()).toBe('0');
});

test('behavior 6: the web row says when it alerts and that the rest arrives as an email digest', async ({
  page,
}) => {
  await stubPushManager(page, { subscribed: true });
  await stubNotification(page, 'granted', 'granted');
  await mockLive(page, { pref: '1' });
  await page.goto('/app/account');
  await expect(page.getByText(WEB_HINT)).toBeVisible();
  await expect(page.getByText(DESKTOP_HINT)).toHaveCount(0);
});

test('behavior 7: off pressed during a hung subscribe wins once the subscribe settles', async ({
  page,
}) => {
  await stubPushManager(page);
  await stubNotification(page, 'granted', 'granted');
  const live = await mockLive(page, { pref: '0', hold: { POST: true } });
  await page.goto('/app/account');
  const sw = pushSwitch(page);
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => live.posts.length).toBe(1);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(await live.pref()).toBe('0');
  expect(live.deletes).toHaveLength(0);

  await live.release();
  await expect.poll(() => live.log).toEqual(['POST start', 'POST end', 'DELETE start', 'DELETE end']);
  await expect.poll(() => live.subscription()).toBe(false);
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: LOCK_SCREEN })).toHaveCount(0);
  expect(await live.pref()).toBe('0');
});

test('fixture scenario renders one switch and no lock-screen action (W5)', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account?scenario=13');
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('button', { name: LOCK_SCREEN })).toHaveCount(0);
});
