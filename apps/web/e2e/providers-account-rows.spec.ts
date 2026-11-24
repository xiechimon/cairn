import { expect, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const URL = '/app/settings/routing?scenario=model-routing';
const CHECK_WORDS = ['可用', '未验证', '验证中', '验证失败', '登录失效'];
for (const width of [1440, 390]) {
  test(`subscription rows at ${width}px: one subtitle line and no diagnostic or usage copy`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL);
    const rows = page.locator('[data-testid="provider-instance"][data-instance-id^="subscription:"]');
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId('provider-list')).not.toContainText('—');
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      await expect(row.getByText(/^订阅 · \d+ 个模型$/)).toHaveCSS('white-space', 'nowrap');
      const text = (await row.textContent()) ?? '';
      expect(CHECK_WORDS.filter((word) => text.includes(word)), text).toEqual([]);
      await expect(row.getByTestId('provider-subtitle')).not.toContainText(
        /最近使用|尚未使用|需要更新 Cairn|需要新版 Cairn/,
      );
      await expect(row.getByTestId('provider-subtitle')).not.toContainText(/冷却至|额度用尽|已过期/);
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const label of [
    'Claude',
    'Claude subscription — International Design and Engineering Workspace',
  ]) {
    test(`R1: long upstream quota leaves the name and model count visible in a 17rem list (${theme}, ${label})`, async ({
      page,
    }) => {
      const now = Date.now();
      const windowName =
        'seven_day_enterprise_international_design_and_engineering_workspace_sonnet_limit';
      const windowLabel =
        'Seven day enterprise international design and engineering workspace sonnet limit';
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript((theme) => localStorage.setItem('cairn-theme', theme), theme);
      await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
        if (path === '/api/teams/t1/claude-subscriptions')
          return json([
            {
              id: 'long-quota',
              kind: 'claude-subscription',
              label,
              expiresAt: null,
              createdAt: now,
              windows: [{ name: windowName, utilization: 0.93, resetsAt: null, observedAt: now }],
              models: ['opus', 'sonnet', 'haiku'].map((family) => ({
                id: `claude-${family}-5-5`,
                name: `Claude ${family} 5.5`,
              })),
            } satisfies ClaudeSubscriptionListEntry,
          ]);
        if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
        if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
        return undefined;
      });
      await page.goto('/app/settings/routing');
      const list = page.getByTestId('provider-list');
      const row = list.getByTestId('provider-instance');
      const name = row.getByText(label, { exact: true });
      const subtitle = row.getByTestId('provider-subtitle');
      const badge = row.getByTestId('subscription-quota-mini');
      await expect(name).toBeVisible();
      await expect(subtitle).toHaveText('订阅 · 3 个模型');
      await expect(badge).toHaveText('剩 7%');
      await expect(subtitle).not.toContainText(/更新|新版|最近使用|尚未使用/);
      await expect(badge).toHaveAccessibleName(`${windowLabel} 剩 7%`);
      await expect(badge).toHaveAttribute('title', `${windowLabel} 剩 7%`);
      await expect(
        page.getByTestId('subscription-detail').getByTestId('subscription-quota-remaining'),
      ).toHaveText('剩 7%');
      await expect(
        page.getByTestId('subscription-detail').getByTestId('subscription-quota-name'),
      ).toHaveText(windowLabel);
      const listBox = await list.boundingBox();
      const rowBox = await row.boundingBox();
      const badgeBox = await badge.boundingBox();
      if (listBox === null || rowBox === null || badgeBox === null)
        throw new Error('R1: the list, row and quota badge must have measurable geometry');
      const rem = await page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
      expect(
        listBox.width,
        'R1: exercise the fixed 17rem list, not the full-width narrow layout',
      ).toBeCloseTo(17 * rem, 0);
      const column = row.getByRole('button').locator('span.flex-1.flex-col');
      const columnBox = await column.boundingBox();
      if (columnBox === null) throw new Error('R1: the text column must have measurable geometry');
      expect(
        columnBox.width,
        'R1: the text column retains readable available width',
      ).toBeGreaterThanOrEqual(6 * rem);
      for (const target of [name, subtitle]) {
        const geometry = await target.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            textWidth: range.getBoundingClientRect().width,
          };
        });
        expect(geometry.left, 'R1: text starts inside the row').toBeGreaterThanOrEqual(rowBox.x);
        expect(
          geometry.right,
          'R1: the badge never overlaps the name or model count',
        ).toBeLessThanOrEqual(badgeBox.x);
        if (target === subtitle || label === 'Claude') {
          expect(
            geometry.scrollWidth,
            'R1: the model count and short provider name are not clipped',
          ).toBeLessThanOrEqual(geometry.clientWidth);
          expect(
            geometry.textWidth,
            'R1: all subtitle glyphs fit, not just their element',
          ).toBeLessThanOrEqual(geometry.width + 1);
        }
      }
      expect(
        badgeBox.x + badgeBox.width,
        'R1: the quota stays inside the row and list',
      ).toBeLessThanOrEqual(Math.min(rowBox.x + rowBox.width, listBox.x + listBox.width));
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const locale of ['zh', 'en'] as const) {
    test(`R1: long quota names never clip remaining values or reset times at 390px (${theme}, ${locale})`, async ({
      page,
    }) => {
      const now = Date.now();
      const windowName =
        'seven_day_enterprise_international_design_and_engineering_workspace_sonnet_limit';
      const windowLabel =
        'Seven day enterprise international design and engineering workspace sonnet limit';
      await page.setViewportSize({ width: 390, height: 900 });
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('cairn-theme', theme);
          localStorage.setItem('cairn.locale', locale);
        },
        { theme, locale },
      );
      await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
        if (path === '/api/teams/t1/claude-subscriptions')
          return json([
            {
              id: 'long-quota-reset',
              kind: 'claude-subscription',
              label: 'Claude subscription — International Design and Engineering Workspace',
              expiresAt: null,
              createdAt: now,
              windows: [
                {
                  name: windowName,
                  utilization: 0.93,
                  resetsAt: now + 73 * 3_600_000,
                  observedAt: now,
                },
              ],
            } satisfies ClaudeSubscriptionListEntry,
          ]);
        if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
        if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
        return undefined;
      });
      await page.goto('/app/settings/routing');
      const detail = page.getByTestId('subscription-detail');
      const name = detail.getByTestId('subscription-quota-name');
      const remaining = detail.getByTestId('subscription-quota-remaining');
      const reset = detail.getByTestId('subscription-quota-reset');
      await expect(name).toHaveText(windowLabel);
      await expect(name).toHaveAttribute('title', windowLabel);
      await expect(remaining).toHaveText(locale === 'zh' ? '剩 7%' : '7% left');
      await expect(reset).toHaveText(locale === 'zh' ? /· .+ 重置/ : /· Resets .+/);
      const badge = page.getByTestId('subscription-quota-mini');
      await expect(badge).toHaveText((await remaining.textContent())!);
      await expect(remaining).toHaveAttribute(
        'aria-label',
        (await badge.getAttribute('aria-label')) ?? '',
      );
      const nameBox = await name.boundingBox();
      const barBox = await detail.getByRole('progressbar').boundingBox();
      const remainingBox = await remaining.boundingBox();
      if (nameBox === null || barBox === null || remainingBox === null)
        throw new Error('R1: the name, bar and remaining value must have measurable geometry');
      for (const box of [nameBox, barBox]) {
        expect(box.width, 'R1: the name and bar retain visible width').toBeGreaterThan(0);
        expect(
          box.y + box.height / 2,
          'R1: name, bar and remaining share one line',
        ).toBeCloseTo(remainingBox.y + remainingBox.height / 2, 0);
      }
      expect(nameBox.x + nameBox.width, 'R1: the name never overlaps the bar').toBeLessThanOrEqual(
        barBox.x,
      );
      expect(barBox.x + barBox.width, 'R1: the bar never overlaps the value').toBeLessThanOrEqual(
        remainingBox.x,
      );
      await expect(name).toHaveCSS('text-overflow', 'ellipsis');
      for (const target of [remaining, reset]) {
        await expect(target).toHaveCSS('white-space', 'nowrap');
        const geometry = await target.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const box = element.getBoundingClientRect();
          const text = range.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            textLeft: text.left,
            textRight: text.right,
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflow: getComputedStyle(element).textOverflow,
          };
        });
        expect(geometry.overflow, 'R1: numbers are never ellipsized').not.toBe('ellipsis');
        expect(geometry.scrollWidth, 'R1: numbers are not clipped').toBeLessThanOrEqual(geometry.width);
        expect(geometry.textLeft, 'R1: glyphs fit inside their box').toBeGreaterThanOrEqual(
          geometry.left - 1,
        );
        expect(geometry.textRight, 'R1: glyphs fit inside their box').toBeLessThanOrEqual(
          geometry.right + 1,
        );
        expect(geometry.left, 'R1: numbers stay inside the viewport').toBeGreaterThanOrEqual(0);
        expect(geometry.right, 'R1: numbers stay inside the viewport').toBeLessThanOrEqual(390);
      }
      const resetBox = await reset.boundingBox();
      if (resetBox === null) throw new Error('R1: the reset time must have measurable geometry');
      expect(
        remainingBox.y + remainingBox.height / 2,
        'R1: remaining and reset share one line',
      ).toBeCloseTo(resetBox.y + resetBox.height / 2, 0);
      expect(
        remainingBox.x + remainingBox.width,
        'R1: values do not overlap',
      ).toBeLessThanOrEqual(resetBox.x);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        'R1: no horizontal scroll at 390px',
      ).toBeLessThanOrEqual(390);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const locale of ['zh', 'en'] as const) {
    for (const width of [1440, 390]) {
      test(`C1 R1: quota tracks and readings share columns with mixed resets (${theme}, ${locale}, ${width}px)`, async ({ page }) => {
        const now = Date.now();
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(({ theme, locale }) => {
          localStorage.setItem('cairn-theme', theme);
          localStorage.setItem('cairn.locale', locale);
        }, { theme, locale });
        await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
          if (path === '/api/teams/t1/claude-subscriptions') return json([{
            id: 'shared-quota',
            kind: 'claude-subscription',
            label: 'Claude engineering subscription',
            expiresAt: null,
            createdAt: now,
            windows: [
              { name: 'five_hour', utilization: 0.7, resetsAt: now + 2 * 3_600_000, observedAt: now },
              { name: 'seven_day', utilization: 0.7, resetsAt: null, observedAt: now },
              { name: 'billing_period', utilization: 0.93, resetsAt: now + 73 * 3_600_000, observedAt: now },
            ],
          } satisfies ClaudeSubscriptionListEntry]);
          if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
          if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
          return undefined;
        });
        await page.goto('/app/settings/routing');
        const rows = page.getByTestId('subscription-quota-window');
        await expect(rows).toHaveCount(3);
        const geometry = await rows.evaluateAll((elements) => elements.map((row) => {
          const rect = (selector: string) => {
            const element = row.querySelector(selector);
            if (element === null) return null;
            const box = element.getBoundingClientRect();
            return { x: box.x, width: box.width };
          };
          return {
            bar: rect('[role=progressbar]'),
            remaining: rect('[data-testid=subscription-quota-remaining]'),
            reset: rect('[data-testid=subscription-quota-reset]'),
          };
        }));
        for (const row of geometry) {
          expect(row.bar?.width, 'R1: the track retains visible width').toBeGreaterThan(0);
          for (const column of ['bar', 'remaining'] as const) {
            expect(row[column]?.x, `C1: ${column} has a shared leading edge`).toBeCloseTo(geometry[0]![column]!.x, 1);
            expect(row[column]?.width, `C1: ${column} has a shared width`).toBeCloseTo(geometry[0]![column]!.width, 1);
          }
        }
        expect(geometry[1]?.reset).toBeNull();
        expect(geometry[2]?.reset?.x, 'C1: reset times have a fixed column').toBeCloseTo(geometry[0]!.reset!.x, 1);
        const fills = await page.getByRole('progressbar').evaluateAll((bars) => bars.map((bar) => bar.firstElementChild!.getBoundingClientRect().width));
        expect(fills[0], 'C1: equal percentages paint equal lengths').toBeCloseTo(fills[1]!, 1);
        expect(fills[2], 'C1: less quota paints a shorter length').toBeLessThan(fills[0]!);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), 'R1: no horizontal scroll').toBeLessThanOrEqual(width);
      });
    }
  }
}

