import { expect, type Locator, type Page, test } from '@playwright/test';
import { openReplySteps } from './helpers.js';

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

test.describe('Coordinator markdown face (fixture, #650)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app?scenario=chief-md');
    await expect(page.getByTestId('home-c')).toBeVisible();
  });

  test('F-R24: unbound chief reply rows carry no face; the page has zero dashed-face glyphs', async ({
    page,
  }) => {
    const stream = page.getByTestId('chief-stream');
    await expect(stream.getByTestId('chief-msg').first()).toBeVisible();
    await expect(stream.getByTestId('chief-msg').locator('> svg')).toHaveCount(0);
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

    await expect(mention).not.toHaveAttribute('href', /.*/);

    await expect(stream.locator('.chat-md-item--ordered').first()).toContainText('第一步：读取配置');
    const nested = stream.locator('.chat-md-item--bullet[data-depth="1"]');
    await expect(nested).toHaveCount(1);
    await expect(nested).toContainText('子项：token 门');
    const fence = stream.locator('pre.chat-md-code');
    await expect(fence).toHaveAttribute('data-lang', 'sh');
    await expect(fence).toContainText('curl -s localhost:8787/healthz');
  });

  test('F-R13: todo mentions render as chips, anchors point at task detail and a click opens it; literal #seq/pseudo schemes render no chip (#675)', async ({
    page,
  }) => {
    const stream = page.getByTestId('chief-stream');
    const chip = stream.locator('.mention-chip--todo');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('#1');

    await expect(chip).toHaveAttribute('href', /^\/app\?(.*&)?thread=r3-legacy-1$/);

    await expect(stream).toContainText('prose #12 与 [伪链](todos:t2) 保持字面');
    expect(await stream.locator('.mention-chip').count()).toBe(
      await stream.locator('.mention-chip--agent').count() +
        (await stream.locator('.mention-chip--todo').count()),
    );

    await chip.click();
    await expect(page).toHaveURL(/[?&]thread=r3-legacy-1/);
  });

  test('F-R4/R5: typing rows have no foot; final rows keep the copy foot without an elapsed label', async ({ page }) => {

    const msgs = page.getByTestId('chief-stream').getByTestId('chief-msg');

    await expect(msgs).toHaveCount(3);

    const final = msgs.nth(1);
    const finalFoot = final.getByTestId('chief-msg-foot');
    await expect(finalFoot.getByTestId('chief-msg-more')).toBeVisible();
    await expect(finalFoot).not.toContainText('完成');

    const typing = msgs.nth(2);
    await expect(typing.getByTestId('chief-msg-foot')).toHaveCount(0);
    await expect(typing.locator('strong')).toHaveText('relay 通道');
  });

  test('F-R6/R8: user row is the flat sand bubble with no avatar, chat body scrollable', async ({ page }) => {
    const userRow = page.getByTestId('chief-stream').getByTestId('chief-msg').first();

    await expect(userRow.locator('img')).toHaveCount(0);
    await expect(userRow.locator('> svg')).toHaveCount(0);
    const bubble = userRow.getByTestId('chief-bubble');
    await expect(bubble).toHaveAttribute('data-slot', 'user-bubble');
    await expect(bubble).toHaveCSS('background-image', 'none');

    const overflow = await page
      .getByTestId('chief-body')
      .evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflow).toBe('auto');
  });

  test('F-R9: frozen capture face r5 114 does not drift — segment arrays walk the original .chief-para/.chief-bullet paths', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    await expect(page.getByTestId('home-c')).toBeVisible();
    const stream = page.getByTestId('chief-stream');

    await expect(stream.getByTestId('chief-msg').locator('p').first()).toContainText('已创建并派工');
    await expect(stream.locator('.chat-para, .chat-md-item, .chat-md-code')).toHaveCount(0);

    await expect(stream.getByTestId('chief-chip-todo')).toHaveCount(1);
    await expect(stream.getByTestId('chief-chip-agent')).toHaveCount(1);

    await expect(stream.getByTestId('chief-msg-tools').getByRole('button')).toHaveCount(1);
  });

  test('F-R15: a Coordinator reply carries no identity row (D122)', async ({ page }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    await mockChiefLiveApi(page, { final: true });
    await page.goto('/app?chief=chief-bbb');

    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();
    await expect(coordinator.getByTestId('chief-msg').last()).toBeVisible();
    await expect(coordinator.getByRole('link', { name: 'r5-scribe' })).toHaveCount(0);
  });
});

