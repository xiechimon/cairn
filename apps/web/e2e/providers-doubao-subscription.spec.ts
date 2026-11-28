import { expect, type Page, test } from '@playwright/test';
import type { DoubaoLoginSession, DoubaoRunnerLogin, DoubaoSubscriptionListEntry } from '@cairn/shared';
import { mockLive, TASK } from './chief-home-mock';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const NOW = Date.now();
const DAY = 86_400_000;
const PNG_A =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_B =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const RUNNER_MBP = {
  id: 'm-mbp',
  name: 'ian-mbp',
  online: true,
  kind: 'host',
  capabilities: {
    mcpServers: [],
    skills: [],
    doubao: {
      installed: true,
      authenticated: true,
      platformSupported: true,
      probedAt: NOW,
      models: [
        { id: '4', name: 'Doubao 2.1 Turbo' },
        { id: 'seed-2-lite', name: 'Seed 2 Lite' },
      ],
    },
  },
};

const RUNNER_MINI_UNAUTHED = {
  id: 'm-mini',
  name: 'mac-mini',
  online: true,
  kind: 'host',
  capabilities: {
    mcpServers: [],
    skills: [],
    doubao: {
      installed: false,
      authenticated: false,
      platformSupported: true,
      probedAt: NOW,
    },
  },
};

const UPSTREAM = [
  { id: '4', name: 'Doubao 2.1 Turbo' },
  { id: 'deepseek-r1', name: 'DeepSeek R1' },
];

const subscription = (
  over: Partial<DoubaoSubscriptionListEntry> = {},
): DoubaoSubscriptionListEntry => ({
  id: 'sub-db-1',
  kind: 'doubao-subscription',
  label: '团队豆包订阅',
  runnerId: null,
  runnerName: 'ian-mbp',
  runnerLogin: 'ok',
  runnerOffline: false,
  runnerModels: UPSTREAM,
  runnerLogins: [
    {
      runnerId: 'm-mbp',
      name: 'ian-mbp',
      online: true,
      installed: true,
      platformSupported: true,
      status: 'ok',
    },
    {
      runnerId: 'm-mini',
      name: 'mac-mini',
      online: true,
      installed: false,
      platformSupported: true,
      status: 'not_installed',
    },
  ],
  enabled: true,
  enabledAt: NOW - DAY,
  createdAt: NOW - 6 * DAY,
  lastUsedAt: NOW - 3_600_000,
  stepsLast24h: 2,
  models: [],
  ...over,
});

const detail = (page: Page) => page.getByTestId('subscription-detail');

