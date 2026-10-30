import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const drawer = (page: Page) => page.locator('.chief-drawer');

const modelRow = (page: Page) => page.getByTestId('chief-model-row');

const modelName = (page: Page) => modelRow(page).locator('span').nth(2);

test.describe('chief drawer model row (#615)', () => {

  test('the model row is a read-only display of the bound Agent model (#1260)', async ({ page }) => {
    await page.goto('/app?view=board&scenario=111');
    await expect(drawer(page)).toBeVisible();
    const row = modelRow(page);
    await expect(row).toBeVisible();
    await expect(modelName(page)).toHaveText('claude-sonnet-5 · 默认');

    await expect(page.getByRole('button', { name: '总管主模型' })).toHaveCount(0);
    await row.click();
    await expect(page.getByRole('dialog', { name: '模型' })).toHaveCount(0);
    await expect(drawer(page)).toBeVisible();
  });

  test('the row is readable in both themes (#751 A same law)', async ({ page }) => {

    for (const theme of ['dark', 'light'] as const) {
      await page.goto('/app?view=board&scenario=111');
      await page.evaluate((t) => localStorage.setItem('cairn-theme', t), theme);
      await page.reload();
      await expect(drawer(page)).toBeVisible();
      const name = modelName(page);
      await expect(name).toBeVisible();
      const ratio = await name.evaluate((el) => {
        const lin = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        const lum = (rgb: number[]) =>
          0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
        const parse = (s: string) => {
          const m = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
          if (m) return [m[1], m[2], m[3]].map((v) => Number(v) * 255);
          return (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        };
        let bg = 'rgba(0, 0, 0, 0)';
        let node: Element | null = el;
        while (node != null && bg === 'rgba(0, 0, 0, 0)') {
          bg = getComputedStyle(node).backgroundColor;
          node = node.parentElement;
        }
        const [hi, lo] = [lum(parse(getComputedStyle(el).color)), lum(parse(bg))].sort(
          (a, b) => b - a,
        );
        return (hi + 0.05) / (lo + 0.05);
      });
      expect(ratio, `${theme} model-row contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the model row carries the runtime mark, not an agent avatar', async ({ page }) => {
    await page.goto('/app?view=board&scenario=fab-avatar');

    await page.locator('.chief-fab').click();
    await expect(drawer(page)).toBeVisible();
    await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const row = modelRow(page);
    await expect(row).toBeVisible();

    await expect(row.locator('span').first().locator('svg')).toHaveCount(1);
    await expect(row.locator('img')).toHaveCount(0);

    await page.goto('/app?view=board&scenario=100');
    await expect(drawer(page)).toBeVisible();
    await expect(modelRow(page)).toHaveCount(0);
    await expect(page.getByText('n/a', { exact: true })).toHaveCount(0);
  });

  test('message copy glyphs are clipboard buttons; no bare inert glyphs remain', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/app?view=board&scenario=114');
    await expect(drawer(page)).toBeVisible();

    const copy = page.getByTestId('chief-msg-tools').getByRole('button', { name: '复制' });
    await expect(copy).toBeVisible();
    await copy.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('CONTRIBUTING.md');

    // the foot copy wires the assistant text the same way
    const footCopy = page.getByTestId('chief-msg-foot').getByRole('button', { name: '复制' });
    await expect(footCopy).toBeVisible();
    await footCopy.click();
    const footClip = await page.evaluate(() => navigator.clipboard.readText());
    expect(footClip).toContain('已创建并派工');

    await expect(page.getByTestId('chief-msg-tools').getByRole('button')).toHaveCount(2);
    await expect(page.getByTestId('chief-msg-tools').locator('> svg')).toHaveCount(0);
    await expect(page.getByTestId('chief-msg-foot').locator('> svg')).toHaveCount(0);
  });

  test('restore button opens the rewind confirm; the foot chevron discloses tool rows', async ({
    page,
  }) => {
    await page.goto('/app?view=board&scenario=114');
    await expect(drawer(page)).toBeVisible();

    const restore = page
      .getByTestId('chief-msg-tools')
      .getByRole('button', { name: '恢复到此处' });
    await expect(restore).toBeVisible();
    await restore.first().click();

    const confirm = page.getByRole('dialog', { name: '恢复到此处' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('恢复到此处？');

    await confirm.getByRole('button', { name: '恢复到此处' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('chief-msg')).toHaveCount(2);

    const foot = page.getByTestId('chief-msg-foot');
    const fold = foot.getByRole('button', { name: '展开过程' });
    await expect(fold).toBeVisible();
    await expect(page.getByTestId('chief-turn-tools')).toHaveCount(0);
    await fold.click();
    const tools = page.getByTestId('chief-turn-tools');
    await expect(tools).toBeVisible();
    await expect(tools.locator('[data-slot="trace-line"]')).toHaveCount(2);
    await expect(tools).toContainText('create_todo');

    await foot.getByRole('button', { name: '收起过程' }).click();
    await expect(tools).toHaveCount(0);
  });

  test('the gear reaches board settings from a wake surface', async ({ page }) => {
    await page.goto('/app/team?scenario=12');
    await page.locator('button[aria-label="总管"]').click();
    await expect(drawer(page)).toBeVisible();
    const gear = drawer(page).locator('button[aria-label="总管设置"]');
    await expect(gear).toBeVisible();

    await gear.click();
    // the deep-link param is consumed (stripped) once the view lands — the
    // stable contract is the settings view itself, not the URL mid-consumption
    await expect(page.getByRole('heading', { name: '总管设置' })).toBeVisible();
  });

});
