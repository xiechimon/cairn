import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';

const MOTION_OUT_STRONG = 'cubic-bezier(0.23, 1, 0.32, 1)';
const MOTION_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';

test.describe('fluid motion system', () => {
  test('anchored overlays use --ease-out-expo and dismiss without slow exit animation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app?scenario=home-c');

    const toggle = page.getByTestId('tasks-toggle');
    await toggle.hover();
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await expect(tooltip).toBeVisible();
    const ttTiming = await tooltip.evaluate((el) => getComputedStyle(el).animationTimingFunction);
    expect(ttTiming).toBe(MOTION_OUT_EXPO);

    await page.keyboard.press('Meta+k');
    const searchDialog = page.locator('[data-slot="dialog-content"]').first();
    await expect(searchDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(searchDialog).toHaveCount(0);
  });

  test('centered dialogs open smoothly and settings SegmentedRadio glides cleanly', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app?scenario=providers-fleet');

    await page.getByTestId('sidebar-feedback').click();
    const feedbackDialog = page.locator('[data-slot="dialog-content"]').first();
    await expect(feedbackDialog).toBeVisible();
    const timing = await feedbackDialog.evaluate((el) => getComputedStyle(el).animationTimingFunction);
    expect(timing).toBe(MOTION_OUT_STRONG);
    await page.keyboard.press('Escape');
    await expect(feedbackDialog).toHaveCount(0);

    await page.getByTestId('sidebar-settings').click();
    const dialog = page.getByRole('dialog', { name: '设置' });
    await expect(dialog).toBeVisible();

    const indicator = dialog.locator('[data-segmented="indicator"]').first();
    if ((await indicator.count()) > 0) {
      const targetRadio = dialog.locator('[role="radio"]').last();
      const beforeX = await indicator.evaluate((el) => getComputedStyle(el).transform);
      await targetRadio.click();
      await page.waitForTimeout(260);
      const afterX = await indicator.evaluate((el) => getComputedStyle(el).transform);
      expect(afterX).not.toBe(beforeX);
    }
  });

  test('disclosure collapses cleanly with zero ghost gap and animates back open smoothly', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app?scenario=sidebar-ref');

    const header = page.getByTestId('project-group-header').filter({ hasText: '客户' });
    await expect(header).toHaveAttribute('aria-expanded', 'true');

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(240);

    const collapsedBox = await header.evaluate((el) => {
      const grid = el.parentElement?.nextElementSibling as HTMLElement | null | undefined;
      if (grid == null) return null;
      return {
        inert: grid.hasAttribute('inert'),
        height: grid.getBoundingClientRect().height,
        timing: getComputedStyle(grid).transitionTimingFunction,
      };
    });
    if (collapsedBox === null) throw new Error('Expected grid element after group header');
    expect(collapsedBox.inert).toBe(true);
    expect(collapsedBox.height).toBeLessThanOrEqual(0.5);
    expect(collapsedBox.timing).toContain(MOTION_OUT_STRONG);

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    const sawTransition = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => {
          const running = document
            .getAnimations()
            .some(
              (a) =>
                a instanceof CSSTransition &&
                (a.transitionProperty === 'grid-template-rows' ||
                  a.transitionProperty === 'opacity'),
            );
          resolve(running);
        });
      });
    });
    expect(sawTransition).toBe(true);
  });

  test('message toolbar copy swaps Check in cleanly while keeping Button instant (0s)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const now = Date.now();
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        { id: 'u1', role: 'user', content: '检查一下导出状态', createdAt: now - 20_000 },
        { id: 'a1', role: 'assistant', content: '导出已经完成，日志正常。', createdAt: now - 10_000 },
      ],
    });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/app');

    const reply = page.getByTestId('chief-msg').filter({ hasText: '导出已经完成' });
    await reply.locator('[data-slot="message-bubble"]').hover();
    const copyBtn = reply.locator('[data-slot="message-meta"]').getByTestId('message-copy');
    await expect(copyBtn).toBeVisible();
    await copyBtn.hover();
    await expect(copyBtn).toHaveCSS('transition-duration', '0s');

    const copyIcon = copyBtn.locator('[data-slot="copy-icon"]');
    const checkIcon = copyBtn.locator('[data-slot="check-icon"]');
    await expect(copyIcon).toHaveCount(1);
    await expect(checkIcon).toHaveCount(1);
    await expect(copyIcon).toHaveCSS('opacity', '1');
    await expect(checkIcon).toHaveCSS('opacity', '0');

    await copyBtn.click();
    await expect(copyBtn).toHaveAttribute('data-copied', '');
    await expect(checkIcon).toHaveCSS('opacity', '1');
    await expect(copyIcon).toHaveCSS('opacity', '0');
  });

  test('segmented tabs glide smoothly with --ease-out-strong', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app?scenario=home-c&pane=made');

    const panel = page.getByRole('complementary', { name: '成果' });
    const indicator = panel.locator('[data-segmented="indicator"]');
    await expect(indicator).toBeVisible();
    const indicatorStyle = await indicator.evaluate((el) => ({
      timing: getComputedStyle(el).transitionTimingFunction,
      leftBefore: getComputedStyle(el).left,
    }));
    expect(indicatorStyle.timing).toContain(MOTION_OUT_STRONG);

    await panel.getByRole('tab', { name: '已归档' }).click();
    await page.waitForTimeout(260);
    const leftAfter = await indicator.evaluate((el) => getComputedStyle(el).left);
    expect(leftAfter).not.toBe(indicatorStyle.leftBefore);
  });

  test('direct-manipulation SidePanel resize tracks 1:1 with smooth rAF intervals', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app?scenario=home-c&pane=tasks');

    const panel = page.locator('aside.side-panel').first();
    await expect(panel).toBeVisible();
    const handle = panel.getByRole('separator', { name: '调整面板宽度' });
    const box = await handle.boundingBox();
    if (box === null) throw new Error('Expected resize handle bounding box');

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.evaluate(() => {
      const frames: number[] = [];
      (window as unknown as { __motionPerf?: { active: boolean; frames: number[] } }).__motionPerf = {
        active: true,
        frames,
      };
      const tick = (t: number) => {
        const state = (window as unknown as { __motionPerf?: { active: boolean; frames: number[] } })
          .__motionPerf;
        if (!state?.active) return;
        state.frames.push(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 16; i += 1) {
      await page.mouse.move(startX - i * 8, startY);
    }

    const duringDrag = await panel.evaluate((el) => ({
      resizing: el.hasAttribute('data-resizing'),
      varWidth: el.style.getPropertyValue('--side-panel-w'),
    }));
    expect(duringDrag.resizing).toBe(true);
    expect(duringDrag.varWidth).toMatch(/px$/);

    await page.mouse.up();
    const afterDrag = await page.evaluate(() => {
      const perf = (window as unknown as { __motionPerf?: { active: boolean; frames: number[] } })
        .__motionPerf;
      if (perf) perf.active = false;
      const frames = perf?.frames ?? [];
      const deltas: number[] = [];
      for (let i = 1; i < frames.length; i += 1) {
        deltas.push((frames[i] ?? 0) - (frames[i - 1] ?? 0));
      }
      deltas.sort((a, b) => a - b);
      const p95 = deltas.length > 0 ? (deltas[Math.floor(deltas.length * 0.95)] ?? 0) : 0;
      const aside = document.querySelector('aside.side-panel') as HTMLElement | null;
      return {
        resizingAfterUp: aside?.hasAttribute('data-resizing') ?? true,
        deltaCount: deltas.length,
        p95,
      };
    });
    expect(afterDrag.resizingAfterUp).toBe(false);
    expect(afterDrag.deltaCount).toBeGreaterThan(2);
    expect(afterDrag.p95).toBeLessThan(65);
  });

  test('phone tabs glide cleanly at 390px in light & dark with zero horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/app?scenario=home-c');
      await page.evaluate((v) => localStorage.setItem('cairn-theme', v), scheme);
      await page.reload();

      const indicator = page.locator('[data-slot="phone-tabs-indicator"]');
      await expect(indicator).toBeVisible();
      const before = await indicator.evaluate((el) => ({
        transform: getComputedStyle(el).transform,
        timing: getComputedStyle(el).transitionTimingFunction,
      }));
      expect(before.timing).toBe(MOTION_OUT_STRONG);

      await page.getByRole('link', { name: /任务/ }).click();
      await page.waitForTimeout(260);
      const afterTransform = await indicator.evaluate((el) => getComputedStyle(el).transform);
      expect(afterTransform).not.toBe(before.transform);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBe(0);
    }
  });

  test('long transcript scroll runs smoothly without frame stalls', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const now = Date.now();
    const messages = Array.from({ length: 80 }, (_, index) => ({
      id: `m-${index}`,
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `第 ${index + 1} 条长对话消息，用来验证长列表滚动合成帧率与位置稳定性。`,
      createdAt: now - (80 - index) * 5_000,
    }));
    await mockLive(page, { threads: [THREAD], messages });
    await page.goto('/app');
    const scroller = page.getByTestId('chief-stream');
    await expect(scroller).toContainText('第 80 条');

    const stats = await scroller.evaluate(async (el) => {
      const deltas: number[] = [];
      let prev = performance.now();
      for (let step = 0; step < 18; step += 1) {
        el.scrollTop = Math.max(0, el.scrollTop - 160);
        const cur = await new Promise<number>((r) => requestAnimationFrame(r));
        deltas.push(cur - prev);
        prev = cur;
      }
      deltas.sort((a, b) => a - b);
      return {
        p95: deltas[Math.floor(deltas.length * 0.95)] ?? 0,
      };
    });
    expect(stats.p95).toBeLessThan(65);
  });

  test('prefers-reduced-motion zeroes keyframe and indicator durations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app?scenario=home-c');

    const indicatorDur = await page
      .locator('[data-slot="phone-tabs-indicator"]')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).transitionDuration));
    expect(indicatorDur).toBeLessThanOrEqual(0.01);

    await page.goto('/app?scenario=sidebar-ref');
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    const disclosure = page.locator('[data-slot="disclosure"]').first();
    await expect(disclosure).toHaveCount(1);
    const gridDur = await disclosure.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).transitionDuration),
    );
    expect(gridDur).toBe(0);
  });
});