function mount(
  page: Page,
  opts: {
    subscriptions?: DoubaoSubscriptionListEntry[];
    runnerLogins?: DoubaoRunnerLogin[];
    canTestConnection?: boolean;
    machines?: object[];
    verifyResult?: object;
    blockDeleteWith409?: boolean;
    loginSessions?: Record<string, DoubaoLoginSession | null>;
    onStartLogin?: (
      machineId: string,
      body: { force?: boolean; logoutFirst?: boolean },
    ) => { status?: number; session?: DoubaoLoginSession; error?: string };
    extraRoutes?: (
      path: string,
      route: Parameters<Parameters<typeof mockLive>[2]>[1],
      json: Parameters<Parameters<typeof mockLive>[2]>[2],
    ) => Promise<void> | undefined;
  } = {},
) {
  const subs = opts.subscriptions ?? [subscription()];
  const machines = (opts.machines ?? [RUNNER_MBP, RUNNER_MINI_UNAUTHED]) as Array<{
    id: string;
    name: string;
  }>;
  const runnerLogins = opts.runnerLogins ?? [
    { runnerId: 'm-mbp', name: 'ian-mbp', online: true, installed: true, platformSupported: true, status: 'ok' },
    { runnerId: 'm-mini', name: 'mac-mini', online: true, installed: false, platformSupported: true, status: 'not_installed' },
  ];
  const sessions: Record<string, DoubaoLoginSession | null> = opts.loginSessions ?? {};

  return mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const custom = opts.extraRoutes?.(path, route, json);
    if (custom !== undefined) return custom;
    if (path === '/api/teams/t1/providers') {
      return json({
        presets: [],
        providers: [],
        canTestConnection: opts.canTestConnection ?? true,
      });
    }
    if (path === '/api/teams/t1/machines') {
      return json(machines);
    }
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([]);
    if (path === '/api/teams/t1/devin-subscriptions') return json([]);
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources') {
      return json({
        sources: [
          {
            runtime: 'doubao',
            hostname: 'ian-mbp',
            installed: true,
            models: UPSTREAM.map((m) => ({ ...m, liveness: 'alive' })),
          },
        ],
      });
    }
    const loginMatch = /^\/api\/teams\/t1\/machines\/([^/]+)\/doubao-login$/.exec(path);
    if (loginMatch !== null) {
      const mid = loginMatch[1]!;
      const mName = machines.find((m) => m.id === mid)?.name ?? mid;
      const method = route.request().method();
      if (method === 'GET') {
        const s = sessions[mid] ?? null;
        if (s !== null && opts.canTestConnection === false) {
          const { qrPngBase64: _q, ...redacted } = s;
          return json({ session: redacted });
        }
        return json({ session: s });
      }
      if (method === 'POST') {
        if (opts.canTestConnection === false) {
          return json({ error: 'Only the instance owner can sign in Doubao on a runner' }, 403);
        }
        const body = route.request().postDataJSON() as { force?: boolean; logoutFirst?: boolean };
        const customResp = opts.onStartLogin?.(mid, body);
        if (customResp?.error !== undefined) {
          return json({ error: customResp.error }, customResp.status ?? 409);
        }
        const next: DoubaoLoginSession = customResp?.session ?? {
          loginId: `login-${mid}-${body.force === true ? '2' : '1'}`,
          machineId: mid,
          machineName: mName,
          status: 'qr',
          qrPngBase64: body.force === true ? PNG_B : PNG_A,
          revision: body.force === true ? 2 : 1,
          startedAt: NOW,
          updatedAt: NOW,
        };
        sessions[mid] = next;
        return json({ session: next });
      }
      if (method === 'DELETE') {
        const prev = sessions[mid];
        const reqLoginId = new URL(route.request().url()).searchParams.get('loginId');
        if (prev && reqLoginId !== null && prev.loginId !== reqLoginId) {
          const { qrPngBase64: _q, ...rest } = prev;
          return json({ session: rest });
        }
        if (prev) {
          const { qrPngBase64: _q, ...rest } = prev;
          sessions[mid] = { ...rest, status: 'cancelled', revision: prev.revision + 1 };
        }
        return json({ session: sessions[mid] ?? null });
      }
    }
    if (path === '/api/teams/t1/doubao-subscriptions' && route.request().method() === 'GET') {
      return json({
        subscriptions: subs.map((s) => ({ ...s, runnerLogins: [...runnerLogins] })),
        runnerLogins,
      });
    }
    if (path === '/api/teams/t1/doubao-subscriptions' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { label: string; runnerId?: string | null };
      const created = subscription({
        id: 'sub-db-new',
        label: body.label,
        runnerId: body.runnerId ?? null,
        runnerLogins: [...runnerLogins],
      });
      subs.push(created);
      return json(
        {
          id: created.id,
          kind: 'doubao-subscription',
          label: created.label,
          runnerId: created.runnerId,
          enabled: true,
          enabledAt: NOW,
          createdAt: NOW,
          lastUsedAt: null,
          models: [],
        },
        201,
      );
    }
    const subMatch = /^\/api\/teams\/t1\/doubao-subscriptions\/([^/]+)$/.exec(path);
    if (subMatch !== null) {
      const id = subMatch[1]!;
      const idx = subs.findIndex((s) => s.id === id);
      if (route.request().method() === 'PATCH' && idx !== -1) {
        const body = route.request().postDataJSON() as { label?: string; models?: typeof UPSTREAM };
        if (body.label !== undefined) subs[idx]!.label = body.label;
        if (body.models !== undefined) subs[idx]!.models = body.models;
        return json(subs[idx]!);
      }
      if (route.request().method() === 'DELETE') {
        if (opts.blockDeleteWith409 === true) {
          return json(
            {
              error:
                'Cannot delete this account while 1 task(s) are running on it; finish or stop them first.',
              code: 'running-tasks',
              running: 1,
            },
            409,
          );
        }
        if (idx !== -1) subs.splice(idx, 1);
        return route.fulfill({ status: 204 });
      }
    }
    const disableMatch = /^\/api\/teams\/t1\/doubao-subscriptions\/([^/]+)\/disable$/.exec(path);
    if (disableMatch !== null) {
      const row = subs.find((s) => s.id === disableMatch[1]!);
      if (row) {
        row.enabled = false;
        row.enabledAt = null;
      }
      return json(row ?? {});
    }
    const enableMatch = /^\/api\/teams\/t1\/doubao-subscriptions\/([^/]+)\/enable$/.exec(path);
    if (enableMatch !== null) {
      const row = subs.find((s) => s.id === enableMatch[1]!);
      if (row) {
        row.enabled = true;
        row.enabledAt = NOW;
      }
      return json(row ?? {});
    }
    const verifyMatch = /^\/api\/teams\/t1\/doubao-subscriptions\/([^/]+)\/verify$/.exec(path);
    if (verifyMatch !== null) {
      return json(opts.verifyResult ?? { ok: true, runnerName: 'ian-mbp' });
    }
    const upstreamMatch =
      /^\/api\/teams\/t1\/doubao-subscriptions\/([^/]+)\/upstream-models$/.exec(path);
    if (upstreamMatch !== null) {
      return json({ status: 'ok', models: UPSTREAM });
    }
    return undefined;
  });
}

