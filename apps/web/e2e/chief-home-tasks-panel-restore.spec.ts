import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, TASK, taskEntry, THREAD } from './chief-home-mock.js';
import { pressOpenCoordinator } from './helpers.js';

const HOME = '/app?scenario=home-c';

const panel = (page: Page) => page.getByRole('complementary', { name: '任务' });
const tab = (page: Page, name: string) => panel(page).getByRole('tab', { name });

async function liveTasks(page: Page, created: Promise<void> = Promise.resolve()) {
  let made = 0;
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [],
      todos: [TASK],
      tasks: [taskEntry({ section: 'working', title: TASK.title })],
    },
    (path, route, json) => {
      const match = /^\/api\/projects\/([^/]+)\/todos$/.exec(path);
      if (match === null || route.request().method() !== 'POST') return undefined;
      made += 1;
      const record = taskEntry({
        id: `todo-made-${made}`,
        projectId: match[1],
        title: 'Made from the panel',
        spec: 'Made from the panel',
        phase: 'todo',
        phaseAt: Date.now(),
        seqNum: 40 + made,
        latestBuildId: null,
        section: 'up_next',
      });
      return created.then(() => json(record, 201));
    },
  );
  await page.goto('/app?pane=tasks');
  await expect(panel(page)).toBeVisible();
}

async function addTask(page: Page) {
  await panel(page).getByTestId('tasks-new').click();
  await panel(page).getByTestId('tasks-add-input').fill('Made from the panel');
  await panel(page).getByTestId('tasks-add-input').press('Enter');
}

