import { expect, test } from '@playwright/test';

const PAGE = '/app/resources/providers?scenario=10';
const SHELL = '[data-route="/app/resources/providers"]';
const CANON_HOST = 'xmonsMac-3574.local';

const CANON_CC_HOST = 'mea-wsl'; // fixtures.ts MACHINE_REMOTE_NAME

test('tablist = exactly `pi` / `Claude Code` / `Gemini` three tabs, `pi` selected by default', async ({ page }) => {
  await page.goto(PAGE);
  const tabs = page.locator(`${SHELL} [role="tablist"] [role="tab"]`);
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAttribute('data-runtime', 'pi');
  await expect(tabs.nth(0)).toHaveText('pi');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toHaveAttribute('data-runtime', 'claude-code');
  await expect(tabs.nth(1)).toHaveText('Claude Code');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
  await expect(tabs.nth(2)).toHaveAttribute('data-runtime', 'gemini');
  await expect(tabs.nth(2)).toHaveText('Gemini');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'false');
});

test('`pi` tab: fixture model rows + facade/38-item negative + no clickable-looking decoration', async ({ page }) => {
  await page.goto(PAGE);
  const rows = page.locator(`${SHELL} [data-model-id][data-runtime="pi"]`);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-model-id', 'claude-sonnet-5');
  await expect(rows.nth(0)).toContainText('Claude Sonnet 5（R3 网关）');
  await expect(rows.nth(0)).toContainText('claude-sonnet-5');

  const main = page.locator(`${SHELL} .page-main`);
  await expect(main).not.toContainText('Cairn（内置）');
  await expect(main).not.toContainText('DeepSeek');
  await expect(main).not.toContainText('OpenRouter');

  await expect(page.locator(`${SHELL} [data-model-id] svg`)).toHaveCount(0);
  await expect(page.locator(`${SHELL} [data-model-id] button`)).toHaveCount(0);
});

test('switching to the `Claude Code` tab: aria-selected flips + ?runtime= written (scenario kept)', async ({
  page,
}) => {
  await page.goto(PAGE);
  await page.locator(`${SHELL} [role="tab"][data-runtime="claude-code"]`).click();
  await expect(page).toHaveURL(/[?&]runtime=claude-code/);
  await expect(page).toHaveURL(/[?&]scenario=10/);
  await expect(
    page.locator(`${SHELL} [role="tab"][data-runtime="claude-code"]`),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`${SHELL} [role="tab"][data-runtime="pi"]`)).toHaveAttribute(
    'aria-selected',
    'false',
  );
  const rows = page.locator(`${SHELL} [data-model-id][data-runtime="claude-code"]`);
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveAttribute('data-model-id', 'claude-opus-4-5');
  await expect(rows.nth(0)).toContainText('default');
});

test('deep link ?runtime=claude-code lands directly, tab position survives reload', async ({ page }) => {
  await page.goto(`${PAGE}&runtime=claude-code`);
  await expect(
    page.locator(`${SHELL} [role="tab"][data-runtime="claude-code"]`),
  ).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(
    page.locator(`${SHELL} [role="tab"][data-runtime="claude-code"]`),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.locator(`${SHELL} [data-model-id][data-runtime="claude-code"]`),
  ).toHaveCount(4);
});

test('header card: runtime name + description + `已安装在 <hostname>` (same shape on both tabs)', async ({ page }) => {
  await page.goto(PAGE);
  const piHead = page.locator(`${SHELL} [data-testid="runtime-head"][data-runtime="pi"]`);
  await expect(piHead).toContainText('pi');
  await expect(piHead).toContainText(`已安装在 ${CANON_HOST}`);
  await expect(piHead).toContainText('cairn 自有运行时');
  await page.locator(`${SHELL} [role="tab"][data-runtime="claude-code"]`).click();
  const ccHead = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(ccHead).toContainText('Claude Code');
  await expect(ccHead).toContainText(`已安装在 ${CANON_CC_HOST}`);
  await expect(ccHead).toContainText('~/.claude/settings.json');
});

test('settings.json missing branch: header turns into the `未安装` guide state, zero model rows rendered, no crash', async ({
  page,
}) => {
  await page.goto('/app/resources/providers?scenario=10-cc-missing&runtime=claude-code');
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toContainText('未安装');
  await expect(head).toContainText('安装 Claude Code 并完成一次登录后');
  await expect(head).not.toContainText('已安装');
  await expect(
    page.locator(`${SHELL} [data-model-id][data-runtime="claude-code"]`),
  ).toHaveCount(0);

  await page.locator(`${SHELL} [role="tab"][data-runtime="pi"]`).click();
  await expect(page.locator(`${SHELL} [data-model-id][data-runtime="pi"]`)).toHaveCount(3);
});

