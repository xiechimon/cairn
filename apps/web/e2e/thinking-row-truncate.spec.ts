import { expect, type Page, test } from '@playwright/test';

// #1034 详情对话面同源缺陷：thinking 行（transcript.tsx case 'thinking'）
// 曾既无 flex 也无宽度上限——chat-row / chat-text 是零规则的死类名，20px
// 头像槽（-mt-1 骑顶设计）直接压在文字上；行内 ThinkingRow 的钮在
// w-fit + nowrap 下解成整段文本宽，冲出线程列。修法 = 对齐 robot 行
// （transcript.tsx :419）的工具类 + #772 截断律（min-w-0 flex-auto truncate）。
// chief 面的长预览截断另钉 chief-stream-markdown.spec F-R21。
// 每条测试钉一个失败方式：
//  T1 行不是 flex → 头像与文字列水平重叠（bug 本体：头像压字）
//  T2 chat-text 无宽度上限（max-width none / min-width auto）→ 钮宽无界
//  T3 长预览（> PREVIEW_CHARS=150，字符切片已触发）没有 CSS 截断 →
//     省略号缺位、可见宽 == 内容宽、钮宽 > 文字列宽
//  T4 页面级横向溢出；以及截断修法砸掉展开交互（点不开全文）
// 数据面 = live 打桩（transcript-user-words.spec 的 stubWorld 纪律）。

const TEAM_ID = 'team-1';
const USER_ID = 'user-1';
const AGENT_ID = 'agent-1';
const CARD_ID = 'todo-tr-1';
const BUILD_ID = 'build-tr-1';
const PROJECT_ID = 'proj-tr-1';

const TITLE = '凭证链路巡检';
const SPEC = ['# 任务目标', '', '巡检凭证链路并给出报告。'].join('\n');
const TASK_PROMPT = `${TITLE}\n\n${SPEC}`;

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: USER_ID, displayName: 'Xmon Dai', avatarUrl: null };

const WIRE_CARD = {
  id: CARD_ID,
  teamId: TEAM_ID,
  projectId: PROJECT_ID,
  title: TITLE,
  spec: SPEC,
  phase: 'review',
  phaseAt: 0,
  seqNum: 9,
  orderIndex: 0,
  tagIds: [],
  assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
  agent: { id: AGENT_ID, displayName: 'live-builder', avatarUrl: null },
  latestBuildId: BUILD_ID,
  lastRunAt: 0,
  hasChanges: true,
  hasPlan: true,
  buildHistory: [],
  sourceTodo: null,
  v: 1,
};

const PROJECT = {
  id: PROJECT_ID,
  name: 'pacman',
  teamId: TEAM_ID,
  repoKind: 'hosted',
  repoName: 'pacman',
  githubRepo: null,
  localPath: null,
};

const WIRE_BUILD = {
  id: BUILD_ID,
  todoId: CARD_ID,
  withPlan: true,
  prevPhase: null,
  triggerSource: 'user',
  planDocId: null,
  errorMessage: null,
  prUrl: null,
  prNumber: null,
  diffHash: null,
  createdAt: 0,
};

/** 长思考（> PREVIEW_CHARS=150，单行无换行点）：字符切片先触发（预览以
 *  字面 … 收尾），CSS 截断必须接力——两级各司其职（#1034 口径）。 */
const LONG_THINKING =
  '用户这句「你好」是纯招呼，没有任务实体：先不路由看板，也不建卡。接下来要做的事分三步——第一步核对会话历史里有没有未收口的执行步，第二步看定时器有没有到点要唤起的复盘，第三步再判断这句招呼背后是不是藏着一个新需求的开头；如果三步都空，就只回一句招呼，等用户把真实意图说出来再动手。另外留意中英混排时省略号的落点，别让截断把行尾标点吃掉半个，视觉上会显得字被切坏而不是被收纳。';

let msgSeq = 0;
function msg(role: 'system' | 'user' | 'assistant', content: unknown, at: number) {
  msgSeq += 1;
  return { id: `msg-${msgSeq}`, role, content, createdAt: at };
}

const MESSAGES = [
  msg('user', TASK_PROMPT, 1000),
  msg('assistant', [{ type: 'thinking', thinking: LONG_THINKING }], 1100),
];

