import { expect, type Page, test } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

const SURFACES = [
  { name: 'coordinator home', url: '/app?scenario=home-c' },
  { name: 'tasks panel', url: '/app?scenario=home-c&pane=tasks' },
  { name: 'task thread', url: '/app?scenario=home-c&thread=home-c-review' },
  { name: 'computers panel', url: '/app?scenario=home-c-machines&pane=machines' },
  { name: 'settings account', url: '/app/settings/account?scenario=01' },
  { name: 'settings model', url: '/app/settings/routing?scenario=model-routing' },
  { name: 'settings runners', url: '/app/settings/machines?scenario=01' },
  { name: 'settings skills', url: '/app/settings/skills?scenario=01' },
  { name: 'settings apps', url: '/app/settings/mcp?scenario=01' },
  { name: 'settings secrets', url: '/app/settings/secrets?scenario=secrets-list' },
  { name: 'settings api keys', url: '/app/settings/api-keys?scenario=01' },
  { name: 'settings im', url: '/app/settings/im?scenario=01' },
];

const CARD_GRID_OPEN = new Set(['settings apps', 'settings im']);

async function open(page: Page, url: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.mouse.move(0, 0);
}

function visibleTextNodes(page: Page) {
  return page.evaluate(() => {
    const out: { text: string; family: string; where: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (text === '' || el === null || el.closest('[aria-hidden="true"],script,style')) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || box.bottom < 0 || box.top > innerHeight) continue;
      out.push({
        text,
        family: getComputedStyle(el).fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '',
        where: el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName.toLowerCase(),
      });
    }
    return out;
  });
}

for (const surface of SURFACES) {
  test(`${surface.name}: fonts, placeholders, backticks and nested cards follow the rules`, async ({
    page,
  }) => {
    await open(page, surface.url);
    const nodes = await visibleTextNodes(page);
    expect(nodes.length, `${surface.name} rendered no text`).toBeGreaterThan(0);
    expect.soft(
      nodes
        .filter((n) => !/^(sourceSerif4|instrumentSans|jetbrainsMono)( Fallback)?$/.test(n.family))
        .map((n) => `${n.family}: ${n.text.slice(0, 30)} @${n.where}`),
      'V2: every text node uses Source Serif 4, Instrument Sans or JetBrains Mono',
    ).toEqual([]);
    expect.soft(
      nodes.filter((n) => /^[\s—·\-–]+$/.test(n.text)).map((n) => `${n.text} @${n.where}`),
      'V19: no text node is only a dash or a dot',
    ).toEqual([]);
    expect.soft(
      nodes.filter((n) => n.text.includes('`')).map((n) => `${n.text.slice(0, 40)} @${n.where}`),
      'T3: no text node shows a raw backtick',
    ).toEqual([]);
    expect.soft(
      await page.locator('[data-slot=card] [data-slot=card]').count(),
      'V4: no card inside a card',
    ).toBe(0);
  });

  test(`${surface.name}: one filled primary button, sibling actions outlined`, async ({ page }) => {
    await open(page, surface.url);
    const primaries = await page.evaluate(() => {
      const dialogs = document.querySelectorAll('[role=dialog]');
      const scope = dialogs.length > 0 ? dialogs[dialogs.length - 1] : document.body;
      return [...(scope?.querySelectorAll<HTMLElement>('[data-slot=button][data-variant=default]') ?? [])]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter((el) => el.closest('[data-slot=dialog-footer],[data-testid=dialog-foot]') === null)
        .map((el) => (el.textContent ?? el.getAttribute('aria-label') ?? '').trim());
    });
    expect(
      primaries.length,
      `V6: at most one filled primary button per screen, found ${primaries.join(', ')}`,
    ).toBeLessThanOrEqual(1);
  });

  test(`${surface.name}: an object list is rows in one card, not a grid or stack of cards`, async ({
    page,
  }) => {
    await open(page, surface.url);
    const grids = await page.evaluate(() => {
      const found: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const style = getComputedStyle(el);
        if (!/grid|flex/.test(style.display) || el.closest('[data-testid=made-panel]')) continue;
        const cards = [...el.children].filter((child) => {
          const s = getComputedStyle(child);
          return (
            child.getBoundingClientRect().height > 40 &&
            parseFloat(s.borderTopLeftRadius) >= 12 &&
            (s.borderTopWidth !== '0px' || s.boxShadow !== 'none')
          );
        });
        if (cards.length >= 3) {
          found.push(el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.className);
        }
      }
      return found;
    });
    if (CARD_GRID_OPEN.has(surface.name)) {
      expect(
        grids.length,
        `V20: ${surface.name} is listed as an open violation in docs/design/audit-2026-11-20.md; once its list is rows in one card, drop it from CARD_GRID_OPEN`,
      ).toBeGreaterThan(0);
      return;
    }
    expect(grids, 'V20: no grid or stack of three or more identical cards').toEqual([]);
  });

  test(`${surface.name}: no horizontal scroll at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, surface.url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, 'R1: scrollWidth <= innerWidth at 390px').toBeLessThanOrEqual(0);
  });
}
