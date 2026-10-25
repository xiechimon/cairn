import { expect, type Locator, type Page, test } from '@playwright/test';
import { spiralAvatarUrl } from '../src/lib/spiral-avatar.js';

// #650/#651 总管抽屉 markdown 单源 + 流式打字面。
// 失败方式枚举（渲染缝；mapper 缝的钉在 test/chief-markdown.test.ts）：
//  F-R1 chief 回复 `**bold**` 仍漏字面星号（没走共用解析器/内联层没 strong 位）
//  F-R2 块级 markdown（标题/列表/嵌套/代码栅栏）在抽屉里不渲染
//  F-R3 mention / 行内 code chip 被 strong 解析破坏
//  F-R4 typing 打字行带 foot（复制钮/完成徽标）——打字面被当定稿面
//  F-R5 定稿行 foot 丢失（typing gate 误伤定稿行）
//  F-R6 用户行头像仍是写死的通用人形字形（没接 XMON-105 单源）
//  F-R7 live 面 avatarUrl 覆盖不生效（不是 /api/user/me 的真值）
//  F-R8 抽屉体（chief-body testid）仍不可滚动（overflow hidden），流式增量被裁在视野外
//  F-R9 fixture 捕获面（r5 114 段数组形）被 markdown 改造误伤（DOM 漂移）
//  F-R10 live text_delta 增量不上屏（抽屉不读 liveTextStore——原 bug 本体）
//  F-R11 终稿 message 收敛后打字行残留 / 与落库行重复渲染
//  F-R12 同文双行（POST + user-<stepId> 回声）双气泡（#667）；连发不同文塌成一条
//  F-R15 robot 行身份 chip（live 面，#741）：头像+名字 anchor 指 Agent 设置页，
//        点击全链落详情页真记录（fixture 面钉在 agent-identity-chip.spec）
// #742 用户气泡 markdown 面（详情页用户行 #612 同款配方；mapper 缝的钉在
// test/chief-markdown.test.ts F-D1..D5）：
//  F-R14 live 用户行仍字面吐纯文本——[#16](todo:id) 与 **bold** 在自泡漏出
//        （bug 本体）；正例 = chip 成锚可点导航，负例 = 裸 #seq / 伪 scheme 字面
//  F-R15 复制载荷漂移——复制钮拿到渲染后文本（#469 律：复制的是 markdown 源）
//  F-R16 气泡节奏塌——单行纯文本 live 气泡几何漂移（44px 药丸 = 10px padding
//        ×2 + 24px 行盒）；多块气泡首/尾块 margin 与 padding 叠出双倍留白
//  F-R17 fixture 捕获面用户气泡漂移——无槽行被误进 markdown 路径（DOM 不稳）
// #822 在飞存在行可展开（箭头是死的 → 点开展示实时步骤；mapper 缝的钉在
// test/chief-flight-expand.test.ts F-E1..E6）：
//  F-R18 行本体是 button（aria-expanded 开关）→ 展开面 = 正在调用的工具 +
//        本轮已落库工具行；Enter 可收；typing 接管/终稿落库两帧展开态零残留
// #1034 思考行宽截断（Button 基类 nowrap+shrink-0 未覆写、w-fit 在 nowrap 下
// fit-content 解成整段文本宽——626px 钮冲出 384px 列；截图里的「…」是 JS 按
// PREVIEW_CHARS=150 切的字面字符，不是 CSS 省略号。detail 面同源缺陷另钉
// thinking-row-truncate.spec）：
//  F-R22 长预览必须由 CSS 截断（#772 律 min-w-0 flex-auto truncate + live-row
//        SKIN 同形）：CJK（无空格）与拉丁各一条，均 < 150 字符——字符切片
//        救不了它们；钉 ellipsis 生效、可见宽 < 内容宽、钮宽 ≤ 列宽、页面零横溢
//
// live 面手法 = notify-click.spec 的替身 EventSource + 路由 mock（SSE 帧
// 程序化注入，不经网络）；fixture 面 = 'chief-md' 命名场景（md-toolout 先例）。

/** window 侧观测槽（init script 写入；notify-click.spec 同款替身）。 */
declare global {
  interface Window {
    __es: { url: string; readyState: number; emit: (ev: unknown) => void }[];
  }
}

function stubEventSource(page: Page) {
  return page.addInitScript(() => {
    window.__es = [];
    class FakeEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) {
        window.__es.push(this as unknown as (typeof window.__es)[number]);
        queueMicrotask(() => this.onopen?.());
      }
      close() {
        this.readyState = 2;
      }
      emit(ev: unknown) {
        this.onmessage?.({ data: JSON.stringify(ev) });
      }
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
  });
}

/** avatarUrl 覆盖桩（live 面）：1×1 PNG 直接 fulfill——不 mock 该主机会真发
 *  DNS 请求，加载失败触发 SeededAvatar 的 fallback 换 src，断言与 error 事件
 *  赛跑（全量套件下实测 flake）。 */
const PX_1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
function stubCdnAvatar(page: Page) {
  return page.route('**/cdn.example/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PX_1 }),
  );
}

// —— live 面 mock（无 scenario 参 = live 模式；notify-click.spec 同配方）——

const TEAM = { id: 't1', name: '团队' };
const USER = { id: 'u1', displayName: 'Xmon Dai', avatarUrl: 'https://cdn.example/me.png' };
const AGENT = {
  id: 'agent-1',
  displayName: 'r5-scribe',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: 'r3-gw',
  modelId: 'claude-sonnet-5',
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};
/** activeRun 在位 = 回合进行中（typing 尾行的 gate 输入）。 */
const THREAD = {
  id: 'chief-bbb',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: '线程乙',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's2', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: { phase: 'chief' },
};
const USER_ROW = { id: 'm1', role: 'user', content: '派一下凭证链路验证', createdAt: 1 };
const FINAL_ROW = { id: 'm9', role: 'assistant', content: '验证完成，**全部通过**。', createdAt: 9 };

