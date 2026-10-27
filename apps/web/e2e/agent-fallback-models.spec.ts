import { expect, type Page, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

const FALLBACK_MODELS_MAX = 5;
const RELAY_MODELS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => ({
  id,
  name: `Relay ${id.toUpperCase()}`,
}));

interface ModelRef {
  provider: string;
  modelId: string;
}

let server: LiveServer;
let teamId: string;
let machineId: string;
let machineName: string;

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text === '' ? null : JSON.parse(text)) as T };
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await bootLiveServer(null);
  const teams = await api<{ id: string }[]>('GET', '/api/teams');
  teamId = teams.json[0]?.id ?? '';
  const machines = await api<{ id: string; name: string; kind: string }[]>(
    'GET',
    `/api/teams/${teamId}/machines`,
  );
  const local = machines.json.find((row) => row.kind === 'local');
  machineId = local?.id ?? '';
  machineName = local?.name ?? '';
  const created = await api('POST', `/api/teams/${teamId}/providers`, {
    providerId: 'relay-a',
    label: 'Relay A',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    models: RELAY_MODELS,
  });
  expect(created.status).toBe(201);
});

test.afterAll(async () => {
  await server?.dispose();
});

async function createAgent(name: string, fallbackModels: ModelRef[] | null = null): Promise<string> {
  const res = await api<{ id: string }>('POST', `/api/teams/${teamId}/agents`, {
    displayName: name,
    machineId,
    fallbackModels,
  });
  expect(res.status).toBe(201);
  return res.json.id;
}

async function savedFallbackModels(agentId: string): Promise<ModelRef[] | null | undefined> {
  const res = await api<{ fallbackModels?: ModelRef[] | null }>(
    'GET',
    `/api/teams/${teamId}/agents/${agentId}`,
  );
  return res.json.fallbackModels;
}

const piModel = (id: string): ModelRef => ({ provider: 'pi', modelId: id });

async function openDetail(page: Page, agentId: string) {
  await page.goto(`${server.base}/app/resources/agents/${agentId}`);
  await expect(page.getByRole('heading', { level: 3, name: '备用模型' })).toBeVisible();
}

async function pickRuntime(page: Page, slot: number, runtimeName: string) {
  await page.getByRole('combobox', { name: `备用 ${slot} 运行时` }).click();
  await page.getByRole('option', { name: runtimeName, exact: true }).click();
}

async function pickModel(page: Page, slot: number, modelName: string) {
  await page.getByRole('combobox', { name: `备用 ${slot} 模型` }).click();
  await page.getByRole('option', { name: modelName }).click();
}

const addButton = (page: Page) => page.getByRole('button', { name: '添加备用模型' });

test('empty chain: rule copy is clear, only an add entry, no candidate rows', async ({ page }) => {
  const agentId = await createAgent('fb-empty');
  await openDetail(page, agentId);
  const section = page.locator('.agent-fallback');
  await expect(section).toContainText('规划和执行步会换，总管只换同一运行时的备选');
  await expect(section).toContainText('审核、验证、合并不换');
  await expect(section).toContainText('备选用尽后，限流和额度继续等待');
  await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toHaveCount(0);
  await expect(addButton(page)).toBeEnabled();
});

test('add: lands in the store only after model selection, reload reads back the same row', async ({ page }) => {
  const agentId = await createAgent('fb-add');
  await openDetail(page, agentId);
  await addButton(page).click();
  await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toBeDisabled();
  await pickRuntime(page, 1, 'pi');
  expect(await savedFallbackModels(agentId)).toBeNull();

  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && res.url().endsWith(`/agents/${agentId}`),
  );
  await pickModel(page, 1, 'Relay M1');
  expect((await saved).status()).toBe(200);
  expect(await savedFallbackModels(agentId)).toEqual([piModel('m1')]);

  await page.reload();
  await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toContainText('Relay M1');
});

