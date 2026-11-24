import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';
import { findLowContrast } from './contrast-probe.js';

const HOME = '/app?scenario=home-c';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { transition: none !important; }';
      document.head.append(style);
    }, { once: true });
  });
});

for (const background of [
  'oklab(0% 0 0 / 90%)',
  'color-mix(in oklab, black 90%, transparent)',
]) {
  test(`A3: the contrast probe includes the ${background} background layer`, async ({ page }) => {
    await page.setContent(`<main style="background: white"><button id="contrast-target" style="color: black; background: ${background}">Remove provider</button><span style="color: white">Unrelated text</span></main>`);
    const failures = await findLowContrast(page, '#contrast-target');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ kind: 'text', text: 'Remove provider', need: 4.5 });
    expect(failures[0]!.ratio).toBeLessThan(4.5);
  });
}

async function expectTip(page: Page, button: Locator, label: string) {
  await button.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(label);
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the waiting-section count meets AA contrast`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto(`${HOME}&pane=tasks`);
    const count = panel(page).locator('[data-section="ready_for_review"] h3 span').first();
    await expect(count).toHaveText('1');
    expect(await findLowContrast(page, '[data-section="ready_for_review"] h3 span')).toEqual([]);
  });

  for (const { utilization, percent } of [
    { utilization: 0.93, percent: '7%' },
    { utilization: 0.4, percent: '60%' },
  ]) {
  test(`${theme}: provider ${percent} quota text meets AA contrast in normal, hover and selected rows`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
      if (path !== '/api/teams/t1/claude-subscriptions') return undefined;
      return json([
        {
          id: 'other-account',
          kind: 'claude-subscription',
          label: 'Other subscription',
          expiresAt: null,
          createdAt: Date.now(),
          windows: [],
          lastUsedAt: null,
          stepsLast24h: 0,
        },
        {
          id: 'quota-account',
          kind: 'claude-subscription',
          label: 'Claude subscription',
          expiresAt: null,
          createdAt: Date.now(),
          windows: [
            { name: 'billing_period', utilization, resetsAt: null, observedAt: Date.now() },
          ],
          lastUsedAt: null,
          stepsLast24h: 0,
        },
      ]);
    });
    await page.goto('/app/settings/routing');
    const row = page.locator('[data-instance-id="subscription:quota-account"]');
    const badge = row.getByTestId('subscription-quota-mini');
    await expect(badge).toHaveText(`剩 ${percent}`);
    await expect(row).not.toHaveAttribute('aria-current');
    for (const state of ['normal', 'hover', 'selected'] as const) {
      if (state === 'hover') await row.hover();
      if (state === 'selected') {
        await row.getByRole('button').first().click();
        await expect(row).toHaveAttribute('aria-current', 'true');
      }
      for (const testId of ['subscription-quota-mini', 'provider-subtitle']) {
        expect(
          await findLowContrast(page, `[data-instance-id="subscription:quota-account"] [data-testid="${testId}"]`),
          `A3: ${theme} ${state} ${percent} text meets WCAG 1.4.3`,
        ).toEqual([]);
      }
    }
    const remaining = page.getByTestId('subscription-quota-remaining');
    await expect(remaining).toHaveText(`剩 ${percent}`);
    expect(
      await findLowContrast(page, '[data-testid="subscription-quota-remaining"]'),
      `A3: ${theme} ${percent} detail text meets WCAG 1.4.3`,
    ).toEqual([]);
  });
  }

  test(`${theme}: provider removal text meets AA contrast at rest and on hover`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto('/app/settings/routing?scenario=model-routing');
    const remove = page.getByTestId('provider-editor').getByRole('button', { name: '移除', exact: true });
    await expect(remove).toBeVisible();
    for (const state of ['normal', 'hover'] as const) {
      if (state === 'hover') await remove.hover();
      expect(
        await findLowContrast(page, '[data-testid="provider-editor"] button[data-variant="destructive"]'),
        `A3: ${theme} ${state} destructive text meets WCAG 1.4.3`,
      ).toEqual([]);
    }
  });

  test(`${theme}: the selected provider's secondary text meets AA contrast`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto('/app/settings/routing?scenario=model-routing');
    const status = page
      .locator('[data-instance-id][aria-current="true"]')
      .getByTestId('provider-subtitle');
    await expect(status).toBeVisible();
    await expect(status).toHaveText(/^订阅 · \d+ 个模型$/);
    expect(await findLowContrast(page, '[data-instance-id][aria-current="true"] [data-testid="provider-subtitle"]')).toEqual([]);
  });
}

