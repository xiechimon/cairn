import { expect, type Locator, type Page, test } from '@playwright/test';
import { spiralAvatarUrl } from '../src/lib/spiral-avatar.js';

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

const PX_1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
function stubCdnAvatar(page: Page) {
  return page.route('**/cdn.example/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PX_1 }),
  );
}

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

      const messages = state.messages ?? (state.final ? [USER_ROW, FINAL_ROW] : [USER_ROW]);
      return route.fulfill(json({ messages }));
    }

    if (p === '/api/teams/t1/agents/agent-1') return route.fulfill(json(AGENT));
    if (p === '/api/todos' || p === '/api/projects') return route.fulfill(json([]));
    if (
      p === '/api/teams/t1/members' ||
      p === '/api/teams/t1/machines' ||
      p === '/api/skills'
    ) {
      return route.fulfill(json([]));
    }

    return route.fulfill({ status: 418, ...json({ error: `unmocked: ${p}` }) });
  });
}

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

async function settledDrawer(drawer: Locator) {
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

test.describe('chief drawer markdown face (fixture, #650)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app?scenario=chief-md');
    await expect(page.locator('.chief-drawer')).toBeVisible();
  });

  test('F-R24: unbound chief reply rows wear the spiral face; the page has zero dashed-face glyphs', async ({
    page,
  }) => {
    const stream = page.getByTestId('chief-stream');
    await expect(stream.getByTestId('chief-msg').locator('> svg').first()).toBeVisible();
    await expect(page.locator('svg circle[stroke-dasharray]')).toHaveCount(0);
  });

  test('F-R1/R2/R3: robot markdown rows share the block parser — bold/heading/list/fence/chip all render, zero star leakage', async ({
    page,
  }) => {
    const stream = page.getByTestId('chief-stream');

    await expect(stream).not.toContainText('**');

    await expect(stream.locator('h2.chat-md-head')).toHaveText('凭证链路验证报告');

    await expect(stream.locator('.chat-para strong', { hasText: '全部通过' })).toHaveCount(1);
    const leadBullet = stream.locator('.chat-md-item--bullet').first();
    await expect(leadBullet.locator('strong')).toHaveText('项目');
    await expect(leadBullet).toContainText(': 凭证链路验证');

    await expect(stream.locator('.chat-code', { hasText: 'docs/verify/' })).toHaveCount(1);
    const mention = stream.locator('.mention-chip--agent');
    await expect(mention).toHaveCount(1);
    await expect(mention).toHaveText('r5-scribe');

    await expect(mention).toHaveAttribute('href', '/app/resources/agents/a1');

    await expect(stream.locator('.chat-md-item--ordered').first()).toContainText('第一步：读取配置');
    const nested = stream.locator('.chat-md-item--bullet[data-depth="1"]');
    await expect(nested).toHaveCount(1);
    await expect(nested).toContainText('子项：token 门');
    const fence = stream.locator('pre.chat-md-code');
    await expect(fence).toHaveAttribute('data-lang', 'sh');
    await expect(fence).toContainText('curl -s localhost:8787/healthz');
  });

  test('F-R13: todo mentions render as chips, anchors point at task detail with click navigation; literal #seq/pseudo schemes render no chip (#675)', async ({
    page,
  }) => {
    const stream = page.getByTestId('chief-stream');
    const chip = stream.locator('.mention-chip--todo');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('#1');

    await expect(chip).toHaveAttribute('href', '/app/todo/r3-legacy-1');

    await expect(stream).toContainText('prose #12 与 [伪链](todos:t2) 保持字面');
    expect(await stream.locator('.mention-chip').count()).toBe(
      await stream.locator('.mention-chip--agent').count() +
        (await stream.locator('.mention-chip--todo').count()),
    );

    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/todo/r3-legacy-1');
  });

  test('F-R4/R5: typing rows have no foot; final rows keep the foot (copy + done 44s)', async ({ page }) => {

    const msgs = page.getByTestId('chief-stream').getByTestId('chief-msg');

    await expect(msgs).toHaveCount(3);

    const final = msgs.nth(1);
    const finalFoot = final.getByTestId('chief-msg-foot');
    await expect(finalFoot.getByRole('button', { name: '复制' })).toBeVisible();
    await expect(finalFoot).toContainText('完成 44s');

    const typing = msgs.nth(2);
    await expect(typing.getByTestId('chief-msg-foot')).toHaveCount(0);
    await expect(typing.locator('strong')).toHaveText('relay 通道');
  });

  test('F-R6/R8: user row avatar = real identity img (XMON-105 single source), drawer body scrollable', async ({ page }) => {
    const userRow = page.getByTestId('chief-stream').getByTestId('chief-msg').first();

    const img = userRow.locator('img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', spiralAvatarUrl('Xmon Dai'));

    await expect(userRow.locator('> svg')).toHaveCount(0);

    const overflow = await page
      .getByTestId('chief-body')
      .evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflow).toBe('auto');
  });

  test('F-R9: frozen capture face r5 114 does not drift — segment arrays walk the original .chief-para/.chief-bullet paths', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const stream = page.getByTestId('chief-stream');

    await expect(stream.locator('p').first()).toContainText('已创建并派工');
    await expect(stream.locator('.chat-para, .chat-md-item, .chat-md-code')).toHaveCount(0);

    await expect(stream.getByTestId('chief-chip-todo')).toHaveCount(1);
    await expect(stream.getByTestId('chief-chip-agent')).toHaveCount(1);

    await expect(stream.getByTestId('chief-msg-tools').getByRole('button')).toHaveCount(2);
  });

  test('F-R15: fixture face (r5 113 running capture) grows no persistent rows — ChiefStreamItem new kind stays zero-pollution', async ({
    page,
  }) => {

    await page.goto('/app?scenario=113');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const stream = page.getByTestId('chief-stream');

    await expect(stream.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);

    const lastMsg = stream.getByTestId('chief-msg').last();
    await expect(lastMsg.getByTestId('chief-msg-foot')).toHaveCount(1);
  });
});

