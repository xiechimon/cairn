// Token 门页 e2e（#253，spec #247 D9）：与其余 spec 的 fixture 面不同，
// 本 spec 起真 apps/server 进程（PACMAN_HOME scratch 目录 + 托管 fixture 构建的
// dist）打真 401 闸。失败方式枚举（web 面，server 面归 test/token-auth.test.ts）：
//   1. 鉴权开 + 无 token 首访 → 门页盖住 UI
//   2. 错 token → 停留门页 + 通用错误文案，localStorage 不写坏值
//   3. 陈旧坏 token → 启动即落门页且坏值被清除（SSE 不带坏 token 重连）
//   4. 放行后 → 原请求重试进 UI，team stream URL 带 ?token=（EventSource
//      无法设 header，server 仅两条 stream 收 query token）
//   5. localStorage 已有好 token → 首访直达 UI，零门页
//   6. 鉴权关 → 零门页，stream URL 不带 token 参数（现况一致）
// 会话流与团队流共用 sse.ts connect() 单缝——URL 构造由团队流断言代表。
// #1048 增补（文案面，纯信息缺口票）：
//   7. zh 面指引缺失——门页只说「已开启鉴权」，不说令牌从哪来（改前状态）
//   8. en 面指引退化——字典模板丢 {tokenVar} 占位 → 英文面失环境变量名
//   9. 文案带「变量名=具体值」的示例赋值，诱导把真值贴进公网可见的文案
// 指引三事实（与 apps/server config.ts 的读取机制一致）：令牌 = 服务端环境
// 变量 ENV_VARS.token 的值（部署方设定，页面读不到）；自部署的文件级落点 =
// systemd 单元 EnvironmentFile 指向的 env 文件；删变量 + 重启服务端 = 关闭
// 鉴权（envStr 只在进程启动时读一次）。

import { ENV_VARS } from '@pacman/shared';
import { expect, type Page, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

declare global {
  interface Window {
    /** addInitScript 注入的 EventSource 构造 URL 记录（?token= 断言面）。 */
    __esUrls?: string[];
  }
}

const GATE_TOKEN = 'pacman-e2e-gate-token-0123456789abcdef';

/** 记录每个 EventSource 构造 URL（?token= 面断言）。 */
async function recordEventSourceUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const urls: string[] = [];
    (window as Window).__esUrls = urls;
    const Native = window.EventSource;
    const Patched = function (url: string | URL, init?: EventSourceInit) {
      urls.push(String(url));
      return new Native(url, init);
    } as unknown as typeof EventSource;
    window.EventSource = Patched;
  });
}

async function streamUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__esUrls ?? []);
}

let authed: LiveServer;
let openServer: LiveServer;

test.beforeAll(async () => {
  authed = await bootLiveServer(GATE_TOKEN);
  openServer = await bootLiveServer(null);
});

test.afterAll(async () => {
  await authed.dispose();
  await openServer.dispose();
});