test('renders Doubao usage, verify outcomes, toggle enabled, 409 delete toast, and per-computer login actions', async ({
  page,
}) => {
  let verifyOverride: object | undefined;
  await mount(page, {
    blockDeleteWith409: true,
    extraRoutes: (path, _route, json) => {
      if (verifyOverride !== undefined && /^\/api\/teams\/t1\/doubao-subscriptions\/[^/]+\/verify$/.test(path)) {
        return json(verifyOverride);
      }
      return undefined;
    },
  });
  await page.goto('/app/resources/providers');
  await expect(detail(page)).toBeVisible();
  await expect(detail(page)).toContainText('近 24 小时');
  await expect(detail(page)).toContainText('2 次运行');
  await expect(detail(page)).toContainText('豆包 不提供剩余用量');
  await expect(detail(page).getByTestId('doubao-runner-logins')).toContainText('ian-mbp');
  await expect(detail(page).getByTestId('doubao-runner-logins')).toContainText('mac-mini');
  await expect(detail(page)).not.toContainText('doubao login');

  await detail(page).getByTestId('subscription-verify').click();
  await expect(page.getByTestId('subscription-verify-feedback')).toContainText('ian-mbp');

  await detail(page).getByTestId('subscription-toggle-enabled').click();
  await expect(detail(page).getByTestId('subscription-toggle-enabled')).toHaveText('启用');
  await detail(page).getByTestId('subscription-toggle-enabled').click();
  await expect(detail(page).getByTestId('subscription-toggle-enabled')).toHaveText('停用');

  await detail(page).getByTestId('subscription-pick-upstream').click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-group')).toHaveText(['Doubao · 1', 'DeepSeek · 1']);
  await picker.getByTestId('upstream-save').click();

  await detail(page).getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '移除', exact: true }).click();
  await expect(page.getByRole('region')).toContainText('移除失败，请重试。');
  await expect(page.getByRole('region')).toContainText('当前状态已变化，请刷新后重试。');
  await expect(page.getByRole('region')).not.toContainText(
    'Cannot delete this account while 1 task(s) are running on it',
  );
  await expect(detail(page)).toContainText('团队豆包订阅');

  await detail(page).getByTestId('doubao-runner-logins').getByTestId('doubao-runner-qr-login').click();
  await expect(detail(page).getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_A}`,
  );
  await detail(page).getByTestId('doubao-qr-refresh').click();
  await expect(detail(page).getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_B}`,
  );
  await detail(page).getByTestId('doubao-qr-cancel').click();
  await expect(detail(page).getByTestId('doubao-qr-login-card')).toHaveCount(0);

  for (const [verifyRes, expectedText] of [
    [{ ok: false, reason: 'missing_local_login', runnerName: 'mac-mini' }, 'mac-mini'],
    [{ ok: false, reason: 'unavailable', runnerName: 'mac-mini' }, 'mac-mini 暂不可用'],
    [{ ok: false, reason: 'timeout', runnerName: 'mac-mini' }, '验证超时'],
    [{ ok: false, reason: 'failed', runnerName: 'mac-mini' }, '无法在 mac-mini 上运行豆包检查'],
  ] as const) {
    verifyOverride = verifyRes;
    await page.reload();
    await detail(page).getByTestId('subscription-verify').click();
    await expect(page.getByTestId('subscription-verify-feedback')).toContainText(expectedText);
    await expect(page.getByTestId('subscription-verify-feedback')).not.toContainText('doubao login');
  }
});