test('C1: the cooling fixture row button announces the same status as its detail', async ({ page }) => {
  await page.goto(URL);
  const row = page.locator('[data-instance-id="subscription:sub-work"]');
  await row.click();
  const status = page.getByTestId('subscription-status');
  await expect(status).toHaveText(/^冷却至 .+/);
  await expect(row.locator('svg.lucide-clock-3')).toBeVisible();
  const subtitle = row.getByTestId('provider-subtitle');
  await expect(subtitle).toHaveText(/^订阅 · \d+ 个模型$/);
  await expect(row.getByRole('button')).toHaveAccessibleName(
    `Work ${await subtitle.textContent()} ${await status.textContent()}`,
  );
});

for (const { state, status, icon } of [
  { state: 'exhausted', status: '额度用尽', icon: 'circle-minus' },
  { state: 'expired', status: '已过期', icon: 'circle-x' },
] as const) {
  test(`C1: the ${state} row button announces the same status as its detail`, async ({ page }) => {
    const account: ClaudeSubscriptionListEntry = {
      id: 'status',
      kind: 'claude-subscription',
      label: 'Claude',
      expiresAt: state === 'expired' ? 0 : null,
      createdAt: 0,
      ...(state === 'exhausted' ? { state: 'exhausted' } : {}),
      cooldownUntil: null,
    };
    await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
      if (path === '/api/teams/t1/claude-subscriptions') return json([account]);
      if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
      if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
      return undefined;
    });
    await page.goto('/app/settings/routing');
    const row = page.getByTestId('provider-instance');
    await expect(row.getByRole('button')).toHaveAccessibleName(`Claude 订阅 · 0 个模型 ${status}`);
    await expect(row.getByTestId('provider-subtitle')).toHaveText('订阅 · 0 个模型');
    await expect(page.getByTestId('subscription-status')).toHaveText(status);
    await expect(row.locator(`svg.lucide-${icon}`)).toBeVisible();
    await expect(row).not.toContainText(status);
  });
}

