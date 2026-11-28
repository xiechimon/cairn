import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const HOME = '/app?scenario=home-c';

async function openSidebar(page: Page) {
  const reopen = page.getByTestId('sidebar-reopen');
  if (await reopen.isVisible()) {
    await reopen.click();
    await page.mouse.move(700, 400);
  }
  await expect(page.locator('aside').first()).toBeVisible();
}

test('C2: core surfaces render no placeholder dashes or empty fixed-ratio boxes', async ({
  page,
}) => {
  for (const [url, readySelector] of [
    [HOME, '[data-testid="home-c"]'],
    ['/app/resources/providers?scenario=01', '[data-testid="provider-editor"]'],
    ['/app/settings/machines?scenario=06', '[data-testid="machine-item"]'],
    ['/app/usage?scenario=home-c', '[data-day]'],
  ] as const) {
    await page.goto(url);
    await expect(page.locator(readySelector).first()).toBeVisible();
    const placeholders = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('main *')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (
          el.childElementCount === 0 &&
          /^[\s—·-]+$/.test(el.textContent ?? '') &&
          !/[—·-]{2,}/.test('') &&
          (el.textContent ?? '').trim() !== '' &&
          el.closest('[aria-hidden="true"], svg, code, pre') === null
        ) {
          bad.push(`dash:${(el.textContent ?? '').trim()}`);
        }
        if (
          el.tagName === 'DIV' &&
          el.childElementCount === 0 &&
          (el.textContent ?? '').trim() === '' &&
          rect.width >= 120 &&
          rect.height >= 120 &&
          getComputedStyle(el).borderStyle !== 'none'
        ) {
          bad.push(`empty-box:${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
      return bad;
    });
    expect(placeholders, `C2: placeholder elements on ${url}`).toEqual([]);
  }
});

test('C7: disabled controls sit beside clear explanatory context', async ({ page }) => {
  await page.goto('/app/todo/r8-12?scenario=54');
  const panel = page.getByTestId('side-chat-panel');
  const send = panel.locator('.composer-send');
  const textarea = panel.locator('textarea[data-compose-target]');
  await expect(send).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(textarea).toHaveAttribute('placeholder', '回复这个任务');
  await textarea.fill('ok');
  await expect(send).toBeEnabled();

  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/settings/routing');
  await expect(page.getByTestId('frequent-models-add')).toBeDisabled();
  await expect(page.getByTestId('frequent-models-empty')).toHaveText(
    '暂无可添加的模型。',
  );
});

test('V12: chrome stays within 2 non-neutral hue families beyond semantic role colors', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(page.getByTestId('home-c')).toBeVisible();
  const extraHues = await page.evaluate(() => {
    const bucket = (cssColor: string): number | null => {
      const m = cssColor.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m === null) return null;
      const a = m[4] === undefined ? 1 : Number(m[4]);
      if (a < 0.05) return null;
      const r = Number(m[1]) / 255;
      const g = Number(m[2]) / 255;
      const b = Number(m[3]) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d < 0.14) return null;
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      const deg = Math.round(((h * 60) + 360) % 360);
      return Math.floor(deg / 30);
    };
    const roleOrExtra = new Set<number>();
    for (const el of document.querySelectorAll('body *')) {
      if (
        el.closest(
          '[data-slot="avatar"], [data-testid="provider-instance"], pre, code, svg, [data-status]',
        ) !== null
      ) {
        continue;
      }
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      for (const c of [st.color, st.backgroundColor]) {
        const b = bucket(c);
        if (b !== null) roleOrExtra.add(b);
      }
    }
    return [...roleOrExtra];
  });
  expect(extraHues.length, `V12: chromatic hue buckets (${extraHues.join(',')})`).toBeLessThanOrEqual(
    5,
  );
});

test('V13: rendered screen chrome stays within the token size and weight budget', async ({
  page,
}) => {
  await page.goto('/app/resources/providers?scenario=01');
  await expect(page.getByTestId('provider-editor')).toBeVisible();
  const stats = await page.evaluate(() => {
    const sizes = new Set<string>();
    const weights = new Set<string>();
    const pairs = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.nodeValue ?? '').trim() === '') continue;
      const el = node.parentElement;
      if (el === null || el.closest('pre, code, svg') !== null) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden') continue;
      sizes.add(st.fontSize);
      weights.add(st.fontWeight);
      pairs.add(`${st.fontSize}/${st.fontWeight}`);
    }
    return {
      sizes: [...sizes],
      weights: [...weights],
      pairs: [...pairs],
    };
  });
  expect(stats.sizes.length, `V13: font sizes ${stats.sizes.join(',')}`).toBeLessThanOrEqual(6);
  expect(stats.weights.length, `V13: font weights ${stats.weights.join(',')}`).toBeLessThanOrEqual(
    3,
  );
  expect(stats.pairs.length, `V13: size/weight pairs ${stats.pairs.join(',')}`).toBeLessThanOrEqual(
    9,
  );
});

test('V15: screen stays within the badge budget (<= 3 tinted pills excluding task glyphs)', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(page.getByTestId('home-c')).toBeVisible();
  const badgeCount = await page.evaluate(() => {
    let count = 0;
    for (const el of document.querySelectorAll('[data-slot="badge"]')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.closest('kbd, [data-slot="status-chip"], [data-slot="tone-glyph"]') !== null) continue;
      count += 1;
    }
    return count;
  });
  expect(badgeCount, 'V15: tinted short-text badge count on screen').toBeLessThanOrEqual(3);
});

test('V17: consecutive chat messages from one speaker never repeat avatars', async ({ page }) => {
  await page.goto('/app?scenario=chief-md-ref');
  const stream = page.getByTestId('home-c').getByTestId('chief-stream');
  await expect(stream).toBeVisible();
  await expect(stream.getByTestId('chief-msg').first()).toBeVisible();
  const res = await page.evaluate(() => {
    const messages = [
      ...document.querySelectorAll(
        '[data-testid="chief-stream"] [data-testid="chief-msg"], [data-testid="chief-stream"] [data-testid="chief-bubble"]',
      ),
    ];
    let repeats = 0;
    for (let i = 1; i < messages.length; i++) {
      const prevKind = messages[i - 1]?.getAttribute('data-testid');
      const curKind = messages[i]?.getAttribute('data-testid');
      const hasAvatar = messages[i]?.querySelector('[data-slot="avatar"]') !== null;
      if (prevKind !== null && prevKind === curKind && hasAvatar) repeats += 1;
    }
    const innerBubbles = document.querySelectorAll(
      '[data-testid="chief-stream"] [data-testid="chief-reply-bubble"]',
    ).length;
    return { count: messages.length + innerBubbles, repeats };
  });
  expect(res.count, 'V17: conversation stream rendered multiple message blocks').toBeGreaterThanOrEqual(
    2,
  );
  expect(res.repeats, 'V17: repeated avatar on consecutive same-speaker rows').toBe(0);
});

test('V18: tasks panel folds sibling rows under status section headings', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks`);
  await expect(page.getByRole('complementary', { name: '任务' })).toBeVisible();
  const ungrouped = await page.evaluate(() => {
    const panel = document.querySelector('aside[aria-label="任务"], [aria-label="任务"]');
    if (panel === null) return -1;
    const rows = panel.querySelectorAll('[data-slot="task-row"], [data-testid="task-row"]');
    const insideSection = panel.querySelectorAll(
      '[data-section] [data-slot="task-row"], [data-section] [data-testid="task-row"]',
    );
    return rows.length - insideSection.length;
  });
  expect(ungrouped, 'V18: task rows sitting outside a status section').toBe(0);
});

test('L1/L3/L4/L6/L7: sidebar rows satisfy hue, avatar, title-width, no-duration and neutral border rules', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  await openSidebar(page);
  const report = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    if (aside === null) return { found: false };
    const projectAvatars = aside.querySelectorAll('.project-avatar').length;
    const durationHits: string[] = [];
    const narrowTitles: string[] = [];
    const chromaticBorders: string[] = [];
    const isNeutralRgb = (c: string) => {
      const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m === null) return true;
      const a = m[4] === undefined ? 1 : Number(m[4]);
      if (a < 0.05) return true;
      return Math.max(Number(m[1]), Number(m[2]), Number(m[3])) -
        Math.min(Number(m[1]), Number(m[2]), Number(m[3])) <= 10;
    };
    const hueBucket = (c: string): number | null => {
      const m = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m === null) return null;
      const a = m[4] === undefined ? 1 : Number(m[4]);
      if (a < 0.05) return null;
      const r = Number(m[1]) / 255;
      const g = Number(m[2]) / 255;
      const b = Number(m[3]) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d < 0.14) return null;
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.floor(((h * 60 + 360) % 360) / 30);
    };
    const hueBuckets = new Set<number>();
    const tintedLetters: string[] = [];
    for (const el of aside.querySelectorAll('*')) {
      if (el.closest('[data-slot="avatar"]') !== null) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      for (const c of [st.color, st.backgroundColor]) {
        const bucket = hueBucket(c);
        if (bucket !== null) hueBuckets.add(bucket);
      }
      if (
        el.childElementCount === 0 &&
        (el.textContent ?? '').trim().length === 1 &&
        !isNeutralRgb(st.backgroundColor)
      ) {
        tintedLetters.push((el.textContent ?? '').trim());
      }
    }
    const navRows = aside.querySelectorAll('[data-slot="sidebar-nav-row"]');
    for (const row of navRows) {
      const text = (row.textContent ?? '').trim();
      if (/\b\d+\s*(?:s|m|h|d|min|hr)\b|\d+\s*(?:秒|分钟|小时|天)前/i.test(text)) {
        durationHits.push(text);
      }
      const st = getComputedStyle(row);
      if (!isNeutralRgb(st.borderTopColor) || !isNeutralRgb(st.borderLeftColor)) {
        chromaticBorders.push(`${text}:${st.borderTopColor}`);
      }
    }
    const projectRows = aside.querySelectorAll('[data-slot="sidebar-project-row"]');
    for (const row of projectRows) {
      const text = (row.textContent ?? '').trim();
      if (/\b\d+\s*(?:s|m|h|d|min|hr)\b|\d+\s*(?:秒|分钟|小时|天)前/i.test(text)) {
        durationHits.push(text);
      }
      const st = getComputedStyle(row);
      if (!isNeutralRgb(st.borderTopColor) || !isNeutralRgb(st.borderLeftColor)) {
        chromaticBorders.push(`${text}:${st.borderTopColor}`);
      }
      const rect = row.getBoundingClientRect();
      const label = row.querySelector('span.truncate');
      if (rect.width > 0 && label !== null) {
        const lRect = label.getBoundingClientRect();
        if (lRect.width > 0 && lRect.width / rect.width < 0.55) {
          narrowTitles.push(`${text}:${(lRect.width / rect.width).toFixed(2)}`);
        }
      }
    }
    return {
      found: true,
      rowCount: navRows.length + projectRows.length,
      hueBuckets: [...hueBuckets],
      projectAvatars,
      tintedLetters,
      durationHits,
      narrowTitles,
      chromaticBorders,
    };
  });
  expect(report.found).toBe(true);
  expect(report.hueBuckets?.length ?? 99, 'L1: chromatic hues in sidebar').toBeLessThanOrEqual(2);
  expect(report.projectAvatars, 'L3: .project-avatar count in sidebar').toBe(0);
  expect(report.tintedLetters, 'L3: tinted 1-letter non-avatar badges in sidebar').toEqual([]);
  expect(report.durationHits, 'L6: duration text inside sidebar row').toEqual([]);
  expect(report.narrowTitles, 'L4: sidebar project row title ratio >= 0.55').toEqual([]);
  expect(report.chromaticBorders, 'L7: chromatic border on sidebar row').toEqual([]);
});

