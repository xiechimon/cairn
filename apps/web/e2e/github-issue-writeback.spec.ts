import { expect, type Page, test } from '@playwright/test';

const LOCAL_TITLE = '登录偶发 500：重试风暴';

function selfRecord(sourceRef: string | null) {
  return {
    id: 'todo-self-1',
    teamId: 'team-1',
    projectId: 'proj-gh',
    title: LOCAL_TITLE,
    spec: '复现步骤：会话过期后连点重试。',
    phase: 'todo',
    phaseAt: 0,
    seqNum: 1,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: sourceRef === null ? 1 : 2,
    createdBy: 'user-1',
    ownerId: 'user-1',
    sourceBuildId: null,
    sourceKind: 'github-issue-self',
    sourceRef,
  };
}

async function stubWorld(
  page: Page,
  opts: {

    sourceRef: string | null;

    echo: { mode: 'ok'; title: string; state?: 'open' | 'closed' } | { mode: 'gone' };
  },
) {
  let record = selfRecord(opts.sourceRef);
  let retryHits = 0;
  let echoHits = 0;
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/**', (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/teams') {
        return route.fulfill(
          json([{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }]),
        );
      }
      if (path === '/api/user/me') {
        return route.fulfill(json({ id: 'user-1', displayName: '我', avatarUrl: null }));
      }
      if (path === '/api/projects') {
        return route.fulfill(
          json([
            {
              id: 'proj-gh',
              name: 'alpha',
              teamId: 'team-1',
              repoKind: 'github',
              githubRepo: 'octo/alpha',
            },
          ]),
        );
      }
      if (path === '/api/todos') return route.fulfill(json([record]));
      if (path === '/api/todos/todo-self-1') return route.fulfill(json(record));
      if (path === '/api/todos/todo-self-1/github-issue') {
        echoHits += 1;
        if (opts.echo.mode === 'gone') {
          return route.fulfill(json({ error: 'source issue' }, 404));
        }
        return route.fulfill(
          json({ number: 101, title: opts.echo.title, state: opts.echo.state ?? 'open' }),
        );
      }
      return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
    }
    if (request.method() === 'POST' && path === '/api/todos/todo-self-1/github-issue/retry') {
      retryHits += 1;

      record = { ...record, sourceRef: 'github:octo/alpha#101', v: record.v + 1 };
      return route.fulfill(json(record));
    }
    return route.fulfill(json({ error: 'e2e stub: not the surface under test' }, 500));
  });
  return {
    get retryHits() {
      return retryHits;
    },
    get echoHits() {
      return echoHits;
    },
  };
}

test('1. built and consistent: echo row = number + status + upstream title, no drift hint', async ({ page }) => {
  await stubWorld(page, {
    sourceRef: 'github:octo/alpha#101',
    echo: { mode: 'ok', title: LOCAL_TITLE },
  });
  await page.goto('/app/todo/todo-self-1');
  const row = page.locator('[data-testid="source-issue-echo"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('#101');
  await expect(row).toContainText('打开');
  await expect(row).toContainText(LOCAL_TITLE);
  await expect(page.locator('[data-testid="source-issue-drift"]')).toHaveCount(0);
});

test('2. inconsistent: neutral hint appears, local title not overwritten (D5 hints only, never overwrites)', async ({ page }) => {
  await stubWorld(page, {
    sourceRef: 'github:octo/alpha#101',
    echo: { mode: 'ok', title: '仓库侧改过的标题', state: 'closed' },
  });
  await page.goto('/app/todo/todo-self-1');
  const row = page.locator('[data-testid="source-issue-echo"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('已关闭');
  await expect(row).toContainText('仓库侧改过的标题');
  await expect(page.locator('[data-testid="source-issue-drift"]')).toHaveText(
    '与本地标题不一致',
  );

  await expect(page.locator('.fresh-title')).toHaveText(LOCAL_TITLE);
});

test('3. unreachable (echo 404): whole row hidden, page shows no error state', async ({ page }) => {
  await stubWorld(page, { sourceRef: 'github:octo/alpha#101', echo: { mode: 'gone' } });
  await page.goto('/app/todo/todo-self-1');

  await expect(page.locator('.fresh-title')).toHaveText(LOCAL_TITLE);
  await expect(page.locator('.spec-block')).toContainText('复现步骤');
  await expect(page.locator('[data-testid="source-issue-echo"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="source-issue-pending"]')).toHaveCount(0);
});

test('4. not built: status row + retry entry; successful retry upgrades the row to the echo state (AC3)', async ({ page }) => {
  const world = await stubWorld(page, {
    sourceRef: null,
    echo: { mode: 'ok', title: LOCAL_TITLE },
  });
  await page.goto('/app/todo/todo-self-1');
  const pending = page.locator('[data-testid="source-issue-pending"]');
  await expect(pending).toBeVisible();
  await expect(pending).toContainText('GitHub issue 未建成');

  expect(world.echoHits).toBe(0);
  await page.locator('[data-testid="source-issue-retry"]').click();
  const row = page.locator('[data-testid="source-issue-echo"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('#101');
  expect(world.retryHits).toBe(1);
  await expect(pending).toHaveCount(0);
});