test('鉴权开：首访落门页；错 token 停留不落盘；对 token 进 UI 且 SSE 带 ?token=', async ({
  page,
}) => {
  await recordEventSourceUrls(page);
  await page.goto(`${authed.base}/app`);

  // 失败方式 1：门页盖住 UI
  await expect(page.locator('.token-gate')).toBeVisible();
  await expect(page.locator('.token-gate-title')).toHaveText('需要访问令牌');

  // 失败方式 2：错 token → 停留 + 通用文案 + localStorage 不落坏值
  await page.locator('.token-gate-input').fill('wrong-token');
  await page.locator('.token-gate-submit').click();
  await expect(page.locator('.token-gate-error')).toHaveText('令牌无效，请重试。');
  await expect(page.locator('.token-gate')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pacman.token'))).toBeNull();
  // 错误细节不泄漏：server {error} 内容不出现在页面
  expect(await page.locator('.token-gate').innerText()).not.toContain('Unauthorized');

  // 失败方式 4：对 token → 放行、停车的原请求带 Bearer 重试成功、UI 呈现
  const retryLands = page.waitForResponse(
    (res) => res.url().endsWith('/api/teams') && res.status() === 200,
  );
  await page.locator('.token-gate-input').fill(GATE_TOKEN);
  await page.locator('.token-gate-submit').click();
  await expect(page.locator('.token-gate')).toHaveCount(0);
  await expect(page.locator('.board-sidebar')).toBeVisible();
  const retried = await retryLands;
  expect(retried.request().headers().authorization).toBe(`Bearer ${GATE_TOKEN}`);
  expect(await page.evaluate(() => localStorage.getItem('pacman.token'))).toBe(GATE_TOKEN);

  // SSE 以 ?token= 建流（EventSource 无法设 header 的协议例外）
  await expect
    .poll(async () =>
      (await streamUrls(page)).some(
        (url) => url.includes('/stream?') && new URL(url, authed.base).searchParams.get('token') === GATE_TOKEN,
      ),
    )
    .toBe(true);
});

test('鉴权开：陈旧坏 token 首访即落门页且坏值被清除', async ({ page }) => {
  await recordEventSourceUrls(page);
  await page.addInitScript(() => localStorage.setItem('pacman.token', 'stale-bad-token'));
  await page.goto(`${authed.base}/app`);

  // 失败方式 3：门页出现，坏值清除（SSE 不得带坏 token 建流）
  await expect(page.locator('.token-gate')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pacman.token'))).toBeNull();
  for (const url of await streamUrls(page)) {
    expect(url).not.toContain('stale-bad-token');
  }
});

test('鉴权开：localStorage 已有好 token → 首访直达 UI 零门页', async ({ page }) => {
  await recordEventSourceUrls(page);
  await page.addInitScript(
    (token: string) => localStorage.setItem('pacman.token', token),
    GATE_TOKEN,
  );
  const firstLoad = page.waitForResponse(
    (res) => res.url().endsWith('/api/teams') && res.status() === 200,
  );
  await page.goto(`${authed.base}/app`);

  await expect(page.locator('.board-sidebar')).toBeVisible();
  await expect(page.locator('.token-gate')).toHaveCount(0);
  expect((await firstLoad).request().headers().authorization).toBe(`Bearer ${GATE_TOKEN}`);
  await expect
    .poll(async () => (await streamUrls(page)).some((url) => url.includes('/stream?token=')))
    .toBe(true);
});

test('鉴权关：零门页零 token 附带，行为与现状一致', async ({ page }) => {
  await recordEventSourceUrls(page);
  const firstLoad = page.waitForResponse((res) => res.url().endsWith('/api/teams'));
  await page.goto(`${openServer.base}/app`);

  // 失败方式 6：门页永不出现，live 数据面直达且请求零附带
  await expect(page.locator('.board-sidebar')).toBeVisible();
  await expect(page.locator('.token-gate')).toHaveCount(0);
  const res = await firstLoad;
  expect(res.status()).toBe(200);
  expect(res.request().headers().authorization).toBeUndefined();
  await expect
    .poll(async () => (await streamUrls(page)).some((url) => url.includes('/stream')))
    .toBe(true);
  for (const url of await streamUrls(page)) {
    expect(url).not.toContain('token=');
  }
});

test('#1048 门页指引：zh 面告诉令牌从哪来（变量名 / EnvironmentFile / 重启关闭）', async ({
  page,
}) => {
  await page.goto(`${authed.base}/app`);
  const help = page.locator('.token-gate-help');
  await expect(help).toBeVisible();

  // 失败方式 7：指引必须含环境变量名的正典值（BRAND 槽，禁硬编码字面量）
  await expect(help).toContainText(ENV_VARS.token);
  // 自部署的文件级落点：systemd 单元 EnvironmentFile 指向的 env 文件
  await expect(help).toContainText('EnvironmentFile');
  // 关闭语义：env 只在进程启动时读取，删变量后必须重启才生效
  await expect(help).toContainText('重启');
  // 失败方式 9：变量名后不得跟示例赋值（任何 = 右值都算诱导贴真值）
  expect(await help.innerText()).not.toMatch(new RegExp(`${ENV_VARS.token}\\s*=`));
});

test('#1048 门页指引：en 面同一事实不失真（变量名经字典模板插值）', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pacman.locale', 'en');
    localStorage.setItem('pacman-locale', 'en');
  });
  await page.goto(`${authed.base}/app`);
  const help = page.locator('.token-gate-help');
  await expect(help).toBeVisible();

  // 失败方式 8：en 模板若丢 {tokenVar} 占位，英文指引里变量名消失
  await expect(help).toContainText(ENV_VARS.token);
  await expect(help).toContainText('EnvironmentFile');
  await expect(help).toContainText(/restart/i);
  expect(await help.innerText()).not.toMatch(new RegExp(`${ENV_VARS.token}\\s*=`));
});
