// Settings-list evidence: the account page and the agent overview, light and
// dark, 1440x900 at DPR 2, from a web dev server that serves fixture scenarios.
//   node docs/verify/paper-settings-list/capture.mjs <label> <baseUrl>
// label = before | after. Also writes <label>-rows.json with every rendered
// row's height and the card's top-edge shadows.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'account', url: '/app/account?scenario=13', card: '.account-card' },
  {
    name: 'agent',
    url: '/app/resources/agents/r3-builder?scenario=agent-detail',
    card: '.agent-overview .profile-card',
  },
];

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
    await page.locator(shot.card).waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    metrics[`${theme}-${shot.name}`] = await page.locator(shot.card).evaluate((card) => {
      const cs = getComputedStyle(card);
      return {
        cardRadius: cs.borderTopLeftRadius,
        cardShadow: cs.boxShadow,
        cardBg: cs.backgroundColor,
        rows: [...card.children].map((el) => ({
          cls: el.className.split(' ')[0],
          h: el.getBoundingClientRect().height,
          bg: getComputedStyle(el).backgroundColor,
          borderTop: getComputedStyle(el).borderTopWidth,
        })),
      };
    });
    const edit = page.getByRole('button', { name: '编辑名称' });
    if (shot.name === 'account' && (await edit.count()) === 1) {
      await edit.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}-editing.png`) });
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `${label}-rows.json`), `${JSON.stringify(metrics, null, 2)}\n`);
