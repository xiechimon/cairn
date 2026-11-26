import { expect, type Page, test } from '@playwright/test';
import { mockLive, TEAM } from './chief-home-mock';

interface LocalStatus {
  installed: boolean;
  loggedIn: boolean;
  canLogin: boolean;
  runnerId?: string;
}

interface MachineStub {
  id: string;
  name: string;
  kind: 'local' | 'remote';
  online: boolean;
}

const LOCAL_MAC: MachineStub = {
  id: 'm-local',
  name: 'studioMac',
  kind: 'local',
  online: true,
};

const MAC_MINI: MachineStub = {
  id: 'm-mini',
  name: 'Studio-Mac-mini',
  kind: 'remote',
  online: true,
};

async function openDelayedDialog(
  page: Page,
  opts: {
    status: LocalStatus;
    delayMs?: number;
    machines?: MachineStub[];
    defaultMachineId?: string | null;
    reducedMotion?: 'reduce' | 'no-preference';
  },
) {
  const delayMs = opts.delayMs ?? 400;
  await page.emulateMedia({ reducedMotion: opts.reducedMotion ?? 'reduce' });
  await page.addInitScript(
    ({ status, delay }) => {
      const w = window as Window & {
        cairnDesktop?: unknown;
        __agyStatusResolved?: boolean;
        __releaseAgyStatus?: () => void;
      };
      w.__agyStatusResolved = false;
      const gate = new Promise<void>((resolve) => {
        w.__releaseAgyStatus = resolve;
      });
      w.cairnDesktop = {
        antigravity: {
          status: async () => {
            await Promise.all([new Promise((resolve) => setTimeout(resolve, delay)), gate]);
            w.__agyStatusResolved = true;
            return status;
          },
          import: async () => ({ ok: false, reason: 'no-key' }),
          signIn: async () => ({ ok: false, reason: 'cancelled' }),
          cancelLogin: async () => {},
        },
      };
    },
    { status: opts.status, delay: delayMs },
  );

  await mockLive(
    page,
    {
      threads: [],
      messages: [],
      ...(opts.machines !== undefined ? { machines: opts.machines } : {}),
    },
    (path, _route, json) => {
      if (path === '/api/teams') {
        return json([
          {
            ...TEAM,
            ...(opts.defaultMachineId !== undefined
              ? { defaultMachineId: opts.defaultMachineId }
              : {}),
          },
        ]);
      }
      if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
      if (path === '/api/teams/t1/antigravity-subscriptions') return json([]);
      return undefined;
    },
  );

  await page.goto('/app/settings/routing');
  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="antigravity-subscription"]').click();
  await page.mouse.move(0, 0);
  const dialog = page.getByRole('dialog', { name: '添加 Antigravity 订阅' });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((anim) => anim.finished)));
  return dialog;
}

function expectSameBox(
  before: { x: number; y: number; width: number; height: number } | null,
  after: { x: number; y: number; width: number; height: number } | null,
  label: string,
) {
  expect(before, `${label}: before box missing`).not.toBeNull();
  expect(after, `${label}: after box missing`).not.toBeNull();
  expect(Math.abs(after!.x - before!.x), `${label}: x shifted`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after!.y - before!.y), `${label}: y shifted`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after!.width - before!.width), `${label}: width shifted`).toBeLessThanOrEqual(
    0.5,
  );
  expect(Math.abs(after!.height - before!.height), `${label}: height shifted`).toBeLessThanOrEqual(
    0.5,
  );
}

function expectNoOverlap(
  upper: { y: number; height: number } | null,
  lower: { y: number; height: number } | null,
  label: string,
) {
  expect(upper, `${label}: upper box missing`).not.toBeNull();
  expect(lower, `${label}: lower box missing`).not.toBeNull();
  expect(
    upper!.y + upper!.height,
    `${label}: login row intersects hint text`,
  ).toBeLessThanOrEqual(lower!.y);
}

