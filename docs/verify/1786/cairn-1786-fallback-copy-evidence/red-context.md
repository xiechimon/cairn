# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-fallback-models.spec.ts >> empty chain: rule copy is clear, only an add entry, no candidate rows
- Location: e2e/agent-fallback-models.spec.ts:93:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.agent-fallback')
Expected substring: "规划和执行步会换，总管只换同一运行时的备选"
Received string:    "备用模型0 / 5主模型额度用完、服务 5xx、账号耗尽、限流、模型 404 或认证失败时，按顺序换到下一个可用备选。只有规划和执行步会换；审核、验证、合并、总管不换。备选用尽后，限流和额度继续等待，其他服务故障则该步失败。添加备用模型"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.agent-fallback') with timeout 5000ms
  - waiting for locator('.agent-fallback')
    14 × locator resolved to <section class="agent-fallback flex flex-col gap-2">…</section>
       - unexpected value "备用模型0 / 5主模型额度用完、服务 5xx、账号耗尽、限流、模型 404 或认证失败时，按顺序换到下一个可用备选。只有规划和执行步会换；审核、验证、合并、总管不换。备选用尽后，限流和额度继续等待，其他服务故障则该步失败。添加备用模型"

```

```yaml
- heading "备用模型" [level=3]
- text: 0 / 5
- paragraph: 主模型额度用完、服务 5xx、账号耗尽、限流、模型 404 或认证失败时，按顺序换到下一个可用备选。只有规划和执行步会换；审核、验证、合并、总管不换。备选用尽后，限流和额度继续等待，其他服务故障则该步失败。
- button "添加备用模型"
```

# Test source

```ts
  1   | import { expect, type Page, test } from '@playwright/test';
  2   | import { bootLiveServer, type LiveServer } from './live-server';
  3   | 
  4   | const FALLBACK_MODELS_MAX = 5;
  5   | const RELAY_MODELS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) => ({
  6   |   id,
  7   |   name: `Relay ${id.toUpperCase()}`,
  8   | }));
  9   | 
  10  | interface ModelRef {
  11  |   provider: string;
  12  |   modelId: string;
  13  | }
  14  | 
  15  | let server: LiveServer;
  16  | let teamId: string;
  17  | let machineId: string;
  18  | let machineName: string;
  19  | 
  20  | async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  21  |   const res = await fetch(`${server.base}${path}`, {
  22  |     method,
  23  |     headers: body === undefined ? {} : { 'content-type': 'application/json' },
  24  |     body: body === undefined ? undefined : JSON.stringify(body),
  25  |   });
  26  |   const text = await res.text();
  27  |   return { status: res.status, json: (text === '' ? null : JSON.parse(text)) as T };
  28  | }
  29  | 
  30  | test.beforeAll(async () => {
  31  |   test.setTimeout(120_000);
  32  |   server = await bootLiveServer(null);
  33  |   const teams = await api<{ id: string }[]>('GET', '/api/teams');
  34  |   teamId = teams.json[0]?.id ?? '';
  35  |   const machines = await api<{ id: string; name: string; kind: string }[]>(
  36  |     'GET',
  37  |     `/api/teams/${teamId}/machines`,
  38  |   );
  39  |   const local = machines.json.find((row) => row.kind === 'local');
  40  |   machineId = local?.id ?? '';
  41  |   machineName = local?.name ?? '';
  42  |   const created = await api('POST', `/api/teams/${teamId}/providers`, {
  43  |     providerId: 'relay-a',
  44  |     label: 'Relay A',
  45  |     baseUrl: 'http://127.0.0.1:9/v1',
  46  |     api: 'openai-completions',
  47  |     models: RELAY_MODELS,
  48  |   });
  49  |   expect(created.status).toBe(201);
  50  | });
  51  | 
  52  | test.afterAll(async () => {
  53  |   await server?.dispose();
  54  | });
  55  | 
  56  | async function createAgent(name: string, fallbackModels: ModelRef[] | null = null): Promise<string> {
  57  |   const res = await api<{ id: string }>('POST', `/api/teams/${teamId}/agents`, {
  58  |     displayName: name,
  59  |     machineId,
  60  |     fallbackModels,
  61  |   });
  62  |   expect(res.status).toBe(201);
  63  |   return res.json.id;
  64  | }
  65  | 
  66  | async function savedFallbackModels(agentId: string): Promise<ModelRef[] | null | undefined> {
  67  |   const res = await api<{ fallbackModels?: ModelRef[] | null }>(
  68  |     'GET',
  69  |     `/api/teams/${teamId}/agents/${agentId}`,
  70  |   );
  71  |   return res.json.fallbackModels;
  72  | }
  73  | 
  74  | const piModel = (id: string): ModelRef => ({ provider: 'pi', modelId: id });
  75  | 
  76  | async function openDetail(page: Page, agentId: string) {
  77  |   await page.goto(`${server.base}/app/resources/agents/${agentId}`);
  78  |   await expect(page.getByRole('heading', { level: 3, name: '备用模型' })).toBeVisible();
  79  | }
  80  | 
  81  | async function pickRuntime(page: Page, slot: number, runtimeName: string) {
  82  |   await page.getByRole('combobox', { name: `备用 ${slot} 运行时` }).click();
  83  |   await page.getByRole('option', { name: runtimeName, exact: true }).click();
  84  | }
  85  | 
  86  | async function pickModel(page: Page, slot: number, modelName: string) {
  87  |   await page.getByRole('combobox', { name: `备用 ${slot} 模型` }).click();
  88  |   await page.getByRole('option', { name: modelName }).click();
  89  | }
  90  | 
  91  | const addButton = (page: Page) => page.getByRole('button', { name: '添加备用模型' });
  92  | 
  93  | test('empty chain: rule copy is clear, only an add entry, no candidate rows', async ({ page }) => {
  94  |   const agentId = await createAgent('fb-empty');
  95  |   await openDetail(page, agentId);
  96  |   const section = page.locator('.agent-fallback');
> 97  |   await expect(section).toContainText('规划和执行步会换，总管只换同一运行时的备选');
      |                         ^ Error: expect(locator).toContainText(expected) failed
  98  |   await expect(section).toContainText('审核、验证、合并不换');
  99  |   await expect(section).toContainText('备选用尽后，限流和额度继续等待');
  100 |   await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toHaveCount(0);
  101 |   await expect(addButton(page)).toBeEnabled();
  102 | });
  103 | 
  104 | test('add: lands in the store only after model selection, reload reads back the same row', async ({ page }) => {
  105 |   const agentId = await createAgent('fb-add');
  106 |   await openDetail(page, agentId);
  107 |   await addButton(page).click();
  108 |   await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toBeDisabled();
  109 |   await pickRuntime(page, 1, 'pi');
  110 |   expect(await savedFallbackModels(agentId)).toBeNull();
  111 | 
  112 |   const saved = page.waitForResponse(
  113 |     (res) => res.request().method() === 'PATCH' && res.url().endsWith(`/agents/${agentId}`),
  114 |   );
  115 |   await pickModel(page, 1, 'Relay M1');
  116 |   expect((await saved).status()).toBe(200);
  117 |   expect(await savedFallbackModels(agentId)).toEqual([piModel('m1')]);
  118 | 
  119 |   await page.reload();
  120 |   await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toContainText('Relay M1');
  121 | });
  122 | 
  123 | test('change: swapping the model of one row keeps the remaining rows in original order', async ({ page }) => {
  124 |   const agentId = await createAgent('fb-edit', [piModel('m1'), piModel('m2')]);
  125 |   await openDetail(page, agentId);
  126 |   await pickModel(page, 1, 'Relay M3');
  127 |   await expect.poll(() => savedFallbackModels(agentId)).toEqual([piModel('m3'), piModel('m2')]);
  128 |   await page.reload();
  129 |   await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toContainText('Relay M3');
  130 |   await expect(page.getByRole('combobox', { name: '备用 2 模型' })).toContainText('Relay M2');
  131 | });
  132 | 
  133 | test('reorder: move up/down changes the stored order, first row cannot move up further, last row cannot move down further', async ({ page }) => {
  134 |   const agentId = await createAgent('fb-order', [piModel('m1'), piModel('m2'), piModel('m3')]);
  135 |   await openDetail(page, agentId);
  136 |   await expect(page.getByRole('button', { name: '上移备用 1' })).toBeDisabled();
  137 |   await expect(page.getByRole('button', { name: '下移备用 3' })).toBeDisabled();
  138 | 
  139 |   await page.getByRole('button', { name: '上移备用 3' }).click();
  140 |   await expect
  141 |     .poll(() => savedFallbackModels(agentId))
  142 |     .toEqual([piModel('m1'), piModel('m3'), piModel('m2')]);
  143 |   await page.getByRole('button', { name: '下移备用 1' }).click();
  144 |   await expect
  145 |     .poll(() => savedFallbackModels(agentId))
  146 |     .toEqual([piModel('m3'), piModel('m1'), piModel('m2')]);
  147 | 
  148 |   await page.reload();
  149 |   await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toContainText('Relay M3');
  150 |   await expect(page.getByRole('combobox', { name: '备用 3 模型' })).toContainText('Relay M2');
  151 | });
  152 | 
  153 | test('delete: deleting a middle row shifts the rest up, deleting down to empty sends null instead of an empty array', async ({ page }) => {
  154 |   const agentId = await createAgent('fb-remove', [piModel('m1'), piModel('m2'), piModel('m3')]);
  155 |   await openDetail(page, agentId);
  156 |   await page.getByRole('button', { name: '删除备用 2' }).click();
  157 |   await expect.poll(() => savedFallbackModels(agentId)).toEqual([piModel('m1'), piModel('m3')]);
  158 | 
  159 |   const patchBodies: unknown[] = [];
  160 |   page.on('request', (req) => {
  161 |     if (req.method() === 'PATCH') patchBodies.push(req.postDataJSON());
  162 |   });
  163 |   await page.getByRole('button', { name: '删除备用 2' }).click();
  164 |   await page.getByRole('button', { name: '删除备用 1' }).click();
  165 |   await expect.poll(() => savedFallbackModels(agentId)).toBeNull();
  166 |   expect(patchBodies.at(-1)).toEqual({ fallbackModels: null });
  167 | 
  168 |   await page.reload();
  169 |   await expect(page.getByRole('combobox', { name: '备用 1 模型' })).toHaveCount(0);
  170 | });
  171 | 
  172 | test('cap: at 5 entries add is disabled, server returns 400 for the 6th and the chain stays unchanged', async ({ page }) => {
  173 |   const agentId = await createAgent('fb-cap');
  174 |   await openDetail(page, agentId);
  175 |   for (let slot = 1; slot <= FALLBACK_MODELS_MAX; slot++) {
  176 |     await expect(addButton(page)).toBeEnabled();
  177 |     await addButton(page).click();
  178 |     await pickRuntime(page, slot, 'pi');
  179 |     await pickModel(page, slot, `Relay M${slot}`);
  180 |     await expect
  181 |       .poll(async () => (await savedFallbackModels(agentId))?.length)
  182 |       .toBe(slot);
  183 |   }
  184 |   await expect(addButton(page)).toBeDisabled();
  185 |   await expect(page.locator('.agent-fallback')).toContainText(`${FALLBACK_MODELS_MAX} / ${FALLBACK_MODELS_MAX}`);
  186 | 
  187 |   const sixth = await api('PATCH', `/api/teams/${teamId}/agents/${agentId}`, {
  188 |     fallbackModels: [1, 2, 3, 4, 5, 6].map((n) => piModel(`m${n}`)),
  189 |   });
  190 |   expect(sixth.status).toBe(400);
  191 |   expect(await savedFallbackModels(agentId)).toHaveLength(FALLBACK_MODELS_MAX);
  192 | });
  193 | 
  194 | test('half-selected rows are not stored: with only a runtime picked and no model, the store keeps the original chain', async ({ page }) => {
  195 |   const agentId = await createAgent('fb-draft', [piModel('m1')]);
  196 |   await openDetail(page, agentId);
  197 |   await addButton(page).click();
```