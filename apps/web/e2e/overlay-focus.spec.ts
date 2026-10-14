import { expect, type Page, test } from '@playwright/test';

// Issue #388 acceptance (弹层与 focus 视觉缺陷组):
//   #15 — 点击 topbar 钮 / 新建任务钮后键盘交互（Esc/Tab）不再出现 UA 蓝框
//         (outline auto rgb(0,95,204))；:focus-visible 必有可见环。#1003 起
//         #1244 起 ui Button 与 #388 per-face 面共用 2px --focus-ring outline。
//         正向断言仍配方无关（expectVisibleRing）：solid outline 或可见
//         box-shadow 都算环，缺环非法。只钉「换皮，不是删皮」。
//   #10 — /app/schedules 新建定时弹层全屏族（#1007 起壳 = registry Dialog，
//         入场 = registry fade-in）：scrim 盖全视口（含 sidebar——旧 z auto
//         被 sidebar z1 压过，阴影只盖右 pane）、Esc 关、背板点击关。
// Fixture 面（r3-92 冻结开屏）承载弹层断言：关闭 = 局部 UI 态，重载还原。

const BOARD = '/app?scenario=01';
const SCHED = '/app/schedules?scenario=r3-92';
/** UA (Chromium) default focus ring: outline auto + this blue. */
const UA_BLUE = 'rgb(0, 95, 204)';

async function focusedOutline(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el == null || el === document.body) return null;
    const cs = getComputedStyle(el);
    return {
      cls: typeof el.className === 'string' && el.className !== '' ? el.className : el.tagName,
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      color: cs.outlineColor,
      shadow: cs.boxShadow,
      focusVisible: el.matches(':focus-visible'),
    };
  });
}

/** 焦点环正向断言（「换皮，不是删皮」）：solid outline（#1244 全局环）或
 *  可见 box-shadow 都算环，缺环非法。本断言只钉「键盘可达面必有可见环且永非
 *  UA 蓝框」。读数前必须等过渡落定。 */
function expectVisibleRing(info: { style: string; color: string; shadow: string }) {
  const outlineRing = info.style === 'solid' && info.color !== UA_BLUE;
  const shadowRing = info.shadow !== 'none';
  expect(outlineRing || shadowRing).toBe(true);
}

