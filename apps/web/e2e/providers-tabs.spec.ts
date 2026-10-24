import { expect, test } from '@playwright/test';

// #356 (spec 11 §A1-A4/A7): providers 页 = runtime tablist（pi / Claude
// Code），tab 状态走 ?runtime= search param（刷新/分享/深链回定位），每
// tab = header 卡（runtime 名 + 说明 + 已安装在 <hostname>）+ 模型行
// （显示名 → 模型 id，data-runtime/data-model-id 契约句柄）。「Cairn
// （内置）」facade 行与 38 项 preset 列表行已除（数据层全留，preset 仅
// 在 picker dialog 内）；A7 行可点感收编：纯展示行无 chevron/三点。
// 数据源 = fixture canon（scenario=10 的 providerSources，见 fixtures.ts
// ——pi 3 行 / claude-code 4 槽）。
// Each test pins one failure mode:
// 1. tablist 恰两 tab + 文案 pi/Claude Code + 默认 pi
// 2. pi 模型行命中 fixture（id/显示名）+ facade/preset 负向 + A7 装饰清零
// 3. 切 tab：aria-selected 翻转 + ?runtime= 写入且 scenario 参保留
// 4. 深链 ?runtime=claude-code 直落 + 刷新回定位
// 5. header 卡：runtime 名/说明/「已安装在 <hostname>」（两 runtime 同构）
// 5b. settings.json 缺失分支：header 转「未安装」指引态 + 模型行零渲染
// 6. 几何：tablist/header/模型行卡同贴内容列左缘（x480 @1440，r7 探针
//    canon），tab 序 pi 左 claude-code 右
// #944/#910 载体：.res-model-row → [data-model-id][data-runtime] 契约句柄；
// .res-runtime-head → runtime-head testid；.res-col → page-col testid；
// .res-tabs → role=tablist；.res-card → resource-group testid；.res-row-chev/
// -more 负向 → 行内 svg/button 计数 0（A7 语义：纯展示行无可点感装饰）。
// .page-main = the page shell's sheet (PR 6 merged the resources shell into it).

const PAGE = '/app/resources/providers?scenario=10';
const SHELL = '[data-route="/app/resources/providers"]';
const CANON_HOST = 'xmonsMac-3574.local'; // fixtures.ts MACHINE_NAME（pi 段 = 本机）
// #1259：claude-code 段挂 remote canon 机（本机 canon pi-only）——cc 卡读
// 远端机的 hostname。
const CANON_CC_HOST = 'mea-wsl'; // fixtures.ts MACHINE_REMOTE_NAME

test('tablist = 恰 pi / Claude Code / Gemini 三 tab，默认选中 pi', async ({ page }) => {
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

test('pi tab：fixture 模型行 + facade/38 项负向 + 无可点感装饰', async ({ page }) => {
  await page.goto(PAGE);
  const rows = page.locator(`${SHELL} [data-model-id][data-runtime="pi"]`);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-model-id', 'claude-sonnet-5');
  await expect(rows.nth(0)).toContainText('Claude Sonnet 5（R3 网关）');
  await expect(rows.nth(0)).toContainText('claude-sonnet-5');
  // A1/A5 负向：facade 行与 38 项 preset 名单不出现在页面正文
  const main = page.locator(`${SHELL} .page-main`);
  await expect(main).not.toContainText('Cairn（内置）');
  await expect(main).not.toContainText('DeepSeek');
  await expect(main).not.toContainText('OpenRouter');
  // A7：纯展示行无 chevron/三点（行内零 svg 零 button）
  await expect(page.locator(`${SHELL} [data-model-id] svg`)).toHaveCount(0);
  await expect(page.locator(`${SHELL} [data-model-id] button`)).toHaveCount(0);
});

test('切 Claude Code tab：aria-selected 翻转 + ?runtime= 写入（scenario 保留）', async ({
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

test('深链 ?runtime=claude-code 直落，刷新后 tab 定位保持', async ({ page }) => {
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

test('header 卡：runtime 名 + 说明 + 「已安装在 <hostname>」（两 tab 同构）', async ({ page }) => {
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

test('settings.json 缺失分支：header 转「未安装」指引态，模型行零渲染不崩', async ({
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
  // pi tab 不受 cc 缺失影响（切回仍见 canon 三行）
  await page.locator(`${SHELL} [role="tab"][data-runtime="pi"]`).click();
  await expect(page.locator(`${SHELL} [data-model-id][data-runtime="pi"]`)).toHaveCount(3);
});

// #1050 五态：主句由 installed（配置）定、细字行由 bin（二进制）定、角标由
// auth（凭据）定——三个维度分开，不压平。此三条钉住「装了+已登录」（canon）、
// 「装了+未登录」、「装了+没配」；「没装」（10-cc-missing，上一条）与
// 「bin 缺席 = 闭嘴」由负向断言覆盖。
test('#1050 装了 + 已登录：细字行报版本与路径，无「未登录」角标', async ({ page }) => {
  await page.goto(`${PAGE}&runtime=claude-code`);
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toContainText(`已安装在 ${CANON_CC_HOST}`);
  await expect(head).toContainText('claude 2.1.289 · /home/u/.local/bin/claude');
  await expect(head).not.toContainText('未登录');
  await expect(head).toHaveAttribute('data-auth', 'logged-in');
  // 主句仍是安装态，不再出现「未配置模型槽」混淆
  await expect(head).not.toContainText('未配置模型槽');
});

test('#1050 装了 + 未登录：细字行尾出「未登录」角标（主句不变）', async ({ page }) => {
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

test('#1050 装了 + 没配：主句转「已安装，未配置模型槽」+ 配置补法句，模型行零渲染', async ({
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
  // 与「没装」的补法句区分开
  await expect(head).not.toContainText('安装 Claude Code 并完成一次登录后');
  await expect(
    page.locator(`${SHELL} [data-model-id][data-runtime="claude-code"]`),
  ).toHaveCount(0);
});

test('#1050 没装（bin: null = 探过了没有）：主句「未安装」+ 安装指引 + 零细字行', async ({
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

test('#1050 配置文件在但二进制没了：不再假报「已安装在」（旧行为是假绿）', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=10-cc-bin-gone&runtime=claude-code');
  const head = page.locator(
    `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`,
  );
  await expect(head).toHaveAttribute('data-state', 'bin-missing');
  await expect(head).toContainText('未安装');
  await expect(head).not.toContainText('已安装');
});

test('#1050 bin 键缺席（老 daemon 没探过）：维持只看 installed 的旧行为，不写「未知」', async ({
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

test('几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右', async ({
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
  // 内容列居中于 sheet：sheet 占 248..1430（右缘留 10px），
  // (248 + 1430 − 768) / 2 = 455。
  expect(colBox?.x).toBe(455);
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
