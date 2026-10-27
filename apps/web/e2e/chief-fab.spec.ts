import { expect, type Page, test } from '@playwright/test';
import { spiralAvatarUrl } from '../src/lib/spiral-avatar.js';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc';

test.describe('detail FAB renders only with unread (#443)', () => {
  test('unread 0: the detail route renders no FAB', async ({ page }) => {
    await page.goto(`${DETAIL}?scenario=16`);
    await expect(page.locator('[data-route="todo-detail"]')).toBeVisible();

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

const R3_SRC = spiralAvatarUrl('r3-builder');

test.describe('FAB icon follows the bound agent (#444)', () => {
  test('bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay', async ({
    page,
  }) => {
    await page.goto('/app?view=board&scenario=fab-avatar');

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
    await page.goto('/app/team?scenario=fab-avatar');

    const fab = page.locator('button[aria-label="总管"]');
    await expect(fab.locator('img')).toHaveAttribute('src', R3_SRC);
    await expect(fab.locator('svg')).toHaveCount(0);
    await expect(fab.locator('.fab-badge')).toHaveText('2');
  });

  test('avatarUrl override wins over the generated face', async ({ page }) => {
    await page.goto('/app?view=board&scenario=fab-avatar-override');
    await expect(page.getByRole('button', { name: '总管', exact: true }).locator('img')).toHaveAttribute(
      'src',
      '/avatar-robot-2.svg',
    );
  });

  test('unbound: the static glyph stays, no avatar face', async ({ page }) => {
    await page.goto('/app/team?scenario=12');
    const fab = page.locator('button[aria-label="总管"]');
    await expect(fab.locator('svg')).toHaveCount(1);

    await expect(fab.locator('img')).toHaveCount(0);
  });
});

test.describe('chief unread badge cap (#1303)', () => {
  test('unread 100 renders 99+ and the tooltip names the thread count', async ({ page }) => {
    await page.goto('/app?view=board&scenario=chief-unread-cap');
    const fab = page.getByRole('button', { name: '总管', exact: true });
    await expect(fab.locator('.fab-badge')).toHaveText('99+');
    await fab.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('100 个总管会话有未读');
  });

  test('unread 99 stays 99', async ({ page }) => {
    await page.goto('/app?view=board&scenario=chief-unread-99');
    await expect(page.getByRole('button', { name: '总管', exact: true }).locator('.fab-badge')).toHaveText('99');
  });
});

test.describe('chief FAB brand states', () => {
  test('idle: a 40px disc on the card surface with body ink, the spiral holds still, no label', async ({
    page,
  }) => {
    await page.goto('/app?view=board&scenario=01');
    const fab = page.getByRole('button', { name: '总管', exact: true });
    await expect(fab).not.toHaveAttribute('data-expanded');
    await expect(fab).toHaveText('');
    const look = await fab.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--card)';
      probe.style.color = 'var(--foreground)';
      document.body.append(probe);
      const expected = getComputedStyle(probe);
      const result = {
        bgIsCard: getComputedStyle(el).backgroundColor === expected.backgroundColor,
        inkIsForeground: getComputedStyle(el).color === expected.color,
        width: el.getBoundingClientRect().width,
        spin: getComputedStyle(el.querySelector('svg') as Element).animationName,
      };
      probe.remove();
      return result;
    });
    expect(look).toEqual({ bgIsCard: true, inkIsForeground: true, width: 40, spin: 'none' });
  });

  test('busy: the pill says `思考中…` and the spiral spins', async ({ page }) => {
    await page.goto('/app?view=board&scenario=chief-busy');
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
    await page.goto('/app?view=board&scenario=chief-unread-99');
    await expect(page.getByRole('button', { name: '总管', exact: true })).toHaveText('99 条新消息');
  });

  test('reduced motion: busy keeps the label but stops the spin', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app?view=board&scenario=chief-busy');
    const fab = page.getByRole('button', { name: '总管', exact: true });
    await expect(fab).toHaveText('思考中…');
    const spin = await fab.evaluate((el) => getComputedStyle(el.querySelector('svg') as Element).animationName);
    expect(spin).toBe('none');
  });
});
