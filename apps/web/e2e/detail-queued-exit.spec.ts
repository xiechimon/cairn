import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

// #1446: a queued task (started, waiting for a machine) has a way out from its
// detail page. Pacman never times out a queued step (#1257), so without one a
// task whose home machine never returns stays queued. 更多 gains 停止 for a
// queued task (POST /api/builds/:id/stop, back to 待开始) and 关闭 is enabled
// (PATCH phase=closed; the server stops the pending step first, #1445).
// Live face, no ?scenario= (stubLiveBoot discipline from schedules-live.spec.ts).
// Failure modes pinned here:
//   1. a queued task's 更多 has no 停止, and 关闭 is disabled;
//   2. 停止 opens the running-turn dialog (its "discard this round" checkbox
//      means nothing for a step that never ran) or sends nothing;
//   3. 关闭 sends nothing;
//   4. the change leaks to planning / building: a menu 停止 appears or 关闭
//      turns on (their stop stays in the composer, 关闭 stays off mid-run).

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: 'proj-1',
  name: 'pacman',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'pacman',
  githubRepo: null,
  localPath: null,
};
const STARTED_AT = Date.now() - 60_000;

function wireTodo(id: string, phase: string, seqNum: number) {
  return {
    id,
    teamId: 'team-1',
    projectId: 'proj-1',
    title: phase === 'queued' ? '排队探针' : '规划探针',
    spec: '',
    phase,
    phaseAt: STARTED_AT,
    seqNum,
    orderIndex: seqNum,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: `build-${id}`,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [{ buildId: `build-${id}`, createdAt: STARTED_AT }],
    sourceTodo: null,
    v: 1,
  };
}

const QUEUED = wireTodo('todo-queued', 'queued', 11);
const PLANNING = wireTodo('todo-planning', 'planning', 12);

interface Sent {
  stops: { path: string; body: unknown }[];
  patches: { path: string; body: unknown }[];
}

async function stubLiveBoot(page: Page): Promise<Sent> {
  const sent: Sent = { stops: [], patches: [] };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [QUEUED, PLANNING] }));
  for (const t of [QUEUED, PLANNING]) {
    await page.route(`**/api/todos/${t.id}`, (route, request) => {
      if (request.method() === 'PATCH') {
        const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
        sent.patches.push({ path: new URL(request.url()).pathname, body });
        return route.fulfill({ json: { ...t, ...body, v: t.v + 1 } });
      }
      return route.fulfill({ json: t });
    });
  }
  await page.route('**/api/builds/*/stop', (route, request) => {
    sent.stops.push({
      path: new URL(request.url()).pathname,
      body: JSON.parse(request.postData() ?? '{}'),
    });
    return route.fulfill({ json: { delegated: false } });
  });
  return sent;
}

const head = (page: Page) => page.getByTestId('detail-head');
const menu = (page: Page) => page.getByRole('menu', { name: '更多' });
const row = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true });

async function openMore(page: Page, todoId: string, chip: string) {
  await page.goto(`/app/todo/${todoId}`);
  await expect(head(page).getByTestId('phase-chip')).toHaveText(chip);
  await head(page).getByRole('button', { name: '更多' }).click();
  await expect(menu(page)).toBeVisible();
}

test('queued: 更多 offers 停止, and confirming it stops the build', async ({ page }) => {
  const sent = await stubLiveBoot(page);
  await openMore(page, QUEUED.id, '排队中');
  await evidencePanelShot(page, 'queued-more-menu.png', menu(page));
  await expect(row(page, '停止')).toBeEnabled();

  await row(page, '停止').click();
  const dialog = page.getByRole('dialog', { name: '停止排队？' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await evidencePanelShot(page, 'queued-stop-dialog.png', dialog);
  await dialog.getByRole('button', { name: '停止', exact: true }).click();
  await expect.poll(() => sent.stops.map((s) => s.path)).toEqual([
    `/api/builds/${QUEUED.latestBuildId}/stop`,
  ]);
});

test('queued: 更多 > 关闭 is enabled and closes the task', async ({ page }) => {
  const sent = await stubLiveBoot(page);
  await openMore(page, QUEUED.id, '排队中');
  await expect(row(page, '关闭')).toBeEnabled();
  await row(page, '关闭').click();
  await expect.poll(() => sent.patches).toEqual([
    { path: `/api/todos/${QUEUED.id}`, body: { phase: 'closed' } },
  ]);
});

test('planning: no menu 停止, 关闭 stays disabled', async ({ page }) => {
  await stubLiveBoot(page);
  await openMore(page, PLANNING.id, '规划中');
  await expect(row(page, '复制链接')).toBeVisible();
  await expect(row(page, '停止')).toHaveCount(0);
  await expect(row(page, '关闭')).toBeDisabled();
});