test.describe('Coordinator user-bubble markdown face (live mock, #742)', () => {

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
    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();
    return coordinator;
  }

  test('F-R14: user bubbles share the parser — todo chips become clickable anchors, bold becomes strong, negatives stay literal', async ({
    page,
  }) => {
    const coordinator = await boot(page);
    const bubble = coordinator.getByTestId('chief-bubble').first();

    await expect(bubble).toHaveAttribute('data-md', '');

    await expect(bubble).not.toContainText('**');
    await expect(bubble).not.toContainText('[#16]');

    await expect(bubble.locator('strong')).toHaveText('优先');

    const chip = bubble.locator('.mention-chip--todo');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('#16');
    await expect(chip).toHaveAttribute('href', /^\/app\?(.*&)?thread=t16$/);

    await expect(bubble).toContainText('prose #12 与 [伪链](todos:t2) [空](todo:) 保持字面');
    await expect(bubble.locator('.mention-chip')).toHaveCount(1);

    await chip.click();
    await expect(page).toHaveURL(/[?&]thread=t16/);
  });

  test('a progress checklist keeps the sub-steps, paragraphs and code under each item', async ({ page }) => {
    await stubEventSource(page);
    await stubCdnAvatar(page);
    await mockChiefLiveApi(page, {
      final: true,
      messages: [
        {
          id: 'm9',
          role: 'assistant',
          content:
            '- [x] Build\n  - Lint passed\n- [~] Deploy\n  - Run migrations\n  - Restart services\n\n  Waiting on the staging window.\n\n  ```sh\n  pnpm migrate\n  ```',
          createdAt: 9,
        },
      ],
    });
    await page.goto('/app?chief=chief-bbb');
    const card = page.getByTestId('home-c').getByTestId('md-tasks');
    await expect(card.getByTestId('md-task')).toHaveCount(2);
    const [build, deploy] = [card.getByTestId('md-task').nth(0), card.getByTestId('md-task').nth(1)];
    await expect(build.getByTestId('md-task-children')).toContainText('Lint passed');
    const children = deploy.getByTestId('md-task-children');
    await expect(children).toContainText('Run migrations');
    await expect(children).toContainText('Restart services');
    await expect(children).toContainText('Waiting on the staging window.');
    await expect(children.getByTestId('md-code')).toContainText('pnpm migrate');
  });

  test('F-R15: copy payload = markdown source (not rendered output); the tool row (reply/copy/more) is unaffected', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const coordinator = await boot(page);
    const firstUser = coordinator.getByTestId('chief-msg').first();
    const tools = firstUser.getByTestId('chief-msg-tools');
    await firstUser.getByTestId('chief-bubble').hover();
    await expect(tools.getByTestId('chief-msg-reply')).toBeVisible();
    await tools.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: '复制' }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());

    expect(clip).toBe(MD_USER);
  });

  test('F-R23: row ids thread through — live row Items carry the source chief_message id (messageId), order = storage order', async ({
    page,
  }) => {
    const coordinator = await boot(page);

    const items = coordinator.locator('[data-slot="message-scroller-item"]');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveAttribute('data-message-id', 'm1');
    await expect(items.nth(1)).toHaveAttribute('data-message-id', 'm2');
    await expect(items.nth(2)).toHaveAttribute('data-message-id', 'm3');
    await expect(items.nth(3)).toHaveAttribute('data-message-id', 'm9');
  });

  test('F-R16: single-paragraph plain-text bubble geometry does not drift (one-line pill); multi-block bubble first/last block margin trimming works', async ({
    page,
  }) => {
    const coordinator = await boot(page);

    const plain = coordinator.getByTestId('chief-bubble').filter({ hasText: PLAIN_USER });
    const geo = await plain.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), font: getComputedStyle(el).fontSize };
    });
    expect(geo.h).toBe(36);
    expect(geo.font).toBe('14px');

    const fence = coordinator.getByTestId('chief-bubble').filter({ hasText: 'echo before-and-after' });
    const pre = fence.getByTestId('md-code-block');
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
    await expect(page.getByTestId('home-c')).toBeVisible();
    const bubble = page.getByTestId('chief-stream').getByTestId('chief-bubble');
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveText('验证一下凭证链路，然后给我一份报告');

    await expect(bubble).not.toHaveAttribute('data-md', '');
    await expect(bubble.locator('.chat-para, .chat-md-item, .chat-md-code')).toHaveCount(0);
  });

  test('F-R19: segment-row projection (#955) — thinking rows in a single column, the in-flight call stays out of the stream', async ({ page }) => {
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

    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();

    const thinking = coordinator.locator('.chief-msg', { hasText: '先把凭证面捋一遍' });
    await expect(thinking).toHaveCount(1);

    await expect
      .poll(
        () =>
          thinking.evaluate((row) => {
            const colEl = row.querySelector(':scope > div');
            if (colEl == null) return null;
            const colCs = getComputedStyle(colEl);
            return {
              display: getComputedStyle(row).display,
              grow: colCs.flexGrow,
              minW: colCs.minWidth,
              images: row.querySelectorAll('img').length,
            };
          }),
        { message: 'thinking 行几何（无头像列：flex 行 + min-w-0 flex-1 列）' },
      )
      .toEqual({
        display: 'flex',
        grow: '1',
        minW: '0px',
        images: 0,
      });
    await expect(thinking.locator('pre')).toHaveCount(0);
    await thinking.getByRole('button', { name: '展开思考' }).click();
    await expect(thinking.locator('pre')).toHaveText('先把凭证面捋一遍');

    await expect(coordinator.locator('.chief-msg', { hasText: 'todo_write' })).toHaveCount(0);
    const live = coordinator.getByTestId('chief-msg').last();
    await expect(live.getByTestId('typing-dots')).toBeVisible();
    await expect(live.getByRole('button')).toHaveCount(0);
    await expect(coordinator.getByText('todo_write')).toHaveCount(0);
  });

  test('F-R20: the in-flight call shows on the status mark and its command stays out of the stream', async ({ page }) => {

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

    const coordinator = page.getByTestId('home-c');
    await expect(coordinator.getByTestId('chief-msg').last().getByTestId('typing-dots')).toBeVisible();
    await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'run');
    await expect(coordinator.getByText('ls -la')).toHaveCount(0);
  });

  test('F-R21: segment-order contract (#1003 / ADR 0011 premortem) — each call belongs to the reply after it and opens from its menu, the same in flight and after settle', async ({
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

    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();

    const rows = coordinator.locator('.chief-msg, [data-testid="chief-msg"]');
    const expectFolded = async () => {
      await expect(rows).toHaveCount(5);
      await expect(rows.nth(0)).toContainText('派一下凭证链路验证');
      await expect(rows.nth(1)).toContainText('先盘点凭证面');
      await expect(rows.nth(2)).toContainText('先看现状');
      await expect(rows.nth(3)).toContainText('再核对补发语义');
      await expect(rows.nth(4)).toContainText('最后收口票');
      await expect(coordinator.getByTestId('chief-turn-tools')).toHaveCount(0);
      await openReplySteps(page, rows.nth(3));
      await expect(rows.nth(3).getByTestId('chief-turn-tools')).toContainText('todo_write');
      await expect(rows.nth(2).getByTestId('chief-turn-tools')).toHaveCount(0);
      await expect(coordinator.getByText('todo_write')).toHaveCount(1);
      await expect(rows.filter({ hasText: '正在调用' })).toHaveCount(0);
    };
    await expectFolded();

    state.activeRun = null;
    await page.goto('/app?chief=chief-bbb');
    await expectFolded();
  });

  test('F-R22: long preview truncated by CSS — button width ≤ column width, ellipsis works, zero horizontal overflow (#1034)', async ({
    page,
  }) => {

    const LONG_CJK =
      '用户只是打了个招呼「你好」，没有具体任务，先不路由到任何看板任务，等下一句话再判断意图，同时留意要不要唤起定时器或者翻既有会话记录';
    const LONG_LATIN =
      '> The user just said "你好" — pure greeting. No task. I should not route it to the board yet; wait for the next line to tell intent, and keep an eye on timers or earlier threads.';
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

    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();
    for (const [text, tag] of [
      [LONG_CJK, 'CJK 长预览'],
      [LONG_LATIN, '拉丁长预览'],
    ] as const) {
      const row = coordinator.locator('.chief-msg', { hasText: text.slice(0, 16) });
      await expect(row, tag).toHaveCount(1);
      const btn = row.getByRole('button', { name: '展开思考' });
      const m = await btn.evaluate((el) => {
        const label = el.querySelector('[data-slot="trace-title"]') as HTMLElement;
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
