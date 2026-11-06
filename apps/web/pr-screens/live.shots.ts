import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { ONLY, prepare, record, recordError, slugOf, THEMES } from './capture-core.js';
import { type LiveState, STATE_PAGES } from './state-pages.js';

const PORTS = {
  empty: Number(process.env.PR_SCREENS_EMPTY_PORT ?? 8441),
  seeded: Number(process.env.PR_SCREENS_SEEDED_PORT ?? 8443),
};

const EMPTY_STATE: LiveState = { teamId: '', projectId: '', todoIds: {} };

const stateOf = (world: keyof typeof PORTS): LiveState =>
  world === 'empty'
    ? EMPTY_STATE
    : JSON.parse(
        readFileSync(
          join(import.meta.dirname, '..', 'pr-screens-live', `state-${PORTS[world]}.json`),
          'utf8',
        ),
      );

test.describe.configure({ mode: 'parallel' });

for (const theme of THEMES) {
  for (const p of STATE_PAGES) {
    if (ONLY && !ONLY.has(slugOf(p.name))) continue;
    const key = `${slugOf(p.name)}-${theme}`;
    test(`capture: ${p.name} (${theme})`, async ({ page }) => {
      test.setTimeout(60_000);
      try {
        await prepare(page, theme);
        if (p.mock) await p.mock(page);
        await page.goto(`http://127.0.0.1:${PORTS[p.world]}${p.url(stateOf(p.world))}`);
        if (p.open) await p.open(page);
        await page.waitForTimeout(600);
        await record(page, key, theme, p.ready(page));
      } catch (error) {
        recordError(key, error);
      }
    });
  }
}
