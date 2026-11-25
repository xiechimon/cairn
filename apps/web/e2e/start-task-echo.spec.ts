import { type ChiefOutage, buildOrchestratePrompt } from '@cairn/shared';
import { expect, test } from '@playwright/test';
import { AGENT, mockLive, READY_MACHINE, TASK, THREAD, taskEntry } from './chief-home-mock.js';
import { evidenceShot } from './evidence.js';

const NOW = Date.now();

const TODO = {
  ...TASK,
  id: 'todo-103',
  title: '修复开始任务回显',
  spec: '开始任务时不要冒充用户说话',
  phase: 'todo',
  phaseAt: NOW - 2_000,
  updatedAt: NOW - 2_000,
  seqNum: 103,
  latestBuildId: null,
  hasPlan: false,
};

function setup(outage: ChiefOutage | null) {
  let orchestrated = false;
  const messages: Array<{
    id: string;
    role: string;
    origin?: string;
    content: unknown;
    createdAt: number;
  }> = [{ id: 'u-hi', role: 'user', origin: 'user', content: '先看看进度', createdAt: NOW - 10_000 }];
  const threads = [
    {
      ...THREAD,
      updatedAt: NOW - 10_000,
      activeRun: null as { phase: string } | null,
      turnQueue: null,
      orchestration: null as { todoId: string; state: 'queued' | 'running' | 'failed'; error: null } | null,
    },
  ];
  return {
    get state() {
      return { orchestrated, messages, threads };
    },
    async install(page: Parameters<typeof mockLive>[0]) {
      await mockLive(
        page,
        {
          threads,
          messages,
          machines: [READY_MACHINE],
          todos: [TODO],
          tasks: [taskEntry(TODO)],
        },
        (path, route, json) => {
          const method = route.request().method();
          if (path === `/api/todos/${TODO.id}`) return json(TODO);
          if (path === `/api/todos/${TODO.id}/orchestrate` && method === 'POST') {
            orchestrated = true;
            const content = buildOrchestratePrompt({
              id: TODO.id,
              seqNum: TODO.seqNum,
              spec: TODO.spec,
            });
            const msg = {
              id: 'orch-msg-1',
              role: 'user',
              origin: 'synthetic',
              content,
              createdAt: NOW,
            };
            messages.push(msg, {
              id: 'user-orch-msg-1',
              role: 'user',
              origin: 'task-prompt',
              content,
              createdAt: NOW + 5,
            });
            threads[0] = {
              ...THREAD,
              updatedAt: NOW,
              activeRun: { phase: 'chief' },
              turnQueue: null,
              orchestration: { todoId: TODO.id, state: 'queued', error: null },
            };
            return json({ thread: threads[0], message: msg }, 201);
          }
          if (path === '/api/teams/t1/chief') {
            return json({
              chief: {
                id: 'chief-u1-t1',
                userId: 'u1',
                teamId: 't1',
                agent: { agentId: AGENT.id },
                lastTurnAt: null,
                createdAt: NOW - 60_000,
                tz: null,
              },
              agentActor: AGENT,
              context: null,
              watches: [],
              wakes: [],
              outage,
            });
          }
          if (path === '/api/teams/t1/chief/threads') return json(threads);
          if (path === `/api/conversations/${THREAD.id}/messages` && method === 'GET') {
            return json({ messages });
          }
          return undefined;
        },
      );
    },
  };
}

test('start-task renders no user bubble in main chat and shows a neutral event without seqNum in task thread', async ({
  page,
}) => {
  const env = setup(null);
  await env.install(page);

  await page.goto(`/app?thread=${TODO.id}`);
  const sideChat = page.getByRole('complementary', { name: TODO.title });
  await expect(sideChat).toBeVisible();
  await sideChat.getByRole('button', { name: '开始' }).click();

  await expect(sideChat.getByTestId('transcript-note').first()).toContainText(
    `已交给 Coordinator：${TODO.title}`,
  );
  await expect(sideChat).not.toContainText(`#${TODO.seqNum}`);
  await evidenceShot(page, 'after-task-thread.png');

  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  await expect(stream).toContainText('先看看进度');
  await expect(stream).not.toContainText('开始任务');
  await expect(stream).not.toContainText('编排请求');
  await evidenceShot(page, 'after-main-chat.png');
});

for (const [reason, snippet] of [
  ['quota', '额度已用完'],
  ['capacity', '暂时过载'],
  ['subscription', '订阅已过期或未授权'],
  ['runner-offline', '执行机当前离线'],
] as const) {
  test(`task panel stops spinning Orchestrating and shows ${reason} outage reason with model action`, async ({
    page,
  }) => {
    const env = setup({ reason, model: 'relay-a/claude-opus', retryAt: null });
    await env.install(page);

    await page.goto(`/app?thread=${TODO.id}`);
    const sideChat = page.getByRole('complementary', { name: TODO.title });
    await sideChat.getByRole('button', { name: '开始' }).click();

    await expect(sideChat.getByTestId('transcript-note').first()).toContainText(
      `已交给 Coordinator：${TODO.title}`,
    );
    await expect(sideChat.locator('[data-orchestrating="true"]')).toHaveCount(0);
    await expect(sideChat.getByRole('button', { name: '编排中' })).toHaveCount(0);
    await expect(sideChat.getByTestId('side-chat-action')).toHaveCount(0);

    const banner = sideChat.getByTestId('chief-outage');
    await expect(banner).toContainText('Coordinator 暂时不可用');
    await expect(banner).toContainText(snippet);
    await evidenceShot(page, `after-outage-${reason}.png`);
    await banner.getByRole('button', { name: '给 Coordinator 换模型' }).click();
    await expect(page).toHaveURL(/\/app\/settings\/routing#route-coordinator$/);
  });
}
