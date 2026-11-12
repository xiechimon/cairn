import { expect, type Page, type Route, test } from '@playwright/test';
import { type MockState, mockLive, PROJECT, TASK, taskEntry, THREAD } from './chief-home-mock.js';
import { evidencePanelShot } from './evidence.js';

type Json = (body: unknown, status?: number) => Promise<void>;

interface World {
  state: MockState;
  posts: { path: string; body: unknown }[];
  fail: boolean;
}

function world(over: Partial<MockState> = {}): World {
  return {
    state: {
      threads: [THREAD],
      messages: [],
      todos: [TASK],
      tasks: [taskEntry({ section: 'working', title: TASK.title })],
      ...over,
    },
    posts: [],
    fail: false,
  };
}

async function open(page: Page, w: World) {
  const sent = await mockLive(page, w.state, (path: string, route: Route, json: Json) => {
    const request = route.request();
    const match = /^\/api\/projects\/([^/]+)\/todos$/.exec(path);
    if (match === null || request.method() !== 'POST') return undefined;
    const body = request.postDataJSON() as { title: string; spec: string };
    w.posts.push({ path, body });
    if (w.fail) return json({ error: 'project is read only' }, 409);
    const record = taskEntry({
      id: `todo-new-${w.posts.length}`,
      projectId: match[1],
      title: body.spec,
      spec: body.spec,
      phase: 'todo',
      phaseAt: Date.now(),
      seqNum: 20 + w.posts.length,
      latestBuildId: null,
      section: 'up_next',
    });
    w.state.tasks = [record, ...(w.state.tasks ?? [])];
    w.state.todos = [record, ...(w.state.todos ?? [])];
    return json(record, 201);
  });
  await page.goto('/app?pane=tasks');
  await expect(panel(page)).toBeVisible();
  return sent;
}

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const plus = (page: Page) => panel(page).getByTestId('tasks-new');
const field = (page: Page) => panel(page).getByTestId('tasks-add-field');
const input = (page: Page) => panel(page).getByTestId('tasks-add-input');
const submit = (page: Page) => panel(page).getByTestId('tasks-add-submit');
const upNext = (page: Page) => panel(page).locator('[data-section="up_next"] [data-slot="task-row-title"]');

test('the plus button opens the add field under the tabs, with the reference metrics', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await open(page, world());
  await expect(field(page)).toHaveCount(0);
  await expect(plus(page)).toHaveAttribute('aria-pressed', 'false');
  await plus(page).click();
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveAttribute('placeholder', '添加任务…');
  await expect(plus(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByRole('tab', { name: '进行中' })).toHaveAttribute('aria-selected', 'true');
  const geometry = await panel(page).evaluate((root) => {
    const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
    const side = root.getBoundingClientRect();
    const tabs = root.querySelector('[role="tablist"]')!.getBoundingClientRect();
    const fieldBox = box('[data-testid="tasks-add-field"]');
    const tile = box('[data-slot="tasks-add-tile"]');
    const glyph = box('[data-slot="tasks-add-tile"] svg');
    const text = box('[data-testid="tasks-add-input"]');
    const arrow = box('[data-testid="tasks-add-submit"]');
    const arrowGlyph = box('[data-testid="tasks-add-submit"] svg');
    const row = box('[data-slot="task-row-title"]');
    const style = getComputedStyle(root.querySelector('[data-testid="tasks-add-field"]')!);
    return {
      underTabs: Math.round(fieldBox.top - tabs.bottom),
      height: fieldBox.height,
      sides: [
        Math.round(fieldBox.left - side.left - root.clientLeft),
        Math.round(side.right - fieldBox.right),
      ],
      radius: style.borderTopLeftRadius,
      tile: `${tile.width}x${tile.height}`,
      tileInset: [Math.round(tile.left - fieldBox.left), Math.round(tile.top - fieldBox.top)],
      glyph: glyph.width,
      textOnRowTitles: Math.round(text.left - row.left),
      arrow: `${arrow.width}x${arrow.height}`,
      arrowGlyph: arrowGlyph.width,
      arrowCentreFromRight: Math.round(fieldBox.right - (arrow.left + arrow.width / 2)),
      ring: style.outlineStyle,
    };
  });
  expect(geometry).toEqual({
    underTabs: 8,
    height: 42,
    sides: [8, 8],
    radius: '10px',
    tile: '24x24',
    tileInset: [13, 9],
    glyph: 16,
    textOnRowTitles: 0,
    arrow: '28x28',
    arrowGlyph: 20,
    arrowCentreFromRight: 21,
    ring: 'solid',
  });
  await evidencePanelShot(page, 'tasks-add-open-light.png', panel(page));
});

