import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, taskEntry, THREAD } from './chief-home-mock.js';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ShiftRecord {
  value: number;
  hadRecentInput: boolean;
  sources: string[];
}

async function relativeY(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    let scrollOffset = window.scrollY;
    let cur = el.parentElement;
    while (cur !== null) {
      scrollOffset += cur.scrollTop;
      cur = cur.parentElement;
    }
    return el.getBoundingClientRect().top + scrollOffset;
  });
}

async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY);
    await Promise.all(finite.map((a) => a.finished.catch(() => {})));
  });
}

async function expectNoLayoutShift(
  page: Page,
  below: Locator,
  label: string,
  trigger: () => Promise<void>,
  options?: { ignoreSources?: readonly string[] },
): Promise<void> {
  await expect(below, `C34: ${label} anchor should be visible before trigger`).toBeVisible();
  await waitForFiniteAnimations(page);
  const beforeY = await relativeY(below);

  await page.evaluate(() => {
    const w = window as unknown as {
      __c34Observer?: PerformanceObserver;
      __c34Shifts?: ShiftRecord[];
    };
    w.__c34Observer?.disconnect();
    w.__c34Shifts = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value?: number;
          hadRecentInput?: boolean;
          sources?: { node?: Element | null }[];
        };
        w.__c34Shifts?.push({
          value: shift.value ?? 0,
          hadRecentInput: shift.hadRecentInput ?? false,
          sources: (shift.sources ?? []).map(
            (s) =>
              s.node?.getAttribute('data-testid') ??
              s.node?.getAttribute('data-slot') ??
              s.node?.tagName.toLowerCase() ??
              'unknown',
          ),
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: false });
    w.__c34Observer = observer;
  });

  await trigger();

  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const shifts = await page.evaluate(() => {
    const w = window as unknown as {
      __c34Observer?: PerformanceObserver;
      __c34Shifts?: ShiftRecord[];
    };
    const obs = w.__c34Observer;
    if (obs) {
      for (const entry of obs.takeRecords()) {
        const shift = entry as PerformanceEntry & {
          value?: number;
          hadRecentInput?: boolean;
          sources?: { node?: Element | null }[];
        };
        w.__c34Shifts?.push({
          value: shift.value ?? 0,
          hadRecentInput: shift.hadRecentInput ?? false,
          sources: (shift.sources ?? []).map(
            (s) =>
              s.node?.getAttribute('data-testid') ??
              s.node?.getAttribute('data-slot') ??
              s.node?.tagName.toLowerCase() ??
              'unknown',
          ),
        });
      }
      obs.disconnect();
    }
    return (w.__c34Shifts ?? []).filter((s) => !s.hadRecentInput);
  });

  const ignored = new Set(options?.ignoreSources ?? []);
  const relevantShifts =
    ignored.size === 0
      ? shifts
      : shifts.filter((s) => s.sources.some((src) => !ignored.has(src)));
  const cls = relevantShifts.reduce((sum, s) => sum + s.value, 0);
  const sources = [...new Set(relevantShifts.flatMap((s) => s.sources))];
  const afterY = await relativeY(below);
  console.log(`[C34] ${label}: cls=${cls.toFixed(4)} deltaY=${(afterY - beforeY).toFixed(2)}`);
  expect(
    cls,
    `C34: ${label} triggered layout shift (CLS=${cls.toFixed(4)}, sources=${sources.join(', ')})`,
  ).toBe(0);
  expect(
    afterY,
    `C34: ${label} moved content below from y=${beforeY} to y=${afterY}`,
  ).toBe(beforeY);
}

