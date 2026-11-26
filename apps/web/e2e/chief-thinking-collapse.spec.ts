import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence.js';
import { installConversationStreams } from './tab-stream-fakes.js';

const PX_1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
  id: 'chief-thinking-collapse',
  chiefId: 'chief-u1-t1',
  userId: 'u1',
  teamId: 't1',
  title: '思考折叠测试',
  createdAt: 2,
  updatedAt: 2,
  lastTurnAt: null,
  session: { runtime: 'pi', id: 's1', openedAt: 2 },
  pendingSessionResumeAt: null,
  toolDefHashes: {},
  toolResultHashes: {},
  activeRun: null,
};

async function setupMock(page: Page, messages: unknown[]) {
  await page.addInitScript(() => {
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
        queueMicrotask(() => this.onopen?.());
      }
      close() {
        this.readyState = 2;
      }
      addEventListener() {}
      removeEventListener() {}
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
  });
  await page.addInitScript(installConversationStreams, '__es_unused');
  await page.route('**/cdn.example/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PX_1 }),
  );
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (pathname === '/api/teams') return json([TEAM]);
    if (pathname === '/api/user/me') return json(USER);
    if (pathname === '/api/teams/t1/notifications') return json({ unreadThreadIds: [] });
    if (pathname === '/api/teams/t1/chief') {
      return json({
        chief: {
          id: THREAD.chiefId,
          userId: 'u1',
          teamId: 't1',
          agent: { agentId: AGENT.id },
          lastTurnAt: null,
          createdAt: 0,
          tz: null,
        },
        agentActor: AGENT,
        context: null,
        watches: [],
        wakes: [],
      });
    }
    if (pathname === '/api/teams/t1/chief/threads') return json([THREAD]);
    if (pathname === `/api/conversations/${THREAD.id}/messages`) return json({ messages });
    if (pathname === '/api/todos' || pathname === '/api/projects') return json([]);
    if (
      pathname === '/api/teams/t1/members' ||
      pathname === '/api/teams/t1/machines' ||
      pathname === '/api/skills'
    ) {
      return json([]);
    }
    return route.fulfill({
      status: 418,
      contentType: 'application/json',
      body: JSON.stringify({ error: `unmocked: ${pathname}` }),
    });
  });
}

test('Coordinator thinking traces (single or consecutive) are completely hidden from the stream', async ({
  page,
}) => {
  await setupMock(page, [
    { id: 'u-1', role: 'user', content: '查一下 MCP 工具为什么报错', createdAt: 10 },
    {
      id: 'th-1',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '先列出当前已连接的 MCP 工具' }],
      createdAt: 11,
    },
    {
      id: 'tc-1',
      role: 'assistant',
      content: {
        kind: 'toolcall',
        call: { id: 'c1', name: 'mcp_list_tools', arguments: {}, startedAt: 12, endedAt: 13, isError: true },
      },
      createdAt: 12,
    },
    {
      id: 'th-2',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'mcp_list_tools 返回空，改用 grep 搜工具注册位置' }],
      createdAt: 14,
    },
    {
      id: 'tc-2',
      role: 'assistant',
      content: {
        kind: 'toolcall',
        call: {
          id: 'c2',
          name: 'grep',
          arguments: { pattern: 'mcp_list_tools' },
          startedAt: 15,
          endedAt: 16,
          isError: true,
        },
      },
      createdAt: 15,
    },
    {
      id: 'th-3',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '缩小路径范围到 apps/server 再 grep 一次' }],
      createdAt: 17,
    },
    {
      id: 'tc-3',
      role: 'assistant',
      content: {
        kind: 'toolcall',
        call: { id: 'c3', name: 'grep', arguments: { pattern: 'registerMcp' }, startedAt: 18, endedAt: 19 },
      },
      createdAt: 18,
    },
    {
      id: 'r-1',
      role: 'assistant',
      content: '已定位到工具注册入口。',
      createdAt: 20,
    },
    { id: 'u-2', role: 'user', content: '再看下第二部分', createdAt: 30 },
    {
      id: 'th-4',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '单独核对第二部分接口' }],
      createdAt: 31,
    },
    {
      id: 'r-2',
      role: 'assistant',
      content: '第二部分也确认无误。',
      createdAt: 32,
    },
  ]);

  await page.goto(`/app?chief=${THREAD.id}`);
  const stream = page.getByTestId('chief-stream');
  await expect(stream).toContainText('已定位到工具注册入口。');
  await expect(stream).toContainText('第二部分也确认无误。');

  await expect(stream.getByRole('button', { name: '展开思考' })).toHaveCount(0);
  await expect(stream.getByRole('button', { name: '收起思考' })).toHaveCount(0);
  await expect(stream.locator('pre')).toHaveCount(0);
  await expect(stream).not.toContainText('思考 3 步');
  await expect(stream).not.toContainText('第 1 步');
  await expect(stream).not.toContainText('第 2 步');
  await expect(stream).not.toContainText('第 3 步');
  await expect(stream).not.toContainText('先列出当前已连接的 MCP 工具');
  await expect(stream).not.toContainText('mcp_list_tools 返回空，改用 grep 搜工具注册位置');
  await expect(stream).not.toContainText('缩小路径范围到 apps/server 再 grep 一次');
  await expect(stream).not.toContainText('单独核对第二部分接口');

  await evidencePanelShot(page, 'thinking-hidden-in-chief.png', stream);
});

test('Not finished and Stopped. No task was created. render with the same FailureMarker separator geometry and visual rhythm', async ({
  page,
}) => {
  await setupMock(page, [
    { id: 'u-err', role: 'user', content: '查一下为什么失败', createdAt: 10 },
    {
      id: 'err-1',
      role: 'system',
      content: JSON.stringify({
        kind: 'chief_turn_error',
        message: 'Request timed out.',
      }),
      createdAt: 11,
    },
    { id: 'u-stop', role: 'user', content: '重新来一次', createdAt: 20 },
    {
      id: 'stop-1',
      role: 'system',
      content: JSON.stringify({ kind: 'chief_turn_stopped', todos: [] }),
      createdAt: 21,
    },
    { id: 'u-ok', role: 'user', content: '继续', createdAt: 30 },
    { id: 'r-ok', role: 'assistant', content: '好的，已经继续处理。', createdAt: 31 },
  ]);

  await page.goto(`/app?chief=${THREAD.id}`);
  const stream = page.getByTestId('chief-stream');
  const notFinished = stream.getByTestId('chief-turn-error');
  const stopped = stream.getByTestId('chief-stopped');
  await expect(notFinished).toHaveText('未完成');
  await expect(stopped).toHaveText('已停止，没有建任务。');

  const metrics = await Promise.all(
    [notFinished, stopped].map((loc) =>
      loc.evaluate((el) => {
        const label = el.querySelector('[data-slot="marker-content"]') as HTMLElement | null;
        const rect = el.getBoundingClientRect();
        const labelCs = label ? getComputedStyle(label) : null;
        return {
          slot: el.getAttribute('data-slot'),
          variant: el.getAttribute('data-variant'),
          width: Math.round(rect.width),
          fontFamily: labelCs?.fontFamily ?? '',
          fontSize: labelCs?.fontSize ?? '',
          textAlign: labelCs?.textAlign ?? '',
        };
      }),
    ),
  );
  expect(metrics[0]?.slot).toBe('marker');
  expect(metrics[0]?.variant).toBe('separator');
  expect(metrics[1]).toEqual(metrics[0]);

  await evidencePanelShot(page, 'turn-end-markers-unified.png', stream);
});
