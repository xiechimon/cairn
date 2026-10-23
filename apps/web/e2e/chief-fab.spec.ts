import { expect, type Page, test } from '@playwright/test';

// Issue #443 acceptance, re-pinned for ADR 0013 (#1009 A0): 详情页总管 FAB
// 仅未读才显示. The detail family is the intentional divergence from the
// #129 every-family-constant FAB ruling (出处行原在 chief-wake.tsx 的
// unreadOnly prop，A0 上收到 chief-root.tsx 的路由门，ADR 0002 D7 之律
// 记录不变) — the FAB carries the only constant unread-badge surface, so on
// the detail face it renders exactly when there is something unread.
// Failure modes pinned here (fixture face; the live 未读归零即消失 path rides
// the same reactive derivation — chiefUnread is query-derived, the button
// unmounts in the same render):
//   1. unread 0 still renders the FAB (gating not wired / route gate ignored)
//   2. unread > 0 renders no FAB, or the badge value does not pass through
//      (a 1 would pass on presence alone — the pin rides 3)
//   3. the FAB loses the A0 geometry (ADR 0013 D4: 40×40 正圆, 距内容区
//      右/下各 8px, fixed 角落锚定 — 替换 48×48/16 族律与 detail 特例位
//      right 504/bottom 104；#347 composer 让位随特例位退役，clearance
//      预约制度接管角落让位)
//   4. the wake surface unmounts with the FAB — the drawer walk on the
//      unread face rides the shell-consistency detail row (scenario
//      detail-unread); the hotkey path stays registered by useChiefSurface
//      regardless of the button (键位以 #442 落地为准, not pinned here)

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc';

