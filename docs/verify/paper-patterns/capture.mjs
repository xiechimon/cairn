// Paper page patterns evidence: the account page, the agent overview and the
// API keys empty state, light and dark, 1440x900 at DPR 2, from a fixture
// build served by vite preview.
//   node docs/verify/paper-patterns/capture.mjs <label> <baseUrl>
// label = before | after. Also writes <label>-metrics.json with card radii,
// row heights and the empty-state icon and button faces.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'account', url: '/app/account?scenario=13', wait: '[data-route="account"] [data-slot="card"]' },
  {
    name: 'agent',
    url: '/app/resources/agents/r3-builder?scenario=agent-detail',
    wait: '.agent-overview [data-slot="card"]',
  },
  { name: 'api-keys', url: '/app/api-keys', wait: '[data-testid="keys-empty"]' },
  { name: 'board', url: '/app?scenario=01', wait: '.todo-card', shot: false },
];

function cardFace(card) {
  const cs = getComputedStyle(card);
  return {
    radius: cs.borderTopLeftRadius,
    shadow: cs.boxShadow,
    bg: cs.backgroundColor,
    rows: [...card.children].map((el) => ({
      h: el.getBoundingClientRect().height,
      top: getComputedStyle(el).borderTopWidth,
      bottom: getComputedStyle(el).borderBottomWidth,
      bg: getComputedStyle(el).backgroundColor,
    })),
  };
}

function emptyFace(empty) {
  const svg = empty.querySelector('svg');
  const media = svg?.parentElement;
  const button = empty.querySelector('button');
  const title = empty.querySelector('h2');
  const desc = empty.querySelector('p');
  const read = (el, keys) =>
    el ? Object.fromEntries(keys.map((k) => [k, getComputedStyle(el)[k]])) : null;
  return {
    icon: svg ? { color: getComputedStyle(svg).color, size: svg.getBoundingClientRect().width } : null,
    media: read(media, ['backgroundColor', 'width', 'height']),
    title: read(title, ['fontSize', 'fontWeight', 'color']),
    desc: { ...read(desc, ['fontSize', 'color', 'maxWidth']), width: desc?.getBoundingClientRect().width },
    button: button
      ? {
          variant: button.dataset.variant,
          size: button.dataset.size,
          ...read(button, ['height', 'backgroundColor', 'borderTopLeftRadius', 'fontSize']),
        }
      : null,
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
    await page.locator(shot.wait).first().waitFor();
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.waitForTimeout(800);
    if (shot.shot !== false) {
      await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    }
    const target = page.locator(shot.wait).first();
    metrics[`${theme}-${shot.name}`] =
      shot.name === 'api-keys'
        ? await target.evaluate(emptyFace)
        : shot.name === 'board'
          ? { radius: await target.evaluate((el) => getComputedStyle(el).borderTopLeftRadius) }
          : await target.evaluate(cardFace);
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `${label}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