test('the Personal detail reads last use, models and each quota window in one place, with no check status', async ({
  page,
}) => {
  await page.goto(URL);
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-status')).toHaveCount(0);
  await expect(detail).not.toContainText('可用');
  await expect(detail).toContainText('最近使用');
  await expect(detail.getByTestId('subscription-model')).toHaveCount(4);
  await expect(detail.getByTestId('subscription-model').first()).toContainText('claude-opus-4-5');
  await expect(detail.getByRole('progressbar')).toHaveCount(2);
  await expect(detail).not.toContainText('还没有额度读数');
  await expect(detail).not.toContainText('—');
});

for (const theme of ['light', 'dark'] as const) {
  for (const locale of ['zh', 'en'] as const) {
    test(`R1: last use fits beside Verify at 390px (${theme}, ${locale})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.addInitScript(
        ({ theme, locale }) => {
          localStorage.setItem('cairn-theme', theme);
          localStorage.setItem('cairn.locale', locale);
        },
        { theme, locale },
      );
      await page.goto(URL);
      const detail = page.getByTestId('subscription-detail');
      const metadata = detail.getByText(/^(订阅|Subscription) · Max · (最近使用|Last used)/);
      const verify = detail.getByTestId('subscription-verify');
      await expect(metadata).toBeVisible();
      await expect(verify).toBeVisible();
      const verifyBox = await verify.boundingBox();
      expect(verifyBox).not.toBeNull();
      const geometry = await metadata.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const box = element.getBoundingClientRect();
        return {
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
          text: [...range.getClientRects()].map((rect) => ({
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          })),
          pageWidth: document.documentElement.scrollWidth,
        };
      });
      expect(
        geometry.scrollWidth,
        'R1: metadata has no clipped horizontal content',
      ).toBeLessThanOrEqual(geometry.width);
      expect(geometry.text.length, 'R1: metadata has measurable text').toBeGreaterThan(0);
      for (const rect of geometry.text) {
        expect(rect.left, 'R1: text stays within metadata').toBeGreaterThanOrEqual(
          geometry.box.left - 1,
        );
        expect(rect.right, 'R1: last use is not ellipsized beside Verify').toBeLessThanOrEqual(
          geometry.box.right + 1,
        );
        expect(rect.top, 'R1: wrapped text stays within metadata').toBeGreaterThanOrEqual(
          geometry.box.top - 1,
        );
        expect(rect.bottom, 'R1: wrapped text stays within metadata').toBeLessThanOrEqual(
          geometry.box.bottom + 1,
        );
        expect(
          verifyBox !== null &&
            rect.left < verifyBox.x + verifyBox.width &&
            rect.right > verifyBox.x &&
            rect.top < verifyBox.y + verifyBox.height &&
            rect.bottom > verifyBox.y,
          'R1: metadata does not overlap Verify',
        ).toBe(false);
      }
      expect(geometry.pageWidth, 'R1: no horizontal scroll at 390px').toBeLessThanOrEqual(390);
      await expect(page.getByTestId('provider-subtitle').first()).toHaveCSS('white-space', 'nowrap');
    });
  }
}

test('the Devin subscription lists its catalog models and shows no quota section', async ({
  page,
}) => {
  await page.goto(URL);
  const row = page.locator('[data-instance-id="subscription:sub-devin"]');
  await expect(row.getByText('订阅 · 5 个模型', { exact: true })).toBeVisible();
  await expect(row.getByTestId('subscription-quota-mini')).toHaveCount(0);
  await row.click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByTestId('subscription-model')).toHaveCount(5);
  await expect(detail.getByTestId('subscription-model').first()).toContainText('SWE-2');
  await expect(detail.getByTestId('subscription-model').first()).toContainText('swe-2-high');
  await expect(detail).not.toContainText('额度');
  await expect(detail.getByTestId('subscription-usage-note')).toHaveText('Devin 不提供剩余用量');
  await expect(detail).not.toContainText('—');
});

test('subscriptions whose Runner reports nothing: Claude reads 0 models and warns, the Devin catalog still shows', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=model-routing-no-runner');
  const row = page.locator('[data-instance-id="subscription:sub-personal"]');
  await expect(row.getByText('订阅 · 0 个模型', { exact: true })).toBeVisible();
  await expect(row).toHaveAttribute('data-tone', 'warn');
  await row.click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail).toContainText('尚未勾选模型。从上游获取模型清单后勾选。');
  const devin = page.locator('[data-instance-id="subscription:sub-devin"]');
  await expect(devin.getByText('订阅 · 5 个模型', { exact: true })).toBeVisible();
  await expect(devin).toHaveAttribute('data-tone', 'ok');
  await devin.click();
  await expect(detail.getByTestId('subscription-model')).toHaveCount(5);
});

test('an account nobody has used says so once, and still has a quota line of its own', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/claude-subscriptions')
      return json([
        {
          id: 's1',
          kind: 'claude-subscription',
          label: 'Fresh',
          expiresAt: null,
          createdAt: 0,
        } satisfies ClaudeSubscriptionListEntry,
      ]);
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/settings/routing');
  const row = page.getByTestId('provider-instance');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('订阅 · 0 个模型');
  await expect(row).not.toContainText('未验证');
  await expect(row).not.toContainText('最近使用');
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByText('尚未使用')).toHaveCount(1);
  await expect(detail).toContainText('尚未勾选模型。从上游获取模型清单后勾选。');
  await expect(detail.getByTestId('subscription-status')).toHaveCount(0);
  await expect(detail.getByTestId('subscription-verify-feedback')).toHaveCount(0);
  await expect(detail.getByTestId('subscription-quota')).toHaveCount(0);
  await expect(detail).not.toContainText('—');
});
