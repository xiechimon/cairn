import { DESKTOP_SHELL_USER_AGENT } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';

type Calls = { install: number; check: number; remoteRetry: number };

async function fakeBridge(page: Page, initialRemoteState: Record<string, unknown> | null = null) {
  await page.addInitScript((remoteInitial) => {
    const listeners = new Set<(state: unknown) => void>();
    const remoteListeners = new Set<(state: unknown) => void>();
    const calls = { install: 0, check: 0, remoteRetry: 0 };
    const w = window as unknown as Record<string, unknown>;
    w.__updateCalls = calls;
    w.__emitUpdate = (state: unknown) => {
      for (const listener of listeners) listener(state);
    };
    w.__emitRemote = (state: unknown) => {
      for (const listener of remoteListeners) listener(state);
    };
    w.cairnDesktop = {
      update: {
        state: async () => ({ status: 'available', version: '0.43.0' }),
        check: async () => {
          calls.check += 1;
        },
        install: async () => {
          calls.install += 1;
        },
        subscribe: (listener: (state: unknown) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        ...(remoteInitial !== null
          ? {
              remoteState: async () => remoteInitial,
              retryRemote: async () => {
                calls.remoteRetry += 1;
              },
              subscribeRemote: (listener: (state: unknown) => void) => {
                remoteListeners.add(listener);
                return () => remoteListeners.delete(listener);
              },
            }
          : {}),
      },
    };
  }, initialRemoteState);
}

const emit = (page: Page, state: Record<string, unknown>) =>
  page.evaluate((s) => (window as unknown as { __emitUpdate: (s: unknown) => void }).__emitUpdate(s), state);
const emitRemote = (page: Page, state: Record<string, unknown>) =>
  page.evaluate((s) => (window as unknown as { __emitRemote: (s: unknown) => void }).__emitRemote(s), state);
const calls = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __updateCalls: Calls }).__updateCalls }));

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe('desktop shell', () => {
  test.use({ userAgent: `Mozilla/5.0 ${DESKTOP_SHELL_USER_AGENT}` });

  test('the footer shows the brand at the left and the update button before usage and settings', async ({
    page,
  }) => {
    await fakeBridge(page);
    await page.goto('/app?scenario=providers-fleet');
    const footer = page.getByTestId('sidebar-footer');
    const brand = footer.getByTestId('sidebar-footer-brand');
    await expect(brand).toBeVisible();
    await expect(brand).toHaveText('Cairn');
    const update = footer.getByTestId('desktop-update');
    await expect(update).toHaveAccessibleName('更新到 0.43.0');
    const x = async (id: string) => (await footer.getByTestId(id).boundingBox())?.x ?? -1;
    const brandX = (await brand.boundingBox())?.x ?? -1;
    expect(brandX).toBeLessThan(await x('desktop-update'));
    expect(await x('desktop-update')).toBeLessThan(await x('sidebar-usage'));
    expect(await x('sidebar-usage')).toBeLessThan(await x('sidebar-settings'));
  });

  test('the icon fills with the download and a click installs only when an update is available', async ({
    page,
  }) => {
    await fakeBridge(page);
    await page.goto('/app?scenario=providers-fleet');
    const update = page.getByTestId('desktop-update');
    const glyph = update.locator('svg');
    const mark = update.locator('[data-slot="update-mark"]');

    await expect(glyph).toHaveAttribute('data-level', '0');
    await expect(mark).toHaveAttribute('data-mark', 'waiting');
    await update.click();
    expect(await calls(page)).toEqual({ install: 1, check: 0, remoteRetry: 0 });

    await emit(page, { status: 'downloading', version: '0.43.0', percent: 62.4 });
    await expect(glyph).toHaveAttribute('data-level', '62');
    await expect(update).toHaveAccessibleName('正在更新 62%');
    await expect(update).toHaveAttribute('aria-disabled', 'true');
    await expect(mark).toHaveCount(0);
    await page.mouse.move(0, 0);
    await update.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('正在更新 62%');
    await update.click({ force: true });
    expect(await calls(page)).toEqual({ install: 1, check: 0, remoteRetry: 0 });

    await emit(page, { status: 'ready', version: '0.43.0' });
    await expect(glyph).toHaveAttribute('data-level', '100');
    await expect(mark).toHaveCount(0);
    await expect(update).toHaveAccessibleName('离开时自动更新到 0.43.0');
    await update.click();
    expect(await calls(page)).toEqual({ install: 2, check: 0, remoteRetry: 0 });

    await emit(page, { status: 'installing', version: '0.43.0' });
    await expect(glyph).toHaveAttribute('data-level', '100');

    await emit(page, { status: 'offline' });
    await expect(glyph).toHaveAttribute('data-level', '0');
    await expect(mark).toHaveCount(0);
    await expect(update).toHaveAccessibleName('无法连接网络，未能检查更新');
    await update.click();
    expect(await calls(page)).toEqual({ install: 2, check: 1, remoteRetry: 0 });

    await emit(page, { status: 'error', message: '下载中断' });
    await expect(glyph).toHaveAttribute('data-level', '0');
    await expect(mark).toHaveAttribute('data-mark', 'failed');
    await update.click();
    expect(await calls(page)).toEqual({ install: 2, check: 2, remoteRetry: 0 });
  });

  test('an install refusal answers immediately with error state and reason', async ({ page }) => {
    await page.addInitScript(() => {
      const listeners = new Set<(state: unknown) => void>();
      const w = window as unknown as Record<string, unknown>;
      w.cairnDesktop = {
        update: {
          state: async () => ({ status: 'ready', version: '0.43.0' }),
          check: async () => {},
          install: async () => ({
            ok: false,
            reason: 'the staged update is not signed by the Cairn certificate',
          }),
          subscribe: (listener: (state: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      };
    });
    await page.goto('/app?scenario=providers-fleet');
    const update = page.getByTestId('desktop-update');
    await expect(update).toHaveAttribute('data-status', 'ready');
    await update.click();
    await expect(update).toHaveAttribute('data-status', 'error');
    await expect(update).toHaveAttribute(
      'title',
      'the staged update is not signed by the Cairn certificate',
    );
    await expect(page.getByText('更新包签名验证未通过，无法安装')).toBeVisible();
  });

  test('an unsupported desktop update still answers with the blocker hint on click', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const calls = { install: 0, check: 0 };
      const w = window as unknown as Record<string, unknown>;
      w.__updateCalls = calls;
      w.cairnDesktop = {
        update: {
          state: async () => ({ status: 'unsupported', blocker: 'not-in-applications' }),
          check: async () => {
            calls.check += 1;
          },
          install: async () => {
            calls.install += 1;
          },
          subscribe: () => () => {},
        },
      };
    });
    await page.goto('/app?scenario=providers-fleet');
    const update = page.getByTestId('desktop-update');
    await expect(update).toHaveAttribute('data-status', 'unsupported');
    await expect(update).toHaveAttribute('aria-disabled', 'true');
    await update.click({ force: true });
    await expect(page.getByText('把 Cairn 移到「应用程序」后才能自动更新')).toBeVisible();
    expect(await calls(page)).toEqual({ install: 0, check: 0 });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`remote update bar never overlaps sidebar footer, composer, or desktop update button in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await fakeBridge(page, {
        phase: 'old-server',
        serverVersion: null,
        serverCommit: null,
        appVersion: '0.43.0',
        targetVersion: '0.43.0',
        updaterState: 'unsupported',
        percent: null,
        reason: 'no-updater',
      });
      await page.goto('/app?scenario=board-inbox');

      const bar = page.getByTestId('remote-update-bar');
      const footer = page.getByTestId('sidebar-footer');
      const update = footer.getByTestId('desktop-update');
      const settings = footer.getByTestId('sidebar-settings');
      const composer = page.locator('[data-testid="home-c"] .chief-composer');

      await expect(bar).toBeVisible();
      await expect(update).toBeVisible();
      await expect(composer).toBeVisible();

      for (const state of [
        { phase: 'old-server', serverVersion: null, serverCommit: null, updaterState: 'unsupported', percent: null, reason: 'no-updater' },
        { phase: 'unsupported', serverVersion: '0.42.0', serverCommit: 'abc1234', updaterState: 'unsupported', percent: null, reason: 'no-updater' },
        { phase: 'failed', serverVersion: '0.42.0', serverCommit: 'abc1234', updaterState: 'failed', percent: null, reason: 'offline' },
        { phase: 'updating', serverVersion: '0.42.0', serverCommit: 'abc1234', updaterState: 'downloading', percent: 45, reason: null },
      ]) {
        await emitRemote(page, { appVersion: '0.43.0', targetVersion: '0.43.0', ...state });
        await expect(bar).toBeVisible();

        const barBox = await bar.boundingBox();
        const footerBox = await footer.boundingBox();
        const updateBox = await update.boundingBox();
        const settingsBox = await settings.boundingBox();
        const composerBox = await composer.boundingBox();

        expect(barBox).not.toBeNull();
        expect(footerBox).not.toBeNull();
        expect(updateBox).not.toBeNull();
        expect(settingsBox).not.toBeNull();
        expect(composerBox).not.toBeNull();

        expect(boxesOverlap(barBox!, footerBox!)).toBe(false);
        expect(boxesOverlap(barBox!, updateBox!)).toBe(false);
        expect(boxesOverlap(barBox!, settingsBox!)).toBe(false);
        expect(boxesOverlap(barBox!, composerBox!)).toBe(false);
      }

      await emitRemote(page, {
        phase: 'old-server',
        serverVersion: null,
        serverCommit: null,
        appVersion: '0.43.0',
        targetVersion: '0.43.0',
        updaterState: 'unsupported',
        percent: null,
        reason: 'no-updater',
      });
      await update.click();
      expect((await calls(page)).install).toBe(1);

      const shot = testInfo.outputPath(`remote-update-bar-1440-${theme}.png`);
      await page.screenshot({ path: shot });
      await testInfo.attach(`remote-update-bar-1440-${theme}`, {
        path: shot,
        contentType: 'image/png',
      });

      await page.getByTestId('remote-update-action').click();
      expect((await calls(page)).remoteRetry).toBe(1);

      await settings.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }

  test('remote update bar stays below peek sidebar footer when sidebar is collapsed', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
    await fakeBridge(page, {
      phase: 'failed',
      serverVersion: '0.42.0',
      serverCommit: 'abc1234',
      appVersion: '0.43.0',
      targetVersion: '0.43.0',
      updaterState: 'failed',
      percent: null,
      reason: 'offline',
    });
    await page.goto('/app?scenario=board-inbox');

    const bar = page.getByTestId('remote-update-bar');
    await expect(bar).toBeVisible();
    await page.getByTestId('sidebar-reopen').hover();
    const peek = page.getByTestId('sidebar-peek');
    await expect(peek).toHaveAttribute('data-open', '');

    const update = peek.getByTestId('desktop-update');
    await expect(update).toBeVisible();
    const shot = testInfo.outputPath('remote-update-bar-peek-collapsed.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('remote-update-bar-peek-collapsed', {
      path: shot,
      contentType: 'image/png',
    });
    await update.click();
    expect((await calls(page)).install).toBe(1);
  });

  test('remote update bar does not overlap phone tabs or overflow on 390px narrow viewports', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fakeBridge(page, {
      phase: 'old-server',
      serverVersion: null,
      serverCommit: null,
      appVersion: '0.43.0',
      targetVersion: '0.43.0',
      updaterState: 'unsupported',
      percent: null,
      reason: 'no-updater',
    });
    await page.goto('/app?scenario=board-inbox');

    const bar = page.getByTestId('remote-update-bar');
    const phoneTabs = page.locator('[data-slot="phone-tabs"]');
    const composer = page.locator('[data-testid="home-c"] .chief-composer');

    await expect(bar).toBeVisible();
    await expect(phoneTabs).toBeVisible();
    await expect(composer).toBeVisible();

    const barBox = await bar.boundingBox();
    const tabsBox = await phoneTabs.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(barBox).not.toBeNull();
    expect(tabsBox).not.toBeNull();
    expect(composerBox).not.toBeNull();

    expect(boxesOverlap(barBox!, tabsBox!)).toBe(false);
    expect(boxesOverlap(barBox!, composerBox!)).toBe(false);
    expect(boxesOverlap(tabsBox!, composerBox!)).toBe(false);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);

    const shot = testInfo.outputPath('remote-update-bar-390.png');
    await page.screenshot({ path: shot });
    await testInfo.attach('remote-update-bar-390', { path: shot, contentType: 'image/png' });

    await page.getByTestId('remote-update-action').click();
    expect((await calls(page)).remoteRetry).toBe(1);
  });
});

test('in the browser the footer has no brand and no update button', async ({ page }) => {
  await page.goto('/app?scenario=providers-fleet');
  const footer = page.getByTestId('sidebar-footer');
  await expect(footer.getByTestId('sidebar-settings')).toBeVisible();
  await expect(footer.getByTestId('sidebar-footer-brand')).toBeHidden();
  await expect(footer.getByTestId('desktop-update')).toHaveCount(0);
});
