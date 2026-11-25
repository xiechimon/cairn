import { expect, type Page, test } from '@playwright/test';

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36 CairnDesktop/mac';

const TRAFFIC_LIGHT_ZONE = { x: 0, y: 0, width: 80, height: 32 };

function overlapsTrafficLights(box: { x: number; y: number; width: number; height: number }): boolean {
  const xOverlap = box.x < TRAFFIC_LIGHT_ZONE.x + TRAFFIC_LIGHT_ZONE.width && box.x + box.width > TRAFFIC_LIGHT_ZONE.x;
  const yOverlap = box.y < TRAFFIC_LIGHT_ZONE.y + TRAFFIC_LIGHT_ZONE.height && box.y + box.height > TRAFFIC_LIGHT_ZONE.y;
  return xOverlap && yOverlap;
}

async function expectClearsTrafficLights(page: Page, locator: ReturnType<Page['locator']>, label: string) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} must have a bounding box`).not.toBeNull();
  expect(overlapsTrafficLights(box!), `${label} (${JSON.stringify(box)}) overlaps traffic lights`).toBe(false);
}

test.describe('mac-desktop titlebar inset', () => {
  test.describe('windowed desktop shell', () => {
    test.use({ userAgent: DESKTOP_UA });

    for (const colorScheme of ['light', 'dark'] as const) {
      test(`narrow 760x850 (${colorScheme}): Settings title and close button clear traffic lights and drag region works`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width: 760, height: 850 });
        await page.goto('/app/settings?scenario=providers-fleet');

        await expect(page.locator('html')).toHaveAttribute('data-shell', 'mac-desktop');
        const header = page.getByTestId('settings-title');
        await expectClearsTrafficLights(page, header.locator('h1'), 'Settings title');
        await expectClearsTrafficLights(
          page,
          header.getByRole('button', { name: '关闭设置' }),
          'Settings close button',
        );

        const dragCheck = await header.evaluate((el) => {
          const dialog = el.closest('[role="dialog"]');
          const beforeStyle = dialog ? getComputedStyle(dialog, '::before') : null;
          const headerStyle = getComputedStyle(el);
          const closeBtn = el.querySelector('button');
          const closeStyle = closeBtn ? getComputedStyle(closeBtn) : null;
          return {
            beforeAppRegion: (beforeStyle as CSSStyleDeclaration & { webkitAppRegion?: string })?.webkitAppRegion,
            beforeHeight: beforeStyle ? Number.parseFloat(beforeStyle.height) : 0,
            headerAppRegion: (headerStyle as CSSStyleDeclaration & { webkitAppRegion?: string }).webkitAppRegion,
            closeAppRegion: (closeStyle as (CSSStyleDeclaration & { webkitAppRegion?: string }) | null)?.webkitAppRegion,
          };
        });
        expect(dragCheck.beforeAppRegion === 'drag' || dragCheck.headerAppRegion === 'drag').toBe(true);
        expect(dragCheck.closeAppRegion).toBe('no-drag');
      });
    }

    test('wide 1280x800: centered Settings modal has no extra top inset; sidebar clears traffic lights', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/app/settings?scenario=providers-fleet');

      const dialog = page.getByRole('dialog', { name: '设置' });
      const header = page.getByTestId('settings-title');
      await expect(header).toBeVisible();
      const [dialogBox, headerBox] = await Promise.all([dialog.boundingBox(), header.boundingBox()]);
      expect(dialogBox).not.toBeNull();
      expect(headerBox).not.toBeNull();
      expect(Math.abs(headerBox!.y - dialogBox!.y)).toBeLessThanOrEqual(2);

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      await expectClearsTrafficLights(
        page,
        page.locator('[data-testid="team-row"] button[aria-label="收起侧边栏"]'),
        'Sidebar collapse toggle',
      );
      await page.locator('[data-testid="team-row"] button[aria-label="收起侧边栏"]').click();
      await expectClearsTrafficLights(
        page,
        page.getByTestId('sidebar-reopen'),
        'Sidebar peek trigger',
      );
    });

    test('resizing across narrow/wide breakpoint while Settings is open toggles inset cleanly', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/app/settings/routing?scenario=providers-fleet');
      const dialog = page.getByRole('dialog', { name: '设置' });
      const header = page.getByTestId('settings-title');
      await expect(header).toBeVisible();

      const wideDialog = await dialog.boundingBox();
      const wideHeader = await header.boundingBox();
      expect(Math.abs(wideHeader!.y - wideDialog!.y)).toBeLessThanOrEqual(2);

      await page.setViewportSize({ width: 760, height: 850 });
      await expect(page.getByTestId('settings-tabs')).toBeVisible();
      await expectClearsTrafficLights(page, header.locator('h1'), 'Resized narrow Settings title');
      await expectClearsTrafficLights(
        page,
        header.getByRole('button', { name: '关闭设置' }),
        'Resized narrow Settings close button',
      );
      await expect(page).toHaveURL(/\/app\/settings\/routing\?/);

      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(page.getByTestId('settings-tabs')).toHaveCount(0);
      await expect
        .poll(async () => {
          const [d, h] = await Promise.all([dialog.boundingBox(), header.boundingBox()]);
          return d && h ? Math.abs(h.y - d.y) : 999;
        })
        .toBeLessThanOrEqual(2);
    });

    test('390x844 narrow viewport: Settings, RouteDialog, and NarrowTopControls clear traffic lights with no horizontal overflow', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/app/settings?scenario=providers-fleet');

      const header = page.getByTestId('settings-title');
      await expectClearsTrafficLights(page, header.locator('h1'), '390px Settings title');
      await expectClearsTrafficLights(
        page,
        header.getByRole('button', { name: '关闭设置' }),
        '390px Settings close button',
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
      const routeHead = page.getByTestId('route-dialog-head');
      await expectClearsTrafficLights(page, routeHead.locator('h2, [data-slot="dialog-title"]'), '390px RouteDialog title');
      await expectClearsTrafficLights(
        page,
        page.getByRole('dialog').getByRole('button', { name: '关闭' }),
        '390px RouteDialog close button',
      );

      await page.goto('/app?scenario=01');
      await expectClearsTrafficLights(
        page,
        page.getByTestId('narrow-menu'),
        '390px narrow menu button',
      );
    });
  });

  test.describe('fullscreen desktop shell', () => {
    test.use({ userAgent: DESKTOP_UA });

    test('fullscreen hides traffic lights and removes top/left inset dynamically', async ({ page }) => {
      await page.addInitScript(() => {
        let fullScreen = true;
        const listeners = new Set<(next: boolean) => void>();
        (
          window as Window & {
            __setMockFullScreen?: (next: boolean) => void;
            cairnDesktop?: Record<string, unknown>;
          }
        ).__setMockFullScreen = (next: boolean) => {
          fullScreen = next;
          for (const listener of listeners) listener(next);
        };
        (
          window as Window & {
            cairnDesktop?: Record<string, unknown>;
          }
        ).cairnDesktop = {
          shell: {
            isFullScreen: async () => fullScreen,
            onFullScreenChange: (listener: (next: boolean) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
        };
      });

      await page.setViewportSize({ width: 760, height: 850 });
      await page.goto('/app/settings?scenario=providers-fleet');

      await expect(page.locator('html')).toHaveAttribute('data-fullscreen', '');
      const header = page.getByTestId('settings-title');
      await expect
        .poll(async () => (await header.boundingBox())?.y ?? -1)
        .toBe(0);

      await page.evaluate(() => {
        (window as Window & { __setMockFullScreen?: (next: boolean) => void }).__setMockFullScreen?.(
          false,
        );
      });
      await expect(page.locator('html')).not.toHaveAttribute('data-fullscreen', '');
      await expectClearsTrafficLights(page, header.locator('h1'), 'Exited fullscreen Settings title');

      await page.evaluate(() => {
        (window as Window & { __setMockFullScreen?: (next: boolean) => void }).__setMockFullScreen?.(
          true,
        );
      });
      await expect(page.locator('html')).toHaveAttribute('data-fullscreen', '');
      await expect
        .poll(async () => (await header.boundingBox())?.y ?? -1)
        .toBe(0);

      await page.keyboard.press('Escape');
      const teamRowPadding = await page
        .getByTestId('team-row')
        .evaluate((el) => getComputedStyle(el).paddingLeft);
      expect(Number.parseFloat(teamRowPadding)).toBeLessThanOrEqual(4);
      await expect(page.locator('.sidebar-team-name')).toBeVisible();
    });
  });

  test.describe('web browser (!mac-desktop)', () => {
    test('760x850 web browser leaves Settings title flush at y=0', async ({ page }) => {
      await page.setViewportSize({ width: 760, height: 850 });
      await page.goto('/app/settings?scenario=providers-fleet');

      await expect(page.locator('html')).not.toHaveAttribute('data-shell', 'mac-desktop');
      const headerBox = await page.getByTestId('settings-title').boundingBox();
      expect(headerBox).not.toBeNull();
      expect(headerBox!.y).toBe(0);
    });
  });
});