test('the task tab last chosen is the one the Tasks panel opens on after a reload', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=tasks`);
  await expect(tab(page, '进行中')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '已完成').click();
  await expect(tab(page, '已完成')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(tab(page, '已完成')).toHaveAttribute('aria-selected', 'true');
});

test('a created task shows Next for now, but a reload opens the tab the user chose', async ({
  page,
}) => {
  await liveTasks(page);
  await tab(page, '已完成').click();
  await addTask(page);
  await expect(tab(page, '接下来')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(tab(page, '已完成')).toHaveAttribute('aria-selected', 'true');
});

test('clicking the tab already shown after a create keeps it after a reload', async ({ page }) => {
  await liveTasks(page);
  await tab(page, '已完成').click();
  await addTask(page);
  await expect(tab(page, '接下来')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '接下来').click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('cairn.tasks-tab')))
    .toBe('next');
  await page.reload();
  await expect(panel(page)).toBeVisible();
  await expect(tab(page, '接下来')).toHaveAttribute('aria-selected', 'true');
});

test('a tab chosen while a task is still being created keeps its selection and focus when it lands', async ({
  page,
}) => {
  let land: () => void = () => {};
  const landed = new Promise<void>((resolve) => {
    land = resolve;
  });
  await liveTasks(page, landed);
  const posted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/todos'),
  );
  await addTask(page);
  await posted;
  await tab(page, '已完成').click();
  land();
  const input = panel(page).getByTestId('tasks-add-input');
  await expect(input).toHaveValue('');
  await expect(input).toBeEditable();
  await expect(tab(page, '已完成')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, '已完成')).toBeFocused();
});

test('a drag abandoned by leaving the panel with Cmd+J does not resize the next panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mockLive(page, { threads: [THREAD], messages: [] });
  await page.goto('/app?pane=tasks');
  const handle = page.getByTestId('side-panel-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  const box = await handle.boundingBox();
  if (box === null) throw new Error('resize handle has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 50, y);
  await page.mouse.move(x - 100, y);
  await expect(handle).toHaveAttribute('aria-valuenow', '520');
  await pressOpenCoordinator(page);
  await expect(panel(page)).toHaveCount(0);
  await page.mouse.up();
  await page.goBack();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('side-panel-resize')).toHaveAttribute('aria-valuenow', '420');
});

async function handleCenter(page: Page) {
  const box = await page.getByTestId('side-panel-resize').boundingBox();
  if (box === null) throw new Error('resize handle has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('pressing the resize handle without moving it stores nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded') === null) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('cairn.side-panel-width', '2000');
    }
    const writes: string[] = [];
    Object.assign(window, { widthWrites: writes });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'cairn.side-panel-width') writes.push(value);
      setItem.call(this, key, value);
    };
  });
  await mockLive(page, { threads: [THREAD], messages: [] });
  await page.goto('/app?pane=tasks');
  const handle = page.getByTestId('side-panel-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '864');
  const { x, y } = await handleCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as { widthWrites: string[] }).widthWrites)).toEqual(
    [],
  );
  expect(await page.evaluate(() => localStorage.getItem('cairn.side-panel-width'))).toBe('2000');
});

test('a drag that ends back where it started keeps the width it started at', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mockLive(page, { threads: [THREAD], messages: [] });
  await page.goto('/app?pane=tasks');
  const handle = page.getByTestId('side-panel-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  const { x, y } = await handleCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y);
  await expect(handle).toHaveAttribute('aria-valuenow', '520');
  await page.mouse.move(x, y);
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await page.mouse.up();
  await page.reload();
  await expect(page.getByTestId('side-panel-resize')).toHaveAttribute('aria-valuenow', '420');
});

test('a keyboard resize made during a drag stands when the drag is abandoned with Cmd+J', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mockLive(page, { threads: [THREAD], messages: [] });
  await page.goto('/app?pane=tasks');
  const handle = page.getByTestId('side-panel-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  const { x, y } = await handleCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y);
  await expect(handle).toHaveAttribute('aria-valuenow', '520');
  await handle.focus();
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '864');
  await pressOpenCoordinator(page);
  await expect(panel(page)).toHaveCount(0);
  await page.mouse.up();
  await page.goBack();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('side-panel-resize')).toHaveAttribute('aria-valuenow', '864');
});

test('a drag the system cancels goes back to the width from before it and stores nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mockLive(page, { threads: [THREAD], messages: [] });
  await page.goto('/app?pane=tasks');
  const handle = page.getByTestId('side-panel-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  const { x, y } = await handleCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y);
  await expect(handle).toHaveAttribute('aria-valuenow', '520');
  await handle.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem('cairn.side-panel-width'))).toBeNull();
  await page.reload();
  await expect(page.getByTestId('side-panel-resize')).toHaveAttribute('aria-valuenow', '420');
});

test.describe('a touch screen', () => {
  test.use({ hasTouch: true });

  async function touchScreen(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    return {
      press: (x: number, y: number) =>
        cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
      move: (x: number, y: number) =>
        cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }),
      lift: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    };
  }

  type TouchWindow = Window & { touchPointer?: number };

  async function watchFingerCapture(handle: Locator) {
    await handle.evaluate((el) => {
      el.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'touch') (window as TouchWindow).touchPointer = event.pointerId;
      });
    });
    return () =>
      handle.evaluate((el) => {
        const id = (window as TouchWindow).touchPointer;
        return id !== undefined && el.hasPointerCapture(id);
      });
  }

  async function openPanel(page: Page) {
    await page.setViewportSize({ width: 1440, height: 800 });
    await mockLive(page, { threads: [THREAD], messages: [] });
    await page.goto('/app?pane=tasks');
    const handle = page.getByTestId('side-panel-resize');
    await expect(handle).toHaveAttribute('aria-valuenow', '420');
    return handle;
  }

  test('a finger pressed during a mouse drag neither takes over nor leaves a width behind', async ({
    page,
  }) => {
    const handle = await openPanel(page);
    const finger = await touchScreen(page);
    const { x, y } = await handleCenter(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 100, y);
    await expect(handle).toHaveAttribute('aria-valuenow', '520');
    const moved = await handleCenter(page);
    await finger.press(moved.x, moved.y);
    await finger.lift();
    await expect(handle).toHaveAttribute('aria-valuenow', '520');
    await page.mouse.move(x - 60, y);
    await expect(handle).toHaveAttribute('aria-valuenow', '480');
    await pressOpenCoordinator(page);
    await expect(panel(page)).toHaveCount(0);
    await page.mouse.up();
    await page.goBack();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId('side-panel-resize')).toHaveAttribute('aria-valuenow', '420');
    expect(await page.evaluate(() => localStorage.getItem('cairn.side-panel-width'))).toBeNull();
  });

  test('closing another panel under a moving finger keeps the mouse drag on this panel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(
      '/app?scenario=chief-files-long&pane=made&file=team-files/att-verify-log.log&fileName=verify-3877.log',
    );
    const filePanel = page.getByTestId('file-panel');
    const fileHandle = filePanel.getByTestId('side-panel-resize');
    const madeHandle = page.locator(
      'aside:not([data-testid="file-panel"]) [data-testid="side-panel-resize"]',
    );
    await expect(fileHandle).toBeVisible();
    await expect(madeHandle).toBeVisible();
    await expect(madeHandle).toHaveAttribute('aria-valuenow', '420');
    const finger = await touchScreen(page);
    const made = await madeHandle.boundingBox();
    if (made === null) throw new Error('Made handle has no box');
    const x = made.x + made.width / 2;
    const y = made.y + made.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 100, y);
    await expect(madeHandle).toHaveAttribute('aria-valuenow', '520');
    const file = await fileHandle.boundingBox();
    if (file === null) throw new Error('file handle has no box');
    await finger.press(file.x + file.width / 2, file.y + file.height / 2);
    await finger.move(file.x + file.width / 2 - 30, file.y + file.height / 2);
    await page.keyboard.press('Escape');
    await expect(filePanel).toHaveCount(0);
    await expect(madeHandle).toHaveAttribute('aria-valuenow', '520');
    await finger.lift();
    await page.mouse.up();
    await expect(madeHandle).toHaveAttribute('aria-valuenow', '520');
    expect(await page.evaluate(() => localStorage.getItem('cairn.side-panel-width'))).toBe('520');
  });

  test('a double-click reset ends a finger drag, so the finger cannot overwrite it', async ({
    page,
  }) => {
    const handle = await openPanel(page);
    const finger = await touchScreen(page);
    const fingerCaptured = await watchFingerCapture(handle);
    const { x, y } = await handleCenter(page);
    await finger.press(x, y);
    await finger.move(x - 100, y);
    await expect(handle).toHaveAttribute('aria-valuenow', '520');
    expect(await fingerCaptured()).toBe(true);
    const moved = await handleCenter(page);
    await page.mouse.dblclick(moved.x, moved.y);
    await expect(handle).toHaveAttribute('aria-valuenow', '420');
    expect(await fingerCaptured()).toBe(false);
    await finger.move(x - 150, y);
    await finger.lift();
    await expect(handle).toHaveAttribute('aria-valuenow', '420');
    expect(await page.evaluate(() => localStorage.getItem('cairn.side-panel-width'))).toBe('420');
  });

  test('a keyboard resize ends a finger drag, so the finger cannot overwrite it', async ({
    page,
  }) => {
    const handle = await openPanel(page);
    const finger = await touchScreen(page);
    const fingerCaptured = await watchFingerCapture(handle);
    const { x, y } = await handleCenter(page);
    await finger.press(x, y);
    await finger.move(x - 100, y);
    await expect(handle).toHaveAttribute('aria-valuenow', '520');
    expect(await fingerCaptured()).toBe(true);
    await handle.focus();
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '360');
    expect(await fingerCaptured()).toBe(false);
    await finger.move(x - 150, y);
    await finger.lift();
    await expect(handle).toHaveAttribute('aria-valuenow', '360');
    expect(await page.evaluate(() => localStorage.getItem('cairn.side-panel-width'))).toBe('360');
  });
});