test('recovers from GET/POST/DELETE errors and SSE disconnect/reconnect during Doubao QR login', async ({
  page,
}) => {
  let failGetRemaining = 2;
  let failPostOnce = true;
  let failDeleteOnce = true;
  let simulateRestartNull = false;
  await mount(page, {
    extraRoutes: (path, route, json) => {
      if (!path.endsWith('/machines/m-mini/doubao-login')) return undefined;
      const method = route.request().method();
      if (method === 'GET') {
        if (failGetRemaining > 0) {
          failGetRemaining -= 1;
          return json({ error: 'status check failed' }, 500);
        }
        if (simulateRestartNull) {
          return json({ session: null });
        }
      }
      if (method === 'POST' && failPostOnce) {
        failPostOnce = false;
        return json({ error: 'cannot start qr right now' }, 500);
      }
      if (method === 'DELETE' && failDeleteOnce) {
        failDeleteOnce = false;
        return json({ error: 'cancel transport error' }, 500);
      }
      return undefined;
    },
  });
  await page.goto('/app/resources/providers');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__es.some((es) => es.url.includes('/api/teams/t1/stream') && es.readyState === 1),
      ),
    )
    .toBe(true);
  await detail(page).getByTestId('doubao-runner-logins').getByTestId('doubao-runner-qr-login').click();
  await expect(detail(page).getByTestId('doubao-qr-query-retry')).toBeVisible();
  await detail(page).getByTestId('doubao-qr-query-retry').click();
  await expect(detail(page).getByTestId('doubao-qr-retry')).toBeVisible();
  await detail(page).getByTestId('doubao-qr-retry').click();
  await expect(detail(page).getByTestId('doubao-qr-image')).toBeVisible();
  await detail(page).getByTestId('doubao-qr-cancel').click();
  await expect(detail(page).getByTestId('doubao-qr-login-card')).toBeVisible();
  await expect(detail(page)).toContainText('cancel transport error');
  simulateRestartNull = true;
  const beforeStreams = await page.evaluate(
    () => window.__es.filter((es) => es.url.includes('/api/teams/t1/stream')).length,
  );
  await page.evaluate(() => {
    const active = window.__es
      .filter((es) => es.url.includes('/api/teams/t1/stream') && es.readyState === 1)
      .at(-1) as unknown as { onerror: (() => void) | null } | undefined;
    active?.onerror?.();
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__es.filter((es) => es.url.includes('/api/teams/t1/stream')).length,
        ),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(beforeStreams);
  await expect(detail(page).getByTestId('doubao-qr-reconnect')).toBeVisible();
  simulateRestartNull = false;
  await detail(page).getByTestId('doubao-qr-reconnect').click();
  await expect(detail(page).getByTestId('doubao-qr-image')).toBeVisible();

  await detail(page).getByTestId('doubao-runner-switch-account').click();
  await expect(detail(page).getByTestId('doubao-switch-notice')).toContainText('含本机 CLI');
});

test('hides Doubao toggle and per-computer scan/switch actions for non-owners', async ({ page }) => {
  await mount(page, { canTestConnection: false });
  await page.goto('/app/resources/providers');
  await expect(detail(page)).toBeVisible();
  await expect(detail(page).getByTestId('subscription-toggle-enabled')).toHaveCount(0);
  await expect(detail(page).getByTestId('doubao-runner-qr-login')).toHaveCount(0);
});

test('adds Doubao subscription with signed-in runner without showing QR', async ({ page }) => {
  await mount(page, {
    subscriptions: [],
    machines: [RUNNER_MBP],
    runnerLogins: [
      { runnerId: 'm-mbp', name: 'ian-mbp', online: true, installed: true, platformSupported: true, status: 'ok' },
    ],
  });
  await page.goto('/app/resources/providers');
  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="doubao-subscription"]').click();
  const dialogSignedIn = page.getByRole('dialog', { name: '添加豆包订阅' });
  await expect(dialogSignedIn).toContainText('已在 ian-mbp 登录豆包');
  await dialogSignedIn.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog', { name: /扫码登录/ })).toHaveCount(0);
  await expect(detail(page)).toContainText('豆包订阅');
});