test.describe('chief drawer streaming face (live mock, #651)', () => {
  test('F-R7/R10/R11: text_delta lands incrementally, message final converges with no duplicates and no residue', async ({ page }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    const state = { final: false };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: '主题', exact: true })).toHaveText('线程乙');

    const userRow = drawer.getByTestId('chief-msg').first();
    await expect(userRow.locator('img')).toHaveAttribute(
      'src',
      'https://cdn.example/me.png',
    );

    const es = await chiefStream(page);

    await es.emit({ type: 'text_delta', text: '正在验证 **凭证' });
    const typing = drawer.getByTestId('chief-msg').last();
    await expect(typing.locator('.chat-para')).toContainText('正在验证 凭证');
    await expect(typing.locator('strong')).toHaveText('凭证');
    await expect(typing).not.toContainText('**');

    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);
    await expect(typing.getByTestId('chief-msg-foot')).toHaveCount(0);

    await es.emit({ type: 'text_delta', text: '链路**，马上出报告' });
    await expect(typing.locator('.chat-para')).toContainText('正在验证 凭证链路，马上出报告');
    await expect(typing.locator('strong')).toHaveText('凭证链路');

    state.final = true;
    await es.emit({ type: 'message', message: FINAL_ROW });

    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);
    await expect(drawer.getByTestId('chief-msg').filter({ hasText: '正在验证' })).toHaveCount(0);

    const final = drawer.getByTestId('chief-msg').last();
    await expect(final.locator('strong', { hasText: '全部通过' })).toHaveCount(1);
    await expect(
      final.getByTestId('chief-msg-foot').getByRole('button', { name: '复制' }),
    ).toBeVisible();
  });

  test('F-R12: two-row dedup (#667) — same-text POST + user-<stepId> echo render exactly one user bubble; two different texts in a row render two', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);

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

    await expect(drawer.getByTestId('chief-bubble')).toHaveCount(2);
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(3);
    await expect(
      drawer.getByTestId('chief-bubble').filter({ hasText: '派一下凭证链路验证' }),
    ).toHaveCount(1);
    await expect(
      drawer.getByTestId('chief-bubble').filter({ hasText: '再查一下 token 用量' }),
    ).toHaveCount(1);
  });

  test('F-R14: in-flight presence row (#739) — silent window hangs a streaming row, first delta converges into typing, final retires both rows', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);

    const state = { final: false };
    await mockChiefLiveApi(page, state);
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: '主题', exact: true })).toHaveText('线程乙');

    const presence = drawer.getByTestId('chief-msg').last();
    const toggle = presence.getByRole('button', { name: /实时步骤/ });
    await expect(toggle).toBeVisible();
    await expect(presence.locator('[class*="spinner-breathe"]')).toHaveCount(1);
    await expect(presence.getByText('处理中...')).toHaveText('处理中...');

    await expect(presence.getByText(/^\d+s$/)).toHaveCount(0);
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);
    await expect(presence.locator('.chat-para')).toHaveCount(0);

    const es = await chiefStream(page);

    await es.emit({ type: 'text_delta', text: '正在验证 **凭证' });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    const typing = drawer.getByTestId('chief-msg').last();
    await expect(typing.locator('.chat-para')).toContainText('正在验证 凭证');
    await expect(typing.getByTestId('chief-msg-foot')).toHaveCount(0);
    await expect(drawer.getByTestId('chief-msg')).toHaveCount(2);

    state.final = true;
    await es.emit({ type: 'message', message: FINAL_ROW });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    await expect(drawer.getByTestId('chief-msg').filter({ hasText: '正在验证' })).toHaveCount(0);
    const final = drawer.getByTestId('chief-msg').last();
    await expect(final.locator('strong', { hasText: '全部通过' })).toHaveCount(1);
  });

  test('F-R16: mid-turn events do not flash-clear (#857) — tool/text rows re-fetch in-flight while the typing face stays, converged stored rows take over', async ({
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

    await es.emit({ type: 'text_delta', text: '先看任务现状和失败原因' });
    const tail = drawer.getByTestId('chief-msg').last();
    await expect(tail.locator('.chat-para')).toContainText('先看任务现状和失败原因');

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

  test('F-R18: in-flight presence row expands (#822) — arrow click reveals live steps, typing takeover leaks nothing', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);

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

    const toggle = presence.getByRole('button', { name: /实时步骤/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('展开实时步骤');
    await expect(presence.getByTestId('chief-turn-tools')).toHaveCount(0);

    const hit = await toggle.boundingBox();
    expect(hit?.height).toBe(24);
    const label = presence.getByText('处理中...');
    const inkInset = await label.evaluate((el) => {
      const btn = el.closest('button') as HTMLElement;
      return Number((el.getBoundingClientRect().y - btn.getBoundingClientRect().y).toFixed(1));
    });
    expect(inkInset).toBe(1.5);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('收起实时步骤');
    const panel = presence.getByTestId('chief-turn-tools');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('正在调用 machines');
    await expect(panel).toContainText('todo_write');

    await toggle.press('Enter');
    await expect(presence.getByTestId('chief-turn-tools')).toHaveCount(0);

    await toggle.click();
    await expect(presence.getByTestId('chief-turn-tools')).toBeVisible();
    const es = await chiefStream(page);
    await es.emit({ type: 'text_delta', text: '正在验证 **凭证' });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    await expect(drawer.getByTestId('chief-turn-tools')).toHaveCount(0);

    state.messages = [...state.messages, FINAL_ROW];
    state.final = true;
    await es.emit({ type: 'message', message: FINAL_ROW });
    await expect(drawer.getByRole('button', { name: /实时步骤/ })).toHaveCount(0);
    await expect(drawer.getByTestId('chief-turn-tools')).toHaveCount(0);
    const final = drawer.getByTestId('chief-msg').last();
    await expect(final.locator('strong', { hasText: '全部通过' })).toHaveCount(1);
  });

  test('F-R15: robot row identity chip (live face, #741) — avatar+name anchor, click navigates the whole chain into the Agent settings page', async ({
    page,
  }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    await mockChiefLiveApi(page, { final: true });
    await page.goto('/app?chief=chief-bbb');

    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();

    const chip = drawer.getByRole('link');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('r5-scribe');

    await expect(chip).toHaveAttribute('href', /^\/app\/resources\/agents\/agent-1/);

    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/resources/agents/agent-1');
    await expect(page.locator('.agent-detail')).toBeVisible();
    await expect(page.locator('.agent-missing')).toHaveCount(0);
    await expect(page.locator('.agent-detail')).toContainText('r5-scribe');
  });
});

test.describe('chief drawer user-bubble markdown face (live mock, #742)', () => {

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

  test('F-R14: user bubbles share the parser — todo chips become clickable anchors, bold becomes strong, negatives stay literal', async ({
    page,
  }) => {
    const drawer = await boot(page);
    const bubble = drawer.getByTestId('chief-bubble').first();

    await expect(bubble).toHaveAttribute('data-md', '');

    await expect(bubble).not.toContainText('**');
    await expect(bubble).not.toContainText('[#16]');

    await expect(bubble.locator('strong')).toHaveText('优先');

    const chip = bubble.locator('.mention-chip--todo');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('#16');
    await expect(chip).toHaveAttribute('href', '/app/todo/t16');

    await expect(bubble).toContainText('prose #12 与 [伪链](todos:t2) [空](todo:) 保持字面');
    await expect(bubble.locator('.mention-chip')).toHaveCount(1);

    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/todo/t16');
  });

  test('F-R15: copy payload = markdown source (not rendered output); the two-button row (copy/restore) is unaffected', async ({
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

    expect(clip).toBe(MD_USER);
  });

  test('F-R23: row ids thread through — live row Items carry the source chief_message id (messageId), order = storage order', async ({
    page,
  }) => {
    const drawer = await boot(page);

    const items = drawer.locator('[data-slot="message-scroller-item"]');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveAttribute('data-message-id', 'm1');
    await expect(items.nth(1)).toHaveAttribute('data-message-id', 'm2');
    await expect(items.nth(2)).toHaveAttribute('data-message-id', 'm3');
    await expect(items.nth(3)).toHaveAttribute('data-message-id', 'm9');
  });

  test('F-R16: single-paragraph plain-text bubble geometry does not drift (44px pill); multi-block bubble first/last block margin trimming works', async ({
    page,
  }) => {
    const drawer = await boot(page);

    const plain = drawer.getByTestId('chief-bubble').filter({ hasText: PLAIN_USER });
    const geo = await plain.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), font: getComputedStyle(el).fontSize };
    });
    expect(geo.h).toBe(44);
    expect(geo.font).toBe('14px');

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

  test('F-R17: fixture capture face user bubbles zero drift — bare paths stay literal (no --md class, no chat-md blocks)', async ({
    page,
  }) => {
    await page.goto('/app?scenario=chief-md');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const bubble = page.getByTestId('chief-stream').getByTestId('chief-bubble');
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveText('验证一下凭证链路，然后给我一份报告');

    await expect(bubble).not.toHaveAttribute('data-md', '');
    await expect(bubble.locator('.chat-para, .chat-md-item, .chat-md-code')).toHaveCount(0);
  });

  test('F-R19: segment-row projection (#955) — thinking rows in a single column, in-flight tool rows flat with real seconds', async ({ page }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);

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

    const thinking = drawer.locator('.chief-msg', { hasText: '先把凭证面捋一遍' });
    await expect(thinking).toHaveCount(1);

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

    const toolRow = drawer.locator('.chief-msg', { hasText: '正在调用 todo_write' });
    await expect(toolRow).toHaveCount(1);
    await expect(toolRow.locator('span.tabular-nums')).toHaveText(/^[3-9]s$/);

    await expect(toolRow).toHaveCSS('display', 'flex');
    await expect(toolRow.locator('> div')).toHaveCSS('flex-grow', '1');

    await expect(drawer.getByTestId('chief-turn-tools')).toHaveCount(0);
  });

  test('F-R20: in-flight tool rows carry the concrete command (not a bare tool name)', async ({ page }) => {

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

    await expect(bashRow).toContainText('正在调用 Bash ls -la');
  });

  test('F-R21: segment-order contract (#1003 / ADR 0011 premortem) — text segments first, their tool rows after, each exactly once; after settle tools fold into the trailing row', async ({
    page,
  }) => {

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

    const rows = drawer.locator('.chief-msg, [data-testid="chief-msg"]');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(0)).toContainText('派一下凭证链路验证');
    await expect(rows.nth(1)).toContainText('先盘点凭证面');
    await expect(rows.nth(2)).toContainText('先看现状');
    await expect(rows.nth(3)).toContainText('正在调用 todo_write');
    await expect(rows.nth(4)).toContainText('再核对补发语义');
    await expect(rows.nth(5)).toContainText('最后收口票');

    for (const text of [
      '先看现状',
      '正在调用 todo_write',
      '再核对补发语义',
      '最后收口票',
    ]) {
      await expect(rows.filter({ hasText: text })).toHaveCount(1);
    }

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

  test('F-R22: long preview truncated by CSS — button width ≤ column width, ellipsis works, zero horizontal overflow (#1034)', async ({
    page,
  }) => {

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

      expect(m.textOverflow, tag).toBe('ellipsis');
      expect(m.overflowX, tag).toBe('hidden');
      expect(m.labelScroll, tag).toBeGreaterThan(m.labelClient);

      expect(m.btnW, tag).toBeLessThanOrEqual(m.colW);
    }

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);
  });
});