test('change: swapping the model of one row keeps the remaining rows in original order', async ({ page }) => {
  const agentId = await createAgent('fb-edit', [piModel('m1'), piModel('m2')]);
  await openDetail(page, agentId);
  await pickModel(page, 1, 'Relay M3');
  await expect.poll(() => savedFallbackModels(agentId)).toEqual([piModel('m3'), piModel('m2')]);
  await page.reload();
  await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toContainText('Relay M3');
  await expect(page.getByRole('combobox', { name: '备用 2 模型' })).toContainText('Relay M2');
});

test('reorder: move up/down changes the stored order, first row cannot move up further, last row cannot move down further', async ({ page }) => {
  const agentId = await createAgent('fb-order', [piModel('m1'), piModel('m2'), piModel('m3')]);
  await openDetail(page, agentId);
  await expect(page.getByRole('button', { name: '上移备用 1' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下移备用 3' })).toBeDisabled();

  await page.getByRole('button', { name: '上移备用 3' }).click();
  await expect
    .poll(() => savedFallbackModels(agentId))
    .toEqual([piModel('m1'), piModel('m3'), piModel('m2')]);
  await page.getByRole('button', { name: '下移备用 1' }).click();
  await expect
    .poll(() => savedFallbackModels(agentId))
    .toEqual([piModel('m3'), piModel('m1'), piModel('m2')]);

  await page.reload();
  await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toContainText('Relay M3');
  await expect(page.getByRole('combobox', { name: '备用 3 模型' })).toContainText('Relay M2');
});

test('delete: deleting a middle row shifts the rest up, deleting down to empty sends null instead of an empty array', async ({ page }) => {
  const agentId = await createAgent('fb-remove', [piModel('m1'), piModel('m2'), piModel('m3')]);
  await openDetail(page, agentId);
  await page.getByRole('button', { name: '删除备用 2' }).click();
  await expect.poll(() => savedFallbackModels(agentId)).toEqual([piModel('m1'), piModel('m3')]);

  const patchBodies: unknown[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH') patchBodies.push(req.postDataJSON());
  });
  await page.getByRole('button', { name: '删除备用 2' }).click();
  await page.getByRole('button', { name: '删除备用 1' }).click();
  await expect.poll(() => savedFallbackModels(agentId)).toBeNull();
  expect(patchBodies.at(-1)).toEqual({ fallbackModels: null });

  await page.reload();
  await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toHaveCount(0);
});

test('cap: at 5 entries add is disabled, server returns 400 for the 6th and the chain stays unchanged', async ({ page }) => {
  const agentId = await createAgent('fb-cap');
  await openDetail(page, agentId);
  for (let slot = 1; slot <= FALLBACK_MODELS_MAX; slot++) {
    await expect(addButton(page)).toBeEnabled();
    await addButton(page).click();
    await pickRuntime(page, slot, 'pi');
    await pickModel(page, slot, `Relay M${slot}`);
    await expect
      .poll(async () => (await savedFallbackModels(agentId))?.length)
      .toBe(slot);
  }
  await expect(addButton(page)).toBeDisabled();
  await expect(page.locator('.agent-fallback')).toContainText(`${FALLBACK_MODELS_MAX} / ${FALLBACK_MODELS_MAX}`);

  const sixth = await api('PATCH', `/api/teams/${teamId}/agents/${agentId}`, {
    fallbackModels: [1, 2, 3, 4, 5, 6].map((n) => piModel(`m${n}`)),
  });
  expect(sixth.status).toBe(400);
  expect(await savedFallbackModels(agentId)).toHaveLength(FALLBACK_MODELS_MAX);
});

test('half-selected rows are not stored: with only a runtime picked and no model, the store keeps the original chain', async ({ page }) => {
  const agentId = await createAgent('fb-draft', [piModel('m1')]);
  await openDetail(page, agentId);
  await addButton(page).click();
  const draftRow = page.locator('.agent-fallback-row').nth(1);
  await expect(draftRow).toContainText('选完模型后才会保存');
  await pickRuntime(page, 2, 'pi');
  await expect(draftRow).toContainText('选完模型后才会保存');
  expect(await savedFallbackModels(agentId)).toEqual([piModel('m1')]);
  await pickModel(page, 2, 'Relay M2');
  await expect.poll(() => savedFallbackModels(agentId)).toEqual([piModel('m1'), piModel('m2')]);
  await expect(draftRow).not.toContainText('选完模型后才会保存');
});

test('deleted model: the row greys out with an explanation and is not silently dropped', async ({ page }) => {
  const agentId = await createAgent('fb-gone', [piModel('m1'), piModel('gone-model')]);
  await openDetail(page, agentId);
  const live = page.locator('.agent-fallback-row').nth(0);
  const gone = page.locator('.agent-fallback-row').nth(1);
  await expect(gone).toContainText('当前可选列表里没有该模型');
  await expect(gone.locator('.agent-fallback-pickers')).toHaveClass(/opacity-60/);
  await expect(live.locator('.agent-fallback-pickers')).not.toHaveClass(/opacity-60/);
  await expect(live).not.toContainText('当前可选列表里没有该模型');
  expect(await savedFallbackModels(agentId)).toEqual([piModel('m1'), piModel('gone-model')]);
});

test('dead model: the row greys out and is marked delisted', async ({ page }) => {
  const agentId = await createAgent('fb-dead', [piModel('m1'), piModel('m2')]);
  await page.route(`**/api/teams/${teamId}/model-sources`, async (route) => {
    const res = await route.fetch();
    const envelope = (await res.json()) as {
      sources: { runtime: string; models: { id: string; liveness?: string }[] }[];
    };
    for (const source of envelope.sources) {
      for (const model of source.models) if (model.id === 'm2') model.liveness = 'dead';
    }
    await route.fulfill({ response: res, json: envelope });
  });
  await openDetail(page, agentId);
  const dead = page.locator('.agent-fallback-row').nth(1);
  await expect(dead).toContainText('已下架');
  await expect(dead.locator('.agent-fallback-pickers')).toHaveClass(/opacity-60/);
  await expect(page.locator('.agent-fallback-row').nth(0)).not.toContainText('已下架');
});

test('owner machine missing the runtime a fallback needs: editing shows a hint, already-configured fallbacks are kept', async ({ page }) => {
  const agentId = await createAgent('fb-runtime', [
    piModel('m1'),
    { provider: 'claude-code', modelId: 'claude-opus-4-5' },
  ]);
  await openDetail(page, agentId);
  await expect(page.locator('.agent-fallback-row').nth(1)).toContainText(
    `归属机 ${machineName} 未开启 claude-code runtime`,
  );
  await expect(page.locator('.agent-fallback-row').nth(0)).not.toContainText('未开启');
  expect(await savedFallbackModels(agentId)).toHaveLength(2);
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

for (const width of [1280, 560]) {
  test(`typography ${width}px: runtime label does not wrap, description text does not overlap the right-side controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const agentId = await createAgent('fb-layout', [
      piModel('m1'),
      piModel('m2'),
      piModel('gone-model'),
      { provider: 'claude-code', modelId: 'claude-opus-4-5' },
    ]);
    await openDetail(page, agentId);
    const rows = page.locator('.agent-fallback-row');
    await expect(rows).toHaveCount(4);
    const row = rows.nth(3);
    await expect(row).toContainText('未开启 claude-code runtime');

    const runtimeLabel = row.locator('.agent-fallback-pickers > span:first-child');
    const lineHeight = await runtimeLabel.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight));
    expect((await runtimeLabel.boundingBox())?.height).toBeLessThanOrEqual(lineHeight + 1);

    const text = (await row.locator(':scope > :first-child').boundingBox()) as Box;
    const controls = (await row.locator('.agent-fallback-pickers').boundingBox()) as Box;
    expect(
      text.x < controls.x + controls.width &&
        controls.x < text.x + text.width &&
        text.y < controls.y + controls.height &&
        controls.y < text.y + text.height,
    ).toBe(false);

    const rowBox = (await row.boundingBox()) as Box;
    expect(controls.x + controls.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    expect(text.x + text.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  });
}
