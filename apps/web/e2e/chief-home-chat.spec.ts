import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

test.describe('home is one continuous Coordinator chat (T1)', () => {
  test('a fresh home shows the greeting, the composer and the running count, and no chief drawer', async ({
    page,
  }) => {
    await mockLive(page, { threads: [], messages: [] });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    await expect(page.getByTestId('home-c-hero')).toContainText('ian');
    await expect(page.getByTestId('home-c-since')).toContainText('1 件在进行');
    await expect(home.getByTestId('chief-composer-input')).toBeVisible();
    await expect(page.getByRole('button', { name: '总管', exact: true })).toHaveCount(0);
    await expect(page.locator('.chief-drawer')).toBeHidden();
    const composer = await home.locator('.chief-composer').boundingBox();
    const hero = await page.getByTestId('home-c-hero').boundingBox();
    const viewport = page.viewportSize();
    expect(composer && hero && viewport).toBeTruthy();
    if (composer && hero && viewport) {
      expect(composer.y + composer.height).toBeGreaterThan(viewport.height - 40);
      expect(hero.y).toBeLessThan(composer.y);
    }
    const input = home.getByTestId('chief-composer-input');
    await input.focus();
    await expect(input).not.toHaveCSS('box-shadow', /0px 0px 0px 3px/);
    await evidenceShot(page, 'home-hero.png');
  });

  test('the first send moves the composer to the bottom and the message joins the chat', async ({
    page,
  }) => {
    const sent = await mockLive(page, { threads: [], messages: [] });
    await page.goto('/app');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await input.fill('看板拖完卡片计数不对');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['看板拖完卡片计数不对']);
    const home = page.getByTestId('home-c');
    await expect(home.getByTestId('chief-stream')).toContainText('看板拖完卡片计数不对');
    await expect(page.getByTestId('home-c-hero')).toHaveCount(0);
    const composer = await home.locator('.chief-composer').boundingBox();
    const viewport = page.viewportSize();
    expect(composer).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (composer && viewport) expect(composer.y + composer.height).toBeGreaterThan(viewport.height - 40);
  });

  test('a first send that fails brings the greeting back and keeps the text', async ({ page }) => {
    const sent = await mockLive(page, { threads: [], messages: [], rejectSend: true });
    await page.goto('/app');
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await input.fill('看板拖完卡片计数不对');
    await input.press('Enter');
    await expect.poll(() => sent).toEqual(['看板拖完卡片计数不对']);
    await expect(page.getByTestId('home-c-hero')).toBeVisible();
    await expect(input).toHaveValue('看板拖完卡片计数不对');
  });

  test('a reply carries a live task chip, a hand-off row and an expandable trace; reload keeps it', async ({
    page,
  }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const stream = page.getByTestId('home-c').getByTestId('chief-stream');
    const chip = stream.locator('a.mention-chip--todo').first();
    await expect(chip).toHaveAttribute('data-phase', 'building');
    await expect(chip.getByRole('img', { name: '执行中' })).toBeVisible();
    const handoff = stream.getByTestId('chief-handoff');
    await expect(handoff).toContainText('已转给任务');
    await expect(handoff).toContainText('#9');
    const expand = stream.getByTestId('chief-tools-toggle').first();
    await expand.click();
    await expect(stream.getByTestId('chief-turn-tools').first()).toBeVisible();
    await evidenceShot(page, 'home-chat.png');
    await page.reload();
    await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toContainText(
      '已经补给它了',
    );
    await page.getByTestId('home-c').locator('a.mention-chip--todo').first().click();
    await expect(page).toHaveURL(/\/app\/todo\/todo-1/);
  });

  test('cmd+J on home focuses the home composer instead of opening the drawer', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
    await expect(page.locator('.chief-drawer')).toBeHidden();
  });

  test('the board view keeps the chief button and drawer', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app?view=board');
    await expect(page.getByTestId('home-c')).toHaveCount(0);
    await page.getByRole('button', { name: '总管', exact: true }).click();
    await expect(page.locator('.chief-drawer')).toBeVisible();
  });

  test('a task chip in the drawer opens the task page', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app?view=board');
    await page.getByRole('button', { name: '总管', exact: true }).click();
    const drawer = page.locator('.chief-drawer');
    await drawer.locator('a.mention-chip--todo').first().click();
    await expect(page).toHaveURL(/\/app\/todo\/todo-1/);
  });

  test('phone width: the chat fills the screen and the composer stays on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    const composer = page.getByTestId('home-c').locator('.chief-composer');
    await expect(composer).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await evidenceShot(page, 'home-chat-phone.png');
  });
});
