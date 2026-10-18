// Paper team pages evidence: team grid, team chart, the agent detail
// permissions and memory tabs, and the create-agent dialog, light and dark,
// 1440x900 at DPR 2, from a web dev server that serves fixture scenarios.
//   node docs/verify/paper-team-pages/capture.mjs <label> <baseUrl>
// label = before | after. Also writes <label>-metrics.json with the agent card
// box, radius, ring and shadow, and the layout switch track and selected tab.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const ROSTER = '/app/team?scenario=team-roster';

const shots = [
  { name: 'team-grid', url: ROSTER, layout: 'grid', ready: '[data-testid="team-agent-card"]' },
  { name: 'team-chart', url: ROSTER, layout: 'chart', ready: '[data-testid="team-chart-node"]' },
  {
    name: 'agent-permissions',
    url: '/app/resources/agents/r3-builder?scenario=agent-detail',
    tab: '权限',
    ready: '.agent-perms',
  },
  {
    name: 'agent-memory',
    url: '/app/resources/agents/r3-builder?scenario=agent-detail',
    tab: '记忆',
    ready: '.agent-memories',
  },
  { name: 'create-agent', url: ROSTER, layout: 'grid', dialog: true, ready: '[role="dialog"][aria-label="创建 agent"]' },
];

const metrics = {};
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addInitScript(
      ([t, layout]) => {
        localStorage.setItem('pacman-theme', t);
        if (layout) localStorage.setItem('pacman.teamMembersLayout', layout);
      },
      [theme, shot.layout ?? null],
    );
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`);
    if (shot.tab) await page.getByRole('tab', { name: shot.tab }).click();
    if (shot.dialog) await page.getByRole('button', { name: '创建 Agent' }).click();
    await page.locator(shot.ready).first().waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    if (shot.name === 'team-grid') {
      metrics[`${theme}-${shot.name}`] = await page.evaluate(() => {
        const card = document.querySelector('[data-testid="team-agent-card"]');
        const list = document.querySelector('[role="tablist"]');
        const active = document.querySelector('[role="tab"][aria-selected="true"]');
        const box = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            w: r.width,
            h: r.height,
            radius: cs.borderTopLeftRadius,
            bg: cs.backgroundColor,
            shadow: cs.boxShadow,
          };
        };
        return {
          card: box(card),
          cardCount: document.querySelectorAll('[data-testid="team-agent-card"]').length,
          switchTrack: box(list),
          switchSelected: box(active),
        };
      });
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `${label}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