function registerC34Suite(mode: 'desktop' | 'mobile') {
  test(`new-task row (${mode}): blank validation, slow submit, rejected save and tooltip keep task list steady`, async ({
    page,
  }) => {
    await mockLive(
      page,
      {
        threads: [THREAD],
        messages: [],
        todos: [TASK],
        tasks: [taskEntry({ section: 'working', title: TASK.title })],
      },
      (path, route, json) => {
        if (path === `/api/projects/${PROJECT.id}/todos` && route.request().method() === 'POST') {
          return delay(650).then(() => json({ error: 'project is read only' }, 409));
        }
        return undefined;
      },
    );
    await page.goto('/app?pane=tasks');
    const panel = page.getByRole('complementary', { name: '任务' });
    await expect(panel).toBeVisible();
    await panel.getByTestId('tasks-new').click();
    const input = panel.getByTestId('tasks-add-input');
    const submit = panel.getByTestId('tasks-add-submit');
    const below = panel.getByTestId('tasks-section').first();
    await expect(input).toBeFocused();
    await expect(below).toBeVisible();

    await expectNoLayoutShift(page, below, 'new-task blank Enter validation', async () => {
      await input.press('Enter');
      await input.fill('   ');
      await input.press('Enter');
    });

    await expectNoLayoutShift(page, below, 'new-task slow submit loading + 409 error toast', async () => {
      await input.fill('Audit the relay probe retries');
      await input.press('Enter');
      await expect(submit).toBeDisabled();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '任务没有添加上，请重试。' })).toBeVisible();
    });

    await expectNoLayoutShift(page, below, 'new-task header button tooltip', async () => {
      await panel.getByTestId('tasks-new').hover();
      await delay(700);
    });
  });

  test('tasks panel: delayed PR query settling with no PRs does not shift sibling rows', async ({
    page,
  }) => {
    let releasePrs!: () => void;
    const prsHeld = new Promise<void>((resolve) => {
      releasePrs = resolve;
    });
    const first = taskEntry({ id: 'todo-1', section: 'working', title: 'Task one', latestBuildId: 'build-1' });
    const second = taskEntry({
      id: 'todo-2',
      seqNum: 10,
      section: 'working',
      title: 'Task two',
      latestBuildId: 'build-2',
    });
    await mockLive(
      page,
      {
        threads: [THREAD],
        messages: [],
        todos: [first, second],
        tasks: [first, second],
      },
      (path, _route, json) => {
        if (path === '/api/prs') return prsHeld.then(() => json([]));
        return undefined;
      },
    );
    await page.goto('/app?pane=tasks');
    const panel = page.getByRole('complementary', { name: '任务' });
    const rows = panel.locator('[data-slot="task-row-frame"]');
    await expect(rows).toHaveCount(2);

    await expectNoLayoutShift(page, rows.nth(1), 'tasks panel delayed empty PR query settling', async () => {
      const prsSettled = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/prs');
      await delay(600);
      releasePrs();
      await prsSettled;
      await delay(100);
    });
  });

  test('Coordinator composer: send error toast, running stop button, context meter and tooltip never shift toolbar', async ({
    page,
  }) => {
    let releaseSend!: () => void;
    const sendHeld = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let releaseChief!: () => void;
    const chiefHeld = new Promise<void>((resolve) => {
      releaseChief = resolve;
    });
    await mockLive(
      page,
      { threads: [THREAD], messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: 10 }] },
      (path, route, json) => {
        if (path === '/api/teams/t1/chief/threads' && route.request().method() === 'GET') {
          return json([{ ...THREAD, activeRun: { phase: 'chief' } }]);
        }
        if (path === '/api/teams/t1/chief') {
          const hasThread = new URL(route.request().url()).searchParams.has('threadId');
          const body = {
            chief: {
              id: 'chief-u1-t1',
              userId: 'u1',
              teamId: 't1',
              agent: { agentId: 'agent-1' },
              lastTurnAt: null,
              createdAt: 0,
              tz: null,
            },
            agentActor: { id: 'agent-1', displayName: 'r5-scribe', modelId: 'claude-sonnet-5' },
            context: { tokens: 24_000, contextWindow: 200_000 },
            watches: [],
            wakes: [],
          };
          return hasThread ? chiefHeld.then(() => json(body)) : json(body);
        }
        if (path === `/api/conversations/${THREAD.id}/messages` && route.request().method() === 'POST') {
          return sendHeld.then(() => json({ error: 'boom' }, 500));
        }
        return undefined;
      },
    );

    await page.goto('/app');
    const chiefHome = page.getByTestId('home-c');
    const plus = chiefHome.getByTestId('composer-plus');
    const composer = chiefHome.getByTestId('chief-composer-input');
    const stop = chiefHome.getByTestId('chief-composer-stop');
    await expect(composer).toBeVisible();
    await expect(stop).toBeVisible();
    const home = mode === 'mobile' ? page.getByRole('menu') : chiefHome;

    await expectNoLayoutShift(page, mode === 'mobile' ? composer : plus, 'Coordinator context meter loading -> loaded', async () => {
      if (mode === 'mobile') {
        await plus.click();
        await expect(home.getByTestId('composer-context-meter')).toHaveAttribute('aria-busy', 'true');
      }
      await delay(600);
      releaseChief();
      await expect(home.getByTestId('composer-context-meter')).toHaveAttribute('aria-busy', 'false');
      if (mode === 'mobile') {
        await page.keyboard.press('Escape');
        await expect(home).toHaveCount(0);
        await expect(page.locator('[data-base-ui-inert]')).toHaveCount(0);
      }
    });

    await expectNoLayoutShift(page, plus, 'Coordinator composer stop state settling', async () => {
      await delay(600);
      await page.evaluate((id) => {
        const w = window as unknown as { __es: { url: string; emit: (ev: unknown) => void }[] };
        w.__es.find((es) => es.url.includes(`/api/conversations/${id}/stream`))?.emit({
          type: 'step',
          step: { id: 'ask', status: 'done' },
        });
      }, THREAD.id);
      await delay(100);
    });

    await expectNoLayoutShift(
      page,
      plus,
      'Coordinator composer send failure toast',
      async () => {
        await composer.fill('Failing message');
        await composer.press('Enter');
        await delay(650);
        releaseSend();
        await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
      },
      { ignoreSources: ['chief-virtual-rows'] },
    );

    await expectNoLayoutShift(page, chiefHome.locator('.chief-composer'), 'Coordinator composer plus tooltip', async () => {
      await plus.hover();
      await delay(700);
    });
  });

  test('Coordinator composer: quick-reply hover preview does not shift toolbar', async ({ page }) => {
    await page.goto('/app?scenario=chief-quick-replies');
    const home = page.getByTestId('home-c');
    const plus = home.getByTestId('composer-plus');
    const quick = home.getByTestId('chief-quick-reply').first();
    await expect(quick).toBeVisible();
    await expect(plus).toBeVisible();

    await expectNoLayoutShift(page, plus, 'Coordinator quick-reply hover preview', async () => {
      await quick.hover();
      await delay(650);
    });
  });

  test('settings account: server version loading and backup run failure keep rows below steady', async ({
    page,
  }) => {
    let releaseVersion!: () => void;
    const versionHeld = new Promise<void>((resolve) => {
      releaseVersion = resolve;
    });
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path === '/api/server/version') {
        return versionHeld.then(() => json({ version: '0.1.774', commit: 'abcdef1' }));
      }
      if (path === '/api/server/backup') {
        return json({
          state: 'recorded',
          status: {
            host: 'mini',
            lastRunAt: Date.now() - 3_600_000,
            lastRunResult: 'success',
            lastRunExitStatus: '0',
            lastSuccessAt: Date.now() - 3_600_000,
          },
          managed: {
            enabled: true,
            storage: 'local',
            schedule: 'daily',
            inProgress: false,
            snapshots: [],
          },
        });
      }
      if (path === '/api/server/backup/run' && route.request().method() === 'POST') {
        return delay(650).then(() => json({ error: 'disk full' }, 500));
      }
      return undefined;
    });

    await page.goto('/app/settings/account');
    const backup = page.getByTestId('account-backup');
    await expect(backup).toBeVisible();

    await expectNoLayoutShift(page, backup, 'account server version loading -> loaded', async () => {
      await delay(600);
      releaseVersion();
      await expect(page.getByTestId('server-version')).toHaveAttribute('aria-busy', 'false');
    });

    const exportRow = page.locator('[data-settings-label="下载全部数据"]');
    await expectNoLayoutShift(page, exportRow, 'account backup run-now loading + error toast', async () => {
      await page.getByTestId('backup-run-now').click();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '备份失败，请重试。' })).toBeVisible();
    });
  });

  test('settings routing: subscription verify, provider test-all and rule save failure never shift rows below', async ({
    page,
  }) => {
    const providerRecord = {
      kind: 'custom',
      providerId: 'relay-fixture',
      label: 'Relay connection',
      baseUrl: 'https://gateway.example.invalid/v1',
      api: 'openai-completions',
      authHeader: false,
      compat: {},
      models: [{ id: 'small-model', name: 'Small model' }],
      id: 'prov-relay',
      createdBy: 'u1',
      createdAt: 1,
      updatedAt: 1,
      configurationFingerprint: 'a'.repeat(32),
    };
    const subRecord = {
      id: 's1',
      kind: 'claude-subscription',
      label: 'Claude subscription',
      expiresAt: null,
      createdAt: Date.now() - 3_600_000,
      windows: [{ name: 'five_hour', utilization: 0.38, resetsAt: Date.now() + 3_600_000, observedAt: Date.now() }],
      lastUsedAt: Date.now() - 120_000,
      stepsLast24h: 7,
    };
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path === '/api/teams/t1/claude-subscriptions') return json([subRecord]);
      if (path === '/api/teams/t1/providers') {
        return json({ presets: [], providers: [providerRecord], canTestConnection: true });
      }
      if (path === '/api/teams/t1/model-sources') {
        return json({
          sources: [
            {
              runtime: 'claude-code',
              installed: true,
              hostname: 'runner-1',
              machineId: 'm1',
              models: [{ id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', slot: 'sonnet' }],
            },
          ],
        });
      }
      if (path === '/api/teams/t1/claude-subscriptions/s1/verify') {
        return delay(650).then(() => json({ ok: false, reason: 'timeout' }));
      }
      if (path === '/api/teams/t1/providers/prov-relay/test') {
        return delay(650).then(() =>
          json({
            configurationFingerprint: providerRecord.configurationFingerprint,
            status: 'failed',
            reason: 'failed',
            failure: 'not-found',
            httpStatus: 404,
            detail: 'not found',
            latencyMs: null,
          }),
        );
      }
      if (path.startsWith('/api/teams/t1/routing-rules/') && route.request().method() === 'PATCH') {
        return delay(650).then(() => json({ error: 'save failed' }, 500));
      }
      return undefined;
    });

    await page.goto('/app/settings/routing');
    const subModels = page.getByTestId('subscription-models');
    await expect(subModels).toBeVisible();

    await expectNoLayoutShift(page, subModels, 'routing subscription verify loading -> failed popover', async () => {
      await page.getByTestId('subscription-verify').click();
      await expect(page.getByTestId('subscription-verify-feedback')).toHaveAttribute('data-phase', 'failed');
    });
    await page.keyboard.press('Escape');

    const freq = page.getByTestId('frequent-models');
    await expectNoLayoutShift(page, freq, 'routing rule save failure toast', async () => {
      await page.getByTestId('routing-rule-new-coordinator').locator('.routing-rule-model-select').click();
      await page.locator('.routing-rule-model-row').first().click();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '保存失败，请重试。' })).toBeVisible();
    });

    await page.getByTestId('provider-instance').filter({ hasText: 'Relay connection' }).click();
    const editor = page.getByTestId('provider-editor');
    await expect(editor.getByTestId('provider-test-all')).toBeVisible();
    const manageHeading = editor.getByRole('heading', { name: '管理' });
    await expectNoLayoutShift(page, manageHeading, 'routing provider test-all loading -> failed popover', async () => {
      await editor.getByTestId('provider-test-all').click();
      await expect(page.getByTestId('model-test-result')).toHaveAttribute('data-phase', 'failed');
    });
  });

  test('settings mcp: OAuth connect loading and failure keep catalog rows below steady', async ({
    page,
  }) => {
    let releaseOAuth!: () => void;
    const oauthHeld = new Promise<void>((resolve) => {
      releaseOAuth = resolve;
    });
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path === '/api/teams/t1/mcp-connectors') return json([]);
      if (path === '/api/teams/t1/mcp-connectors/github') {
        return json({ available: false, installUrl: null, connectionReady: false });
      }
      if (path === '/api/teams/t1/mcp-connectors/composio') {
        return json({ configured: false, apps: [] });
      }
      if (path === '/api/teams/t1/mail/accounts') return json({ accounts: [] });
      if (path === '/api/teams/t1/mcp-connectors/oauth/start' && route.request().method() === 'POST') {
        return oauthHeld.then(() => json({ error: 'bad gateway' }, 502));
      }
      return undefined;
    });

    await page.goto('/app/settings/mcp');
    const catalog = page.getByTestId('mcp-catalog');
    const nextRow = catalog.locator('[data-connector-card="Linear"] + *');
    await expect(nextRow).toBeVisible();

    await expectNoLayoutShift(page, nextRow, 'mcp OAuth start loading + failure', async () => {
      await catalog.getByRole('button', { name: '接入 Linear' }).click();
      await delay(650);
      releaseOAuth();
      await expect(catalog.getByRole('button', { name: '接入 Linear' })).toBeEnabled();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '未能连接 Linear' })).toBeVisible();
    });
  });

  test('settings remote: tailnet toggle failure keeps empty block below steady', async ({ page }) => {
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path === '/api/remote/routes') {
        return json({
          environmentId: 'env-1',
          routes: [],
          tailnet: { enabled: false, state: 'off', dnsName: null, authUrl: null, error: null },
        });
      }
      if (path === '/api/remote/tailnet' && route.request().method() === 'POST') {
        return delay(650).then(() => json({ error: 'failed' }, 500));
      }
      return undefined;
    });

    await page.goto('/app/settings/remote');
    const below = page.getByTestId('remote-routes-empty');
    await expect(below).toBeVisible();

    await expectNoLayoutShift(page, below, 'remote tailnet toggle failure', async () => {
      await page.getByTestId('remote-access-switch').click();
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: '远程访问未能打开，请重试' }),
      ).toBeVisible();
    });
  });

  test(`project settings (${mode}): repo validation and branch load error wrap below controls without shifting layout`, async ({
    page,
  }) => {
    let releaseBranches!: () => void;
    const branchesHeld = new Promise<void>((resolve) => {
      releaseBranches = resolve;
    });
    await mockLive(
      page,
      {
        threads: [],
        messages: [],
        projects: [
          {
            id: 'proj-1',
            name: 'cairn',
            teamId: 't1',
            repoKind: 'github',
            githubRepo: 'octo/cairn',
          },
        ],
      },
      (path, _route, json) => {
        if (path === '/api/projects/proj-1/branches') {
          return branchesHeld.then(() => json({ error: 'branches failed' }, 500));
        }
        return undefined;
      },
    );

    await page.goto('/app/project/proj-1/settings');
    const input = page.getByRole('textbox', { name: 'GitHub 仓库（owner/repo）' });
    const branchRow = page.locator('[data-settings-label="目标分支"]');
    const branchTrigger = page.getByTestId('project-base-branch');
    const archiveBtn = page.getByTestId('project-archive');
    await expect(input).toBeVisible();
    await expect(branchRow).toBeVisible();
    await expect(branchTrigger).toBeVisible();
    await expect(archiveBtn).toBeVisible();

    await waitForFiniteAnimations(page);
    const inputBefore = await input.boundingBox();
    expect(inputBefore).not.toBeNull();

    await expectNoLayoutShift(page, branchRow, `project settings invalid github repo validation (${mode})`, async () => {
      await input.fill('invalid-repo');
      await page.getByRole('button', { name: '保存仓库' }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'GitHub 仓库格式应为 owner/repo。' }),
      ).toBeVisible();
    });

    await waitForFiniteAnimations(page);
    const repoAlert = page.getByRole('alert').filter({ hasText: 'GitHub 仓库格式应为 owner/repo。' });
    const inputAfter = await input.boundingBox();
    const repoAlertBox = await repoAlert.boundingBox();
    expect(inputAfter).not.toBeNull();
    expect(repoAlertBox).not.toBeNull();
    expect(
      inputAfter!.x,
      `C34: project settings repo input shifted sideways at ${mode} from x=${inputBefore!.x} to x=${inputAfter!.x}`,
    ).toBe(inputBefore!.x);
    expect(
      inputAfter!.width,
      `C34: project settings repo input shrank at ${mode} from w=${inputBefore!.width} to w=${inputAfter!.width}`,
    ).toBe(inputBefore!.width);
    expect(
      repoAlertBox!.y,
      `C34: project settings repo error (${repoAlertBox!.y}) must wrap below input (${inputAfter!.y + inputAfter!.height}) at ${mode}`,
    ).toBeGreaterThanOrEqual(inputAfter!.y + inputAfter!.height - 1);
    expect(
      Math.abs(repoAlertBox!.x - inputAfter!.x),
      `C34: project settings repo error (${repoAlertBox!.x}) must align below input (${inputAfter!.x}) at ${mode}`,
    ).toBeLessThanOrEqual(16);

    await input.fill('octo/cairn');
    await expect(repoAlert).toHaveCount(0);
    await branchTrigger.evaluate((el) =>
      el.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await waitForFiniteAnimations(page);
    const branchBefore = await branchTrigger.boundingBox();
    expect(branchBefore).not.toBeNull();
    const branchAlert = page.getByRole('alert').filter({ hasText: '读取失败' });

    await expectNoLayoutShift(page, archiveBtn, `project settings branch load error (${mode})`, async () => {
      await delay(600);
      releaseBranches();
      await expect(branchAlert).toBeVisible();
    });

    await waitForFiniteAnimations(page);
    const branchAfter = await branchTrigger.boundingBox();
    const branchAlertBox = await branchAlert.boundingBox();
    expect(branchAfter).not.toBeNull();
    expect(branchAlertBox).not.toBeNull();
    expect(
      branchAfter!.x,
      `C34: project settings branch picker shifted sideways at ${mode} from x=${branchBefore!.x} to x=${branchAfter!.x}`,
    ).toBe(branchBefore!.x);
    expect(
      branchAfter!.width,
      `C34: project settings branch picker shrank at ${mode} from w=${branchBefore!.width} to w=${branchAfter!.width}`,
    ).toBe(branchBefore!.width);
    expect(
      branchAlertBox!.y,
      `C34: project settings branch error (${branchAlertBox!.y}) must wrap below picker (${branchAfter!.y + branchAfter!.height}) at ${mode}`,
    ).toBeGreaterThanOrEqual(branchAfter!.y + branchAfter!.height - 1);
    expect(
      Math.abs(branchAlertBox!.x - branchAfter!.x),
      `C34: project settings branch error (${branchAlertBox!.x}) must align below picker (${branchAfter!.x}) at ${mode}`,
    ).toBeLessThanOrEqual(16);
  });

  test('thread panel: schedules loading, action chip pending/error, stop pending/error and send failure keep layout steady', async ({
    page,
  }) => {
    let releaseSchedules!: () => void;
    const schedulesHeld = new Promise<void>((resolve) => {
      releaseSchedules = resolve;
    });
    const confirmTodo = {
      ...TASK,
      id: 'todo-1',
      phase: 'confirm',
      latestBuildId: 'build-1',
      section: 'needs_input',
    };
    await mockLive(
      page,
      {
        threads: [THREAD],
        messages: [],
        todos: [confirmTodo],
        tasks: [taskEntry({ id: 'todo-1', phase: 'confirm', latestBuildId: 'build-1', section: 'needs_input' })],
      },
      (path, route, json) => {
        if (path === '/api/todos/todo-1') return json(confirmTodo);
        if (path === '/api/builds/build-1') {
          return json({ id: 'build-1', todoId: 'todo-1', status: 'waiting_confirm', errorMessage: null });
        }
        if (path === '/api/builds/build-1/steps') {
          if (route.request().method() === 'POST') {
            return delay(650).then(() => json({ error: 'action failed' }, 500));
          }
          return json([
            { id: 'step-1', buildId: 'build-1', kind: 'plan', status: 'done', machineId: 'm-ready' },
          ]);
        }
        if (path === '/api/builds/build-1/plans') return json([]);
        if (path === '/api/builds/build-1/changes') return json({ files: [] });
        if (path === '/api/conversations/build-1/messages') {
          return json({
            messages: [{ id: 'u1', role: 'user', content: 'Fix bug', createdAt: 1000 }],
            nextCursor: null,
          });
        }
        if (path === '/api/prs') return json([]);
        if (path === '/api/schedules') return schedulesHeld.then(() => json([]));
        if (path === '/api/todos/todo-1/messages' && route.request().method() === 'POST') {
          return delay(650).then(() => json({ error: 'send failed' }, 500));
        }
        return undefined;
      },
    );

    await page.goto('/app?thread=todo-1');
    const sidePanel = page.getByTestId('side-chat-panel');
    const transcript = sidePanel.getByTestId('transcript-col');
    const composerCard = sidePanel.getByTestId('composer-card');
    await expect(transcript).toBeVisible();
    await expect(composerCard).toBeVisible();

    await expectNoLayoutShift(page, transcript, 'thread panel schedules loading -> empty', async () => {
      await delay(600);
      releaseSchedules();
      await expect(sidePanel.getByTestId('automation-loading')).toHaveCount(0);
    });

    await expectNoLayoutShift(page, composerCard, 'thread panel action chip pending + error', async () => {
      await sidePanel.getByTestId('side-chat-action').getByRole('button', { name: '批准计划' }).click();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '批准失败，请重试。' })).toBeVisible();
    });

    const actionCard = sidePanel.getByTestId('side-chat-action');
    await expectNoLayoutShift(page, actionCard, 'thread panel send reply error', async () => {
      const textarea = composerCard.locator('textarea');
      await textarea.fill('Will fail');
      await textarea.press('Enter');
      await expect(sidePanel.getByTestId('side-chat-send-error')).toBeVisible();
    });
  });

  test('thread panel: stop button pending and error keep composer tools steady', async ({ page }) => {
    const buildingTodo = {
      ...TASK,
      id: 'todo-run',
      phase: 'building',
      latestBuildId: 'build-run',
      section: 'working',
    };
    await mockLive(
      page,
      {
        threads: [THREAD],
        messages: [],
        todos: [buildingTodo],
        tasks: [taskEntry({ id: 'todo-run', phase: 'building', latestBuildId: 'build-run', section: 'working' })],
      },
      (path, route, json) => {
        if (path === '/api/todos/todo-run') return json(buildingTodo);
        if (path === '/api/builds/build-run') {
          return json({ id: 'build-run', todoId: 'todo-run', status: 'running', errorMessage: null });
        }
        if (path === '/api/builds/build-run/steps') {
          return json([
            {
              id: 'step-run',
              buildId: 'build-run',
              kind: 'session',
              status: 'claimed',
              machineId: 'm-ready',
            },
          ]);
        }
        if (path === '/api/builds/build-run/plans') return json([]);
        if (path === '/api/builds/build-run/changes') return json({ files: [] });
        if (path === '/api/conversations/build-run/messages') {
          return json({
            messages: [{ id: 'u1', role: 'user', content: 'Run task', createdAt: 1000 }],
            nextCursor: null,
          });
        }
        if (path === '/api/prs') return json([]);
        if (path === '/api/schedules') return json([]);
        if (path === '/api/builds/build-run/stop' && route.request().method() === 'POST') {
          return delay(650).then(() => json({ error: 'stop failed' }, 500));
        }
        return undefined;
      },
    );

    await page.goto('/app?thread=todo-run');
    const sidePanel = page.getByTestId('side-chat-panel');
    const tools =
      mode === 'mobile'
        ? sidePanel.getByTestId('composer-toolbar')
        : sidePanel.locator('[data-slot="composer-tools"]');
    const stopBtn = sidePanel.locator('.composer-stop');
    await expect(stopBtn).toBeVisible();
    await expect(tools).toBeVisible();

    await expectNoLayoutShift(page, tools, `thread panel stop loading + error toast (${mode})`, async () => {
      await stopBtn.click();
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: '停止失败，请重试。' })).toBeVisible();
    });
  });
}

test.describe('C34: no layout shift on transient states (desktop 1440px)', () => {
  registerC34Suite('desktop');
});

test.describe('C34: no layout shift on transient states (mobile 390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  registerC34Suite('mobile');
});