test('allows saving Doubao subscription with zero online runners and handles 500 error', async ({
  page,
}) => {
  let failCreate = true;
  await mount(page, {
    subscriptions: [],
    machines: [],
    runnerLogins: [],
    extraRoutes: (path, route, json) => {
      if (path === '/api/teams/t1/doubao-subscriptions' && route.request().method() === 'POST' && failCreate) {
        failCreate = false;
        return json({ error: 'save failed' }, 500);
      }
      return undefined;
    },
  });
  await page.goto('/app/resources/providers');
  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="doubao-subscription"]').click();
  const dialogEmpty = page.getByRole('dialog', { name: '添加豆包订阅' });
  await expect(dialogEmpty).toContainText('当前暂无可扫码的在线执行机');
  await dialogEmpty.getByRole('button', { name: '保存' }).click();
  await expect(dialogEmpty.getByRole('alert')).toContainText('保存失败');
  await dialogEmpty.getByRole('button', { name: '保存' }).click();
  await expect(detail(page)).toContainText('豆包订阅');
});

test('renders inline QR login card on waiting Coordinator turn and waiting Worker task', async ({
  page,
}) => {
  const workerTodo = {
    ...TASK,
    id: 'todo-db-1',
    teamId: 't1',
    projectId: 'proj-1',
    seqNum: 10,
    title: 'Doubao Worker Wait',
    spec: '',
    phase: 'building',
    phaseAt: NOW,
    hasPlan: false,
    latestBuildId: 'b-db-1',
    buildHistory: [],
    kind: 'todo',
    createdBy: 'u1',
    ownerId: 'u1',
    sourceBuildId: null,
    sourceKind: null,
    sourceRef: null,
  };
  await mockLive(
    page,
    {
      threads: [
        {
          id: 'chief-home',
          chiefId: 'chief-u1-t1',
          userId: 'u1',
          teamId: 't1',
          title: '豆包等待',
          createdAt: 2,
          updatedAt: 2,
          lastTurnAt: null,
          session: { runtime: 'doubao', id: 's-db', openedAt: 2 },
          pendingSessionResumeAt: null,
          toolDefHashes: {},
          toolResultHashes: {},
          activeRun: { phase: 'chief' },
          turnQueue: {
            position: 1,
            waitingFor: { machineId: 'm-mini', name: 'mac-mini', running: 0, capacity: 1 },
            blocked: { kind: 'doubao-login-required', missing: ['mac-mini'] },
          },
        },
      ],
      messages: [{ id: 'm1', role: 'user', content: '用豆包分析代码', createdAt: 10 }],
      todos: [workerTodo],
    } as Parameters<typeof mockLive>[1],
    (path, route, json) => {
      if (path === '/api/teams/t1/providers') {
        return json({ presets: [], providers: [], canTestConnection: true });
      }
      if (path === '/api/teams/t1/machines') {
        return json([RUNNER_MINI_UNAUTHED]);
      }
      if (path === '/api/todos/todo-db-1') {
        return json(workerTodo);
      }
      if (path === '/api/builds/b-db-1') {
        return json({
          id: 'b-db-1',
          todoId: 'todo-db-1',
          withPlan: false,
          prevPhase: 'todo',
          triggerSource: 'user',
          planDocId: null,
          errorMessage: null,
          prUrl: null,
          prNumber: null,
          diffHash: null,
          reportAttachmentId: null,
          createdAt: NOW,
        });
      }
      if (path === '/api/builds/b-db-1/changes') {
        return json({ files: [], reported: true });
      }
      if (path === '/api/builds/b-db-1/usage') {
        return json([]);
      }
      if (path === '/api/builds/b-db-1/plans') {
        return json([]);
      }
      if (path === '/api/builds/b-db-1/steps') {
        return json([
          {
            id: 'step-db-1',
            buildId: 'b-db-1',
            kind: 'build',
            status: 'pending',
            createdAt: NOW,
            claimedAt: null,
            finishedAt: null,
            machineId: null,
            sessionId: null,
            errorMessage: null,
            summary: null,
            queue: {
              position: 1,
              waitingFor: { machineId: 'm-mini', name: 'mac-mini', running: 0, capacity: 1 },
              blocked: { kind: 'doubao-login-required', missing: ['mac-mini'] },
            },
          },
        ]);
      }
      if (path === '/api/teams/t1/machines/m-mini/doubao-login') {
        const method = route.request().method();
        if (method === 'GET') return json({ session: null });
        if (method === 'POST') {
          return json({
            session: {
              loginId: 'login-inline-1',
              machineId: 'm-mini',
              machineName: 'mac-mini',
              status: 'qr',
              qrPngBase64: PNG_A,
              revision: 1,
              startedAt: NOW,
              updatedAt: NOW,
            },
          });
        }
      }
      return undefined;
    },
  );

  await page.goto('/app');
  await expect(page.getByTestId('doubao-qr-login-card')).toBeVisible();
  await expect(page.getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_A}`,
  );

  await page.goto('/app?pane=tasks&thread=todo-db-1');
  await expect(page.getByTestId('side-chat-panel').getByTestId('doubao-qr-login-card')).toBeVisible();
  await expect(page.getByTestId('side-chat-panel').getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_A}`,
  );
});

