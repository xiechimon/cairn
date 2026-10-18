import { expect, type Page, test } from '@playwright/test';

// Issue #1157：ResourceShell 的返回键曾是裸 <a href>——点它是浏览器整页导航，
// 整个 SPA 重新加载（丢内存态、重跑 boot、重拉全部数据）。修法 = shell.tsx
// 一处换 react-router <Link to>，全部消费面同吃。本 spec 钉「机制」不钉
// 「结果」：toHaveURL 对整页重载是瞎的（全量重载同样会让 URL 变对）。
//
// 失败方式（每条断言钉一个）：
// 1. 返回键仍是裸 <a>（或回归）→ 整页导航把旧 document 连内存一起回收：
//    点前挂上的 window.__spaSentinel 读回 undefined。哨兵是主判据。
// 2. 整页导航必然发起新的 document 请求——点击后的
//    request(resourceType=document) 计数非 0 即整页重载。SPA 路由切换
//    （history.pushState）不发 document 请求；无竞态：若真整页重载，
//    document 请求必先于目标面渲染发出，而计数断言在目标面渲染后才读。
// 3. Link 断掉（不导航 / 目标错）→ URL 与目标面标记必须到位。
// 4. 另一个带返回键的面同族回归——agent-detail（票报的面）与
//    machine detail（验收要求至少再核一面）各跑一遍同一机制。

/** 带内存哨兵的 window 形态（哨兵只活在本 spec 的一次导航周期里）。 */
type SentinelWindow = Window & { __spaSentinel?: string };

/** 点返回必须是 SPA 内路由切换：哨兵存活 + 零 document 请求 + URL 到位。 */
async function expectBackIsSpaNavigation(
  page: Page,
  route: string,
  backTo: string,
  landedMarker: string,
) {
  await page.goto(route);
  // document 请求计数器在 goto 之后挂——初始加载不计，只抓点击后的导航。
  let documentRequests = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentRequests += 1;
  });
  const sentinel = await page.evaluate(() => {
    const w = window as SentinelWindow;
    w.__spaSentinel = crypto.randomUUID();
    return w.__spaSentinel;
  });
  await page.locator('[aria-label="返回"]').click();
  // 结果面：URL 到位 + 目标面已渲染。这一步同时是整页重载情形的竞态兜底——
  // 新 document 渲染完时旧 window 必已回收，随后的哨兵读回必然来自新世界。
  await expect(page).toHaveURL(backTo);
  await expect(page.locator(landedMarker)).toBeVisible();
  // 机制面（soft：红态时两条信号一起浮出来，不是只报第一条）：
  // 内存哨兵存活 = window 没被回收；零 document 请求 = 没发生整页导航。
  expect
    .soft(await page.evaluate(() => (window as SentinelWindow).__spaSentinel))
    .toBe(sentinel);
  expect.soft(documentRequests).toBe(0);
}

test('agent detail back is an in-SPA navigation, not a document reload', async ({ page }) => {
  await expectBackIsSpaNavigation(
    page,
    '/app/resources/agents/r3-builder?scenario=agent-detail',
    '/app/team',
    '[data-route="team"]',
  );
});

// Paper page shell (PR 6): sidebar destinations (skills) carry no back arrow
// any more; the second detail face is machine detail → the machines list.
test('machine detail back is an in-SPA navigation, not a document reload', async ({ page }) => {
  await expectBackIsSpaNavigation(
    page,
    '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06',
    '/app/resources/machines',
    '[data-route="/app/resources/machines"] h1:text-is("机器")',
  );
});
