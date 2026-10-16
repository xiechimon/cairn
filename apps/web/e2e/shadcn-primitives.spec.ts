import { expect, type Page, test } from '@playwright/test';

// XMON-14 acceptance: avatar / kbd / tag-chip 三原语在 components/ui/ 有了
// shadcn 落点，21 个消费面切了过去。既有行为钉（avatar-dicebear 的 src 契约、
// chief-fab 的 48×48 几何、hotkeys 的 ⌘J/⌘K 悬浮律、board-filter 的 chip
// 20px）一行未动仍是正本；本 spec 补的是「落点自己」的契约——registry 数据
// 属性、消费面与落点的一一对应、以及落点必须保住 per-face 几何所以不能插盒。
// 每条用例钉一个失败方式：
// 1. 某个消费面漏切，仍渲染旧原语（没有 [data-slot=avatar]）
// 2. 落点在 img 与 per-face 容器之间插了一个定尺盒（display 不是 contents）
//    ——48×48 FAB / 24×24 侧栏 chip / FAB 头像槽 `[&_img]:size-full` 的百分比
//    链（chief-fab-icon.tsx，#950 utility 化）会一起裂
// 3. 成功路径上多渲染一个 fallback 元素（相对旧原语多一个可见节点）
// 4. kbd 落点没接上 registry（data-slot=kbd 缺失）或静息没隐藏
// 5. tag-chip 落点没接上 registry Badge（data-slot=badge 缺失）或几何漂移

const DICEBEAR = '**/api.dicebear.com/**';
const SVG_BODY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12"/></svg>';

/** Hermetic dicebear（avatar-dicebear.spec.ts idiom）：断 src 契约，不打真外网。 */
async function stubDicebear(page: Page) {
  await page.route(DICEBEAR, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: SVG_BODY }),
  );
}

// Paper card (DESIGN.md 任务卡) dropped the executor avatar; the running
// footer names the agent instead, so the board face left this list.
test('avatar 落点：侧栏人像走 components/ui 落点', async ({ page }) => {
  await stubDicebear(page);
  await page.goto('/app?scenario=22d');
  const faces = [page.locator('.sidebar-user')];
  for (const face of faces) {
    await expect(face.locator('[data-slot="avatar"]')).toHaveCount(1);
    await expect(face.locator('[data-slot="avatar-image"]')).toHaveCount(1);
    // 成功路径不渲染 fallback 元素（旧原语只有一个 img 节点）
    await expect(face.locator('[data-slot="avatar-fallback"]')).toHaveCount(0);
  }
  // 侧栏收起态的 rail chip 是同一落点的第二形态
  await page.evaluate(() => localStorage.setItem('pacman.sidebar-collapsed', '1'));
  await page.reload();
  await expect(page.locator('.rail-user [data-slot="avatar-image"]')).toHaveCount(1);
});

test('avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变', async ({
  page,
}) => {
  await stubDicebear(page);
  await page.goto('/app?scenario=22d');
  const probe = await page.evaluate(() => {
    const root = document.querySelector('.sidebar-user [data-slot="avatar"]')!;
    const img = document.querySelector('.sidebar-user [data-slot="avatar-image"]')!;
    const chip = document.querySelector('.sidebar-user')!;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    return {
      display: getComputedStyle(root).display,
      rootBox: box(root),
      imgBox: box(img),
      chipBox: box(chip),
    };
  });
  // contents 根已随 #983 判决退役（#1003 施工）：上游 after: 发丝环需要真实
  // containing block——contents 宿主上 absolute 伪元素会爬到页级祖先，成为
  // 整页点击拦截层（XMON-14 实测）。
  expect(probe.display).not.toBe('contents');
  // 定尺盒 = 消费点 className（size-6），img 走件内 size-full 随 Root——
  // img 尺寸契约不变：24×24（`.sidebar-user [&_img]:size-6` 同值同构）。
  expect(probe.rootBox.w).toBe(24);
  expect(probe.rootBox.h).toBe(24);
  expect(probe.imgBox.w).toBe(24);
  expect(probe.imgBox.h).toBe(24);
  expect(probe.chipBox.h).toBe(44);
});

test('kbd 落点：悬浮提示 = registry Tooltip+Kbd 组合，静息不挂载 / 悬浮浮出', async ({ page }) => {
  await page.goto('/app?scenario=01');
  // #950 载体：.chief-fab → aria-label 总管钮（board inline FAB）。
  // #983/#1004：kbd-hint 退役为 registry Tooltip+Kbd——静息不挂载
  // （count 0，取代旧 visibility 隐藏律），悬浮浮出 registry Kbd。
  const fab = page.getByRole('button', { name: '总管', exact: true });
  const hint = page.locator('[data-slot="tooltip-content"] [data-slot="kbd"]');
  await expect(hint).toHaveCount(0);
  await fab.hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute('data-slot', 'kbd');
  await expect(hint).toHaveText('⌘J');
});

// #1006 R5 实审裁决（用户 2026-10-08，与 L1 裁决①一致）：row-flush 16px
// 消费点覆写收编 registry Badge 默认 20px——两尺寸不并存，卡面/面板面
// 单档 20（旧「卡面 16 / 面板面 20」双保契约由裁决作废，本 spec 重钉）。
// The board card no longer renders TagChip (Paper card: tag icon tinted with
// tag.color + name, pinned in board-filter.spec); the type-filter option is
// the TagChip face that stays.
test('tag-chip 落点：落在 registry Badge 上，几何单档 20px 正本', async ({ page }) => {
  await page.goto('/app?scenario=board-tags');
  await expect(page.locator('.todo-card-tag')).toHaveCount(0);
  await page.locator('.board-type-filter').click();
  const option = page.locator('.type-filter-option[data-tag="bug"]');
  await option.click();
  const picked = option.locator('.tag-chip');
  await expect(picked).toBeVisible();
  await expect(picked).toHaveAttribute('data-slot', 'badge');
  const ph = await picked.evaluate((el) => el.getBoundingClientRect().height);
  expect(ph).toBeCloseTo(20, 2);
});