import { expect, type Page, test } from '@playwright/test';

// #1037: the 新建定时 form's live face — the pin the acceptance called out as
// missing: click 保存 → a real POST /api/schedules carrying the form state.
// Boot stubs follow the stubLiveBoot discipline (agent-detail / page-scroll):
// teams + user me must succeed (they feed teamId); every other GET 500s into
// the app's existing isError tolerance (data ?? []). No ?scenario= in the URL
// = live data source (api/mode.ts gate: fixture build without the param hits
// the real API surface, which page.route intercepts).
//
// Hostile-data discipline (#1037 brief): the stub todo carries a long
// unbreakable title — the dialog must stay capped, the task row must stay
// truncated, and 保存 must still fire. Stubs this tame would let a dead
// button ship: the row geometry only breaks on content a real user can type.

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
// 124 chars, zero break opportunities — the "stub too tame" trap.
const LONG_TITLE = 'AnUnbreakableScheduleProbeTitle'.repeat(4);

function wireTodo(i: number) {
  return {
    id: `todo-${i}`,
    teamId: 'team-1',
    projectId: 'proj-1',
    title: i === 0 ? LONG_TITLE : `滚动探针任务 ${i}`,
    spec: `滚动探针任务 ${i}`,
    phase: 'todo',
    phaseAt: 0,
    seqNum: i + 1,
    orderIndex: i,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: 0,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
}

const CREATED_SCHEDULE = {
  id: 'sched-new',
  teamId: 'team-1',
  projectId: 'proj-1',
  todoId: 'todo-0',
  kind: 'once',
  at: 0,
  tz: 'Asia/Shanghai',
  machineId: null,
  nextRunAt: 0,
  createdBy: 'user-1',
  todo: {
    seqNum: 1,
    title: LONG_TITLE,
    phase: 'todo',
    projectName: 'pacman',
    ownerId: 'user-1',
  },
};

async function stubLiveBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
}

test('live face: 保存 fires POST /api/schedules with the form state (#1037)', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [wireTodo(0)] }));
  const posts: unknown[] = [];
  await page.route('**/api/schedules*', (route, request) => {
    if (request.method() === 'POST') {
      posts.push(request.postDataJSON());
      return route.fulfill({ json: CREATED_SCHEDULE });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/app/schedules');
  await expect(page.locator('.sched-empty')).toBeVisible();
  await page.locator('.sched-empty').getByRole('button', { name: '新建定时' }).click();
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await expect(dialog).toBeVisible();

  // b face: the 项目/任务/机器 rows must not read as pickers — no chevron
  // affordance anywhere in the form (ChevronRight's polyline is its own
  // outline, icons/ChevronRight.tsx). The r2 §6.6 inventory registers the
  // reference's rows as preselected values with no observed picker
  // interaction, so the honest local-first face is a static display row.
  await expect(dialog.locator('polyline[points="9 18 15 12 9 6"]')).toHaveCount(0);

  // Hostile data: the unbreakable 124-char title must stay inside the row box
  // (truncate), never push the 488px panel wider.
  const taskValue = dialog.locator('.sched-form-row', { hasText: '任务' });
  await expect(taskValue).toBeVisible();
  expect(
    await taskValue.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'long unbreakable title overflows the task row',
  ).toBe(true);
  const panel = await dialog.boundingBox();
  expect(panel).not.toBeNull();
  expect(panel!.width).toBeLessThanOrEqual(488.5);

  // Drive the form: 单次 tab + hour 10 — the wire body must carry both.
  // #1010/#1084 hook migration (same law as m5-web-e2e): the registry compound
  // select portals its popup to body — dialog-scoped listbox locators can never
  // see it — and Base UI puts role=listbox on the inner Select.List while the
  // SelectContent aria-label lands on the role=presentation outer Popup (the
  // listbox's own aria-label is always null), so the old
  // `[role=listbox][aria-label=时]` compound hook is unreachable on the
  // pristine component. The trigger keeps aria-label=时 and still renders
  // inside the dialog; the open popup is the only listbox in the a11y tree
  // (closed popups stay display:none), so page-level getByRole('listbox')
  // is unambiguous.
  await dialog.getByRole('radio', { name: '单次' }).click();
  await dialog.locator('button[aria-label="时"]').click();
  await page.getByRole('listbox').getByRole('option', { name: '10', exact: true }).click();
  await dialog.getByRole('button', { name: '保存' }).click();

  await expect.poll(() => posts.length).toBe(1);
  const body = posts[0] as Record<string, unknown>;
  expect(body.kind).toBe('once');
  expect(body.todoId).toBe('todo-0');
  expect(body.projectId).toBe('proj-1');
  expect(typeof body.at).toBe('number');
  // at = 10:00 local today (or tomorrow when already past — saveSchedule's
  // once-branch law); either way the wall-clock slots are the picked ones.
  const at = new Date(body.at as number);
  expect(at.getHours()).toBe(10);
  expect(at.getMinutes()).toBe(0);
  await expect(dialog).toBeHidden();
});
