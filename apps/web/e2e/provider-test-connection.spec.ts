import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const RECORD = {
  kind: 'custom',
  providerId: 'relay-glm',
  label: 'Relay · GLM/DeepSeek',
  baseUrl: 'https://gateway.example.invalid/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: {},
  models: [{ id: 'glm-5.3', name: 'glm-5.3' }],
  id: 'prov-relay',
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 1,
};

const OK = {
  status: 'ok',
  listing: { httpStatus: 200, modelCount: 4, latencyMs: 80, error: null },
  probe: {
    requestedModel: 'glm-5.3',
    echoedModel: 'glm-5.3',
    httpStatus: 200,
    latencyMs: 412,
    error: null,
  },
};

const FAILED = {
  status: 'failed',
  listing: { httpStatus: 401, modelCount: null, latencyMs: 60, error: { type: 'auth', message: 'bad key' } },
  probe: {
    requestedModel: 'glm-5.3',
    echoedModel: null,
    httpStatus: 401,
    latencyMs: 61,
    error: { type: 'auth', message: 'Incorrect API key provided: [REDACTED]' },
  },
};

test('the Test button posts to the provider test endpoint and shows only the summary', async ({
  page,
}) => {
  let result: unknown = OK;
  const posts: string[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') {
      posts.push(route.request().method());
      return json(result);
    }
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [RECORD] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  const editor = page.getByTestId('provider-editor');
  await expect(editor.getByLabel('名称')).toHaveValue('Relay · GLM/DeepSeek');

  await editor.getByRole('button', { name: '测试', exact: true }).click();
  const outcome = editor.getByTestId('provider-test-result');
  await expect(outcome).toContainText('连接正常');
  await expect(outcome).toContainText('glm-5.3');
  await expect(outcome).toContainText('412ms');
  expect(posts).toEqual(['POST']);

  result = FAILED;
  await editor.getByRole('button', { name: '测试', exact: true }).click();
  await expect(outcome).toContainText('连接失败');
  await expect(outcome).toContainText('HTTP 401');
  await expect(outcome).toContainText('[REDACTED]');
});
