import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const PROXY = ['MiniMax-M3', 'glm-5.3', 'grok-4.3-fast', 'claude-opus-4-8', 'claude-sonnet-5'];
const CLAUDE = [
  'claude-haiku-4-5',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
];

async function open(page: Page, patches: unknown[]) {
  let rule: Record<string, unknown> | null = null;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/routing-settings')
      return json({ rules: rule === null ? [] : [rule], policies: [] });
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/top-models') return json({ models: [] });
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'proxy',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: PROXY.map((id) => ({ id, name: id })),
          },
          {
            runtime: 'pi',
            provider: 'dclaude',
            providerLabel: 'domestic-claude',
            installed: true,
            models: CLAUDE.map((id) => ({ id, name: id })),
          },
        ],
      });
    if (path === '/api/teams/t1/routing-rules/session' && method === 'PATCH') {
      const body = route.request().postDataJSON() as { provider: string; modelId: string };
      patches.push({ provider: body.provider, modelId: body.modelId });
      rule = {
        id: 'r1',
        teamId: 't1',
        use: 'session',
        provider: body.provider,
        modelId: body.modelId,
        thinkingLevel: null,
        fallbackModels: null,
        machineId: null,
        requiredCapabilities: null,
        seededFromAgentId: null,
        createdAt: 1,
        updatedAt: 1,
      };
      return json(rule);
    }
    return undefined;
  });
  await page.goto('/app/settings/work-routing');
  return page
    .getByRole('dialog', { name: '设置' })
    .getByTestId('routing-rule-new-session')
    .locator('.routing-rule-model-select');
}

test('C19: a long model list filters as you type, by model or provider, and Escape clears before it closes', async ({
  page,
}) => {
  const patches: unknown[] = [];
  const trigger = await open(page, patches);
  await trigger.click();
  await expect(page.getByRole('combobox', { name: '筛选模型' })).toBeFocused();
  const menu = page.locator('.routing-rule-model-menu');
  const field = menu.locator('[data-slot="picker-filter"]');
  await expect(menu.locator('.routing-rule-model-row')).toHaveCount(13);
  await expect(menu).toContainText('输入可筛选');
  expect((await field.boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);
  await expect(menu.getByText('domestic-claude', { exact: true })).toBeVisible();

  await page.keyboard.type('opus48');
  await expect(field.getByRole('combobox')).toHaveValue('opus48');
  expect((await field.boundingBox())?.height ?? 0).toBeGreaterThan(20);
  const rows = menu.locator('.routing-rule-model-row');
  await expect(rows).toHaveText([
    /claude-opus-4-8\s*domestic-proxy/,
    /claude-opus-4-8\s*domestic-claude/,
  ]);

  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await expect(rows).toHaveCount(13);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await trigger.click();
  await expect(page.getByRole('combobox', { name: '筛选模型' })).toBeFocused();
  await page.keyboard.type('gpt-9');
  await expect(menu).toContainText('没有匹配「gpt-9」的模型');

  await page.keyboard.press('Escape');
  await page.keyboard.type('opus domestic-claude');
  await expect(rows).toHaveCount(5);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect.poll(() => patches).toEqual([{ provider: 'dclaude', modelId: 'claude-opus-4-6' }]);
});

test('C20: the trigger names the picked model with its provider', async ({ page }) => {
  const patches: unknown[] = [];
  const trigger = await open(page, patches);
  await trigger.click();
  await expect(page.getByRole('combobox', { name: '筛选模型' })).toBeFocused();
  await page.keyboard.type('opus-4-8 proxy');
  await page.keyboard.press('Enter');
  await expect.poll(() => patches).toEqual([{ provider: 'proxy', modelId: 'claude-opus-4-8' }]);
  await expect(
    page.getByRole('dialog', { name: '设置' }).locator('#route-session .routing-rule-model-select'),
  ).toContainText(/claude-opus-4-8\s*domestic-proxy/);
});
