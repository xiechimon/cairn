import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const failure = (id: string, createdAt: number, facts: Record<string, unknown>) => ({
  id,
  role: 'system',
  content: JSON.stringify({ kind: 'chief_turn_error', ...facts }),
  createdAt,
});

const TIMEOUT = {
  message: 'Coordinator turn ended: model_error "Request timed out."',
  providerId: 'prov-wb',
  provider: 'WorkBuddy',
  model: 'DeepSeek V4.1 Flash',
  elapsedMs: 199_000,
};

async function open(
  page: Page,
  messages: unknown[],
  sent: string[] = [],
  rewound: string[] = [],
) {
  await mockLive(page, { threads: [THREAD], messages }, (path, route, json) => {
    if (path === `/api/conversations/${THREAD.id}/messages` && route.request().method() === 'POST') {
      sent.push((route.request().postDataJSON() as { content: string }).content);
      return json({ thread: THREAD }, 201);
    }
    if (path === `/api/teams/t1/chief/threads/${THREAD.id}/rewind`) {
      rewound.push((route.request().postDataJSON() as { messageId: string }).messageId);
      return json({ deletedCount: 1, thread: THREAD });
    }
    return undefined;
  });
  await page.goto('/app');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
});

test('every failure is the same grey line in the conversation, and only the latest gets the card', async ({
  page,
}) => {
  const sent: string[] = [];
  const rewound: string[] = [];
  await open(
    page,
    [
      { id: 'm1', role: 'user', content: '帮我测一下中文输入', createdAt: 10 },
      failure('m2', 11, { message: 'Coordinator turn ended: interrupted "generation, 3 times"' }),
      { id: 'm3', role: 'user', content: '再试一次', createdAt: 12 },
      failure('m4', 13, TIMEOUT),
    ],
    sent,
    rewound,
  );
  const lines = page.getByTestId('chief-turn-error');
  await expect(lines).toHaveText(['没完成：这一轮被打断了', '没完成：模型太久没有回应']);
  await expect(page.getByTestId('chief-stream')).not.toContainText('Request timed out');
  const card = page.getByTestId('chief-turn-error-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('模型太久没有回应');
  await expect(card).toContainText('DeepSeek V4.1 Flash（WorkBuddy）3 分钟没有回应');
  await expect(card.getByRole('link', { name: '换 Coordinator 模型' })).toHaveAttribute(
    'href',
    /\/app\/settings\/routing#route-coordinator/,
  );
  await card.getByRole('button', { name: '详情' }).click();
  await expect(card.getByTestId('chief-turn-error-raw')).toContainText('Request timed out.');
  await lines.first().click();
  await expect(page.getByTestId('chief-turn-error-detail')).toContainText('Cairn 在回复途中重启');
  await card.getByTestId('chief-turn-retry').click();
  await expect.poll(() => rewound).toEqual(['m3']);
  expect(sent).toEqual([]);
});

test('closing the card leaves only the line', async ({ page }) => {
  await open(page, [
    { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
    failure('m2', 11, TIMEOUT),
  ]);
  const card = page.getByTestId('chief-turn-error-card');
  await expect(card).toBeVisible();
  await page.getByTestId('chief-turn-error-card-dismiss').click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('chief-turn-error')).toHaveText('没完成：模型太久没有回应');
});

test('a failure followed by an owner message has no card', async ({ page }) => {
  await open(page, [
    { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
    failure('m2', 11, TIMEOUT),
    { id: 'm3', role: 'user', content: '算了', createdAt: 12 },
  ]);
  await expect(page.getByTestId('chief-turn-error')).toHaveCount(1);
  await expect(page.getByTestId('chief-turn-error-card')).toHaveCount(0);
});

test('a rejected key names the provider and links to that provider', async ({ page }) => {
  await open(page, [
    { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
    failure('m2', 11, {
      message: 'Coordinator turn ended: model_error "401: {\\"message\\":\\"Invalid API key\\"}"',
      providerId: 'prov-wb',
      provider: 'WorkBuddy',
    }),
  ]);
  const card = page.getByTestId('chief-turn-error-card');
  await expect(card).toContainText('WorkBuddy 不接受这个 API key');
  await expect(card.getByRole('link', { name: '重新填写 API key' })).toHaveAttribute(
    'href',
    /\/app\/settings\/routing\?item=provider:prov-wb/,
  );
  await expect(card.getByTestId('chief-turn-retry')).toBeVisible();
});

test('a missing model offers no retry', async ({ page }) => {
  await open(page, [
    { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
    failure('m2', 11, {
      message:
        '404: {"message":"Model \\"glm-5.3\\" is not supported by any configured account in this group","type":"model_not_found"}',
      model: 'GLM-5.3',
    }),
  ]);
  const card = page.getByTestId('chief-turn-error-card');
  await expect(card).toContainText('用不了 GLM-5.3 这个模型');
  await expect(card.getByTestId('chief-turn-retry')).toHaveCount(0);
});

test.describe('on a Mac', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });

  test('an unreachable model also names the macOS Local Network setting', async ({ page }) => {
    await open(page, [
      { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
      failure('m2', 11, {
        message: 'Coordinator turn ended: model_error "connect EHOSTUNREACH 192.0.2.10:8080"',
      }),
    ]);
    const card = page.getByTestId('chief-turn-error-card');
    await expect(card).toContainText('系统设置 → 隐私与安全性 → 本地网络');
    await expect(card.getByTestId('chief-turn-retry')).toBeVisible();
  });
});

test('a turn waiting for a computer or an offline Runner shows the card and leaves no line once it runs', async ({
  page,
}) => {
  const waiting = (kind: string, name: string | null) => ({
    ...THREAD,
    activeRun: { phase: 'chief' },
    turnQueue: {
      position: 1,
      waitingFor:
        name === null ? null : { machineId: 'mx', name, running: 0, capacity: 1 },
      blocked: { kind, missing: [] },
    },
  });
  const state = {
    threads: [waiting('machine-offline', 'xmon-mbp')] as unknown[],
    messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: 10 }],
  };
  await mockLive(page, state as Parameters<typeof mockLive>[1]);
  await page.goto('/app');
  const card = page.getByTestId('chief-queue-wait-card');
  await expect(card).toContainText('执行机 xmon-mbp 离线');
  await expect(card.getByRole('link', { name: '查看执行机' })).toHaveAttribute(
    'href',
    /\/app\/settings\/machines/,
  );
  state.threads = [waiting('no-computer', null)];
  await page.reload();
  await expect(card).toContainText('Coordinator 的电脑还没准备好');
  await expect(card.getByRole('link', { name: '打开电脑' })).toHaveAttribute('href', /pane=machines/);
  await page.getByTestId('chief-queue-wait-card-dismiss').click();
  await expect(card).toHaveCount(0);
  state.threads = [THREAD];
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('chief-turn-error')).toHaveCount(0);
});

