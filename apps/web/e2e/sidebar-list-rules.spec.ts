import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

const MIN = 60_000;
const LONG = 'Rework the credential relay so a machine that reconnects mid-run keeps its lease';

async function open(page: Page) {
  const now = Date.now();
  const projects = [
    PROJECT,
    ...['atlas', 'harbor', 'ledger', 'orchard', 'quarry', 'signal'].map((name, i) => ({
      ...PROJECT,
      id: `proj-${i + 2}`,
      name,
    })),
  ];
  const todo = (id: string, title: string, phase: string, ago: number, extra = {}) => ({
    ...TASK,
    id,
    title,
    phase,
    phaseAt: now - ago * MIN,
    ...extra,
  });
  const todos = [
    todo('t-ask', 'Pick a provider for the first run', 'confirm', 5),
    todo('t-rev', LONG, 'review', 40),
    todo('t-fail', 'Failed deploy to staging', 'failed', 180),
    todo('t-run', 'Run the build', 'building', 12),
    todo('t-run2', LONG, 'planning', 3, { projectId: 'proj-2' }),
    todo('t-idle', 'Draft the release notes', 'todo', 600),
    todo('t-done', 'Finished work', 'done', 2),
    todo('t-arch', 'Archived work', 'building', 1, { archivedAt: now }),
  ];
  await mockLive(page, { threads: [THREAD], messages: [], todos, projects });
  await page.goto('/app');
  if (page.viewportSize()!.width < 640) {
    await page.getByRole('button', { name: '展开侧边栏' }).click();
  }
  await expect(page.getByTestId('thread-groups')).toBeVisible();
}

const probe = (page: Page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('aside [data-slot="sidebar-thread-row"]')];
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
      if (s <= 0.15) return null;
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
        const title = row.querySelector<HTMLElement>('[data-slot="sidebar-thread-title"]')!;
        const glyph = row.querySelector('svg')!;
        return {
          state: row.dataset.state,
          titleShare: title.getBoundingClientRect().width / rect.width,
          neutralGlyph: neutral(glyph),
          tag: row.querySelector('[data-slot="sidebar-thread-tag"]')?.textContent ?? null,
          meta: row.querySelector('[data-slot="sidebar-thread-meta"]')?.textContent ?? null,
          bg: getComputedStyle(row).backgroundColor,
          borderHue: hue(rgb(getComputedStyle(row).borderTopColor) ?? { r: 0, g: 0, b: 0 }),
        };
      }),
      avatars: list.querySelectorAll('.project-avatar').length,
      headers: [...document.querySelectorAll('aside [data-testid^="thread-group-"]')].map(
        (el) => (el as HTMLElement).dataset.testid,
      ),
    };
  });

for (const scheme of ['dark', 'light'] as const) {
  for (const width of [1440, 375]) {
    test(`L1-L7 hold at ${width}px in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      const m = await probe(page);

      expect(m.hues, 'L1: distinct chromatic hues in the list').toBeLessThanOrEqual(2);
      expect(m.avatars, 'L3: colored letter avatars').toBe(0);
      expect(m.headers, 'L5: group order').toEqual([
        'thread-group-needs-you',
        'thread-group-running',
        'thread-group-done',
      ]);
      expect(m.rows.length).toBeGreaterThan(0);
      for (const row of m.rows) {
        expect(row.titleShare, `L4: title share of a ${row.state} row`).toBeGreaterThanOrEqual(0.6);
        if (row.state !== 'needs-you') {
          expect(row.neutralGlyph, `L2: glyph of a ${row.state} row is neutral`).toBe(true);
        }
        if (row.state === 'failed') expect(row.tag, 'L2: failed carries a text tag').toBe('失败');
        if (row.state !== 'running') expect(row.meta, 'L6: resting time only on running').toBeNull();
        expect(row.borderHue, 'L7: no hued border').toBeNull();
      }
      const running = m.rows.find((r) => r.state === 'running')!;
      expect(running.meta, 'L6: running shows elapsed').not.toBeNull();
      const resting = m.rows.find((r) => r.state === 'idle')!;
      expect(running.bg, 'L7: running row differs from a resting row').not.toBe(resting.bg);
    });
  }
}