for (const viewport of [
  { name: '1440px', width: 1440, height: 732 },
  { name: '390px', width: 390, height: 844 },
]) {
  test(`C23/A4: login row holds its final shape at ${viewport.name} and never overlaps the hint @motion`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const dialog = await openDelayedDialog(page, {
      status: { installed: true, loggedIn: false, canLogin: true },
      delayMs: 400,
      machines: [LOCAL_MAC, MAC_MINI],
      defaultMachineId: MAC_MINI.id,
    });

    const resolvedBefore = await page.evaluate(
      () => (window as Window & { __agyStatusResolved?: boolean }).__agyStatusResolved,
    );
    expect(resolvedBefore).toBe(false);

    const row = dialog.getByTestId('antigravity-local-row');
    const hint = dialog.getByTestId('antigravity-local-hint');
    await expect(row).toBeVisible();
    await expect(hint).toHaveText('默认使用执行机上已登录的 Antigravity。');
    await expect(dialog.getByTestId('antigravity-paste-toggle')).toHaveText('改用 API key');
    await expect(dialog).not.toContainText('GEMINI_API_KEY');

    const beforeDialog = await dialog.boundingBox();
    const beforeRow = await row.boundingBox();
    const beforeHint = await hint.boundingBox();
    expect(beforeRow?.height ?? 0).toBeGreaterThan(0);
    expectNoOverlap(beforeRow, beforeHint, `first paint (${viewport.name})`);

    await page.evaluate(() =>
      (window as Window & { __releaseAgyStatus?: () => void }).__releaseAgyStatus?.(),
    );
    const loginButton = dialog.getByTestId('antigravity-local-login');
    await expect(loginButton).toBeVisible();
    await expect(loginButton).toHaveText('在 Studio-Mac-mini 上登录 Antigravity');
    await expect(dialog).not.toContainText('会打开浏览器');

    const afterDialog = await dialog.boundingBox();
    const afterRow = await row.boundingBox();
    const afterHint = await hint.boundingBox();

    expectSameBox(beforeRow, afterRow, `login row (${viewport.name})`);
    expectSameBox(beforeHint, afterHint, `hint (${viewport.name})`);
    expectSameBox(beforeDialog, afterDialog, `dialog (${viewport.name})`);
    expectNoOverlap(afterRow, afterHint, `settled (${viewport.name})`);

    const runningRowAnimations = await row.evaluate((el) =>
      [el, ...el.querySelectorAll('*')].flatMap((node) =>
        node.getAnimations().map((anim) => {
          if ('animationName' in anim) return `animation:${String(anim.animationName)}`;
          if ('transitionProperty' in anim) return `transition:${String(anim.transitionProperty)}`;
          return anim.id;
        }),
      ),
    );
    expect(runningRowAnimations).toEqual([]);

    if (viewport.width === 390) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
}

test('C23/A4: logged-in check resolution keeps the login row and hint in place', async ({
  page,
}) => {
  const dialog = await openDelayedDialog(page, {
    status: { installed: true, loggedIn: true, canLogin: true },
    delayMs: 400,
    machines: [LOCAL_MAC],
    defaultMachineId: LOCAL_MAC.id,
  });

  const row = dialog.getByTestId('antigravity-local-row');
  const hint = dialog.getByTestId('antigravity-local-hint');
  await expect(row).toBeVisible();
  await expect(hint).toHaveText('默认使用执行机上已登录的 Antigravity。');
  const beforeRow = await row.boundingBox();
  const beforeHint = await hint.boundingBox();

  await page.evaluate(() =>
    (window as Window & { __releaseAgyStatus?: () => void }).__releaseAgyStatus?.(),
  );
  const importButton = dialog.getByTestId('antigravity-local-import');
  await expect(importButton).toBeVisible();
  await expect(importButton).toHaveText('接入');
  await expect(row).toContainText('这台 Mac 已登录 Antigravity。');

  const afterRow = await row.boundingBox();
  const afterHint = await hint.boundingBox();
  expectSameBox(beforeRow, afterRow, 'logged-in row');
  expectSameBox(beforeHint, afterHint, 'logged-in hint');
  expectNoOverlap(afterRow, afterHint, 'logged-in settled');
});

test('says 这台 Mac only when the default runner is this computer, and handles a long runner name at 390px', async ({
  page,
}) => {
  const localDialog = await openDelayedDialog(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
    delayMs: 50,
    machines: [LOCAL_MAC, MAC_MINI],
    defaultMachineId: LOCAL_MAC.id,
  });
  await page.evaluate(() =>
    (window as Window & { __releaseAgyStatus?: () => void }).__releaseAgyStatus?.(),
  );
  await expect(localDialog.getByTestId('antigravity-local-login')).toHaveText(
    '在这台 Mac 上登录 Antigravity',
  );

  const longRunner: MachineStub = {
    id: 'm-long',
    name: 'engineering-build-mac-studio-01.internal.example.com',
    kind: 'remote',
    online: true,
  };
  await page.setViewportSize({ width: 390, height: 844 });
  const longDialog = await openDelayedDialog(page, {
    status: { installed: true, loggedIn: false, canLogin: true },
    delayMs: 50,
    machines: [LOCAL_MAC, longRunner],
    defaultMachineId: longRunner.id,
  });
  await page.evaluate(() =>
    (window as Window & { __releaseAgyStatus?: () => void }).__releaseAgyStatus?.(),
  );
  const button = longDialog.getByTestId('antigravity-local-login');
  await expect(button).toHaveText(
    '在 engineering-build-mac-studio-01.internal.example.com 上登录 Antigravity',
  );
  const rowBox = await longDialog.getByTestId('antigravity-local-row').boundingBox();
  const hintBox = await longDialog.getByTestId('antigravity-local-hint').boundingBox();
  expectNoOverlap(rowBox, hintBox, 'long runner name at 390px');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await longDialog.getByTestId('antigravity-paste-toggle').click();
  await expect(longDialog.getByLabel('GEMINI_API_KEY')).toBeVisible();
});