async function stubWorld(page: Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/**', (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/teams') return route.fulfill(json([TEAM]));
      if (path === '/api/user/me') return route.fulfill(json(USER));
      if (path === '/api/projects') return route.fulfill(json([PROJECT]));
      if (path === '/api/todos') return route.fulfill(json([WIRE_CARD]));
      if (path === `/api/todos/${CARD_ID}`) return route.fulfill(json(WIRE_CARD));
      if (path === `/api/teams/${TEAM_ID}/members`) {
        return route.fulfill(json([
          { id: 'member-user', teamId: TEAM_ID, actorId: USER_ID, memberType: 'user', actor: USER },
          {
            id: `member-${AGENT_ID}`,
            teamId: TEAM_ID,
            actorId: AGENT_ID,
            memberType: 'agent',
            actor: {
              id: AGENT_ID,
              displayName: 'live-builder',
              description: null,
              status: 'active',
              avatarUrl: null,
              provider: null,
              modelId: 'stub-model',
              thinkingLevel: null,
              tools: [],
              secrets: [],
              defaultSkill: null,
              skillsAllowlist: null,
              mcpServers: [],
            },
          },
        ]));
      }
      if (path === `/api/teams/${TEAM_ID}/notifications`) {
        return route.fulfill(json({ unreadThreadIds: [] }));
      }
      if (path === `/api/builds/${BUILD_ID}`) return route.fulfill(json(WIRE_BUILD));
      if (path === `/api/builds/${BUILD_ID}/steps`) return route.fulfill(json([]));
      if (path === `/api/builds/${BUILD_ID}/plans`) return route.fulfill(json([]));
      if (path === `/api/builds/${BUILD_ID}/usage`) return route.fulfill(json([]));
      if (path === `/api/builds/${BUILD_ID}/changes`) {
        return route.fulfill(json({ files: [] }));
      }
      if (path === `/api/conversations/${BUILD_ID}/messages`) {
        return route.fulfill(
          json({
            messages: MESSAGES,
            chips: [],
            historyEpoch: 0,
            steerPending: [],
            activeRun: null,
            nextCursor: null,
          }),
        );
      }
      return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
    }
    return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
  });
  await page.goto(`/app/todo/${CARD_ID}`);
  await expect(page.getByTestId('transcript-col')).toBeVisible();
}

/** 被测行：thinking 行 = 唯一带展开钮的 agent 行。 */
function thinkingRow(page: Page) {
  return page.locator('div.chat-row--agent', { hasText: '用户这句' });
}

test('T1: 行是 flex，头像与文字列水平不重叠（改前：头像压在文字上）', async ({ page }) => {
  await stubWorld(page);
  const row = thinkingRow(page);
  await expect(row).toHaveCount(1);
  const layout = await row.evaluate((el) => {
    const avatar = el.querySelector('[data-testid="msg-avatar"]') as HTMLElement;
    const text = el.querySelector('.chat-text') as HTMLElement;
    const a = avatar.getBoundingClientRect();
    const t = text.getBoundingClientRect();
    return { display: getComputedStyle(el).display, gap: t.left - a.right, avatarW: a.width };
  });
  expect(layout.display).toBe('flex');
  // robot 行同距（ml-[11px]）：负值 = 重叠（改前形态），0 = 贴死，11 = 对齐 :419。
  expect(layout.gap).toBe(11);
  // 头像槽 flex-none 生效：20px 槽不被文字挤压。
  expect(layout.avatarW).toBe(20);
});

test('T2: chat-text 有宽度上限与 min-w-0——robot 行 :419 同款工具类', async ({ page }) => {
  await stubWorld(page);
  const cs = await thinkingRow(page)
    .locator('.chat-text')
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { maxWidth: s.maxWidth, minWidth: s.minWidth };
    });
  // 改前：死类名零规则 → max-width none（钮宽无界的根）+ min-width auto。
  expect(cs.maxWidth).not.toBe('none');
  expect(cs.minWidth).toBe('0px');
});

test('T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽', async ({ page }) => {
  await stubWorld(page);
  const row = thinkingRow(page);
  const btn = row.getByRole('button', { name: '展开思考' });
  const m = await btn.evaluate((el) => {
    const label = el.querySelector('span') as HTMLElement;
    const cs = getComputedStyle(label);
    const col = el.closest('.chat-text') as HTMLElement;
    return {
      textOverflow: cs.textOverflow,
      overflowX: cs.overflowX,
      labelClient: label.clientWidth,
      labelScroll: label.scrollWidth,
      labelText: label.textContent ?? '',
      btnW: Math.round(el.getBoundingClientRect().width),
      colW: Math.round(col.getBoundingClientRect().width),
    };
  });
  // 字符切片仍管「预览多长」（#1034 口径：切片可留）：预览 = 前 150 字符 + 字面 …。
  expect(m.labelText.endsWith('…')).toBe(true);
  expect(m.labelText.length).toBeLessThan(LONG_THINKING.length);
  // 宽度截断由 CSS 承担：ellipsis 生效 + 可见宽 < 内容宽。
  expect(m.textOverflow).toBe('ellipsis');
  expect(m.overflowX).toBe('hidden');
  expect(m.labelScroll).toBeGreaterThan(m.labelClient);
  expect(m.btnW).toBeLessThanOrEqual(m.colW);
});

test('T4: 页面级零横向溢出；展开交互不被截断修法砸掉', async ({ page }) => {
  await stubWorld(page);
  const row = thinkingRow(page);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);
  // 截断只动折叠态预览；点开仍见全文（pre 走 pre-wrap + break-words）。
  await row.getByRole('button', { name: '展开思考' }).click();
  await expect(row.locator('pre')).toHaveText(LONG_THINKING);
});
