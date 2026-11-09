import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, taskEntry, THREAD } from './chief-home-mock';

const LONG = 'Rework the credential relay so a machine that reconnects mid-run keeps its lease';

async function open(page: Page) {
  const now = Date.now();
  const projects = [
    PROJECT,
    ...['atlas', 'harbor', 'ledger', 'orchard', 'quarry', 'signal'].map((name, i) => ({
      ...PROJECT,
      id: `proj-${i + 2}`,
      name,
      group: i < 2 ? null : 'Side projects',
    })),
    { ...PROJECT, id: 'proj-old', name: 'attic', archivedAt: now },
  ];
  const tasks = [
    taskEntry({ id: 't-ask', title: 'Pick a provider', phase: 'confirm', section: 'needs_input' }),
    taskEntry({ id: 't-run', title: LONG, phase: 'building', section: 'working', projectId: 'proj-4' }),
  ];
  const tasksReady = Promise.withResolvers<void>();
  await mockLive(page, { threads: [THREAD], messages: [], todos: [], tasks, projects }, (path, _route, json) => {
    if (path !== '/api/tasks') return undefined;
    return tasksReady.promise.then(() => json({ entries: tasks }));
  });
  await page.goto('/app?project=proj-2');
  if (page.viewportSize()!.width < 640) {
    await page.getByRole('button', { name: '展开侧边栏' }).click();
  }
  await expect(page.locator('aside [data-slot="sidebar-project-row"]').first()).toBeVisible();
  return tasksReady.resolve;
}

const probe = (page: Page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('aside [data-slot="sidebar-project-row"]')];
    const list = document.querySelector<HTMLElement>('aside nav')!;
    const rgb = (value: string) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r = 0, g = 0, b = 0, a = 1] = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const hue = (c: { r: number; g: number; b: number }) => {
      const r = c.r / 255;
      const g = c.g / 255;
      const b = c.b / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const l = (max + min) / 2;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (s <= 0.15 || l < 0.1 || l > 0.9) return null;
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.round(((h * 60 + 360) % 360) / 30) % 12;
    };
    const hues = new Set<number>();
    for (const el of list.querySelectorAll<SVGElement | HTMLElement>('*')) {
      const cs = getComputedStyle(el);
      for (const value of [cs.color, cs.backgroundColor, cs.borderTopColor, cs.fill, cs.stroke]) {
        const c = rgb(value);
        if (c === null || c.a < 0.3) continue;
        const h = hue(c);
        if (h !== null) hues.add(h);
      }
    }
    const neutral = (el: Element) => {
      const c = rgb(getComputedStyle(el).color);
      return c === null || hue(c) === null;
    };
    return {
      hues: hues.size,
      rows: rows.map((row) => {
        const rect = row.getBoundingClientRect();
        const title = row.querySelector<HTMLElement>('span[title]')!;
        const dot = row.querySelector('[data-slot="needs-you-dot"]');
        const glyph = row.querySelector('[data-slot="project-glyph"]')!;
        return {
          name: title.textContent,
          titleShare: title.getBoundingClientRect().width / rect.width,
          neutralGlyph: neutral(glyph),
          dotHue: dot === null ? null : hue(rgb(getComputedStyle(dot).backgroundColor)!),
          hasTime: /\d+\s*(天|小时|分|d|h|m)\b/.test(row.textContent ?? ''),
          borderHue: hue(rgb(getComputedStyle(row).borderTopColor) ?? { r: 0, g: 0, b: 0 }),
        };
      }),
      avatars: list.querySelectorAll('.project-avatar').length,
      headers: [...document.querySelectorAll<HTMLElement>('aside [data-testid="project-group-header"]')].map(
        (el) => el.textContent,
      ),
    };
  });

for (const scheme of ['dark', 'light'] as const) {
  for (const width of [1440, 375]) {
    test(`L1-L7 hold at ${width}px in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 800 });
      const releaseTasks = await open(page);
      const dots = page.locator('aside [data-slot="needs-you-dot"]');
      await expect(dots).toHaveCount(0);
      releaseTasks();
      await expect(dots).toHaveCount(1);
      const m = await probe(page);

      expect(m.hues, 'L1: distinct chromatic hues in the list').toBeLessThanOrEqual(2);
      expect(m.avatars, 'L3: colored letter avatars').toBe(0);
      expect(m.headers, 'L5: owner groups after the ungrouped projects').toEqual(['Side projects']);
      expect(m.rows.map((row) => row.name), 'L5: archived projects show nowhere').toEqual([
        'cairn',
        'atlas',
        'harbor',
        'ledger',
        'orchard',
        'quarry',
        'signal',
      ]);
      for (const row of m.rows) {
        expect(row.titleShare, `L4: title share of ${row.name}`).toBeGreaterThanOrEqual(0.55);
        expect(row.neutralGlyph, `L2: glyph of ${row.name} is neutral`).toBe(true);
        expect(row.hasTime, `L6: ${row.name} holds no time text`).toBe(false);
        expect(row.borderHue, 'L7: no hued border').toBeNull();
      }
      expect(
        m.rows.filter((row) => row.dotHue !== null).map((row) => row.name),
        'L2: only a project with a task waiting on the owner takes the accent',
      ).toEqual(['cairn']);
    });
  }
}
