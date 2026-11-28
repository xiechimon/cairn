import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startStubProvider, useAsCoordinatorModel } from '../coordinator-journey-model.mjs';

const PROVIDER_ERROR = 'Failed to fetch team settings';

async function assertFailureCard(window, provider) {
  const card = window.getByTestId('chief-turn-error-card');
  await card.waitFor({ timeout: 60_000 });
  const align = await card
    .getByTestId('failure-marker-label')
    .evaluate((node) => getComputedStyle(node).textAlign);
  assert.match(align, /^(left|start)$/, 'the failure card centres its text');
  const retry = card.getByTestId('chief-turn-retry');
  const middles = [];
  for (const control of [retry, card.getByRole('link').first()]) {
    const box = await control.boundingBox();
    middles.push(box.y + box.height / 2);
  }
  assert.ok(Math.abs(middles[0] - middles[1]) <= 1, `the card actions stack: ${middles}`);
  const before = provider.calls();
  await retry.click();
  const deadline = Date.now() + 60_000;
  while (provider.calls() === before && Date.now() < deadline) await window.waitForTimeout(250);
  assert.ok(provider.calls() > before, 'retry did not reach the model provider');
  await card.waitFor({ timeout: 60_000 });
}

async function openRunLog(window, mode, evidenceDir) {
  const link = window.getByTestId('run-trace-link').first();
  await link.waitFor({ timeout: 60_000 });
  await link.click();
  await window.waitForURL(/\/app\/runs\//, { timeout: 30_000 });
  const failure = window.getByTestId('run-failure');
  await failure.waitFor({ timeout: 30_000 });
  assert.ok((await failure.innerText()).trim() !== '', 'the run log leads with the failure');
  await window.screenshot({ path: join(evidenceDir, `${mode}-run-log.png`) });
  await window.keyboard.press('Escape');
  await window.getByTestId('run-page').waitFor({ state: 'detached', timeout: 30_000 });
  await window.getByTestId('chief-status-mark-button').first().click();
  const turn = window.getByTestId('run-list').locator('a[data-run-row]').first();
  await turn.waitFor({ timeout: 30_000 });
  assert.equal(await turn.getAttribute('aria-current'), 'page', 'the newest turn is selected');
  await window.getByTestId('run-page').waitFor({ timeout: 30_000 });
  await window.keyboard.press('Escape');
}

export default async function coordinatorTurnFailure({ window, mode, evidenceDir }) {
  const message = `packaged ${mode} ${Date.now() % 100000}`;
  const provider = await startStubProvider(() => [{ error: { message: PROVIDER_ERROR } }]);
  try {
    await useAsCoordinatorModel(window, provider.url);
    await window.goto(new URL('/app', window.url()).toString());
    await window.getByTestId('chief-composer-block').click({ timeout: 30_000 });
    const input = window.getByTestId('chief-composer-input').first();
    await input.click();
    await window.keyboard.type(message);
    const persisted = window.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/(teams\/[^/]+\/chief\/threads|conversations\/[^/]+\/messages)$/.test(
          new URL(response.url()).pathname,
        ) &&
        response.ok(),
      { timeout: 30_000 },
    );
    await window.keyboard.press('Enter');
    await persisted;
    await window.getByText(message, { exact: true }).first().waitFor({ timeout: 30_000 });
    if (mode === 'local-server') await assertFailureCard(window, provider);
    await window.reload();
    await window.getByText(message, { exact: true }).first().waitFor({ timeout: 30_000 });
    await window.screenshot({ path: join(evidenceDir, `${mode}-coordinator-turn-failure.png`) });
    await openRunLog(window, mode, evidenceDir);
  } finally {
    provider.close();
  }
}
