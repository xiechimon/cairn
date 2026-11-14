import { mkdir } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { keyboardFocus, readRing, settleTransitions } from './helpers.js';

const parse = (c: string) => {
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) throw new Error(`unparsable color ${c}`);
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
};

const over = (fg: string, bg: string) => {
  const f = parse(fg);
  const b = parse(bg);
  return {
    r: f.a * f.r + (1 - f.a) * b.r,
    g: f.a * f.g + (1 - f.a) * b.g,
    b: f.a * f.b + (1 - f.a) * b.b,
  };
};

const dist = (x: { r: number; g: number; b: number }, y: { r: number; g: number; b: number }) =>
  Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);

const resolve = (page: Page, token: string) =>
  page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.backgroundColor = `var(${v})`;
    document.body.append(el);
    const out = getComputedStyle(el).backgroundColor;
    el.remove();
    return out;
  }, token);

for (const theme of ['light', 'dark'] as const) {
  test(`⌘K hint shows on the search icon's tooltip (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');
    await page.getByRole('complementary').getByRole('button', { name: '搜索' }).hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('⌘K');
  });

  test(`hover and selected rows share one height and corner (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

    const geo = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, w: r.width, h: r.height, radius: getComputedStyle(el).borderRadius };
      };
      const selected = document.querySelector(
        'aside [data-slot="sidebar-nav-row"][aria-current="page"]',
      );
      const plain = document.querySelector(
        'aside [data-slot="sidebar-project-row"]:not([aria-current="page"])',
      );
      if (!selected || !plain) throw new Error('sidebar rows missing');
      return { selected: box(selected), plain: box(plain) };
    });
    expect(geo.selected).toEqual({ x: 8, w: 204, h: 34, radius: '6px' });
    expect(geo.plain).toEqual({ x: 30, w: 182, h: 34, radius: '6px' });
  });

  test(`selected row = sheet fill + hairline, distinct from hover (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

    const sidebarBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('aside')!).backgroundColor,
    );
    const schedules = page.getByRole('complementary').locator('[data-slot="sidebar-project-row"]').first();
    await schedules.hover();
    await page.waitForTimeout(300);
    const hoverBg = await schedules.evaluate((el) => getComputedStyle(el).backgroundColor);
    const selected = await page.evaluate(() => {
      const cs = getComputedStyle(
        document.querySelector('aside [data-slot="sidebar-nav-row"][aria-current="page"]')!,
      );
      return { bg: cs.backgroundColor, ring: cs.boxShadow };
    });

    expect(hoverBg).toBe(await resolve(page, '--sidebar-hover'));
    const bg = parse(sidebarBg);
    expect(dist(over(hoverBg, sidebarBg), bg)).toBeGreaterThan(3);
    expect(selected.bg).toBe(await resolve(page, '--sidebar-active'));
    expect(selected.ring).toBe('none');
    expect(selected.bg).not.toBe(hoverBg);
  });
}


const REF = '/app?scenario=sidebar-ref';

test('L9: the sidebar keeps the measured reference geometry', async ({ page }) => {
  await page.goto(REF);
  const m = await page.evaluate(() => {
    const box = (el: Element | null) => {
      if (el === null) throw new Error('missing');
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    };
    const aside = document.querySelector('aside.board-sidebar');
    return {
      aside: box(aside),
      team: box(document.querySelector('[data-testid="team-row"]')),
      coordinator: box(document.querySelector('aside [data-slot="sidebar-nav-row"]')),
      rows: [...document.querySelectorAll('aside [data-slot="sidebar-project-row"]')].map(box),
      group: box(document.querySelector('aside [data-testid="project-group-header"]')),
      footer: box(document.querySelector('[data-testid="sidebar-footer"]')),
      settings: box(document.querySelector('[data-testid="sidebar-settings"]')),
      activity: box(document.querySelector('[data-testid="sidebar-activity"]')),
      label: aside?.textContent?.includes('项目') && !aside.textContent.includes('新建项目'),
    };
  });
  expect(m.aside[2]).toBe(220);
  expect(m.team).toEqual([8, 0, 204, 48]);
  expect(m.coordinator).toEqual([8, 52, 204, 34]);
  expect(m.rows.map((row) => [row[0], row[1], row[3]])).toEqual([
    [30, 88, 34],
    [30, 124, 34],
    [30, 204, 34],
    [30, 240, 34],
  ]);
  expect(m.group).toEqual([8, 176, 204, 26]);
  expect(m.footer[3]).toBe(56);
  expect(m.activity[0] + m.activity[2] / 2).toBe(168);
  expect(m.settings[0] + m.settings[2] / 2).toBe(198);
  await expect(page.getByRole('complementary').getByText('项目', { exact: true })).toHaveCount(0);
});

test('L8: child rows hang on one continuous rounded tree guide', async ({ page }) => {
  await page.goto(REF);
  const m = await page.evaluate(() =>
    [...document.querySelectorAll('aside [data-slot="sidebar-project-row"]')].map((row) => {
      const wrap = row.closest('.group\\/row');
      if (wrap === null) throw new Error('row wrapper missing');
      const guides = [...wrap.querySelectorAll('[data-slot="tree-guide"]')].map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: r.x,
          top: r.top,
          bottom: r.bottom,
          right: r.right,
          radius: cs.borderBottomLeftRadius,
          arm: cs.borderBottomWidth,
        };
      });
      const glyph = row.querySelector('[data-slot="project-glyph"]')!.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { guides, iconMid: glyph.top + glyph.height / 2, rowLeft: r.left, rowTop: r.top, rowBottom: r.bottom };
    }),
  );
  for (const row of m) {
    const elbow = row.guides.find((guide) => guide.arm === '1px');
    expect(elbow, 'every child row has an elbow').toBeDefined();
    expect(elbow!.x).toBe(22);
    expect(elbow!.right).toBe(row.rowLeft);
    expect(Math.abs(elbow!.bottom - 0.5 - row.iconMid)).toBeLessThanOrEqual(1);
    expect(Number.parseFloat(elbow!.radius)).toBeGreaterThan(0);
  }
  const [cairn, r3, web, api] = m;
  const trunk = (row: (typeof m)[number]) => row.guides.find((guide) => guide.arm === '0px');
  expect(trunk(cairn!)!.bottom).toBe(cairn!.rowBottom);
  expect(Math.min(...r3!.guides.map((guide) => guide.top))).toBeLessThanOrEqual(cairn!.rowBottom);
  expect(trunk(r3!)).toBeUndefined();
  expect(trunk(web!)!.bottom).toBe(web!.rowBottom);
  expect(trunk(api!)).toBeUndefined();
  const newProject = page.locator('aside [data-slot="sidebar-new-project"]');
  await expect(newProject.locator('[data-slot="tree-guide"]')).toHaveCount(0);
});

test('L2: a waiting project shows only the dot; its status lives in the tooltip and description', async ({
  page,
}) => {
  await page.goto(REF);
  const api = page.locator('aside [data-slot="sidebar-project-row"]', { hasText: 'acme-api' });
  await expect(api.locator('[data-slot="needs-you-dot"]')).toHaveCount(1);
  await expect(api).toHaveText('acme-api');
  await expect(api).toHaveAttribute('aria-description', /.+/);
  const description = await api.getAttribute('aria-description');
  await api.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(description ?? '');
  const web = page.locator('aside [data-slot="sidebar-project-row"]', { hasText: 'acme-web' });
  await expect(web.locator('[data-slot="needs-you-dot"]')).toHaveCount(0);
});

test('a folded group shows its count, keeps the waiting dot and hides its projects', async ({
  page,
}) => {
  await page.goto(REF);
  const header = page.getByTestId('project-group-header');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(header.locator('[data-slot="group-count"]')).toHaveText('2');
  await expect(header.locator('[data-slot="needs-you-dot"]')).toHaveCount(1);
  await expect(page.locator('aside [data-slot="sidebar-project-row"]')).toHaveText([
    'cairn',
    'r3-lifecycle',
  ]);
});

test('the row menu matches the reference metrics and order', async ({ page }) => {
  await page.goto(REF);
  const row = page.locator('aside [data-slot="sidebar-project-row"]', { hasText: 'r3-lifecycle' });
  await row.hover();
  const trigger = page.getByRole('button', { name: 'r3-lifecycle 的菜单' });
  await trigger.click();
  const menu = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(menu.getByRole('menuitem')).toHaveText([
    '重命名',
    '项目主页',
    '任务',
    '项目设置',
    '项目说明',
    '移到分组',
    '归档',
    '删除',
  ]);
  await expect.poll(() => menu.evaluate((el) => el.getBoundingClientRect().width)).toBe(168);
  const m = await page.evaluate(() => {
    const menu = document.querySelector('[data-slot="dropdown-menu-content"]')!;
    const trigger = document.querySelector('[aria-label="r3-lifecycle 的菜单"]')!;
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const box = (el: Element) => el.getBoundingClientRect();
    const cs = getComputedStyle(menu);
    const svg = items[0]!.querySelector('svg')!;
    return {
      menu: box(menu),
      trigger: box(trigger),
      triggerSize: [box(trigger).width, box(trigger).height],
      triggerGlyph: box(trigger.querySelector('svg')!).width,
      radius: cs.borderRadius,
      padding: cs.paddingTop,
      itemHeights: items.map((item) => box(item).height),
      itemRadius: getComputedStyle(items[0]!).borderRadius,
      icon: [box(svg).width, box(svg).x - box(items[0]!).x],
      font: getComputedStyle(items[0]!).fontSize,
      danger: getComputedStyle(items.at(-1)!).color,
      destructive: (() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--destructive)';
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      })(),
    };
  });
  expect(m.menu.width).toBe(168);
  expect(m.radius).toBe('10px');
  expect(m.padding).toBe('6px');
  expect(m.itemHeights).toEqual([27, 27, 27, 27, 27, 27, 27, 27]);
  expect(m.itemRadius).toBe('6px');
  expect(m.icon).toEqual([20, 10]);
  expect(m.font).toBe('13px');
  expect(m.danger).toBe(m.destructive);
  expect(m.triggerSize).toEqual([22, 22]);
  expect(m.triggerGlyph).toBe(16);
  expect(m.menu.top - m.trigger.bottom).toBe(5);
  expect(Math.abs(m.menu.left - m.trigger.left)).toBeLessThanOrEqual(1);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('the footer and the collapsed rail carry no computers link', async ({ page }) => {
  await page.goto(REF);
  await expect(page.getByTestId('sidebar-attention')).toHaveCount(0);
  await expect(page.locator('aside [data-slot="fleet-chip"]')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.reload();
  const rail = page.locator('aside.board-sidebar--collapsed');
  await expect(rail.getByTestId('sidebar-activity')).toBeVisible();
  await expect(rail.getByTestId('sidebar-attention')).toHaveCount(0);
});