test('#1050 installed + logged in: fine-print row reports version and path, no `未登录` badge', async ({ page }) => {
  await page.goto(`${PAGE}&runtime=claude-code`);
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toContainText(`已安装在 ${CANON_CC_HOST}`);
  await expect(head).toContainText('claude 2.1.289 · /home/u/.local/bin/claude');
  await expect(head).not.toContainText('未登录');
  await expect(head).toHaveAttribute('data-auth', 'logged-in');

  await expect(head).not.toContainText('未配置模型槽');
});

test('#1050 installed + not logged in: fine-print row ends with the `未登录` badge (main sentence unchanged)', async ({ page }) => {
  await page.goto(
    '/app/resources/providers?scenario=10-cc-loggedout&runtime=claude-code',
  );
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toContainText(`已安装在 ${CANON_CC_HOST}`);
  await expect(head).toContainText('claude 2.1.289 · /home/u/.local/bin/claude');
  await expect(head).toContainText('未登录');
  await expect(head).toHaveAttribute('data-auth', 'not-logged-in');
});

test('#1050 installed + unconfigured: main sentence turns `已安装，未配置模型槽` + how-to-configure sentence, zero model rows', async ({
  page,
}) => {
  await page.goto(
    '/app/resources/providers?scenario=10-cc-noconfig&runtime=claude-code',
  );
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toContainText('已安装，未配置模型槽');
  await expect(head).toContainText('claude 2.1.289 · /home/u/.local/bin/claude');
  await expect(head).toContainText('ANTHROPIC_*_MODEL');

  await expect(head).not.toContainText('安装 Claude Code 并完成一次登录后');
  await expect(
    page.locator(`${SHELL} [data-model-id][data-runtime="claude-code"]`),
  ).toHaveCount(0);
});

test('#1050 not installed (bin: null = probed and absent): main sentence `未安装` + install guide + zero fine-print rows', async ({
  page,
}) => {
  await page.goto('/app/resources/providers?scenario=10-cc-missing&runtime=claude-code');
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toHaveAttribute('data-state', 'bin-missing');
  await expect(head).toContainText('未安装');
  await expect(head).toContainText('安装 Claude Code 并完成一次登录后');
  await expect(head.locator('[data-testid="runtime-bin"]')).toHaveCount(0);
  await expect(head).not.toContainText('未知');
});

test('#1050 config file present but binary gone: no longer falsely reports `已安装在` (old behavior was false green)', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=10-cc-bin-gone&runtime=claude-code');
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toHaveAttribute('data-state', 'bin-missing');
  await expect(head).toContainText('未安装');
  await expect(head).not.toContainText('已安装');
});

test('#1050 bin key absent (old daemon never probed): keeps the old look-at-installed-only behavior, writes no `未知`', async ({
  page,
}) => {
  await page.goto('/app/resources/providers?scenario=10-cc-legacy&runtime=claude-code');
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toHaveAttribute('data-state', 'installed');
  await expect(head).toContainText(`已安装在 ${CANON_CC_HOST}`);
  await expect(head.locator('[data-testid="runtime-bin"]')).toHaveCount(0);
  await expect(head).not.toContainText('未知');
});

test('geometry: tablist/header/model-row cards all hug the content column left edge, tab order pi left claude-code right', async ({
  page,
}) => {
  await page.goto(PAGE);
  const col = page.locator(`${SHELL} [data-testid="page-col"]`);
  const tabs = page.locator(`${SHELL} [role="tablist"]`);
  const head = page.locator(`${SHELL} [data-testid="runtime-head"]`).first();
  const card = page.locator(`${SHELL} [data-testid="resource-group"]`).first();
  const colBox = await col.boundingBox();
  const tabsBox = await tabs.boundingBox();
  const headBox = await head.boundingBox();
  const cardBox = await card.boundingBox();
  expect(colBox).not.toBeNull();

  expect(colBox?.x).toBe(460);
  for (const box of [tabsBox, headBox, cardBox]) {
    expect(box?.x).toBe(colBox?.x);
  }
  expect(headBox?.width).toBe(colBox?.width);
  expect(cardBox?.width).toBe(colBox?.width);
  const piTab = await page.locator(`${SHELL} [role="tab"][data-runtime="pi"]`).boundingBox();
  const ccTab = await page
    .locator(`${SHELL} [role="tab"][data-runtime="claude-code"]`)
    .boundingBox();
  expect(piTab!.x + piTab!.width).toBeLessThanOrEqual(ccTab!.x);
});
