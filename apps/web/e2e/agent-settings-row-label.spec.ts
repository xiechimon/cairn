import { expect, test } from '@playwright/test';

const AGENT_DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail';
const MACHINE_DETAIL = '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06';

test('settings row labels name the agent detail selects', async ({ page }) => {
  await page.goto(AGENT_DETAIL);
  await expect(page.locator('.agent-skill-select')).toBeVisible();
  for (const name of ['默认 skill', '运行时', '模型', '思考强度']) {
    await expect(page.getByRole('combobox', { name })).toBeVisible();
  }
});

test('the evacuate picker keeps its deliberate name', async ({ page }) => {
  await page.goto(MACHINE_DETAIL);
  await expect(page.getByTestId('team-agent-grid')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '迁移到' })).toBeVisible();
});

test('the required-MCP switch keeps its deliberate name', async ({ page }) => {
  await page.goto(AGENT_DETAIL);
  await page.locator('.agent-tab').nth(2).click();
  await expect(page.getByRole('switch', { name: '要求安装 r3-mcp' })).toBeVisible();
});

test('D71 the Orb requirement survives toggling an MCP requirement off', async ({ page }) => {
  await page.goto(AGENT_DETAIL);
  await page.locator('.agent-tab').nth(2).click();
  const orb = page.getByRole('switch', { name: '要求 Orb 沙箱' });
  const mcp = page.getByRole('switch', { name: '要求安装 r3-mcp' });
  await orb.click();
  await expect(orb).toBeChecked();
  await mcp.click();
  await expect(mcp).toBeChecked();
  await mcp.click();
  await expect(mcp).not.toBeChecked();
  await expect(orb).toBeChecked();
});
