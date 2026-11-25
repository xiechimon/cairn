import { DESKTOP_SHELL_USER_AGENT } from '@cairn/shared';
import { expect, type Page, test } from '@playwright/test';

type Calls = { install: number; check: number };

async function fakeBridge(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Set<(state: unknown) => void>();
    const calls = { install: 0, check: 0 };
    const w = window as unknown as Record<string, unknown>;
    w.__updateCalls = calls;
    w.__emitUpdate = (state: unknown) => {
      for (const listener of listeners) listener(state);
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
      },
    };
  });
}

const emit = (page: Page, state: Record<string, unknown>) =>
  page.evaluate((s) => (window as unknown as { __emitUpdate: (s: unknown) => void }).__emitUpdate(s), state);
const calls = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __updateCalls: Calls }).__updateCalls }));

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
    expect(await calls(page)).toEqual({ install: 1, check: 0 });

    await emit(page, { status: 'downloading', version: '0.43.0', percent: 62.4 });
    await expect(glyph).toHaveAttribute('data-level', '62');
    await expect(update).toHaveAccessibleName('正在更新 62%');
    await expect(update).toHaveAttribute('aria-disabled', 'true');
    await expect(mark).toHaveCount(0);
    await page.mouse.move(0, 0);
    await update.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('正在更新 62%');
    await update.click({ force: true });
    expect(await calls(page)).toEqual({ install: 1, check: 0 });

    await emit(page, { status: 'ready', version: '0.43.0' });
    await expect(glyph).toHaveAttribute('data-level', '100');
    await expect(mark).toHaveCount(0);
    await expect(update).toHaveAccessibleName('离开时自动更新到 0.43.0');
    await update.click();
    expect(await calls(page)).toEqual({ install: 2, check: 0 });

    await emit(page, { status: 'installing', version: '0.43.0' });
    await expect(glyph).toHaveAttribute('data-level', '100');

    await emit(page, { status: 'offline' });
    await expect(glyph).toHaveAttribute('data-level', '0');
    await expect(mark).toHaveCount(0);
    await expect(update).toHaveAccessibleName('无法连接网络，未能检查更新');
    await update.click();
    expect(await calls(page)).toEqual({ install: 2, check: 1 });

    await emit(page, { status: 'error', message: '下载中断' });
    await expect(glyph).toHaveAttribute('data-level', '0');
    await expect(mark).toHaveAttribute('data-mark', 'failed');
    await update.click();
    expect(await calls(page)).toEqual({ install: 2, check: 2 });
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
});

test('in the browser the footer has no brand and no update button', async ({ page }) => {
  await page.goto('/app?scenario=providers-fleet');
  const footer = page.getByTestId('sidebar-footer');
  await expect(footer.getByTestId('sidebar-settings')).toBeVisible();
  await expect(footer.getByTestId('sidebar-footer-brand')).toBeHidden();
  await expect(footer.getByTestId('desktop-update')).toHaveCount(0);
});