test('an outdated built-in Claude Code says so in English, offers only Update Cairn, and updates in place', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    const calls: string[] = [];
    let status = 'idle';
    Object.assign(window, {
      updateCalls: calls,
      cairnDesktop: {
        update: {
          state: async () => ({ status, version: '0.1.600' }),
          check: async () => {
            calls.push('check');
            status = 'available';
          },
          install: async () => {
            calls.push('install');
          },
          subscribe: () => () => {},
        },
      },
    });
  });
  const raw =
    'API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required';
  await open(page, [
    { id: 'm1', role: 'user', content: 'hello', createdAt: 10 },
    { id: 'm2', role: 'assistant', content: 'Done.', createdAt: 11 },
    { id: 'm3', role: 'user', content: 'again', createdAt: 12 },
    failure('m4', 13, { message: raw }),
  ]);
  const card = page.getByTestId('chief-turn-error-card');
  await expect(card).toHaveAttribute('data-kind', 'runtime-update');
  await expect(card).toContainText(
    "Cairn's built-in Claude Code 2.1.278 is too old: this model needs 2.1.280 or newer",
  );
  await expect(card).toContainText('Update Cairn, then try again.');
  await expect(page.getByTestId('chief-stream')).not.toContainText('API Error');
  await expect(card.getByTestId('chief-turn-retry')).toHaveCount(0);
  await card.getByTestId('chief-turn-update').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { updateCalls: string[] }).updateCalls))
    .toEqual(['check', 'install']);
});