test('closing the add field returns focus to the button that opened it', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  const plus = panel(page).getByTestId('tasks-new');
  const input = panel(page).getByTestId('tasks-add-input');
  await plus.click();
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(plus).toBeFocused();
  await plus.click();
  await input.fill('Check the relay probe');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(plus).toBeFocused();
});

test('the panel close and the chief send show their names on hover', async ({ page }) => {
  await page.goto('/app?scenario=01&pane=tasks');
  await expectTip(page, panel(page).locator('[data-panel-close]'), '关闭');
  await expectTip(page, page.getByRole('button', { name: '发送' }), '发送');
});

interface IconButtonGap {
  testid: string;
  html: string;
  missing: string[];
}

async function iconButtonGaps(page: Page): Promise<IconButtonGap[]> {
  return page.evaluate(() => {
    const gaps: { testid: string; html: string; missing: string[] }[] = [];
    for (const b of document.querySelectorAll('button')) {
      const box = b.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const clone = b.cloneNode(true) as HTMLElement;
      for (const el of clone.querySelectorAll('.sr-only')) el.remove();
      if ((clone.textContent ?? '').trim() !== '') continue;
      const named =
        (b.getAttribute('aria-label') ?? '').trim() !== '' ||
        (b.getAttribute('aria-labelledby') ?? '').trim() !== '' ||
        (b.getAttribute('title') ?? '').trim() !== '' ||
        (b.textContent ?? '').trim() !== '';
      const tipped =
        b.hasAttribute('data-base-ui-tooltip-trigger') ||
        (b.getAttribute('title') ?? '').trim() !== '' ||
        b.closest('[data-slot="message-toolbar-tools"][data-unarmed]') !== null;
      const missing: string[] = [];
      if (!named) missing.push('accessible name');
      if (!tipped) missing.push('visible tooltip');
      if (missing.length > 0) {
        gaps.push({
          testid: b.getAttribute('data-testid') ?? '',
          html: b.outerHTML.slice(0, 120),
          missing,
        });
      }
    }
    return gaps;
  });
}

test('icon-only buttons on the swept pages carry a name and a tooltip', async ({ page }) => {
  const surfaces: [string, string, () => Promise<void>][] = [
    [
      'home tasks pane',
      `${HOME}&pane=tasks`,
      async () => {
        await expect(page.getByTestId('tasks-toggle')).toBeVisible();
      },
    ],
    [
      'model routing settings',
      '/app/settings/routing?scenario=model-routing',
      async () => {
        await expect(page.locator('[data-instance-id]').first()).toBeVisible();
      },
    ],
    [
      'usage',
      '/app/usage?scenario=home-c',
      async () => {
        await expect(page.locator('[data-day]').first()).toBeVisible();
      },
    ],
  ];
  for (const [name, url, ready] of surfaces) {
    await page.goto(url);
    await ready();
    expect(await iconButtonGaps(page), `C4: icon buttons on ${name}`).toEqual([]);
  }
});

test('the new-project form names every icon button and shows it on hover', async ({ page }) => {
  await page.route('**/api/fs/pick', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'folder picker unavailable', reason: 'unavailable' }),
    });
  });
  await page.route('**/api/fs/list*', (route) =>
    route.fulfill({
      json: {
        path: '/Users/e2e',
        entries: [
          { name: 'demo', git: true },
          { name: 'plain', git: false },
        ],
        truncated: false,
      },
    }),
  );
  await page.goto('/app/project/new?scenario=01');
  await page.locator('#prj-new-repo').click();
  await page.getByRole('menuitemradio', { name: '本地文件夹' }).click();
  await expect(page.getByRole('button', { name: '浏览' })).toBeVisible();
  expect(await iconButtonGaps(page), 'C4: project form icon buttons').toEqual([]);
  await expectTip(page, page.getByRole('button', { name: '切换仓库来源' }), '切换仓库来源');
  await page.getByRole('button', { name: '浏览' }).click();
  await expect(page.getByRole('dialog', { name: '浏览本地文件夹' })).toBeVisible();
  expect(await iconButtonGaps(page), 'C4: directory browser icon buttons').toEqual([]);
});