test.describe('detail FAB renders only with unread (#443)', () => {
  test('unread 0: the detail route renders no FAB', async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=16`);
    await expect(page.locator('[data-route="todo-detail"]')).toBeVisible();
    // A0：FAB 单实例载体 = 根 layout 的 .chief-fab（族类名 .detail-fab 退役）
    await expect(page.locator('.chief-fab')).toHaveCount(0);
  });

  test('unread > 0: the FAB renders with the badge value', async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=detail-unread`);
    const fab = page.locator('.chief-fab');
    await expect(fab).toBeVisible();
    await expect(fab.locator('.fab-badge')).toHaveText('3');
  });

  test('the FAB keeps the corner anchor and grows into a 40px-tall pill when unread', async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=detail-unread`);
    const geometry = await page.locator('.chief-fab').evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        wide: el.getBoundingClientRect().width > 40,
        height: cs.height,
        right: cs.right,
        bottom: cs.bottom,
        position: cs.position,
      };
    });
    expect(geometry).toEqual({ wide: true, height: '40px', right: '8px', bottom: '8px', position: 'fixed' });
  });
});

// Issue #444 acceptance: FAB 图标 = 绑定 Agent 头像. The icon source switches
// at the single consumption point (ChiefFabIcon in the root-host FAB,
// ADR 0013 D6) — the script-generated ChiefFab asset stays untouched. The
// avatar semantics belong to the Avatar primitive (dicebear seed / avatarUrl
// override / onError 退静态资产 — pinned by avatar-dicebear.spec.ts); pinned
// here is the FAB-level 绑定态二选一 + pass-through. Failure modes:
//   1. a bound face still renders the static glyph (the consumption point
//      missed the switch)
//   2. an unbound face loses the glyph (avatar or a new placeholder face
//      renders where the ruling keeps the static asset)
//   3. the avatarUrl override loses to the generated face (src not passed
//      through at the FAB level)
//   4. the avatar does not fill the 40×40 circle, or the badge/geometry
//      drift on the avatar face

const R3_SRC = 'https://api.dicebear.com/9.x/lorelei/svg?seed=r3-builder';
const SVG_BODY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12"/></svg>';

/** Hermetic dicebear: the generated avatar "loads" without network
 *  (avatar-dicebear.spec.ts idiom). */
async function stubDicebear(page: Page) {
  await page.route('**/api.dicebear.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: SVG_BODY }),
  );
}

test.describe('FAB icon follows the bound agent (#444)', () => {
  test('bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay', async ({
    page,
  }) => {
    await stubDicebear(page);
    await page.goto('/app?scenario=fab-avatar');
    // #950: .fab-avatar 类退役——FAB 载体 = role + aria-label（A0 起单实例
    // 根 host，.chief-fab 类钩同载体）；头像 img 直取（wrapper 无独立语义）。
    const fab = page.getByRole('button', { name: '总管', exact: true });
    const img = fab.locator('img');
    await expect(img).toHaveAttribute('src', R3_SRC);
    await expect(fab.locator('svg')).toHaveCount(0);
    await expect(fab.locator('.fab-badge')).toHaveText('2');
    const fabBox = await fab.boundingBox();
    const imgBox = await img.boundingBox();
    expect(fabBox?.height).toBeCloseTo(40, 0);
    expect(imgBox?.y).toBeCloseTo((fabBox?.y ?? Number.NaN) + 4, 0);
    expect(imgBox?.width).toBeCloseTo(32, 0);
    expect(imgBox?.height).toBeCloseTo(32, 0);
  });

  test('bound: a non-board route swaps at the same single consumption point', async ({ page }) => {
    await stubDicebear(page);
    await page.goto('/app/team?scenario=fab-avatar');
    // A0：五挂载点退役后全站一个 FAB（根 host），team 面与 board 面同载体；
    // button 限定防与窗 aside 的 aria-label 双匹配（#947 重钉先例）。
    const fab = page.locator('button[aria-label="总管"]');
    await expect(fab.locator('img')).toHaveAttribute('src', R3_SRC);
    await expect(fab.locator('svg')).toHaveCount(0);
    await expect(fab.locator('.fab-badge')).toHaveText('2');
  });

  test('avatarUrl override wins over the generated face', async ({ page }) => {
    await page.goto('/app?scenario=fab-avatar-override');
    await expect(page.getByRole('button', { name: '总管', exact: true }).locator('img')).toHaveAttribute(
      'src',
      '/avatar-robot-2.svg',
    );
  });

  test('unbound: the static glyph stays, no avatar face', async ({ page }) => {
    await page.goto('/app/team?scenario=12');
    const fab = page.locator('button[aria-label="总管"]');
    await expect(fab.locator('svg')).toHaveCount(1);
    // #950: 无头像面 = 无 img（.fab-avatar wrapper 类退役）。
    await expect(fab.locator('img')).toHaveCount(0);
  });
});

test.describe('chief unread badge cap (#1303)', () => {
  test('unread 100 renders 99+ and the tooltip names the thread count', async ({ page }) => {
    await page.goto('/app?scenario=chief-unread-cap');
    const fab = page.getByRole('button', { name: '总管', exact: true });
    await expect(fab.locator('.fab-badge')).toHaveText('99+');
    await fab.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('100 个总管会话有未读');
  });

  test('unread 99 stays 99', async ({ page }) => {
    await page.goto('/app?scenario=chief-unread-99');
    await expect(page.getByRole('button', { name: '总管', exact: true }).locator('.fab-badge')).toHaveText('99');
  });
});

test.describe('chief FAB brand states', () => {
  test('idle: a 40px brand green disc, the spiral holds still, no label', async ({ page }) => {
    await page.goto('/app?scenario=01');
    const fab = page.getByRole('button', { name: '总管', exact: true });
    await expect(fab).not.toHaveAttribute('data-expanded');
    await expect(fab).toHaveText('');
    const look = await fab.evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      width: el.getBoundingClientRect().width,
      spin: getComputedStyle(el.querySelector('svg') as Element).animationName,
    }));
    expect(look).toEqual({ bg: 'rgb(23, 58, 47)', width: 40, spin: 'none' });
  });

  test('busy: the pill says 思考中… and the spiral spins', async ({ page }) => {
    await page.goto('/app?scenario=chief-busy');
    const fab = page.getByRole('button', { name: '总管', exact: true });
    await expect(fab).toHaveAttribute('data-expanded', 'true');
    await expect(fab).toHaveText('思考中…');
    const look = await fab.evaluate((el) => ({
      wide: el.getBoundingClientRect().width > 40,
      spin: getComputedStyle(el.querySelector('svg') as Element).animationName,
    }));
    expect(look).toEqual({ wide: true, spin: 'spin' });
  });

  test('unread: the pill names the count', async ({ page }) => {
    await page.goto('/app?scenario=chief-unread-99');
    await expect(page.getByRole('button', { name: '总管', exact: true })).toHaveText('99 条新消息');
  });

  test('reduced motion: busy keeps the label but stops the spin', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app?scenario=chief-busy');
    const fab = page.getByRole('button', { name: '总管', exact: true });
    await expect(fab).toHaveText('思考中…');
    const spin = await fab.evaluate((el) => getComputedStyle(el.querySelector('svg') as Element).animationName);
    expect(spin).toBe('none');
  });
});
