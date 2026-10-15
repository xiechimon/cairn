// 机器页 shell 开关 e2e（XMON-113 R3）：`machine.shellEnabled` 的 web 写入面
// ——契约（记录字段 + PATCH 透传）由 XMON-108 R1 提供（shared
// machineRecordSchema / patchMachineBodySchema，server routes.ts 单字段透传）。
//
// 面的形态 = 行内开关（票内决策，理由见交付评论）：#503 摘除 per-runtime 开关
// 的真实理由是那个控件是死的（PR #507 body 原文「写 enabledRuntimes——该字段
// 全仓只写不读」），shellEnabled 有真实消费方（claim 组装 localTasks 双闸 +
// 每命令预检），是活控件，故行内控件面在此接回；死钮纪律（删除 / chevron /
// per-runtime 开关）仍由 machines-local.spec.ts 负向把守。
//
// live 面启动打桩（承 agent-detail.spec 的 stubLiveBoot 纪律）：teams /
// user me 是 teamId 来源、必须成功；machines 读/写面是本 spec 的被测对象
// （读 = GET /api/teams/{tid}/machines，写 = PATCH /api/machines/{id}——
// 两个不同前缀，路由桩别写混）；
// 其余 GET 一律 500（= 应用既有 isError 耐受）。URL 不带 ?scenario= 即 live
// 数据源（api/mode.ts 闸门），故本 spec 覆盖 live 面而非 fixture 面。
//
// 钉住的失败方式（先列后写）：
//   1. 开关不读真值 —— 显示态与记录里的 shellEnabled 不一致（每行按自己的
//      记录渲染，不是全局一个值）。
//   2. 写入字段错 —— PATCH body 不是 {shellEnabled}（例如连带发 enabledRuntimes
//      被全量替换掉，或字段拼错被 server 静默忽略）。
//   3. 失败不回滚 —— PATCH 返 500 后开关停在开态，用户以为存上了。
//   4. 失败无反馈 —— 回滚但一声不吭（XMON-80 同病：点了没反应）。
//   5. 成功后错误行不退 —— 「有反馈」退化成一条永远挂着的红字。
//   6. 无乐观更新 —— 响应在途期间开关不动，用户以为没点上、连点几次。
//   7. 刷新不持久 —— 拨 on → reload → 回 off（读侧没投影 / 写侧没落库）。
//   8. 只给本机开 —— 接入机（kind='remote'）行不渲染开关，授权面缺口。

import { expect, type Page, test } from '@playwright/test';

// #944/#910 载体：.mach-shell-switch 类名钩退役 → role=switch 一级
// （aria-label = AGENT_TOOL_SHELL，行内恰一个开关，行 scope 即唯一定位）。
const SWITCH = '[role="switch"]';
const ERROR = '[role="alert"]';

interface StubMachine {
  id: string;
  name: string;
  teamId: string;
  online: boolean;
  latestCliVersion: null;
  kind: 'local' | 'remote';
  enabledRuntimes: string[];
  shellEnabled: boolean;
  /** #1108 并发面（缺省不带 = 老 server 形——控件退场面由 machines-local 钉）。 */
  maxConcurrent?: number;
  runningSteps?: number;
}

/** machineRecordSchema 形状（XMON-108 起含 shellEnabled；#1108 起可带并发位）。 */
function machine(over: Partial<StubMachine> & { id: string; name: string }): StubMachine {
  return {
    teamId: 'team-1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: [],
    shellEnabled: false,
    ...over,
  };
}

/** live 启动打桩 + 有状态 machines 面：PATCH 成功即改桩内状态，故 reload 后的
 *  GET 回读的是「服务端」真值——刷新持久这一条测的是读侧投影，不是浏览器内存。 */
async function stubStack(page: Page, rows: StubMachine[]) {
  const state = { rows: rows.map((r) => ({ ...r })), patches: [] as unknown[] };
  // 注册序 = 匹配逆序（playwright 取最后注册者）：catch-all 先，具体路由后。
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({ json: state.rows }),
  );
  await page.route('**/api/machines/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    state.patches.push(route.request().postDataJSON());
    const body = route.request().postDataJSON() as {
      shellEnabled?: boolean;
      maxConcurrent?: number;
    };
    state.rows = state.rows.map((r) =>
      r.id === id
        ? {
            ...r,
            ...(body.shellEnabled !== undefined ? { shellEnabled: body.shellEnabled } : {}),
            ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}),
          }
        : r,
    );
    return route.fulfill({ json: state.rows.find((r) => r.id === id) });
  });
  return state;
}

const LOCAL = machine({ id: 'm-local', name: 'xmonsMac-3574.local', kind: 'local' });
const REMOTE = machine({ id: 'm-remote', name: 'build-box' });

