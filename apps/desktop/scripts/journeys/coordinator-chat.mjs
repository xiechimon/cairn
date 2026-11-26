import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startStubProvider, useAsCoordinatorModel } from '../coordinator-journey-model.mjs';

const REPLY = 'The packaged stub model answered.';
function replyChunks(request) {
  const isTurn = (request.tools?.length ?? 0) > 0;
  const text = {
    choices: [{ index: 0, delta: { role: 'assistant', content: isTurn ? REPLY : '' } }],
  };
  const stop = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  const usage = { prompt_tokens: 12_000, completion_tokens: 12, total_tokens: 12_012 };
  return isTurn ? [text, stop, { choices: [], usage }] : [text, stop];
}

export default async function coordinatorChat({ window, mode, evidenceDir }) {
  const provider = await startStubProvider(replyChunks);
  try {
    await useAsCoordinatorModel(window, provider.url);
    const message = `packaged usage ${Date.now() % 100000}`;
    await window.goto(new URL('/app', window.url()).toString());
    await window.getByTestId('chief-composer-block').click({ timeout: 30_000 });
    const input = window.getByTestId('chief-composer-input').first();
    await input.click();
    await window.keyboard.type(message);
    await window.keyboard.press('Enter');
    await window.getByText(message, { exact: true }).first().waitFor({ timeout: 30_000 });
    await window.getByText(REPLY).first().waitFor({ timeout: 60_000 });
    const settled = window
      .getByTestId('home-c')
      .locator('[data-testid="composer-context-meter"][aria-busy="false"]:not([data-mock])');
    await settled.waitFor({ timeout: 30_000 });
    await settled.click();
    const usage = window.getByTestId('channel-usage');
    await usage.waitFor({ timeout: 15_000 });
    assert.match(await usage.innerText(), /Tokens\s+12k\b/i, 'usage did not show the turn tokens');
    await window.screenshot({ path: join(evidenceDir, `${mode}-coordinator-chat.png`) });
  } finally {
    provider.close();
  }
}