function mockChiefLiveApi(
  page: Page,
  state: {
    final: boolean;
    messages?: { id: string; role: string; content: unknown; createdAt: number }[];
    // #822 F-R18：在飞展开面数据源覆写（activeRun.tool 工具名投影）。
    // null = 回合已收口（settled 面覆写，F-R21；undefined 走 THREAD 缺省）。
    activeRun?: { phase: string; tool?: { toolName: string } } | null;
  },
) {
  const json = (body: unknown) => ({
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  return page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/teams') return route.fulfill(json([TEAM]));
    if (p === '/api/user/me') return route.fulfill(json(USER));
    if (p === '/api/teams/t1/notifications')
      return route.fulfill(json({ unreadThreadIds: [] }));
    if (p === '/api/teams/t1/chief/threads')
      return route.fulfill(
        json([
          {
            ...THREAD,
            activeRun: state.activeRun === undefined ? THREAD.activeRun : state.activeRun,
          },
        ]),
      );
    if (p === '/api/teams/t1/chief') {
      return route.fulfill(
        json({
          chief: {
            id: 'chief-u1-t1',
            userId: 'u1',
            teamId: 't1',
            agent: { agentId: 'agent-1' },
            charter: null,
            lastTurnAt: null,
            createdAt: 0,
            tz: null,
          },
          agentActor: AGENT,
          context: null,
          watches: [],
          wakes: [],
        }),
      );
    }
    if (p === '/api/conversations/chief-bbb/messages') {
      // 自定义 messages 原样返回（F-R12 旧语义：final 不再补 FINAL_ROW）；
      // 缺省集：未决 [USER_ROW] / 终稿 [USER_ROW, FINAL_ROW]。
      const messages = state.messages ?? (state.final ? [USER_ROW, FINAL_ROW] : [USER_ROW]);
      return route.fulfill(json({ messages }));
    }
    // #741 F-R15：身份 chip 点击全链——Agent 详情页的记录读面。
    if (p === '/api/teams/t1/agents/agent-1') return route.fulfill(json(AGENT));
    if (p === '/api/todos' || p === '/api/projects') return route.fulfill(json([]));
    if (
      p === '/api/teams/t1/members' ||
      p === '/api/teams/t1/machines' ||
      p === '/api/skills'
    ) {
      return route.fulfill(json([]));
    }
    // 未覆盖路径 418 + {error}：react-query retry:1 落定后安静失败，断言面
    // 不吃这些查询（notify-click.spec 同律）。
    return route.fulfill({ status: 418, ...json({ error: `unmocked: ${p}` }) });
  });
}

/** 等到目标会话流的替身 EventSource 建流，返回程序化 emit 句柄。 */
async function chiefStream(page: Page) {
  const part = '/api/conversations/chief-bbb/stream';
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), part))
    .toBe(true);
  return {
    emit: (ev: unknown) =>
      page.evaluate(
        ([u, e]) => {
          const es = window.__es.find((x) => x.url.includes(u));
          es?.emit(e);
        },
        [part, ev] as [string, unknown],
      ),
  };
}

/** A0 进场动画（fade+scale，ADR 0013 D7）：boundingBox /
 *  getBoundingClientRect 含 transform——几何断言前先等动画落定
 *  （chief-panel.spec settled 同谓词；#1033 同帧律管采样配对，本谓词管
 *  进场腿）。 */
