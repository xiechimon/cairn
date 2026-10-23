import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

// Issue #615/#1260 (总管抽屉 fixture 面回归): #1260 总管降级后模型行 =
// 绑定 Agent 自身模型的只读展示（chief 行 model/compaction/thinkingLevel
// 覆盖槽退役——改模型去 Agent 设置面）。本 spec 钉 fixture 面：
//   1. the model row is a read-only display: the bound Agent's model name +
//      runtime mark render, and no picker control / model popover exists
//      (the #615/#950 control carrier 总管主模型 retired with the slot).
//   2. the row stays readable in both themes (rendered-pair contrast).
//   3. the row carries the runtime mark (RuntimePi 块状 π / RuntimeClaudeCode
//      品牌星标), not an agent avatar; unbound keeps the plain n/a line.
//   4. the message-row copy glyphs are real clipboard buttons; 恢复 / foot
//      chevron had no backend and no local-first object face, so per the
//      #306/#146 二分律 they are gone, not inert.
//   5. the gear is reachable off-board: wake shells render it and it lands
//      on the board settings view via the ?chief=settings deep link.

const drawer = (page: Page) => page.locator('.chief-drawer');
// #1260: 模型行只读载体 = data-testid（行无 role 语义，aria 无处挂）。
const modelRow = (page: Page) => page.getByTestId('chief-model-row');
// 行内 span 序：0 = 包装 span，1 = 运行时 mark，2 = 模型名。
const modelName = (page: Page) => modelRow(page).locator('span').nth(2);

test.describe('chief drawer model row (#615)', () => {

  test('the model row is a read-only display of the bound Agent model (#1260)', async ({ page }) => {
    await page.goto('/app?scenario=111');
    await expect(drawer(page)).toBeVisible();
    const row = modelRow(page);
    await expect(row).toBeVisible();
    await expect(modelName(page)).toHaveText('claude-sonnet-5 · 默认');
    // 覆盖槽退役：行不是控制件——旧 #615/#950 载体（总管主模型钮）与
    // 模型 popover 均不存在；点行无任何开面。
    await expect(page.getByRole('button', { name: '总管主模型' })).toHaveCount(0);
    await row.click();
    await expect(page.getByRole('dialog', { name: '模型' })).toHaveCount(0);
    await expect(drawer(page)).toBeVisible();
  });

  test('the row is readable in both themes (#751 A 同律)', async ({ page }) => {
    // #751 A 同律：断渲染对（计算字色 × 实际背景），不断 CSS 值。行是
    // tertiary 12px 小字——AA 正文档 4.5:1 是地板。
    for (const theme of ['dark', 'light'] as const) {
      await page.goto('/app?scenario=111');
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
    await page.goto('/app?scenario=fab-avatar');
    // ADR 0013 D4：fab-avatar 捕获形 = 关窗态（FAB 头像面）——模型行面先开窗
    await page.locator('.chief-fab').click();
    await expect(drawer(page)).toBeVisible();
    await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const row = modelRow(page);
    await expect(row).toBeVisible();
    // #615 返工裁决：行首 = 运行时标记（fixture 未录 provider 位 = pi 正典
    // π 字形），不是 Agent 头像——头像脸归 FAB / 消息流各自的面。#1260 只读
    // 行同律：mark 槽 = 行内首个 span（结构载体；svg 存在 + 无 img）。
    await expect(row.locator('span').first().locator('svg')).toHaveCount(1);
    await expect(row.locator('img')).toHaveCount(0);

    // unbound: plain n/a line, no control (nothing to pick until an agent binds)
    await page.goto('/app?scenario=100');
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByText('n/a', { exact: true })).toBeVisible();
  });

  test('message copy glyphs are clipboard buttons; no bare inert glyphs remain', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/app?scenario=114');
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

    // 用户行两钮（复制 + 恢复到此处）皆为真按钮；裸 glyph 子节点零残留
    // （#615 返工：恢复钮按用户裁决闭环复活，不再按二分律删除）
    await expect(page.getByTestId('chief-msg-tools').getByRole('button')).toHaveCount(2);
    await expect(page.getByTestId('chief-msg-tools').locator('> svg')).toHaveCount(0);
    await expect(page.getByTestId('chief-msg-foot').locator('> svg')).toHaveCount(0);
  });

  test('restore button opens the rewind confirm; the foot chevron discloses tool rows', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    await expect(drawer(page)).toBeVisible();

    // 恢复钮（参考站 live aria 正词「恢复到此处」）→ 破坏性确认层先行
    const restore = page
      .getByTestId('chief-msg-tools')
      .getByRole('button', { name: '恢复到此处' });
    await expect(restore).toBeVisible();
    await restore.first().click();
    // #950: 确认层载体 = dialog role + 可及名（DialogShell aria-label=title）。
    const confirm = page.getByRole('dialog', { name: '恢复到此处' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('恢复到此处？');
    // fixture accept 律：确认只关窗（零请求），流不变
    await confirm.getByRole('button', { name: '恢复到此处' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('chief-msg')).toHaveCount(2);

    // foot 折叠箭头 = 过程披露：展开出该回合工具行（Multica OuterProcessFold 同族）
    const foot = page.getByTestId('chief-msg-foot');
    const fold = foot.getByRole('button', { name: '展开过程' });
    await expect(fold).toBeVisible();
    await expect(page.getByTestId('chief-turn-tools')).toHaveCount(0);
    await fold.click();
    const tools = page.getByTestId('chief-turn-tools');
    await expect(tools).toBeVisible();
    await expect(tools.locator('div')).toHaveCount(2);
    await expect(tools).toContainText('create_todo');
    // 收起回折叠态
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