test.describe('#15 focus ring收编', () => {
  test('click + key on 新建任务/topbar buttons: never the UA blue box', async ({ page }) => {
    await page.goto(BOARD);
    // #445：顶栏「+ 任务」撤除——新建触发位 = 侧栏「新任务」行
    const newTask = page.locator('.sidebar-new-task');
    await newTask.click();
    // keyboard interaction after a click flips the focused button into
    // :focus-visible (Chromium heuristic) — the exact dogfood symptom path
    // #389: 家族律 = 开时焦点入层、关时回还触发位——Esc 现在的职责是关
    // dialog（焦点回还按钮），读环前必须等关闭落定；重发律同 search-focus
    // （负载下渲染端输入处理可滞后于断言读，关层监听挂被动 effect）。
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.keyboard.press('Escape');
      // #948 载体重钉（#910 裁定 1）：dialog 类名锚换 role+name 一级载体。
      const closed = await page
        .getByRole('dialog', { name: '新建任务' })
        .waitFor({ state: 'hidden', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (closed) break;
    }
    await page.waitForTimeout(250); // transition-all 过渡落定（见 expectVisibleRing 注）
    const info = await focusedOutline(page);
    expect(info).not.toBeNull();
    expect(info!.style).not.toBe('auto');
    expect(info!.color).not.toBe(UA_BLUE);
    // 正向堵洞：键盘交互后 Chromium 必命中 :focus-visible——命中即环必须在
    // （防「整环删干净」的回归从负向断言溜过去；换皮，不是删皮）
    if (info!.focusVisible) {
      expectVisibleRing(info!);
    }

    // schedules topbar 新建 (#1037: fixture face wired — the click opens the
    // frozen dialog, Esc closes it and focus returns to the opener per the
    // DialogShell #389 contract; the UA-ring ban rides the returned focus).
    await page.goto('/app/schedules?scenario=11');
    const pageNew = page.locator('.page-new-action');
    await pageNew.click();
    const schedDialog = page.getByRole('dialog', { name: '新建定时' });
    await expect(schedDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(schedDialog).toBeHidden();
    await expect(pageNew).toBeFocused();
    await page.waitForTimeout(250); // 同上：过渡落定后读数
    const info2 = await focusedOutline(page);
    expect(info2).not.toBeNull();
    expect(info2!.style).not.toBe('auto');
    expect(info2!.color).not.toBe(UA_BLUE);
    if (info2!.focusVisible) {
      expectVisibleRing(info2!);
    }
  });

  test('Tab focus keeps the official ring (keyboard reachability preserved)', async ({ page }) => {
    await page.goto(BOARD);
    // tab through the chrome until the 新建任务 button owns focus
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      await page.keyboard.press('Tab');
      found = await page.evaluate(
        () => document.activeElement?.classList.contains('sidebar-new-task') ?? false,
      );
    }
    expect(found).toBe(true);
    await page.waitForTimeout(250); // 同上：过渡落定后读数
    const info = await focusedOutline(page);
    expect(info).not.toBeNull();
    expect(info!.focusVisible).toBe(true);
    expectVisibleRing(info!);
  });
});

// #1007（wave 1 L4）重钉：新建定时弹层从 FloatingShell 全屏族迁 registry
// Dialog（#983 居中 fixed 模态族判决）；#1037 收编进 DialogShell 零皮肤
// 适配层（家族律容器：封顶 + body 滚动 + footer 钉底 + #389 焦点回还）——
// scrim 载体 = DialogOverlay（data-slot=dialog-overlay），入场 = registry
// fade-in（duration-100），关闭四路（Esc/背板/X/取消）语义保持；X 钮
// aria-label=t('关闭')（DialogShell 适配层自携，registry 内建钮 sr-only
// 文案是英文硬编码）。
test.describe('#10 schedules 新建定时弹层 = registry Dialog 全屏族（fade-in）', () => {
  const overlay = (page: Page) => page.locator('[data-slot="dialog-overlay"]');

  test('scrim covers the full viewport — sidebar included', async ({ page }) => {
    await page.goto(SCHED);
    await expect(overlay(page)).toBeVisible();
    const covers = await page.evaluate(() => {
      // a point deep inside the sidebar, far from the centered panel
      const el = document.elementFromPoint(100, 400);
      return el?.closest('[data-slot="dialog-overlay"]') != null;
    });
    expect(covers).toBe(true);
  });

  test('Esc closes the overlay', async ({ page }) => {
    await page.goto(SCHED);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toBeHidden();
  });

  test('backdrop click closes; entry rides the registry fade-in', async ({ page }) => {
    await page.goto(SCHED);
    const scrim = overlay(page);
    await expect(scrim).toBeVisible();
    // registry DialogOverlay: data-open:animate-in data-open:fade-in-0 —
    // tw-animate-css 的 animate-in 单 keyframe 名 = enter（fade 幅度走
    // --enter-fade 变量），与 #656 期 scrim 同机制。
    await expect(scrim).toHaveCSS('animation-name', 'enter');
    // scrim far from the 488-wide centered panel
    await page.mouse.click(80, 80);
    await expect(scrim).toBeHidden();
  });

  test('X and 取消 close the fixture face too (no dead buttons)', async ({ page }) => {
    await page.goto(SCHED);
    await page.locator('.sched-form-cancel').click();
    await expect(overlay(page)).toBeHidden();

    await page.goto(SCHED);
    await page.getByRole('button', { name: '关闭' }).click();
    await expect(overlay(page)).toBeHidden();
  });
});