async function settledDrawer(drawer: Locator) {
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

test.describe('chief drawer markdown 面（fixture，#650）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app?scenario=chief-md');
    await expect(page.locator('.chief-drawer')).toBeVisible();
  });

  test('F-R1/R2/R3: robot markdown 行走共用块解析——bold/标题/列表/栅栏/chip 全渲染，星号零漏出', async ({
    page,
  }) => {
    const stream = page.getByTestId('chief-stream');
    // 字面星号一个不漏（定稿行 + 打字行全文范围）。
    await expect(stream).not.toContainText('**');

    // 标题 = 真 h2（chat-md-head 家族，detail.css 几何单源）。
    await expect(stream.locator('h2.chat-md-head')).toHaveText('凭证链路验证报告');

    // 粗体 = 真 <strong>（段落内 + bullet lead 内）。
    await expect(stream.locator('.chat-para strong', { hasText: '全部通过' })).toHaveCount(1);
    const leadBullet = stream.locator('.chat-md-item--bullet').first();
    await expect(leadBullet.locator('strong')).toHaveText('项目');
    await expect(leadBullet).toContainText(': 凭证链路验证');

    // 行内 code chip + mention chip（strong 解析不破坏既有内联家族）。
    await expect(stream.locator('.chat-code', { hasText: 'docs/verify/' })).toHaveCount(1);
    const mention = stream.locator('.mention-chip--agent');
    await expect(mention).toHaveCount(1);
    await expect(mention).toHaveText('r5-scribe');
    // #741: agent 提及 chip 接通导航（#675 todo 分支同款配方）——href 指
    // Agent 设置页；点击导航与负例钉在 agent-identity-chip.spec。
    await expect(mention).toHaveAttribute('href', '/app/resources/agents/a1');

    // 有序列表 + 嵌套子项（depth 缩进位）+ 代码栅栏（lang 位 + 原文）。
    await expect(stream.locator('.chat-md-item--ordered').first()).toContainText('第一步：读取配置');
    const nested = stream.locator('.chat-md-item--bullet[data-depth="1"]');
    await expect(nested).toHaveCount(1);
    await expect(nested).toContainText('子项：token 门');
    const fence = stream.locator('pre.chat-md-code');
    await expect(fence).toHaveAttribute('data-lang', 'sh');
    await expect(fence).toContainText('curl -s localhost:8787/healthz');
  });

  test('F-R13: todo 提及渲成 chip，锚点指任务详情并可点击导航；字面 #seq/伪 scheme 不出 chip（#675）', async ({
    page,
  }) => {
    const stream = page.getByTestId('chief-stream');
    const chip = stream.locator('.mention-chip--todo');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('#1');
    // 点击行为 = 导航（参考站实测：todo chip click → /app/todo/<id>，
    // hover 无弹层）。真锚点（router Link）：键盘/中键免费。
    await expect(chip).toHaveAttribute('href', '/app/todo/r3-legacy-1');
    // 防正则吃宽：prose 裸 #12 与相邻 scheme 伪链 [伪链](todos:t2) 保持字面文本。
    await expect(stream).toContainText('prose #12 与 [伪链](todos:t2) 保持字面');
    expect(await stream.locator('.mention-chip').count()).toBe(
      await stream.locator('.mention-chip--agent').count() +
        (await stream.locator('.mention-chip--todo').count()),
    );
    // SPA pushState 只钉 pathname（card-press.spec 同律——query 不随钉）。
    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/todo/r3-legacy-1');
  });

  test('F-R4/R5: typing 打字行无 foot；定稿行 foot（复制 + 完成 44s）保留', async ({ page }) => {
    // #950 载体：行 = chief-msg testid（#910 二级：无 role 的结构行）。
    const msgs = page.getByTestId('chief-stream').getByTestId('chief-msg');
    // note 行不是消息行：user + 定稿 robot + typing robot = 3。
    await expect(msgs).toHaveCount(3);

    const final = msgs.nth(1);
    const finalFoot = final.getByTestId('chief-msg-foot');
    await expect(finalFoot.getByRole('button', { name: '复制' })).toBeVisible();
    await expect(finalFoot).toContainText('完成 44s');

    const typing = msgs.nth(2);
    await expect(typing.getByTestId('chief-msg-foot')).toHaveCount(0);
    await expect(typing.locator('strong')).toHaveText('relay 通道');
  });

  test('F-R6/R8: 用户行头像 = 真人身份 img（XMON-105 单源），抽屉体可滚动', async ({ page }) => {
    const userRow = page.getByTestId('chief-stream').getByTestId('chief-msg').first();
    // #950 载体：头像 = 行内 img（.chief-avatar 槽类退役；XMON-105 img 律）。
    const img = userRow.locator('img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', spiralAvatarUrl('Xmon Dai'));
    // 写死的通用人形字形退场（行直接子级无 svg 字形槽）。
    await expect(userRow.locator('> svg')).toHaveCount(0);

    // 滚动容器：overflow-y auto（原 hidden 把长线程整个裁死）。
    const overflow = await page
      .getByTestId('chief-body')
      .evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflow).toBe('auto');
  });

  test('F-R9: r5 114 冻结捕获面不漂移——段数组行走原 .chief-para/.chief-bullet 路径', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const stream = page.getByTestId('chief-stream');
    // 段数组形照旧：字面段落 <p> 存在、chat-md 块零出现（.chief-para 类退役，
    // 字面路径载体 = p 元素本身）。
    await expect(stream.locator('p').first()).toContainText('已创建并派工');
    await expect(stream.locator('.chat-para, .chat-md-item, .chat-md-code')).toHaveCount(0);
    // todo / agent 实体 chip 保留（ChiefSegment 家族不受 markdown 槽影响；
    // testid 载体——文本载体区分不了 chip 与漏出字面量，F-R1/R3 语义所在）。
    await expect(stream.getByTestId('chief-chip-todo')).toHaveCount(1);
    await expect(stream.getByTestId('chief-chip-agent')).toHaveCount(1);
    // 用户行头像换 img 后，两钮行（复制/恢复）不受影响。
    await expect(stream.getByTestId('chief-msg-tools').getByRole('button')).toHaveCount(2);
  });

  test('F-R15: fixture 面（r5 113 running 捕获）不长存在行——ChiefStreamItem 新 kind 零污染', async ({
    page,
  }) => {
    // fixture 直接喂 ChiefContent.stream（不经 mapChief），running 位只切 composer
    // 占位；#739 的存在行是 live mapper 派生，捕获面尾行仍是定稿 robot 行。
    await page.goto('/app?scenario=113');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const stream = page.getByTestId('chief-stream');
    // #950 载体：在飞存在行 = 实时步骤 disclosure 钮（.chief-streaming 类退役）。
    await expect(stream.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    // 尾行 = 定稿 robot（带 foot），非在飞存在行。
    const lastMsg = stream.getByTestId('chief-msg').last();
    await expect(lastMsg.getByTestId('chief-msg-foot')).toHaveCount(1);
  });
});

