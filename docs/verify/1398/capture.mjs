// Chief area evidence (#1398), light and dark, 1440x900 at DPR 2, from a
// fixture build served by `vite preview`.
//   node docs/verify/1398/capture.mjs <label> <baseUrl>
// label = before | after. Window shots are clipped to the floating window;
// settings shots are the full page. The chief-question scenario only exists
// on the after build, so the before run records it as missing.
// Also writes <label>-metrics.json (boxes, corners, type sizes).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const WINDOW = 'aside.chief-drawer';

const shots = [
  { name: 'window-gated', url: '/app?scenario=100', window: true },
  { name: 'window-ready', url: '/app?scenario=111', window: true },
  {
    name: 'window-thread',
    url: '/app?scenario=114',
    window: true,
    ready: async (page) => {
      await page.getByRole('button', { name: '展开过程' }).click();
    },
  },
  { name: 'window-switcher', url: '/app?scenario=116', window: true },
  { name: 'window-markdown', url: '/app?scenario=chief-md', window: true },
  { name: 'window-question', url: '/app?scenario=chief-question', window: true, optional: true },
  { name: 'settings-agent', url: '/app?scenario=101' },
  { name: 'settings-charter', url: '/app?scenario=102' },
  { name: 'settings-memory', url: '/app?scenario=103' },
  { name: 'settings-watches', url: '/app?scenario=104' },
];

function measure() {
  const pick = (el) => {
    if (el == null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      radius: cs.borderTopLeftRadius,
      bg: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      serif: /serif/i.test(cs.fontFamily) && !/sans-serif/i.test(cs.fontFamily.split(',')[0]),
      color: cs.color,
    };
  };
  const q = (sel) => pick(document.querySelector(sel));
  const byText = (tag, text) =>
    pick([...document.querySelectorAll(tag)].find((n) => n.textContent?.trim() === text) ?? null);
  const win = document.querySelector('aside.chief-drawer');
  const title = win?.querySelector('header button span');
  const examples = document.querySelector('[data-testid="chief-examples"]');
  return {
    window: pick(win),
    threadTitle: pick(title ?? null),
    titleInset:
      win && title
        ? Math.round(
            (title.closest('button').getBoundingClientRect().x - win.getBoundingClientRect().x) *
              10,
          ) / 10
        : null,
    gateText: byText('span', '请先为总管选择一个 Agent。'),
    gateBanner: pick(
      [...document.querySelectorAll('span')].find(
        (n) => n.textContent?.trim() === '请先为总管选择一个 Agent。',
      )?.parentElement ?? null,
    ),
    gateButton: byText('button', '设置'),
    heroTitle: byText('h2', '选择一个主题开始'),
    exampleCard: pick(examples?.querySelector('button') ?? null),
    exampleTile: pick(examples?.querySelector('button > span') ?? null),
    switcher: q('[role="menu"]'),
    switcherRow: q('[role="menu"] [role="menuitem"]'),
    note: q('[data-testid="chief-stream"] [data-slot="marker"]'),
    foot: q('[data-testid="chief-msg-foot"]'),
    turnTool: q('[data-testid="chief-turn-tools"] > div'),
    composerInput: q('[data-testid="chief-composer-input"]'),
    questionCard: q('[data-testid="chief-question-card"]'),
    settingsTitle: byText('h1', '总管设置'),
    settingsHeader: pick(
      [...document.querySelectorAll('h1')].find((n) => n.textContent?.trim() === '总管设置')
        ?.parentElement ?? null,
    ),
    settingsCard: q('.settings-card'),
    settingsRows: [...document.querySelectorAll('.settings-card > .settings-row')].map(
      (el) => Math.round(el.getBoundingClientRect().height * 10) / 10,
    ),
    editButton: byText('button', '编辑'),
  };
}

const metrics = {};
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`);
    if (shot.window) {
      const win = page.locator(WINDOW);
      const visible = await win
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!visible || (shot.optional && (await page.getByTestId('chief-question-card').count()) === 0)) {
        metrics[`${theme}-${shot.name}`] = 'missing';
        await context.close();
        continue;
      }
      // Let the fade + scale entrance settle before measuring.
      await win.evaluate((el) =>
        Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
      );
    } else {
      await page.getByRole('heading', { name: '总管设置' }).waitFor();
    }
    if (shot.ready) await shot.ready(page);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.waitForTimeout(600);
    const path = join(out, `${label}-${theme}-${shot.name}.png`);
    if (shot.window) await page.locator(WINDOW).screenshot({ path });
    else await page.screenshot({ path });
    metrics[`${theme}-${shot.name}`] = await page.evaluate(measure);
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `${label}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