test('A8/A9: WCAG 2.2 interactive target sizes >= 24px (desktop) and focus is not obscured', async ({
  page,
}) => {
  for (const [url, ready] of [
    ['/app/resources/providers?scenario=01', '[data-testid="provider-editor"]'],
    ['/app?scenario=01', '[data-testid="home-c"]'],
  ] as const) {
    await page.goto(url);
    await expect(page.locator(ready)).toBeVisible();
    if (url.startsWith('/app?')) await openSidebar(page);
    const undersized = await page.evaluate(() => {
      const els = [
        ...document.querySelectorAll(
          'main button, main [role="button"], main input[type="checkbox"], main input[type="radio"], main select, aside button, aside a[href]',
        ),
      ].filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (getComputedStyle(el).visibility === 'hidden') return false;
        if (el.tagName === 'A' && el.closest('p, li') !== null) return false;
        return true;
      });
      const small: string[] = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width >= 23.5 && r.height >= 23.5) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hitsNeighbor = els.some((other) => {
          if (other === el || other.contains(el) || el.contains(other)) return false;
          const o = other.getBoundingClientRect();
          const dx = Math.max(o.left - cx, 0, cx - o.right);
          const dy = Math.max(o.top - cy, 0, cy - o.bottom);
          return dx * dx + dy * dy < 12 * 12;
        });
        if (hitsNeighbor) {
          small.push(
            `${el.tagName}:${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''}:${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      }
      return small;
    });
    expect(undersized, `A8: desktop target sizes >= 24x24 or spaced on ${url}`).toEqual([]);
  }

  for (const [url, ready] of [
    ['/app?scenario=01', '[data-testid="home-c"]'],
    ['/app/resources/providers?scenario=01', '[data-testid="provider-editor"]'],
  ] as const) {
    await page.goto(url);
    await expect(page.locator(ready)).toBeVisible();
    let checked = 0;
    for (let i = 0; i < 15 && checked < 6; i++) {
      await page.keyboard.press('Tab');
      const probe = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active === document.body) {
          return { skip: true, obscured: false, detail: 'body' };
        }
        const r = active.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) {
          return { skip: true, obscured: false, detail: 'hidden' };
        }
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) {
          return { skip: false, obscured: true, detail: `off-viewport:${active.tagName}` };
        }
        const hit = document.elementFromPoint(cx, cy);
        const obscured =
          hit === null ||
          (hit !== active && !active.contains(hit) && !hit.contains(active));
        return {
          skip: false,
          obscured,
          detail: `${active.tagName}(${active.getAttribute('data-testid') ?? active.getAttribute('aria-label') ?? ''}) hit=${hit?.tagName}.${hit?.className}`,
        };
      });
      if (!probe.skip) {
        checked += 1;
        expect(probe.obscured, `A9: ${probe.detail} on ${url} (WCAG 2.4.11)`).toBe(false);
      }
    }
    expect(checked, `A9: verified at least 4 keyboard focus stops on ${url}`).toBeGreaterThanOrEqual(
      4,
    );
  }
});

test.describe('A8 touch targets under pointer: coarse', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('A8: touch reorder controls and key interactive controls meet 44x44', async ({ page }) => {
    await page.goto('/app/settings/routing?scenario=model-routing');
    await expect(page.getByTestId('provider-editor')).toBeVisible();
    await expect(page.getByTestId('provider-instance').first()).toBeVisible();
    const audit = await page.evaluate(() => {
      const bad: string[] = [];
      let checked = 0;
      for (const el of document.querySelectorAll(
        '[data-testid="provider-instance"] button, [data-testid="frequent-model-drag-grip"], main button[data-slot="button"]',
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        checked += 1;
        if (r.height < 43.5 || r.width < 43.5) {
          bad.push(`${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim()}:${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return { checked, bad };
    });
    expect(audit.checked, 'A8: measured touch controls on providers page').toBeGreaterThanOrEqual(4);
    expect(audit.bad, 'A8: coarse-pointer touch targets >= 44x44').toEqual([]);
  });
});
