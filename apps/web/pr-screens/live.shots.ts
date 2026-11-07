import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ONLY, prepare, record, recordError, slugOf, THEMES } from './capture-core.js';
import { FROZEN_AT } from './frozen-time.mjs';
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

if (!ONLY || ONLY.has('failed-thread')) {
  test('failed-thread server timestamps match the browser clock', async ({ page, request }) => {
    const state = stateOf('seeded');
    const origin = `http://127.0.0.1:${PORTS.seeded}`;
    const response = await request.get(`${origin}/api/todos/${state.todoIds.failed}`);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({
      phase: 'failed',
      phaseAt: FROZEN_AT,
      lastRunAt: FROZEN_AT,
    });
    await prepare(page, 'light');
    await page.goto(`${origin}/app?thread=${state.todoIds.failed}`);
    await expect(
      page.getByTestId('side-chat-action').getByRole('button', { name: '重试' }),
    ).toBeVisible();
    expect(await page.evaluate(() => Date.now())).toBe(FROZEN_AT);
    const time = await page.evaluate(
      (ms) =>
        new Intl.DateTimeFormat('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(ms),
      FROZEN_AT,
    );
    await expect(page.getByText(time, { exact: true })).toBeVisible();
  });
}

for (const theme of THEMES) {
  for (const p of STATE_PAGES) {
    if (ONLY && !ONLY.has(slugOf(p.name))) continue;
    const key = `${slugOf(p.name)}-${theme}`;
    test(`capture: ${p.name} (${theme})`, async ({ page }) => {
      test.setTimeout(60_000);
      try {
        await prepare(page, theme);
        const settled = p.mock ? await p.mock(page) : undefined;
        await page.goto(`http://127.0.0.1:${PORTS[p.world]}${p.url(stateOf(p.world))}`);
        if (p.open) await p.open(page);
        if (settled) await settled();
        await page.waitForTimeout(600);
        await record(page, key, theme, p.ready(page));
      } catch (error) {
        recordError(key, error);
      }
    });
  }
}
