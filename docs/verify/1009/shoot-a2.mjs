// A2 evidence capture (#1009): the detail transcript column before/after the
// registry MessageScroller swap. One-off lane script (not a committed spec) —
// drives the fixture stack's detail scenarios and frames the center column.
//
// Usage (from apps/web, preview already serving on E2E_PORT):
//   E2E_PORT=8403 node docs/verify/1009/shoot-a2.mjs <outdir>

import { chromium } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8403);
const OUT = process.argv[2] ?? '.';
const BASE = `http://127.0.0.1:${PORT}/app`;

// Fixture scenarios: 17b = confirm-phase thread with a spec brief card,
// 36 = done-phase multi-turn transcript (chat-type-measure's own routes).
const ID = '7ve0iOkQ-JBpSL98zSiGc';
const SHOTS = [
  { name: 'a2-detail-confirm-17b', route: `/todo/${ID}?scenario=17b` },
  { name: 'a2-detail-done-36', route: `/todo/${ID}?scenario=36` },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
for (const shot of SHOTS) {
  await page.goto(`${BASE}${shot.route}`);
  await page.waitForSelector('[data-testid="transcript-col"]', { timeout: 15_000 });
  await page.waitForTimeout(400);
  const box = await page.locator('[data-testid="detail-center"]').boundingBox();
  await page.screenshot({
    path: `${OUT}/${shot.name}.png`,
    clip: box ?? undefined,
  });
  console.log(`wrote ${OUT}/${shot.name}.png`);
}
await browser.close();
