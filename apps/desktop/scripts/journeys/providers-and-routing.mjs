import assert from 'node:assert/strict';
import { join } from 'node:path';

async function apiJson(window, path, init) {
  const result = await window.evaluate(
    async ({ url, options }) => {
      const response = await fetch(url, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
      });
      return { status: response.status, text: await response.text() };
    },
    { url: path, options: init },
  );
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${init?.method ?? 'GET'} ${path} -> ${result.status}: ${result.text}`,
  );
  return JSON.parse(result.text);
}

export default async function providersAndRouting({ window, mode, evidenceDir }) {
  const teams = await apiJson(window, '/api/teams');
  assert.ok(Array.isArray(teams) && teams.length > 0, 'GET /api/teams returned no teams');
  const teamId = teams[0].id;

  await apiJson(window, '/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: `packaged ${mode} routing`, repoKind: 'hosted' }),
  });

  await apiJson(window, `/api/teams/${teamId}/providers`, {
    method: 'POST',
    body: JSON.stringify({
      providerId: 'openai-relay',
      label: 'OpenAI Relay',
      baseUrl: 'https://example.invalid/v1',
      api: 'openai-completions',
      models: [{ id: 'gpt-5', name: 'GPT-5' }],
      apiKey: 'sk-test-packaged-relay',
    }),
  });

  await apiJson(window, `/api/teams/${teamId}/providers`, {
    method: 'POST',
    body: JSON.stringify({
      providerId: 'anthropic-ultra',
      label: 'Anthropic Ultra',
      baseUrl: 'https://example.invalid/v1',
      api: 'anthropic-messages',
      models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }],
      apiKey: 'sk-test-packaged-journey',
    }),
  });

  await apiJson(window, `/api/teams/${teamId}/routing-rules/coordinator`, {
    method: 'PATCH',
    body: JSON.stringify({
      provider: 'anthropic-ultra',
      modelId: 'claude-opus-5-5',
      thinkingLevel: 'high',
    }),
  });

  await apiJson(window, `/api/teams/${teamId}/routing-rules/session`, {
    method: 'PATCH',
    body: JSON.stringify({
      provider: 'anthropic-ultra',
      modelId: 'claude-opus-5-5',
      thinkingLevel: 'medium',
    }),
  });

  const sources = await apiJson(window, `/api/teams/${teamId}/model-sources`);
  const customSource = sources.sources.find((source) => source.providerId === 'anthropic-ultra');
  assert.ok(customSource, 'anthropic-ultra source missing from model-sources');
  const opus = customSource.models.find((model) => model.id === 'claude-opus-5-5');
  assert.deepEqual(opus?.thinkingLevels, ['low', 'medium', 'high', 'xhigh', 'max']);

  await window.goto(new URL('/app', window.url()).toString());
  await window.getByTestId('home-c').waitFor({ timeout: 15_000 });
  await window.getByTestId('chief-composer-block').waitFor({ timeout: 15_000 });

  await window.goto(new URL('/app/settings/routing', window.url()).toString());
  await window.getByTestId('routing-add-provider').waitFor({ timeout: 15_000 });
  await window.getByTestId('routing-section').waitFor({ timeout: 15_000 });

  const row = window
    .locator('[data-testid="provider-instance"]:not([aria-current="true"])')
    .first();
  await row.waitFor({ timeout: 15_000 });
  const targetId = await row.getAttribute('data-instance-id');
  await row.getByTestId('provider-status-mark').click();
  await window
    .locator(
      `[data-testid="provider-instance"][data-instance-id="${targetId}"][aria-current="true"]`,
    )
    .waitFor({ timeout: 15_000 });

  await window.screenshot({ path: join(evidenceDir, `${mode}-providers-and-routing.png`) });
}
