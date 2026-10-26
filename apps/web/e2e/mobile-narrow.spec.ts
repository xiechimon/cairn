import { expect, test, type Locator } from '@playwright/test';

const DETAIL_REVIEW = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';
const REVIEW_DIALOG = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=review-dialog-fanout';

for (const width of [360, 390]) {
  test.describe(`窄屏 ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
    });

    test('M1 看板：rail 侧栏 + 顶栏动作留在视口内 + 无页面级横滚', async ({ page }) => {
      await page.goto('/app');
      const rail = page.locator('.board-sidebar--collapsed');
      await expect(rail).toBeVisible();
      const railBox = (await rail.boundingBox()) as { width: number };
      expect(railBox.width, 'rail 宽度').toBeLessThanOrEqual(48);
      for (const name of ['筛选', '新任务']) {
        const box = (await page
          .getByRole('button', { name: new RegExp(name) })
          .first()
          .boundingBox()) as { x: number; width: number };
        expect(box.x + box.width, `${name} 右缘`).toBeLessThanOrEqual(width);
        expect(box.x, `${name} 左缘`).toBeGreaterThanOrEqual(0);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('M2 纸页：阅读列不裁切，栏内控件留在视口内', async ({ page }) => {
      await page.goto('/app/account');
      const editName = page.getByRole('button', { name: '编辑名称' });
      await expect(editName).toBeVisible();
      const box = (await editName.boundingBox()) as { x: number; width: number };
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('M3 详情：头按钮与 composer 控件触控区 ≥44px', async ({ page }) => {
      await page.goto(DETAIL_REVIEW);
      const headControls: Locator[] = [
        page.getByRole('link', { name: '返回' }),
        page.getByRole('button', { name: '更多' }),
        page.locator('.detail-head-action'),
      ];
      for (const control of headControls) {
        const box = (await control.boundingBox()) as { height: number };
        expect(box.height, `${control} 高度`).toBeGreaterThanOrEqual(44);
      }
      for (const cls of ['.composer-tool', '.composer-send']) {
        const box = (await page.locator(cls).first().boundingBox()) as { height: number };
        expect(box.height, `${cls} 高度`).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('M4 总管：FAB ≥44px，开窗可最小化收回', async ({ page }) => {
      await page.goto('/app');
      const fab = page.locator('.chief-fab');
      await expect(fab).toBeVisible();
      const fabBox = (await fab.boundingBox()) as { width: number; height: number };
      expect(fabBox.width).toBeGreaterThanOrEqual(44);
      expect(fabBox.height).toBeGreaterThanOrEqual(44);
      await fab.click();
      const drawer = page.locator('.chief-drawer');
      await expect(drawer).toBeVisible();
      const drawerBox = (await drawer.boundingBox()) as { x: number; width: number };
      expect(drawerBox.x).toBeGreaterThanOrEqual(0);
      expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: '最小化' }).click();
      await expect(drawer).toBeHidden();
      await expect(fab).toBeVisible();
    });

    test('M5 搜索面板：整面板留在视口内，Esc 可关', async ({ page }) => {
      await page.goto('/app');
      await page.keyboard.press('Control+k');
      const panel = page.locator('.search-panel');
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox()) as { x: number; width: number };
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });

    test('M6 弹层：AI 审核对话框在视口内可关', async ({ page }) => {
      await page.goto(REVIEW_DIALOG);
      const dialog = page.getByRole('dialog', { name: 'AI 审核' });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox()) as { x: number; width: number };
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: '取消' }).click();
      await expect(dialog).toBeHidden();
    });

    test('M8 paper pages keep a side gutter and visible names', async ({ page }) => {
      const pages = [
        '/app/account?scenario=13',
        '/app/resources/skills?scenario=skills-list',
        '/app/resources/mcp-servers?scenario=07',
        '/app/resources/machines?scenario=06',
        '/app/resources/providers?scenario=10',
        '/app/team?scenario=12',
        '/app?scenario=101',
      ];
      for (const url of pages) {
        await page.goto(url);
        await page.locator('.settings-card, [data-testid="team-agent-grid"], [data-testid="chief-settings-col"]').first().waitFor();
        const report = await page.evaluate(() => {
          const rail = document.querySelector('.board-sidebar--collapsed')?.getBoundingClientRect();
          const railRight = rail?.right ?? 0;
          const col = document.querySelector('[data-testid="page-col"], [data-testid="chief-settings-col"]');
          const problems: string[] = [];
          for (const el of col?.querySelectorAll('*') ?? []) {
            const box = el.getBoundingClientRect();
            if (box.width <= 1 && box.height <= 1) continue;
            if (getComputedStyle(el).visibility === 'hidden') continue;
            if (box.left < railRight + 12 - 0.5 || box.right > innerWidth - 12 + 0.5) {
              problems.push(`${el.className.toString().slice(0, 40)} ${Math.round(box.left)}-${Math.round(box.right)}`);
            }
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
            if (hasText && box.width < 1) problems.push(`zero-width text "${el.textContent?.trim()}"`);
          }
          return problems.slice(0, 3);
        });
        expect(report, url).toEqual([]);
      }
    });

    test('M7 审批弹层：合并对话框在视口内可关', async ({ page }) => {
      await page.goto(DETAIL_REVIEW);
      await page.locator('.detail-head-action').click();
      const dialog = page.getByRole('dialog', { name: '完成任务' });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox()) as {
        x: number;
        width: number;
        y: number;
        height: number;
      };
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  });
}
