import { expect, type Page, test } from '@playwright/test';

// Issue #629 acceptance: the board card's press face matches the reference
// product (todos.dev, 2026-10-02 live 实测; 可拖面由 #753 扩到每列——2026-10-03/04
// 重测推翻「待处理/已完成卡不带传感器」，done 卡的按压微移现在武装 dnd 手势，
// 但 #629 的原生链接拖抑制与点击导航不受影响):
//   · 卡面文本不可选中（参考站卡根 user-select: none）；
//   · stretched link 不可原生拖——draggable="false" + -webkit-user-drag:
//     none；按住微移零 dragstart（Chrome 拖影 chip = 用户报的「偶尔出现
//     一个小链接」，绝迹）；dnd overlay（#753 起 done 卡也会升起）不是原生
//     拖影，两者判据分开钉；
//   · 悬停 = 中性升档微染（--card-hover；2026-10-12 用户派对齐
//     deepseek-harness 对话框的交互面 hover 反馈，取代「卡面无 hover」的
//     todos.dev 静止正典）；
//   · 按压 = 整卡 bg tint 一档（--surface-press：dark surface-tertiary /
//     light surface-secondary，参考站 active:bg-* 同源），标题链接不吃全局
//     a:active 压暗（参考站单一反馈）；
//   · 点击（未移动）导航详情路由——参考站同款效果，钉住不被封锁误伤。
// #943/#910 重钉：卡 = [data-todo-id] 属性载体（列 scope 走既有
// data-column）；标题链接 = 卡内唯一 role=link；dnd 浮层 =
// data-testid="drag-overlay"（二级：portal 容器无 role）。断言值不动。

/** Two responsive frame boundaries — flushes React tasks queued before it
 *  (the same-column drop teardown, #753). */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
  );
}

/** Resolve a declaration through the token path the card consumes. */
async function resolveVar(page: Page, prop: string, value: string) {
  return page.evaluate(
    ([p, v]) => {
      const probe = document.createElement('div');
      probe.style.setProperty(p, v);
      document.body.append(probe);
      const resolved = getComputedStyle(probe).getPropertyValue(p).trim();
      probe.remove();
      return resolved;
    },
    [prop, value] as const,
  );
}

for (const theme of ['light', 'dark'] as const) {
  test(`press tints the whole card one surface step (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');
    const card = page.locator('[data-column="done"] [data-todo-id]').first();
    const box = await card.boundingBox();
    if (box == null) throw new Error('done card missing');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const restBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    const expectedPress = await resolveVar(page, 'background-color', 'var(--surface-press)');
    // the resting face must not already sit on the press tier
    expect(restBg).not.toBe(expectedPress);

    await page.mouse.move(cx, cy);
    // 悬停微染（2026-10-12 用户派 dsh 对话框观感对齐）：hover = --card-hover
    // 中性升档（dsh interactive-bg-hover 同族），与按压档互不混淆。
    const expectedHover = await resolveVar(page, 'background-color', 'var(--card-hover)');
    expect(restBg).not.toBe(expectedHover);
    expect(expectedHover).not.toBe(expectedPress);
    await expect(card).toHaveCSS('background-color', expectedHover);
    await page.mouse.down();
    await expect(card).toHaveCSS('background-color', expectedPress);
    // single feedback: the stretched link does NOT dim under the global a:active
    const linkOpacity = await card
      .getByRole('link')
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(linkOpacity).toBe('1');

    // release away from the card BUT inside the source column: no click, tint
    // clears with :active. (#753: a cross-column release would be a committed
    // drop — done(有变更)→待处理 is a valid pair now — so the abort point stays
    // in the done column, keeping this spec on the press face alone.)
    await page.mouse.move(cx, cy + box.height + 40, { steps: 6 });
    await page.mouse.up();
    await settleFrames(page);
    await expect(card).toHaveCSS('background-color', restBg);
  });
}

test('card face is selection- and native-drag-locked (「小链接」绝迹)', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const card = page.locator('[data-column="done"] [data-todo-id]').first();
  await expect(card).toHaveCSS('user-select', 'none');
  const link = card.getByRole('link');
  await expect(link).toHaveAttribute('draggable', 'false');
  const userDrag = await link.evaluate((el) => getComputedStyle(el).webkitUserDrag);
  expect(userDrag).toBe('none');

  // press-and-move over the card: zero NATIVE dragstart, zero selection —
  // and since #753 the dnd overlay DOES rise (done cards arm the board
  // gesture; the two "drag ghosts" are different mechanisms and the #629
  // lock is about the native one only)
  await page.evaluate(() => {
    (window as unknown as { __dragstarts: number }).__dragstarts = 0;
    document.addEventListener(
      'dragstart',
      () => {
        (window as unknown as { __dragstarts: number }).__dragstarts += 1;
      },
      true,
    );
  });
  const box = await card.boundingBox();
  if (box == null) throw new Error('done card missing');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + i * 6, cy + i * 3, { steps: 2 });
  }
  const mid = await page.evaluate(() => ({
    dragstarts: (window as unknown as { __dragstarts: number }).__dragstarts,
    selection: window.getSelection()?.toString() ?? '',
  }));
  expect(mid.dragstarts).toBe(0);
  expect(mid.selection).toBe('');
  await expect(page.getByTestId('drag-overlay').locator('[data-todo-id]')).toBeVisible();
  // release OUTSIDE the card bounds but inside the source column: a press
  // that travels and lifts off the card is an aborted gesture, not a click
  // (up inside the card bounds is the browser's click law — that face is
  // pinned by the navigate test below); the same-column drop commits nothing
  await page.mouse.move(cx, cy + box.height, { steps: 6 });
  await page.mouse.up();
  await settleFrames(page);
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe('/app');
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
});

test('plain click on a done card still navigates to the detail route', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const card = page.locator('[data-column="done"] [data-todo-id]').first();
  const id = await card.getAttribute('data-todo-id');
  await card.click();
  // SPA pushState keeps the scenario query — match the path, not the full URL
  await page.waitForURL((u) => u.pathname === `/app/todo/${id}`);
  expect(new URL(page.url()).pathname).toBe(`/app/todo/${id}`);
});