test('adds Doubao subscription on clean runner -> shows QR dialog -> handles expired refresh, detail reattach, and completion without terminal instructions', async ({
  page,
}) => {
  let startCount = 0;
  let reattachGetCount = 0;
  const sessions: Record<string, DoubaoLoginSession | null> = {};
  const runnerLogins: DoubaoRunnerLogin[] = [
    { runnerId: 'm-mini', name: 'mac-mini', online: true, installed: false, platformSupported: true, status: 'not_installed' },
  ];
  await mount(page, {
    subscriptions: [],
    machines: [RUNNER_MINI_UNAUTHED],
    runnerLogins,
    loginSessions: sessions,
    extraRoutes: (path, route) => {
      if (path === '/api/teams/t1/machines/m-mini/doubao-login' && route.request().method() === 'GET') {
        reattachGetCount += 1;
      }
      return undefined;
    },
    onStartLogin: (mid) => {
      startCount += 1;
      if (startCount === 1) {
        return {
          session: {
            loginId: 'l-exp',
            machineId: mid,
            machineName: 'mac-mini',
            status: 'expired',
            reason: 'expired',
            revision: 1,
            startedAt: NOW,
            updatedAt: NOW,
          },
        };
      }
      return {
        session: {
          loginId: 'l-qr',
          machineId: mid,
          machineName: 'mac-mini',
          status: 'qr',
          qrPngBase64: PNG_B,
          revision: 2,
          startedAt: NOW,
          updatedAt: NOW,
        },
      };
    },
  });

  await page.goto('/app/resources/providers');
  await page.getByTestId('routing-add-provider').click();
  await page.locator('[data-preset-id="doubao-subscription"]').click();
  const addDialog = page.getByRole('dialog', { name: '添加豆包订阅' });
  await expect(addDialog).toBeVisible();
  await expect(addDialog).not.toContainText('doubao login');
  await addDialog.getByRole('button', { name: '保存并扫码登录' }).click();

  const qrDialog = page.getByRole('dialog', { name: 'mac-mini 豆包扫码登录' });
  await expect(qrDialog).toBeVisible();
  await expect(qrDialog).toContainText('二维码已过期');
  const addToast = page.locator('[data-sonner-toast]').filter({ hasText: '已添加服务商' });
  await expect(addToast).toHaveCount(1);
  await qrDialog.getByTestId('doubao-qr-retry').click();
  await expect(qrDialog.getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_B}`,
  );
  await expect(addToast).toHaveCount(0, { timeout: 10_000 });
  await qrDialog.getByRole('button', { name: '稍后扫码' }).click();
  await expect(detail(page)).toContainText('豆包订阅');
  await expect(addToast).toHaveCount(0);

  await page.reload();
  await expect(detail(page)).toBeVisible();
  const postCountBeforeReattach = startCount;
  const getsBeforeReattach = reattachGetCount;
  await detail(page).getByTestId('doubao-runner-qr-login').click();
  await expect.poll(() => reattachGetCount).toBeGreaterThan(getsBeforeReattach);
  expect(startCount).toBe(postCountBeforeReattach);
  await expect(detail(page).getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_B}`,
  );

  sessions['m-mini'] = {
    loginId: 'l-qr',
    machineId: 'm-mini',
    machineName: 'mac-mini',
    status: 'succeeded',
    revision: 3,
    startedAt: NOW,
    updatedAt: NOW + 1000,
  };
  runnerLogins[0] = {
    runnerId: 'm-mini',
    name: 'mac-mini',
    online: true,
    installed: true,
    platformSupported: true,
    status: 'ok',
  };
  await page.evaluate(() => {
    const stream = window.__es.find((es) => es.url.includes('/api/teams/t1/stream')) as unknown as {
      emit: (ev: unknown) => void;
    };
    stream.emit({
      type: 'doubao.login',
      machineId: 'm-mini',
      loginId: 'l-qr',
      status: 'succeeded',
      revision: 3,
    });
    stream.emit({ type: 'machine_presence', machineId: 'm-mini', online: true });
  });
  await expect(detail(page).getByTestId('doubao-qr-login-card')).toHaveCount(0);
  await expect(detail(page).getByTestId('doubao-runner-switch-account')).toBeVisible();
});