test.describe('chief drawer 流式面（live mock，#651）', () => {
  test('F-R7/R10/R11: text_delta 增量上屏，message 终稿收敛不重复不残留', async ({ page }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    const state = { final: false };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: '主题', exact: true })).toHaveText('线程乙');

    // F-R7: live 面用户行头像 = /api/user/me 的 avatarUrl 覆盖真值。
    const userRow = drawer.getByTestId('chief-msg').first();
    await expect(userRow.locator('img')).toHaveAttribute(
      'src',
      'https://cdn.example/me.png',
    );

    const es = await chiefStream(page);

    // F-R10: 增量一：打字面上屏，粗体即时渲染（增量面与终稿面同一解析器）。
    await es.emit({ type: 'text_delta', text: '正在验证 **凭证' });
    const typing = drawer.getByTestId('chief-msg').last();
    await expect(typing.locator('.chat-para')).toContainText('正在验证 凭证');
    await expect(typing.locator('strong')).toHaveText('凭证');
    await expect(typing).not.toContainText('**');
    // user 行 + typing 行；打字面无 foot。
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);
    await expect(typing.getByTestId('chief-msg-foot')).toHaveCount(0);

    // F-R10: 增量二：同一段落追加（250ms 聚合窗口的下一批）。
    await es.emit({ type: 'text_delta', text: '链路**，马上出报告' });
    await expect(typing.locator('.chat-para')).toContainText('正在验证 凭证链路，马上出报告');
    await expect(typing.locator('strong')).toHaveText('凭证链路');

    // F-R11: 终稿 message 事件 → 缓冲 clear + messages 重取接管。
    state.final = true;
    await es.emit({ type: 'message', message: FINAL_ROW });
    // 打字行退场：user + 定稿 robot = 2 行，「正在验证」文本零残留。
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);
    await expect(drawer.getByTestId('chief-msg').filter({ hasText: '正在验证' })).toHaveCount(0);
    // 定稿行恰一条（不重复），粗体渲染 + foot 归位。
    const final = drawer.getByTestId('chief-msg').last();
    await expect(final.locator('strong', { hasText: '全部通过' })).toHaveCount(1);
    await expect(
      final.getByTestId('chief-msg-foot').getByRole('button', { name: '复制' }),
    ).toBeVisible();
  });

  test('F-R12: 双行去重（#667）——同文 POST + user-<stepId> 回声恰一个用户气泡；连发不同文各一条', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    // 生产对齐：每回合双落库（POST 行 + daemon transcript 回声行 user-<stepId>），
    // 两句话 → mock 4 条 user 行 + 1 条 robot。
    const state = {
      final: true,
      messages: [
        { id: 'm1', role: 'user' as const, content: '派一下凭证链路验证', createdAt: 1 },
        { id: 'user-stepX', role: 'user' as const, content: '派一下凭证链路验证', createdAt: 2 },
        { id: 'm2', role: 'user' as const, content: '再查一下 token 用量', createdAt: 3 },
        { id: 'user-stepY', role: 'user' as const, content: '再查一下 token 用量', createdAt: 4 },
        { id: 'm9', role: 'assistant' as const, content: '两件都办完，**全部通过**。', createdAt: 9 },
      ],
    };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    // 每句恰一个用户气泡（chief-bubble testid 只在 user 行）：2 user + 1 robot = 3 行。
    await expect(drawer.getByTestId('chief-bubble')).toHaveCount(2);
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(3);
    await expect(
      drawer.getByTestId('chief-bubble').filter({ hasText: '派一下凭证链路验证' }),
    ).toHaveCount(1);
    await expect(
      drawer.getByTestId('chief-bubble').filter({ hasText: '再查一下 token 用量' }),
    ).toHaveCount(1);
  });

  test('F-R14: 在飞存在行（#739）——静默窗口挂 streaming 行，首 delta 收敛为 typing，终稿两行皆退场', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    // running 在位（THREAD.activeRun）、缓冲空、终稿未落 = 发送到首 token 的
    // 静默窗口（绑定慢模型时分钟级）。
    const state = { final: false };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: '主题', exact: true })).toHaveText('线程乙');

    // 静默窗口：存在行立即可见——loading-dev Atom spinner + 处理中... 标签，
    // 与详情页 streaming 行同族；user 行 + 存在行 = 2，打字面尚未出现。
    // #950 载体：存在行 = 实时步骤 disclosure 钮；spinner = 呼吸动画名
    // （motion.css 载体层单源 keyframes，类名为 animate-[…] utility 产物）。
    const presence = drawer.getByTestId('chief-msg').last();
    const toggle = presence.getByRole('button', { name: /实时步骤/ });
    await expect(toggle).toBeVisible();
    await expect(presence.locator('[class*="spinner-breathe"]')).toHaveCount(1);
    await expect(presence.getByText('处理中...')).toHaveText('处理中...');
    // #471：不挂秒数（静止期无流事件驱动重渲，秒数会冻结说谎；本票不加计时器）。
    await expect(presence.getByText(/^\d+s$/)).toHaveCount(0);
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);
    await expect(presence.locator('.chat-para')).toHaveCount(0);

    const es = await chiefStream(page);

    // 首 delta 到达 → 存在行收敛为 typing 打字行（两行互斥，尾部恒至多一行）。
    await es.emit({ type: 'text_delta', text: '正在验证 **凭证' });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    const typing = drawer.getByTestId('chief-msg').last();
    await expect(typing.locator('.chat-para')).toContainText('正在验证 凭证');
    await expect(typing.getByTestId('chief-msg-foot')).toHaveCount(0);
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);

    // 终稿 message 落库 → 打字行退场，定稿 robot 行接管；存在行/打字行皆不残留。
    state.final = true;
    await es.emit({ type: 'message', message: FINAL_ROW });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    await expect(drawer.getByTestId('chief-msg').filter({ hasText: '正在验证' })).toHaveCount(0);
    const final = drawer.getByTestId('chief-msg').last();
    await expect(final.locator('strong', { hasText: '全部通过' })).toHaveCount(1);
  });

  test('F-R16: 轮中事件不闪清（#857）——工具行/文本行事件后重取在飞时打字面保留，收敛后落库行接管', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    const state: Parameters<typeof mockChiefLiveApi>[1] = { final: false };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    const es = await chiefStream(page);

    // 第一轮文本流出 → 打字面上屏。
    await es.emit({ type: 'text_delta', text: '先看任务现状和失败原因' });
    const tail = drawer.getByTestId('chief-msg').last();
    await expect(tail.locator('.chat-para')).toContainText('先看任务现状和失败原因');

    // 轮中工具行落库（message 事件，重取在飞、messages 仍是 [USER_ROW]）：
    // 打字面保留，已显示文本不闪清。
    await es.emit({
      type: 'message',
      message: {
        id: 'm-tool-1',
        role: 'assistant',
        content: {
          kind: 'toolcall',
          call: { id: 'c-m-tool-1', name: 'todo_write', arguments: {}, startedAt: 3, endedAt: 5 },
        },
        createdAt: 5,
      },
    });
    await expect(drawer.getByTestId('chief-msg').last().locator('.chat-para')).toContainText(
      '先看任务现状和失败原因',
    );

    // 第一轮终稿行落库 + messages 重取收敛 → 打字面退场，落库行接管，文本恰一条。
    const ROUND1 = {
      id: 'm-round1',
      role: 'assistant',
      content: '先看任务现状和失败原因',
      createdAt: 6,
    };
    state.messages = [USER_ROW, ROUND1];
    await es.emit({ type: 'message', message: ROUND1 });
    await expect(
      drawer.getByTestId('chief-msg').filter({ hasText: '先看任务现状和失败原因' }),
    ).toHaveCount(1);
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
  });

  test('F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    // activeRun 带 tool 位 + 本轮已落库工具行 = 展开面两件现货（无新 wire）。
    const state = {
      final: false,
      activeRun: { phase: 'chief', tool: { toolName: 'machines' } },
      messages: [
        USER_ROW,
        {
          id: 'm5',
          role: 'assistant',
          content: {
            kind: 'toolcall',
            call: { id: 'c-m5', name: 'todo_write', arguments: {}, startedAt: 3, endedAt: 5000 },
          },
          createdAt: 5,
        },
      ],
    };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    await settledDrawer(drawer);
    const presence = drawer.getByTestId('chief-msg').last();
    // 行本体是 button：箭头不再是纯装饰（#950 载体 = disclosure aria-label）。
    const toggle = presence.getByRole('button', { name: /实时步骤/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('展开实时步骤');
    await expect(presence.getByTestId('chief-turn-tools')).toHaveCount(0);
    // #885（WCAG 2.5.8）：活行命中盒 24px。21px 自然行 + 上下 1.5px 内边距，
    // margin-block 负值等量抵掉——命中区长到 24，墨迹纹丝不动（ink 距盒顶
    // 恰为那 1.5px 补偿量）。
    const hit = await toggle.boundingBox();
    expect(hit?.height).toBe(24);
    const label = presence.getByText('处理中...');
    const inkInset = await label.evaluate((el) => {
      const btn = el.closest('button') as HTMLElement;
      return Number((el.getBoundingClientRect().y - btn.getBoundingClientRect().y).toFixed(1));
    });
    expect(inkInset).toBe(1.5);

    // 点开展示全程：正在调用的工具 + 本轮已落库的工具行。
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('收起实时步骤');
    const panel = presence.getByTestId('chief-turn-tools');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('正在调用 machines');
    await expect(panel).toContainText('todo_write');

    // 键盘可达：Enter 收起。
    await toggle.press('Enter');
    await expect(presence.getByTestId('chief-turn-tools')).toHaveCount(0);

    // 取代 race：展开态下首 delta 到达 → typing 接管，展开态不得闪留/泄漏。
    await toggle.click();
    await expect(presence.getByTestId('chief-turn-tools')).toBeVisible();
    const es = await chiefStream(page);
    await es.emit({ type: 'text_delta', text: '正在验证 **凭证' });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    await expect(drawer.getByTestId('chief-turn-tools')).toHaveCount(0);

    // 终稿落库 → 定稿行接管；存在行/展开面皆不残留（mock 按请求实时读
    // state.messages，终稿行由本测试自行并入——F-R12 旧语义不动）。
    state.messages = [...state.messages, FINAL_ROW];
    state.final = true;
    await es.emit({ type: 'message', message: FINAL_ROW });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    await expect(drawer.getByTestId('chief-turn-tools')).toHaveCount(0);
    const final = drawer.getByTestId('chief-msg').last();
    await expect(final.locator('strong', { hasText: '全部通过' })).toHaveCount(1);
  });

  test('F-R15: robot 行身份 chip（live 面，#741）——头像+名字 anchor，点击全链进 Agent 设置页', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    await mockChiefLiveApi(page, { final: true });
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    // live mapper 恒带 agent id（#444 封套）→ robot 行身份成链。
    // #950 载体：身份 chip = 行内唯一 link（.chief-identity 类退役）。
    const chip = drawer.getByRole('link');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('r5-scribe');
    // live URL 的 ?chief= 参消费后即剥（XMON-106）——href 只钉路径前缀，
    // 不钉 search 中途态（本仓已知坑）。
    await expect(chip).toHaveAttribute('href', /^\/app\/resources\/agents\/agent-1/);
    // 点击 = 同 tab 整页路由（参考站正典），落点解析真记录（AGENT mock）。
    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/resources/agents/agent-1');
    await expect(page.locator('.agent-detail')).toBeVisible();
    await expect(page.locator('.agent-missing')).toHaveCount(0);
    await expect(page.locator('.agent-detail')).toContainText('r5-scribe');
  });
});

