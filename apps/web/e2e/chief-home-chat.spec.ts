import { expect, test } from '@playwright/test';
import { HISTORY, mockLive, type Row, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';
import { openReplySteps, pressOpenCoordinator } from './helpers.js';

test.describe('home is one continuous Coordinator chat (T1)', () => {
  test('a fresh home shows the greeting, the composer and the running count, and no floating Coordinator', async ({
    page,
  }) => {
    await mockLive(page, { threads: [], messages: [] });
    await page.goto('/app');
    const home = page.getByTestId('home-c');
    await expect(page.getByTestId('home-c-hero')).toContainText('ian');
    await expect(page.getByTestId('home-c-since')).toContainText('1 件在进行');
    await expect(home.getByTestId('chief-composer-input')).toBeVisible();
    await expect(page.locator('.chief-fab')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Coordinator' })).toHaveCount(0);
    const composer = await home.getByTestId('chief-composer-block').boundingBox();
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
    const composer = await home.getByTestId('chief-composer-block').boundingBox();
    const viewport = page.viewportSize();
    expect(composer).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (composer && viewport) expect(composer.y + composer.height).toBeGreaterThan(viewport.height - 40);
  });

  test('the first send from home never brings the loading skeleton back, even when the messages arrive late', async ({
    page,
  }) => {
    const state = { threads: [] as (typeof THREAD)[], messages: [] as Row[] };
    await mockLive(page, state, (path, route, json) => {
      if (path !== `/api/conversations/${THREAD.id}/messages` || route.request().method() !== 'GET')
        return undefined;
      return new Promise<void>((resolve) =>
        setTimeout(() => void json({ messages: state.messages }).then(resolve), 400),
      );
    });
    await page.goto('/app');
    await expect(page.getByTestId('home-c-hero')).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { skeletonSeen: number }).skeletonSeen = 0;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="conversation-skeleton"]') !== null)
          (window as unknown as { skeletonSeen: number }).skeletonSeen += 1;
      }).observe(document.body, { childList: true, subtree: true });
    });
    const input = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await input.fill('看板拖完卡片计数不对');
    await input.press('Enter');
    await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toContainText(
      '看板拖完卡片计数不对',
    );
    expect(
      await page.evaluate(() => (window as unknown as { skeletonSeen: number }).skeletonSeen),
    ).toBe(0);
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
    const handoffLine = await handoff.evaluate((el) => ({
      align: getComputedStyle(el).textAlign,
      rule: getComputedStyle(el, '::before').content,
      chips: el.querySelectorAll('.mention-chip').length,
      leftGap:
        el.firstElementChild!.getBoundingClientRect().left - el.getBoundingClientRect().left,
    }));
    expect(handoffLine).toEqual({ align: 'left', rule: 'none', chips: 0, leftGap: 0 });
    await expect(handoff.getByRole('link', { name: '#9' })).toHaveAttribute('data-phase', 'building');
    await expect(stream.getByTestId('chief-turn-tools')).toHaveCount(0);
    await openReplySteps(page, stream.getByTestId('chief-msg').filter({ hasText: '已经补给它了' }));
    await expect(stream.getByTestId('chief-turn-tools').first()).toBeVisible();
    await evidenceShot(page, 'home-chat.png');
    await page.reload();
    await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toContainText(
      '已经补给它了',
    );
    await page.getByTestId('home-c').locator('a.mention-chip--todo').first().click();
    await expect(page).toHaveURL(/[?&]thread=todo-1/);
  });

  test('cmd+J on home focuses the home composer', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app');
    await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeFocused();
  });

  test('a page other than home has no Coordinator; cmd+J navigates to it', async ({ page }) => {
    await mockLive(page, { threads: [THREAD], messages: HISTORY });
    await page.goto('/app/schedules');
    await expect(page.getByTestId('home-c')).toHaveCount(0);
    await expect(page.getByTestId('chief-composer-input')).toHaveCount(0);
    await pressOpenCoordinator(page);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId('home-c').getByTestId('chief-stream')).toContainText(
      '已经补给它了',
    );
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

  test('switching from a project back to the Coordinator lands at the newest message', async ({
    page,
  }) => {
    const minute = 60_000;
    const long = '这一段写得足够长，好让整段对话超过一屏。'.repeat(6);
    const projectTurns: Row[] = Array.from({ length: 8 }, (_, i) => [
      { id: `pu${i}`, role: 'user', content: `cairn 第 ${i} 问`, createdAt: (1 + i * 2) * minute, projectId: 'proj-1' },
      { id: `pa${i}`, role: 'assistant', content: `cairn 第 ${i} 答。\n\n${long}`, createdAt: (2 + i * 2) * minute },
    ]).flat();
    const coordinatorTurns: Row[] = Array.from({ length: 30 }, (_, i) => [
      { id: `u${i}`, role: 'user', content: `第 ${i} 个问题`, createdAt: (20 + i * 2) * minute, projectId: null },
      {
        id: `a${i}`,
        role: 'assistant',
        content: `第 ${i} 个回答。\n\n${long}`,
        createdAt: (21 + i * 2) * minute,
      },
    ]).flat();
    await mockLive(page, { threads: [THREAD], messages: [...projectTurns, ...coordinatorTurns] });
    await page.goto('/app');
    const sidebar = page.locator('[data-slot="sidebar-nav-row"], [data-slot="sidebar-project-row"]');
    const newest = page.getByTestId('chief-stream').getByText('第 29 个回答');
    await expect(newest).toBeInViewport();
    await sidebar.filter({ hasText: 'cairn' }).click();
    await expect(page.getByTestId('chief-stream').getByText('cairn 第 7 答')).toBeInViewport();
    await page.getByTestId('chief-body').hover();
    await page.mouse.wheel(0, -400);
    await expect(page.getByTestId('jump-to-latest')).toHaveAttribute('data-active', 'true');
    await sidebar.filter({ hasText: 'Coordinator' }).click();
    await expect(newest).toBeInViewport();
    await expect(page.getByTestId('jump-to-latest')).toHaveAttribute('data-active', 'false');
  });
});
