// Paper resource pages evidence: skills, MCP, secrets, machines, machine
// detail and providers, empty and populated where a
// fixture scenario exists, plus the create dialogs. Light and dark,
// 1440x900 at DPR 2, from a fixture build served by vite preview.
//   node docs/verify/paper-resource-pages/capture.mjs <label> <baseUrl>
// label = before | after.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const MACHINE = 'Kd8fG2hJ4mN9pQ1rStUvWx3';
const shots = [
  { name: 'skills-empty', url: '/app/resources/skills?scenario=01' },
  { name: 'skills-list', url: '/app/resources/skills?scenario=06' },
  { name: 'mcp-empty', url: '/app/resources/mcp-servers?scenario=01' },
  { name: 'mcp-list', url: '/app/resources/mcp-servers?scenario=07' },
  { name: 'secrets-empty', url: '/app/resources/secrets?scenario=01' },
  { name: 'secrets-list', url: '/app/resources/secrets?scenario=agent-detail-secrets' },
  { name: 'machines-empty', url: '/app/resources/machines?scenario=01' },
  { name: 'machines-list', url: '/app/resources/machines?scenario=06' },
  { name: 'machines-chief', url: '/app/resources/machines?scenario=machines-chief-state' },
  { name: 'machine-detail', url: `/app/resources/machines/${MACHINE}?scenario=06` },
  { name: 'providers-empty', url: '/app/resources/providers?scenario=01' },
  { name: 'providers-pi', url: '/app/resources/providers?scenario=06' },
  { name: 'providers-cc', url: '/app/resources/providers?scenario=06&runtime=claude-code' },
  { name: 'providers-cc-missing', url: '/app/resources/providers?scenario=10-cc-missing&runtime=claude-code' },
  { name: 'dialog-skill', url: '/app/resources/skills?scenario=06', click: '[data-testid="resource-new"]' },
  { name: 'dialog-skill-import', url: '/app/resources/skills?scenario=06', click: '[data-testid="resource-import"]' },
  { name: 'dialog-secret', url: '/app/resources/secrets?scenario=01', click: '[data-testid="resource-new"]' },
  { name: 'dialog-provider', url: '/app/resources/providers?scenario=06', click: '[data-testid="resource-new"]' },
  { name: 'dialog-machine', url: '/app/resources/machines?scenario=06', clickText: '添加机器' },
];

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
    await page.locator('[data-testid="page-col"]').first().waitFor();
    if (shot.click) await page.locator(shot.click).first().click();
    if (shot.clickText) await page.getByRole('button', { name: shot.clickText }).first().click();
    if (shot.click || shot.clickText) {
      await page.getByRole('dialog').first().waitFor();
    }
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    await context.close();
  }
}
await browser.close();