test('每行开关读自己的记录真值（本机开 / 接入机关）', async ({ page }) => {
  await stubStack(page, [{ ...LOCAL, shellEnabled: true }, REMOTE]);
  await page.goto('/app/resources/machines');
  const switches = page.locator(SWITCH);
  await expect(switches).toHaveCount(2);
  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator(`${SWITCH}[data-machine-id="m-remote"]`)).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('接入机行同样有开关：授权面覆盖非本机机器', async ({ page }) => {
  await stubStack(page, [LOCAL, REMOTE]);
  await page.goto('/app/resources/machines');
  await expect(page.locator('div[data-kind="remote"]').locator(SWITCH)).toHaveCount(1);
});

test('拨 on：PATCH 单字段 {shellEnabled:true}，刷新后仍 on（读侧真值一致）', async ({ page }) => {
  const state = await stubStack(page, [LOCAL]);
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();
  // 前提守卫：请求真发出去了，且只带 shellEnabled 一个字段（#503 起 PATCH
  // 两字段各自可选、缺省 = 不动——连带发 enabledRuntimes 会把该列全量替换）。
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ shellEnabled: true });
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('拨 off：同律回写 false 并持久', async ({ page }) => {
  const state = await stubStack(page, [{ ...LOCAL, shellEnabled: true }]);
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await sw.click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ shellEnabled: false });
  await page.reload();
  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('响应在途期间即显示新态（乐观更新，不等服务器回执）', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  // 把 PATCH 按住不放：若开关要等响应才动，这里就会红。
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/machines/*', async (route) => {
    await held;
    return route.fallback();
  });
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  release();
});

test('PATCH 失败：开关回滚 + 可见错误反馈', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  let patches = 0;
  await page.route('**/api/machines/*', (route) => {
    patches += 1;
    return route.fulfill({ status: 500, json: { error: 'boom' } });
  });
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await sw.click();
  await expect.poll(() => patches).toBe(1);
  const error = page.locator(ERROR);
  await expect(error).toBeVisible();
  await expect(error).toHaveText('保存失败，请重试。');
  // 失败不停在开态——否则用户以为存上了，而预检会按旧值拒。
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('保存成功后不留错误行', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  await page.goto('/app/resources/machines');
  await page.locator(`${SWITCH}[data-machine-id="m-local"]`).click();
  await expect(page.locator(ERROR)).toHaveCount(0);
});
// —— #1108 并发上限控件（PATCH 单字段 + 读标注投影 + 老形态退场）——————————
// 失败方式（先于实现固化，shell 开关八条同族）：
//   C1 写入字段错——PATCH body 不是单字段 {maxConcurrent}（连带发其它字段 =
//   覆盖替换面，#503 律）。
//   C2 读标注不渲染 / 渲染错数——`执行中 {n}/{cap}` 必须来自记录真值。
//   C3 老形态（无 maxConcurrent 字段）→ 控件与读标注整组退场（fixture 混版本零漂移）。
//   C4 刷新不持久——选 4 → reload → 回 4（读侧投影）。

test('C1+C2+C4：并发选择器——读标注真值、PATCH 单字段、刷新持久', async ({ page }) => {
  const state = await stubStack(page, [
    { ...LOCAL, maxConcurrent: 2, runningSteps: 1 },
  ]);
  await page.goto('/app/resources/machines');
  // C2：读标注 = 记录真值（running 1 / cap 2）。
  const readout = page.locator('[data-machine-running="1"]');
  await expect(readout).toHaveText('执行中 1/2');
  // 触发钮显示当前上限；打开选 4。（#1241 设计 A：行内可见面 = 数值 +
  // chevron，语义词全走 aria-label——无来源字段的老 server 形退短标签。）
  const trigger = page.locator('button[aria-label^="并发上限"]');
  await expect(trigger).toHaveAccessibleName('并发上限 2');
  await expect(trigger).toContainText('2');
  await trigger.click();
  await page.getByRole('spinbutton', { name: '并发上限' }).fill('4');
  await page.getByRole('spinbutton', { name: '并发上限' }).press('Enter');
  // C1：PATCH 只带 maxConcurrent 单字段。
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ maxConcurrent: 4 });
  // C4：刷新后读侧真值一致。
  await page.reload();
  await expect(page.locator('button[aria-label^="并发上限"]')).toContainText('4');
});

test('C3：老 server 形（无 maxConcurrent 字段）→ 控件与读标注整组退场', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  await page.goto('/app/resources/machines');
  await expect(page.locator('button[aria-label^="并发上限"]')).toHaveCount(0);
  await expect(page.locator('[data-machine-running]')).toHaveCount(0);
  // shell 开关不受影响（行回到单控件面）。
  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveCount(1);
});
