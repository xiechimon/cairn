import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PROVIDER_ERROR = 'Failed to fetch team settings';

async function startFailingProvider() {
  let calls = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      if (!request.url?.endsWith('/chat/completions')) return response.writeHead(404).end();
      calls += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ error: { message: PROVIDER_ERROR } })}\n\n`);
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    calls: () => calls,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

async function useAsCoordinatorModel(window, baseUrl) {
  const failed = await window.evaluate(async (url) => {
    const [team] = await (await fetch('/api/teams')).json();
    const send = async (method, path, body) => {
      const response = await fetch(`/api/teams/${team.id}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.ok ? null : `${method} ${path} ${response.status}: ${await response.text()}`;
    };
    return (
      (await send('POST', '/providers', {
        providerId: 'journey-gateway',
        label: 'Journey Gateway',
        baseUrl: url,
        api: 'openai-completions',
        authHeader: true,
        apiKey: 'journey-key',
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'journey-model', name: 'journey-model' }],
      })) ??
      (await send('PATCH', '/routing-rules/coordinator', {
        provider: 'journey-gateway',
        modelId: 'journey-model',
      }))
    );
  }, baseUrl);
  assert.equal(failed, null, `seed Coordinator model: ${failed}`);
}

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

export default async function coordinatorTurnFailure({ window, mode, evidenceDir }) {
  const message = `packaged ${mode} ${Date.now() % 100000}`;
  const provider = await startFailingProvider();
  try {
    await useAsCoordinatorModel(window, provider.url);
    await window.goto(new URL('/app', window.url()).toString());
    await window.getByTestId('chief-composer-block').click({ timeout: 30_000 });
    const input = window.getByTestId('chief-composer-input').first();
    await input.click();
    await window.keyboard.type(message);
    await window.keyboard.press('Enter');
    await window.getByText(message, { exact: true }).first().waitFor({ timeout: 30_000 });
    if (mode === 'local-server') await assertFailureCard(window, provider);
    await window.reload();
    await window.getByText(message, { exact: true }).first().waitFor({ timeout: 30_000 });
    await window.screenshot({ path: join(evidenceDir, `${mode}-coordinator-turn-failure.png`) });
  } finally {
    provider.close();
  }
}