test('keeps switch-account card open despite cached prior succeeded, preserves QR on stale cancel response, and shows refresh on QR without image', async ({
  page,
}) => {
  const sessions: Record<string, DoubaoLoginSession | null> = {
    'm-mbp': {
      loginId: 'prior-ok-login',
      machineId: 'm-mbp',
      machineName: 'ian-mbp',
      status: 'succeeded',
      revision: 3,
      startedAt: NOW - 5000,
      updatedAt: NOW - 4000,
    },
    'm-mini': {
      loginId: 'qr-no-img',
      machineId: 'm-mini',
      machineName: 'mac-mini',
      status: 'qr',
      revision: 1,
      startedAt: NOW,
      updatedAt: NOW,
    },
  };
  let startMbpDelayResolve: (() => void) | null = null;
  await mount(page, {
    loginSessions: sessions,
    extraRoutes: (path, route, json) => {
      if (path === '/api/teams/t1/machines/m-mbp/doubao-login' && route.request().method() === 'POST') {
        return new Promise<void>((resolve) => {
          startMbpDelayResolve = resolve;
        }).then(() =>
          json({
            session: {
              loginId: 'new-switch-login',
              machineId: 'm-mbp',
              machineName: 'ian-mbp',
              status: 'qr',
              qrPngBase64: PNG_A,
              revision: 1,
              startedAt: NOW,
              updatedAt: NOW,
            },
          }),
        );
      }
      return undefined;
    },
    onStartLogin: (mid, body) => ({
      session: {
        loginId: body.logoutFirst === true ? 'new-switch-login' : `${mid}-refreshed`,
        machineId: mid,
        machineName: mid === 'm-mbp' ? 'ian-mbp' : 'mac-mini',
        status: 'qr',
        qrPngBase64: PNG_A,
        revision: 1,
        startedAt: NOW,
        updatedAt: NOW,
      },
    }),
  });

  await page.goto('/app/resources/providers');
  await detail(page).getByTestId('doubao-runner-qr-login').click();
  await expect(detail(page).getByTestId('doubao-qr-refresh')).toBeVisible();
  await detail(page).getByTestId('doubao-qr-refresh').click();
  await expect(detail(page).getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_A}`,
  );
  await detail(page).getByTestId('doubao-qr-cancel').click();

  await detail(page).getByTestId('doubao-runner-switch-account').click();
  await expect(detail(page).getByTestId('doubao-switch-notice')).toContainText('含本机 CLI');
  await expect.poll(() => startMbpDelayResolve).not.toBeNull();
  await expect(detail(page).getByTestId('doubao-qr-login-card')).toBeVisible();
  startMbpDelayResolve!();
  await expect(detail(page).getByTestId('doubao-qr-image')).toHaveAttribute(
    'src',
    `data:image/png;base64,${PNG_A}`,
  );
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390] as const) {
    test(`layout and overflow stay clean at ${width}px (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await mount(page);
      await page.goto('/app/resources/providers');
      await expect(detail(page)).toBeVisible();
      await detail(page).getByTestId('doubao-runner-qr-login').click();
      await expect(detail(page).getByTestId('doubao-qr-image')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    });
  }
}