test.describe('chief drawer 用户气泡 markdown 面（live mock，#742）', () => {
  // 验收样例逐字进 mock：todo 提及 link 形 + 粗体 + 三面字面负例一句话打包。
  const MD_USER =
    '派 [#16](todo:t16) 去处理，**优先** 检查；prose #12 与 [伪链](todos:t2) [空](todo:) 保持字面';
  const PLAIN_USER = '收到，谢谢';
  const FENCE_USER = '```sh\necho before-and-after\n```';

  async function boot(page: Page) {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    await mockChiefLiveApi(page, {
      final: true,
      messages: [
        { id: 'm1', role: 'user', content: MD_USER, createdAt: 1 },
        { id: 'm2', role: 'user', content: PLAIN_USER, createdAt: 2 },
        { id: 'm3', role: 'user', content: FENCE_USER, createdAt: 3 },
        { id: 'm9', role: 'assistant', content: '三件都办完。', createdAt: 9 },
      ],
    });
    await page.goto('/app?chief=chief-bbb');
    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    await settledDrawer(drawer);
    return drawer;
  }


  test('F-R14: 用户气泡走同源解析——todo chip 成锚可点导航、bold 成 strong、负例保持字面', async ({
    page,
  }) => {
    const drawer = await boot(page);
    const bubble = drawer.getByTestId('chief-bubble').first();
    // 渲染路径双态（#612 配方）：live 用户行带槽进 md 路径（#950 载体 =
    // data-md 属性，旧表现类 chief-bubble--md 退役，#910 裁定 3 状态归 data-*）。
    await expect(bubble).toHaveAttribute('data-md', '');
    // 字面漏出归零：粗体定界符与链接语法不再以文本形态出现。
    await expect(bubble).not.toContainText('**');
    await expect(bubble).not.toContainText('[#16]');
    // bold = 真 strong（与 robot 行同一内联层）。
    await expect(bubble.locator('strong')).toHaveText('优先');
    // todo chip = 真锚点（router Link，#678 已通面），href 指任务详情。
    const chip = bubble.locator('.mention-chip--todo');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('#16');
    await expect(chip).toHaveAttribute('href', '/app/todo/t16');
    // 负例集（t-0059 probe 三面在用户气泡内同律）：裸 #seq / 相邻 scheme /
    // 空 id 保持字面文本，chip 总数不因它们增加。
    await expect(bubble).toContainText('prose #12 与 [伪链](todos:t2) [空](todo:) 保持字面');
    await expect(bubble.locator('.mention-chip')).toHaveCount(1);
    // 点击 = 导航（F-R13 同律；SPA pushState 只钉 pathname，放行末位）。
    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/todo/t16');
  });

  test('F-R15: 复制载荷 = markdown 原文（不是渲染结果）；两钮行（复制/恢复）不受影响', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const drawer = await boot(page);
    const firstUser = drawer.getByTestId('chief-msg').first();
    const tools = firstUser.getByTestId('chief-msg-tools');
    await expect(tools.getByRole('button')).toHaveCount(2);
    await expect(tools.getByRole('button', { name: '恢复到此处' })).toBeVisible();
    await tools.getByRole('button', { name: '复制' }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // #469 律：复制的是消息 markdown 源——wire 原文逐字（trim 归一后全等）。
    expect(clip).toBe(MD_USER);
  });

  test('F-R23: 行 id 贯通——live 行 Item 携源 chief_message id（messageId），顺序 = 存储序', async ({
    page,
  }) => {
    const drawer = await boot(page);
    // #1009 A1 行 id 贯通（票面「mapper 视图侧」；wire 零触碰——ADR 0011
    // 封段在写入端）：live 行的 React key 与 MessageScroller messageId =
    // 源 chief_message id，顺序 = createdAt 存储序（m1/m2/m3/m9，本 boot 面
    // 四行全 user/robot——id 缺省的 fixture 捕获形回落 index，S10 另钉）。
    const items = drawer.locator('[data-slot="message-scroller-item"]');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveAttribute('data-message-id', 'm1');
    await expect(items.nth(1)).toHaveAttribute('data-message-id', 'm2');
    await expect(items.nth(2)).toHaveAttribute('data-message-id', 'm3');
    await expect(items.nth(3)).toHaveAttribute('data-message-id', 'm9');
  });

  test('F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效', async ({
    page,
  }) => {
    const drawer = await boot(page);
    // live 面纯文本消息同样走 md 路径——几何必须与原字面路径逐值咬合。
    const plain = drawer.getByTestId('chief-bubble').filter({ hasText: PLAIN_USER });
    const geo = await plain.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), font: getComputedStyle(el).fontSize };
    });
    expect(geo.h).toBe(44); // 10px padding ×2 + 24px 行盒（现状逐像素同值）
    expect(geo.font).toBe('14px');
    // 整条消息 = 单个代码栅栏：首/尾块 margin 归零，不与 10px/12px padding
    // 叠出双倍留白（#612 chat-bubble--md 修剪的抽屉版）。
    const fence = drawer.getByTestId('chief-bubble').filter({ hasText: 'echo before-and-after' });
    const pre = fence.locator('pre.chat-md-code');
    await expect(pre).toBeVisible();
    const margins = await pre.evaluate((el) => ({
      top: getComputedStyle(el).marginTop,
      bottom: getComputedStyle(el).marginBottom,
    }));
    expect(margins.top).toBe('0px');
    expect(margins.bottom).toBe('0px');
  });

  test('F-R17: fixture 捕获面用户气泡零漂移——无槽走字面路径（无 --md 类、无 chat-md 块）', async ({
    page,
  }) => {
    await page.goto('/app?scenario=chief-md');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const bubble = page.getByTestId('chief-stream').getByTestId('chief-bubble');
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveText('验证一下凭证链路，然后给我一份报告');
    // fixture user 项不挂槽（单源在 live mapper）——捕获字节级稳定。
    await expect(bubble).not.toHaveAttribute('data-md', '');
    await expect(bubble.locator('.chat-para, .chat-md-item, .chat-md-code')).toHaveCount(0);
  });

  test('F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数', async ({ page }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    // 起点取真实过去时刻：秒数必须由「真实锚 + 走表」得出（#471 律），
    // 摆冻结数或没有锚的假数都会让这条断言红。
    const startedAt = Date.now() - 3000;
    const state: Parameters<typeof mockChiefLiveApi>[1] = {
      final: false,
      messages: [
        USER_ROW,
        {
          id: 'msg-seg-1',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '先把凭证面捋一遍' }],
          createdAt: 2,
        },
        {
          id: 'msg-seg-2',
          role: 'assistant',
          content: [{ type: 'text', text: '先看现状' }],
          createdAt: 4,
        },
        {
          id: 'c-tool-1',
          role: 'assistant',
          content: {
            kind: 'toolcall',
            call: { id: 'c-tool-1', name: 'todo_write', arguments: {}, startedAt },
          },
          createdAt: 5,
        },
      ],
    };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    // 思考段单列一行，折叠态只渲染预览（全文不在 DOM）。既有 fixture 捕获面
    // 从不产出此行，故本断言同时钉住「fixture 零漂移」的反面。
    const thinking = drawer.locator('.chief-msg', { hasText: '先把凭证面捋一遍' });
    await expect(thinking).toHaveCount(1);
    // #1033 几何钉（失败方式先列后写）：a) 头像槽丢 [&_img]:size-6 约束 →
    // 无固有尺寸的 dicebear SVG 撑满列宽（现场实测 380×380 巨图）；b) 行丢
    // flex → display:block，头像独占一行、正文被推到图下方；c) 消息列丢
    // min-w-0 flex-1 → flex-grow:0，长文不再撑满剩余宽。三条任一红 = 死类名
    // 回潮。桩已换成真 Lorelei 形态（无 width/height），约束缺失必被量到。
    // 几何必须同帧量（单 evaluate + poll 收敛）：抽屉入场是整帧位移，img 与
    // 列分两次 boundingBox 采样会跨动画帧，产出「列在头像左边」的假倒挂。
    await expect
      .poll(
        () =>
          thinking.evaluate((row) => {
            const img = row.querySelector('img')?.getBoundingClientRect();
            const colEl = row.querySelector(':scope > div');
            const col = colEl?.getBoundingClientRect();
            if (img == null || colEl == null || col == null) return null;
            const colCs = getComputedStyle(colEl);
            return {
              display: getComputedStyle(row).display,
              grow: colCs.flexGrow,
              minW: colCs.minWidth,
              imgW: img.width,
              imgH: img.height,
              // 头像在文字左侧、同一行（不是上下堆叠）。
              colRightOfImg: col.x > img.x,
              colBesideImg: col.y < img.bottom,
            };
          }),
        { message: 'thinking 行几何（#1033：24px 头像槽 + flex 行 + min-w-0 flex-1 列）' },
      )
      .toEqual({
        display: 'flex',
        grow: '1',
        minW: '0px',
        imgW: 24,
        imgH: 24,
        colRightOfImg: true,
        colBesideImg: true,
      });
    await expect(thinking.locator('pre')).toHaveCount(0);
    await thinking.getByRole('button', { name: '展开思考' }).click();
    await expect(thinking.locator('pre')).toHaveText('先把凭证面捋一遍');
    // 在飞工具行平铺进主呈现（不走披露），进行态标签 + 真实锚走出的秒数。
    const toolRow = drawer.locator('.chief-msg', { hasText: '正在调用 todo_write' });
    await expect(toolRow).toHaveCount(1);
    await expect(toolRow.locator('span.tabular-nums')).toHaveText(/^[3-9]s$/);
    // #1033：行骨架同律——工具行也是 flex 行、消息列拿到 min-w-0 flex-1。
    await expect(toolRow).toHaveCSS('display', 'flex');
    await expect(toolRow.locator('> div')).toHaveCSS('flex-grow', '1');
    // 披露面钉 testid（.chief-turn-tools 类已随 #950 退役，类选择器恒 0 =
    // 空断言，测不到「平铺不进披露」的本意）。
    await expect(drawer.getByTestId('chief-turn-tools')).toHaveCount(0);
  });

  test('F-R20: 在飞工具行带出具体命令（不是裸工具名）', async ({ page }) => {
    // 失败方式（先列后写）：一排 `正在调用 Bash` 读不出到底跑了什么。渲染面
    // 本来就有位置，丢的是投影——所以这条钉在**渲染出的文本**上，改回裸名即红。
    const state: Parameters<typeof mockChiefLiveApi>[1] = {
      final: false,
      messages: [
        USER_ROW,
        {
          id: 'c-tool-2',
          role: 'assistant',
          content: {
            kind: 'toolcall',
            call: {
              id: 'c-tool-2',
              name: 'Bash',
              arguments: { command: 'ls -la', description: '列目录' },
              startedAt: 3,
            },
          },
          createdAt: 5,
        },
      ],
    };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    const bashRow = drawer.locator('.chief-msg', { hasText: '正在调用 Bash' });
    await expect(bashRow).toHaveCount(1);
    // 裸名 `正在调用 Bash` 是改前的形态；这里要求命令同行可见。
    await expect(bashRow).toContainText('正在调用 Bash ls -la');
  });

  test('F-R21: 段序契约（#1003 / ADR 0011 premortem）——文本段在前、其工具行在后、各恰一次；收口后工具折进后随段', async ({
    page,
  }) => {
    // 失败方式（先列后写；ADR 0011 premortem「真 e2e 断言：文本段在前、
    // 其工具行在后」的投影面落点，#984 侦察点名的缺口、#1009 chief 车道
    // 施工前补钉——车道只消费本 pin，不重设计）：
    //   1. 渲染序按 id 字典序 / 到达序而非落库序——msg-run-10 字典序排在
    //      msg-run-2 前，任何客户端重排即红；
    //   2. 同毫秒并列行（D4 单调 createdAt 防线失效时）序不稳——两行同
    //      createdAt 必须仍按落库数组序渲染（mapper 不排序，REST 序即序）；
    //   3. 在飞工具行不再平铺（折回披露面）——段序在主呈现不可观测；
    //   4. 收口后工具行挂错宿主——必须折进它**后随**的文本段披露，不是
    //      前导段（D6 / r5 canon）。
    // 「段文本恰一次」的 live 缓冲↔落库行交接面由 F-R16（#857）钉住，
    // 本条钉 DOM 序与折叠归属，不重复覆盖。
    await stubEventSource(page);
    await stubCdnAvatar(page);
    const startedAt = Date.now() - 3000;
    const segRows = [
      {
        id: 'msg-run-1',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '先盘点凭证面' }],
        createdAt: 2,
      },
      {
        id: 'msg-run-2',
        role: 'assistant',
        content: [{ type: 'text', text: '先看现状' }],
        createdAt: 4,
      },
      {
        id: 'c-tool-1',
        role: 'assistant',
        content: {
          kind: 'toolcall',
          call: { id: 'c-tool-1', name: 'todo_write', arguments: {}, startedAt },
        },
        createdAt: 5,
      },
      // 同毫秒并列 + id 字典序陷阱（'msg-run-10' < 'msg-run-2'）：
      // 渲染序只许来自落库数组序。
      {
        id: 'msg-run-10',
        role: 'assistant',
        content: [{ type: 'text', text: '再核对补发语义' }],
        createdAt: 6,
      },
      {
        id: 'msg-run-11',
        role: 'assistant',
        content: [{ type: 'text', text: '最后收口票' }],
        createdAt: 6,
      },
    ];
    const state: Parameters<typeof mockChiefLiveApi>[1] = {
      final: false,
      messages: [USER_ROW, ...segRows],
    };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    // 在飞面（activeRun 在位）：段行与工具行按落库序平铺，user + 5 段 = 6
    // 行；尾行是 robot 段，无存在行/打字行追加（#739 尾行 gate）。
    // 行载体两族并集（chief-drawer 渲染面事实）：user/robot/streaming 行 =
    // data-testid="chief-msg"，thinking/tool 段行 = .chief-msg 类；CSS 并集
    // 选择器按文档序返回，正好是段序本身。
    const rows = drawer.locator('.chief-msg, [data-testid="chief-msg"]');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toContainText('派一下凭证链路验证');
    await expect(rows.nth(1)).toContainText('先盘点凭证面');
    await expect(rows.nth(2)).toContainText('先看现状');
    await expect(rows.nth(3)).toContainText('正在调用 todo_write');
    await expect(rows.nth(4)).toContainText('再核对补发语义');
    await expect(rows.nth(5)).toContainText('最后收口票');
    // 各段恰一次（无重复投影；工具行以「正在调用」进行态标签计，其披露
    // pill 文案 todo_write 是子串关系，不入本组过滤）。
    for (const text of [
      '先看现状',
      '正在调用 todo_write',
      '再核对补发语义',
      '最后收口票',
    ]) {
      await expect(rows.filter({ hasText: text })).toHaveCount(1);
    }

    // 收口面：activeRun 收口 + 重导航（深链参一次性消费即剥，reload 读不到
    // ?chief= 参，必须重新 goto）——工具行退出主呈现，折进它后随文本段
    // （「再核对补发语义」）foot 的「展开过程」披露；前导段（「先看现状」）
    // 无披露触发器（归属错位即红）。
    state.activeRun = null;
    await page.goto('/app?chief=chief-bbb');
    const settled = drawer.locator('.chief-msg, [data-testid="chief-msg"]');
    await expect(settled).toHaveCount(5);
    await expect(settled.nth(2)).toContainText('先看现状');
    await expect(settled.nth(2).getByRole('button', { name: '展开过程' })).toHaveCount(0);
    await expect(settled.nth(3)).toContainText('再核对补发语义');
    const fold = settled.nth(3).getByRole('button', { name: '展开过程' });
    await expect(fold).toHaveCount(1);
    await fold.click();
    await expect(settled.nth(3).getByTestId('chief-turn-tools')).toContainText('todo_write');
    await expect(settled.filter({ hasText: '正在调用' })).toHaveCount(0);

  });

  test('F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034）', async ({
    page,
  }) => {
    // 失败方式（判因档第 5 条）：改前 F-R19 的短 stub（9 字符）永远放不出这个
    // bug——钮宽 == 文本宽时 w-fit 无害。两条长预览都刻意 < PREVIEW_CHARS
    // （150）：JS 字符切片不触发，能把宽度收住的只剩 CSS。CJK 一条（无空格、
    // 无断行点，拉丁的换行兜底不存在）+ 拉丁一条（票面截图同款形态）。
    const LONG_CJK =
      '用户只是打了个招呼「你好」，没有具体任务，先不路由到任何看板任务，等下一句话再判断意图，同时留意要不要唤起定时器或者翻既有会话记录';
    const LONG_LATIN =
      '> The user just said "你好" — pure greeting. No task. I should not route it to the board yet; wait for the next line to tell intent.';
    const state: Parameters<typeof mockChiefLiveApi>[1] = {
      final: false,
      messages: [
        USER_ROW,
        {
          id: 'msg-tr-1',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: LONG_CJK }],
          createdAt: 2,
        },
        {
          id: 'msg-tr-2',
          role: 'assistant',
          content: [{ type: 'thinking', thinking: LONG_LATIN }],
          createdAt: 3,
        },
      ],
    };
    await stubEventSource(page);
    await stubCdnAvatar(page);
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    for (const [text, tag] of [
      [LONG_CJK, 'CJK 长预览'],
      [LONG_LATIN, '拉丁长预览'],
    ] as const) {
      const row = drawer.locator('.chief-msg', { hasText: text.slice(0, 16) });
      await expect(row, tag).toHaveCount(1);
      const btn = row.getByRole('button', { name: '展开思考' });
      const m = await btn.evaluate((el) => {
        const label = el.querySelector('span') as HTMLElement;
        const cs = getComputedStyle(label);
        // 列没有稳定类名（#950 退役 chief.css 后 MSG_COL_CLS 只剩工具类），
        // 按列上的 data-testid 取——类名靠不住，这是 #1033/#1040 之后的事实。
        const col = el.closest('[data-testid="chief-msg-col"]') as HTMLElement;
        return {
          textOverflow: cs.textOverflow,
          overflowX: cs.overflowX,
          labelClient: label.clientWidth,
          labelScroll: label.scrollWidth,
          btnW: Math.round(el.getBoundingClientRect().width),
          colW: Math.round(col.getBoundingClientRect().width),
        };
      });
      // 验收 1：真截断 = ellipsis 生效 + 可见宽 < 内容宽（改前：clip 且
      // client == scroll，span 根本没有可溢出的盒）。
      expect(m.textOverflow, tag).toBe('ellipsis');
      expect(m.overflowX, tag).toBe('hidden');
      expect(m.labelScroll, tag).toBeGreaterThan(m.labelClient);
      // 验收 2 前半：钮宽 ≤ 列宽（改前实测 626px 钮 / 384px 列）。
      expect(m.btnW, tag).toBeLessThanOrEqual(m.colW);
    }
    // 验收 2 后半：页面级零横向溢出。
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);
  });
});
