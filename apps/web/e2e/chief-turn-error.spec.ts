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

test('the card carries the latest failure alone; older failures are a bare 没完成 marker', async ({
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
  const stream = page.getByTestId('chief-stream');
  const markers = page.getByTestId('chief-turn-error');
  await expect(markers).toHaveText(['没完成']);
  await expect(markers.getByRole('button')).toHaveCount(0);
  await expect(stream).not.toContainText('Request timed out');
  await expect(stream).not.toContainText('被打断');
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
  await card.getByTestId('chief-turn-retry').click();
  await expect.poll(() => rewound).toEqual(['m3']);
  expect(sent).toEqual([]);
});

test('closing the card leaves the bare marker', async ({ page }) => {
  await open(page, [
    { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
    failure('m2', 11, TIMEOUT),
  ]);
  const card = page.getByTestId('chief-turn-error-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('chief-turn-error')).toHaveCount(0);
  await page.getByTestId('chief-turn-error-card-dismiss').click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('chief-turn-error')).toHaveText('没完成');
});

test('a stored raw API error reply renders as the marker, never as a chat bubble', async ({
  page,
}) => {
  const raw =
    "API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.";
  await open(page, [
    { id: 'm1', role: 'user', content: '#5393 现在进展到哪了？', createdAt: 10 },
    { id: 'm2', role: 'assistant', content: raw, createdAt: 11 },
    failure('m3', 12, { message: raw }),
    { id: 'm4', role: 'user', content: '再看一下', createdAt: 13 },
    failure('m5', 14, { message: raw }),
  ]);
  const stream = page.getByTestId('chief-stream');
  await expect(page.getByTestId('chief-turn-error-card')).toHaveAttribute('data-kind', 'runtime-update');
  await expect(page.getByTestId('chief-turn-error')).toHaveText(['没完成']);
  await expect(stream).not.toContainText('API Error');
  await expect(stream.getByTestId('chief-reply')).toHaveCount(0);
});

test('a turn that failed shows only its marker: no thinking and no second failure notice', async ({
  page,
}) => {
  const raw =
    "API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.";
  await open(page, [
    { id: 'm1', role: 'user', content: '#5393 现在进展到哪了？', createdAt: 10 },
    {
      id: 'm2',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '先查 #5393 的最近一步和它卡住的原因。' }],
      createdAt: 11,
    },
    failure('m3', 12, { message: raw }),
    { id: 'm4', role: 'user', content: '再试一次', createdAt: 13 },
    {
      id: 'm5',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '逐条核对它的执行机、模型和最后一次输出。' }],
      createdAt: 14,
    },
    failure('m6', 15, { message: raw }),
  ]);
  const stream = page.getByTestId('chief-stream');
  await expect(page.getByTestId('chief-turn-error-card')).toHaveCount(1);
  await expect(page.getByTestId('chief-turn-error')).toHaveText(['没完成']);
  await expect(page.getByRole('button', { name: '展开思考' })).toHaveCount(0);
  await expect(stream).not.toContainText('先查 #5393');
  await expect(stream).not.toContainText('逐条核对');
  await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByText('出错了', { exact: true })).toHaveCount(0);
});

test('expanding a row in the history keeps it where it was and opens below it', async ({ page }) => {
  const filler = '这一段是之前的回复，用来把对话撑到需要滚动的长度。'.repeat(6);
  const messages: unknown[] = [];
  for (let n = 0; n < 8; n++) {
    messages.push({ id: `u${n}`, role: 'user', content: `第 ${n} 个问题`, createdAt: 10 + n * 2 });
    messages.push({ id: `a${n}`, role: 'assistant', content: filler, createdAt: 11 + n * 2 });
  }
  messages.push({ id: 'u-last', role: 'user', content: '最后看一下凭证面', createdAt: 40 });
  messages.push({
    id: 'think',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: ['先把凭证面捋一遍', ...Array(16).fill('逐条核对每个入口的鉴权。')].join('\n') },
    ],
    createdAt: 41,
  });
  messages.push({ id: 'a-last', role: 'assistant', content: '凭证面没有问题。', createdAt: 42 });
  await open(page, messages);
  const body = page.getByTestId('chief-body');
  await expect(page.getByText('凭证面没有问题。')).toBeVisible();
  await expect
    .poll(() => body.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight))
    .toBeLessThan(2);
  const trigger = page.getByRole('button', { name: '展开思考' });
  const before = await trigger.evaluate((n) => n.getBoundingClientRect().top);
  await trigger.click();
  const opened = page.getByRole('button', { name: '收起思考' });
  await expect(opened).toBeVisible();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.waitForTimeout(300);
  const after = await opened.evaluate((n) => n.getBoundingClientRect());
  expect(Math.abs(after.top - before), 'C23: the clicked header stays put').toBeLessThanOrEqual(1);
  const detail = await page
    .locator('pre', { hasText: '先把凭证面捋一遍' })
    .evaluate((n) => n.getBoundingClientRect().top);
  expect(detail).toBeGreaterThanOrEqual(after.bottom - 1);
  await opened.click();
  await expect(page.locator('pre', { hasText: '先把凭证面捋一遍' })).toHaveCount(0);
  const gap = () => body.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight);
  await expect.poll(gap).toBeLessThan(2);
  await page.evaluate(
    () =>
      new Promise((done) => {
        let left = 6;
        const tick = () => (--left === 0 ? done(null) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  await page.setViewportSize({ width: 1440, height: 632 });
  await expect.poll(gap, 'collapsing at the bottom follows the bottom again').toBeLessThan(2);
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

test('a turn on an online Runner whose Claude Code has no login says so and links to adding one, never offline', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [
      {
        ...THREAD,
        activeRun: { phase: 'chief' },
        turnQueue: {
          position: 1,
          waitingFor: { machineId: 'mx', name: 'xmon-mbp', running: 0, capacity: 1 },
          blocked: { kind: 'claude-logged-out', missing: [] },
        },
      },
    ],
    messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: 10 }],
  } as Parameters<typeof mockLive>[1]);
  await page.goto('/app');
  await expect(page.getByText('团队还没有可用的 Claude 订阅', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: '添加 Claude 订阅' })).toHaveAttribute(
    'href',
    /\/app\/settings\/routing/,
  );
  await expect(page.getByTestId('chief-queue-wait-card')).toHaveCount(0);
  await expect(page.getByText('离线')).toHaveCount(0);
  await expect(page.getByText('等待执行机上线')).toHaveCount(0);
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
