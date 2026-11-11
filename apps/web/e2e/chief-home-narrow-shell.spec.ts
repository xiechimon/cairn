import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const tabs = (page: Page) => page.getByRole('navigation', { name: '对话、任务和成果' });
const tab = (page: Page, name: RegExp) => tabs(page).getByRole('link', { name });
const BADGE_BLUE = 'rgb(55, 109, 214)';
const top = (page: Page) => page.locator('[data-slot="narrow-top"]');
const box = async (page: Page, testId: string) => {
  const found = await page.getByTestId(testId).first().boundingBox();
  if (found === null) throw new Error(`${testId} has no box`);
  return found;
};
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
]) {
  test.describe(`narrow shell at ${viewport.width}`, () => {
    test.use({ viewport });

    test('floating top controls replace the header bar', async ({ page }) => {
      await page.goto(HOME);
      await expect(page.getByTestId('home-c-pane-buttons')).toHaveCount(0);
      const menu = await box(page, 'narrow-menu');
      expect(menu.width).toBe(46);
      expect(menu.height).toBe(46);
      expect(menu.x).toBe(16);
      const mark = page.locator('[data-slot="narrow-top"] [data-slot="status-mark-circle"]');
      const markBox = await mark.boundingBox();
      expect(markBox!.width).toBe(62);
      expect(Math.abs(markBox!.x + markBox!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
      expect(menu.y).toBe(12);
      const right = await box(page, 'tasks-toggle');
      expect(right.width).toBe(46);
      expect(right.height).toBe(46);
      expect(right.y).toBe(menu.y);
      expect(Math.round(viewport.width - right.x - right.width)).toBe(16);
      const radius = (testId: string) =>
        page.getByTestId(testId).first().evaluate((node) => getComputedStyle(node).borderRadius);
      expect(await radius('tasks-toggle')).toBe(await radius('narrow-menu'));
      const shadow = (testId: string) =>
        page.getByTestId(testId).first().evaluate((node) => getComputedStyle(node).boxShadow);
      expect(await shadow('tasks-toggle')).toBe(await shadow('narrow-menu'));
      expect(await shadow('machines-button')).toBe(await shadow('narrow-menu'));
      expect(
        await tabs(page).evaluate((node) => getComputedStyle(node).boxShadow),
      ).toBe(await shadow('narrow-menu'));
      await expect(page.getByTestId('tasks-toggle').getByTestId('tasks-badge')).toHaveText('3');
      expect(await overflow(page)).toBe(0);
    });

    test('count badges are the reference blue with a white digit, top and bottom', async ({
      page,
    }) => {
      await page.goto(HOME);
      for (const badge of [
        page.getByTestId('tasks-toggle').getByTestId('tasks-badge'),
        tabs(page).getByTestId('tasks-badge'),
      ]) {
        await expect(badge).toHaveCSS('background-color', BADGE_BLUE);
        await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)');
        const size = await badge.boundingBox();
        expect(size!.height).toBe(18);
      }
    });

    test('the top right holds only the tasks button: no avatar or account button', async ({
      page,
    }) => {
      await page.goto(HOME);
      await expect(page.getByTestId('tasks-toggle')).toHaveCount(1);
      await expect(top(page).getByRole('button')).toHaveCount(2);
      await expect(top(page).getByRole('button', { name: '账号' })).toHaveCount(0);
      await expect(top(page).locator('img')).toHaveCount(0);
      await expect(page.getByTestId('tasks-toggle')).toHaveAccessibleName('任务，3 件等你');
    });

    test('the status mark is a bare disc that carries its state in its name, with no label chip', async ({
      page,
    }) => {
      await page.goto(HOME);
      const mark = top(page).getByTestId('chief-status-mark');
      await expect(mark).toHaveAttribute('data-state', 'ask');
      await expect(page.getByTestId('chief-status-pill')).toHaveCount(0);
      await expect(mark.getByRole('img', { name: '等你确认' })).toBeVisible();
      const disc = await mark.locator('[data-slot="status-mark-circle"]').boundingBox();
      const menu = await box(page, 'narrow-menu');
      expect(disc!.y + disc!.height).toBeLessThanOrEqual(menu.y + menu.height + 10);
    });

    test('the tab bar switches panes instantly and keeps the URL of the desktop pane', async ({
      page,
    }) => {
      await page.goto(HOME);
      await expect(tab(page, /对话/)).toHaveAttribute('aria-current', 'page');
      await expect(tabs(page).getByTestId('tasks-badge')).toHaveText('3');
      await tab(page, /任务/).click();
      await expect(page).toHaveURL(/[?&]pane=tasks/);
      await expect(page.getByRole('complementary', { name: '任务' })).toBeVisible();
      await expect(page.getByTestId('tasks-toggle')).toHaveAttribute('aria-pressed', 'true');
      await tab(page, /成果/).click();
      await expect(page).toHaveURL(/[?&]pane=made/);
      await expect(page.getByRole('complementary', { name: '成果' })).toBeVisible();
      await expect(tab(page, /成果/)).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('tasks-toggle')).toHaveAttribute('aria-pressed', 'false');
      await page.getByTestId('machines-button').click();
      await expect(page).toHaveURL(/[?&]pane=machines/);
      await expect(page.getByRole('complementary', { name: '电脑' })).toBeVisible();
      await expect(page.getByTestId('machines-button')).toHaveAttribute('aria-pressed', 'true');
      await expect(tabs(page).locator('[aria-current="page"]')).toHaveCount(0);
      await tab(page, /对话/).click();
      await expect(page).not.toHaveURL(/pane=/);
      await expect(page.getByTestId('chief-composer-input')).toBeVisible();
      expect(await overflow(page)).toBe(0);
    });

    test('each panel fills the space between the top controls and the tab bar', async ({
      page,
    }) => {
      for (const [pane, name, closable] of [
        ['tasks', '任务', false],
        ['made', '成果', false],
        ['machines', '电脑', true],
      ] as const) {
        await page.goto(`${HOME}&pane=${pane}`);
        const panel = page.getByRole('complementary', { name });
        await expect(panel).toBeVisible();
        const head = await panel.locator('[data-panel-head]').boundingBox();
        const menu = await box(page, 'narrow-menu');
        expect(head!.y, pane).toBeGreaterThanOrEqual(menu.y + menu.height);
        const bar = await tabs(page).boundingBox();
        const contentBottom = await panel.evaluate(
          (node) =>
            node.getBoundingClientRect().bottom -
            Number.parseFloat(getComputedStyle(node).paddingBottom),
        );
        expect(contentBottom, pane).toBeLessThanOrEqual(bar!.y);
        await expect(panel.locator('[data-panel-close]')).toBeVisible({ visible: closable });
        expect(await overflow(page), pane).toBe(0);
      }
    });

    test('a deep link to a pane opens it as a tab', async ({ page }) => {
      await page.goto(`${HOME}&pane=made`);
      await expect(page.getByRole('complementary', { name: '成果' })).toBeVisible();
      await expect(tab(page, /成果/)).toHaveAttribute('aria-current', 'page');
    });

    test('the drawer pushes the conversation back as a card and closes on a tap or a swipe', async ({
      page,
    }) => {
      await page.goto(HOME);
      await page.getByTestId('narrow-menu').click();
      const drawer = page.getByRole('dialog', { name: '侧边栏' });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' })).toBeVisible();
      const row = await drawer.locator('[data-slot="sidebar-project-row"]').first().boundingBox();
      expect(row!.height).toBeGreaterThanOrEqual(44);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const sheet = document.querySelector('.board-sheet');
            return sheet === null ? '' : getComputedStyle(sheet).transform;
          }),
        )
        .not.toBe('none');
      await expect
        .poll(async () => (await page.locator('.board-sheet').boundingBox())!.x)
        .toBeGreaterThan(viewport.width * 0.8);
      await page.mouse.click(viewport.width - 10, viewport.height / 2);
      await expect(drawer).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(() => getComputedStyle(document.querySelector('.board-sheet')!).transform),
        )
        .toBe('none');
      await page.getByTestId('narrow-menu').click();
      await expect(drawer).toBeVisible();
      await page.evaluate(() => {
        const touch = (x: number) =>
          new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 300 });
        document.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(300)] }));
        document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(120)] }));
      });
      await expect(drawer).toBeHidden();
    });

    test('settings, language and activity stay reachable from the drawer footer', async ({
      page,
    }) => {
      await page.goto(HOME);
      await page.getByTestId('narrow-menu').click();
      const drawer = page.getByRole('dialog', { name: '侧边栏' });
      await expect(drawer.getByTestId('sidebar-activity')).toBeVisible();
      await expect(drawer.getByTestId('sidebar-settings')).toBeVisible();
      await drawer.getByTestId('sidebar-activity').click();
      await expect(page).toHaveURL(/\/app\/activity/);
      await page.goto(HOME);
      await page.getByTestId('narrow-menu').click();
      await page.getByRole('dialog', { name: '侧边栏' }).getByTestId('sidebar-settings').click();
      await expect(page).toHaveURL(/\/app\/settings/);
      await page.goto('/app/settings/account?scenario=home-c');
      await expect(page.getByRole('combobox', { name: '语言' })).toBeVisible();
    });

    test('the composer sits 20px above the tab bar', async ({ page }) => {
      await page.goto('/app?scenario=home-c-empty');
      const composer = await page.locator('.chief-composer').boundingBox();
      const bar = await tabs(page).boundingBox();
      expect(Math.round(bar!.y - (composer!.y + composer!.height))).toBe(20);
      expect(Math.round(viewport.height - bar!.y - bar!.height)).toBe(12);
    });

    test('the composer is one row and stays visible above the keyboard', async ({ page }) => {
      await page.goto('/app?scenario=home-c-empty');
      const input = page.getByTestId('chief-composer-input');
      const plus = page.locator('[data-testid="composer-plus"]:visible');
      const send = page.getByRole('button', { name: '发送' });
      const plusBox = await plus.boundingBox();
      const inputBox = await input.boundingBox();
      const sendBox = await send.boundingBox();
      expect(Math.abs(plusBox!.y + plusBox!.height / 2 - (sendBox!.y + sendBox!.height / 2))).toBeLessThanOrEqual(2);
      expect(plusBox!.x).toBeLessThan(inputBox!.x);
      expect(sendBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width - 1);
      expect(sendBox!.width).toBe(sendBox!.height);
      await plus.click();
      await expect(page.getByTestId('composer-context-meter')).toBeVisible();
      await page.keyboard.press('Escape');
      await input.click();
      await input.fill('看一下 relay 的进度');
      await page.setViewportSize({ width: viewport.width, height: 420 });
      await expect(tabs(page)).toHaveCount(0);
      await expect(input).toBeInViewport();
      const field = await input.boundingBox();
      expect(field!.y + field!.height).toBeLessThanOrEqual(420);
      await input.blur();
      await expect(tabs(page)).toBeVisible();
    });
  });
}

test('wide screens keep the header controls and draw no narrow chrome', async ({ page }) => {
  await page.goto(HOME);
  await expect(page.getByTestId('home-c-pane-buttons')).toBeVisible();
  await expect(page.getByTestId('narrow-menu')).toHaveCount(0);
  await expect(page.locator('[data-slot="phone-bar"]')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-narrow-chrome', '');
  await expect(
    page.getByTestId('home-c-pane-buttons').locator('[data-slot="needs-you-dot"]'),
  ).toHaveCSS('background-color', BADGE_BLUE);
});

test.describe('dark theme', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the count badge keeps the same blue and white digit', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-theme', 'dark'));
    await page.goto(HOME);
    const badge = tabs(page).getByTestId('tasks-badge');
    await expect(badge).toHaveCSS('background-color', BADGE_BLUE);
    await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)');
  });
});