for (const theme of ['light', 'dark'] as const) {
  test(`Enter saves the task to the up-next list without starting it, and the field stays for the next one (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    const w = world();
    const sent = await open(page, w);
    await plus(page).click();
    await input(page).fill('Audit the relay probe retries');
    await expect(submit(page)).toBeEnabled();
    await input(page).press('Enter');
    await expect(upNext(page)).toHaveText(['Audit the relay probe retries']);
    expect(w.posts).toEqual([
      { path: `/api/projects/${PROJECT.id}/todos`, body: { title: '', spec: 'Audit the relay probe retries' } },
    ]);
    await expect(panel(page).getByRole('tab', { name: '接下来' })).toHaveAttribute('aria-selected', 'true');
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue('');
    await expect(submit(page)).toBeDisabled();
    await page.keyboard.type('Draft the release notes');
    await submit(page).click();
    await expect(upNext(page)).toHaveText(['Draft the release notes', 'Audit the relay probe retries']);
    expect(w.posts).toHaveLength(2);
    await expect(input(page)).toHaveValue('');
    await expect(input(page)).toBeFocused();
    await expect(field(page)).toHaveCSS('outline-style', 'solid');
    expect(sent).toEqual([]);
    await expect(page.locator('.chief-composer textarea')).toHaveValue('');
    await expect(page).not.toHaveURL(/thread=/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await evidencePanelShot(page, `tasks-add-saved-${theme}.png`, panel(page));
  });
}

test('an empty or blank field submits nothing', async ({ page }) => {
  const w = world();
  await open(page, w);
  await plus(page).click();
  await expect(submit(page)).toBeDisabled();
  await input(page).press('Enter');
  await input(page).fill('   ');
  await expect(submit(page)).toBeDisabled();
  await input(page).press('Enter');
  await page.waitForTimeout(300);
  expect(w.posts).toEqual([]);
  await expect(field(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(panel(page).getByRole('tab', { name: '进行中' })).toHaveAttribute('aria-selected', 'true');
});

test('Escape closes the field and keeps the panel; the plus button closes it too', async ({ page }) => {
  const w = world();
  await open(page, w);
  await plus(page).click();
  await input(page).fill('Half a thought');
  await page.keyboard.press('Escape');
  await expect(field(page)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(plus(page)).toHaveAttribute('aria-pressed', 'false');
  await plus(page).click();
  await expect(input(page)).toHaveValue('');
  await plus(page).click();
  await expect(field(page)).toHaveCount(0);
  expect(w.posts).toEqual([]);
});

test('a refused save keeps the text in the field and says so', async ({ page }) => {
  const w = world();
  w.fail = true;
  await open(page, w);
  await plus(page).click();
  await input(page).fill('Audit the relay probe retries');
  await input(page).press('Enter');
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: '任务没有添加上，请重试。' })).toBeVisible();
  await expect(input(page)).toHaveValue('Audit the relay probe retries');
  await expect(field(page)).toBeVisible();
  await expect(panel(page).getByRole('tab', { name: '进行中' })).toHaveAttribute('aria-selected', 'true');
  await expect(upNext(page)).toHaveCount(0);
  w.fail = false;
  await input(page).press('Enter');
  await expect(upNext(page)).toHaveText(['Audit the relay probe retries']);
});

test('with several projects and none chosen the task goes to the Coordinator, which picks the project', async ({
  page,
}) => {
  const w = world({ projects: [PROJECT, { ...PROJECT, id: 'proj-2', name: 'relay' }] });
  const sent = await open(page, w);
  await plus(page).click();
  await input(page).fill('Audit the relay probe retries');
  await input(page).press('Enter');
  await expect.poll(() => sent).toEqual(['Audit the relay probe retries']);
  expect(w.posts).toEqual([]);
  await expect(field(page)).toHaveCount(0);
});

test('the empty list hides its own add button while the field is open', async ({ page }) => {
  const w = world({ todos: [], tasks: [] });
  await open(page, w);
  const empty = panel(page).getByTestId('tasks-empty');
  await empty.getByRole('button', { name: '添加任务' }).click();
  await expect(input(page)).toBeFocused();
  await expect(empty).toHaveCount(0);
  await input(page).fill('Audit the relay probe retries');
  await input(page).press('Enter');
  await expect(upNext(page)).toHaveText(['Audit the relay probe retries']);
  await expect(input(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field(page)).toHaveCount(0);
  await expect(upNext(page)).toHaveText(['Audit the relay probe retries']);
});
