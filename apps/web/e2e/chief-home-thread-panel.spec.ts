import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';
const panel = (page: Page) => page.getByTestId('side-chat');

test('a review thread leads with the updates block and shows the update count in the head', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(page.getByTestId('thread-updates')).toContainText('决定与更新');
  await expect(page.getByTestId('thread-updates')).toContainText('r7 rebaseline probe');
  await expect(page.getByTestId('thread-updates').locator('time')).toContainText('更新');
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定·1 条更新');
});

test('a working thread has no updates block', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-c`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('thread-updates')).toHaveCount(0);
});

test('the origin line names the main-chat message and scrolls the conversation to it', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(page.getByTestId('thread-origin')).toContainText('来自主对话 · ');
  await page.getByTestId('thread-origin-jump').click();
  await expect(
    page.locator('[data-testid="home-c"] [data-reply-source="home-c-ask-fold"]'),
  ).toBeInViewport();
});

test('a thread with no originating message shows no origin line', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-a`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('thread-origin')).toHaveCount(0);
});

test('a task waiting for review offers finishing once, as one outlined chip above the composer', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  const note = page.getByTestId('side-chat-action');
  await expect(note).toHaveAttribute('data-action', 'finish');
  await expect(page.locator('.side-panel').getByRole('button', { name: /^(完成…|标记完成)$/ })).toHaveCount(1);
  const face = await note.evaluate((el) => {
    const button = el.querySelector('button')!;
    return {
      shadow: getComputedStyle(el).boxShadow,
      fill: getComputedStyle(el).backgroundColor,
      buttonFill: getComputedStyle(button).backgroundColor,
    };
  });
  expect(face).toEqual({
    shadow: 'none',
    fill: 'rgba(0, 0, 0, 0)',
    buttonFill: 'rgba(0, 0, 0, 0)',
  });
  await expect(note).not.toContainText('已就绪，等你审阅');
  await note.getByRole('button', { name: '完成…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a working thread offers no action note', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-c`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('side-chat-action')).toHaveCount(0);
});

test('back returns to the tasks list and close leaves the panel area empty', async ({ page }) => {
  await page.goto(`${HOME}&pane=tasks&thread=home-c-review`);
  await panel(page).getByTestId('side-chat-back').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '任务' })).toBeVisible();
  await page.goto(`${HOME}&pane=tasks&thread=home-c-review`);
  await panel(page).getByRole('button', { name: '关闭' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '任务' })).toHaveCount(0);
});

test('an unread thread shows a dot on its task reference, and opening the thread clears it', async ({
  page,
}) => {
  await page.goto('/app?scenario=home-c-unread');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref').filter({ hasText: 'Orb canary round 7' });
  await expect(ref).toHaveCount(1);
  await expect(ref.locator('[data-slot="task-ref-unread"]')).toBeVisible();
  await expect(ref.locator('[data-slot="task-ref-unread"]')).toHaveAccessibleName('有新动态');
  await expect(
    stream
      .getByTestId('chief-task-ref')
      .filter({ hasText: 'Fold finished turns' })
      .locator('[data-slot="task-ref-unread"]'),
  ).toHaveCount(0);
  await ref.click();
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(ref.locator('[data-slot="task-ref-unread"]')).toHaveCount(0);
});

test('the panel width is resizable and remembered', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  const handle = page.getByTestId('side-panel-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '420');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).not.toHaveAttribute('aria-valuenow', '420');
  await page.reload();
  await expect(page.getByTestId('side-panel-resize')).not.toHaveAttribute('aria-valuenow', '420');
});

test('the head is one calm row: a one-line title, the status in the task tone, controls centred on it', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  const head = panel(page);
  const title = head.locator('h2');
  await expect(title).toContainText('Fold finished turns into purpose and duration');
  const geometry = await head.evaluate((el) => {
    const box = (node: Element | null) => node?.getBoundingClientRect() ?? null;
    const h2 = el.querySelector('h2');
    const titles = el.querySelector('[data-slot="side-chat-titles"]');
    const close = [...el.querySelectorAll('button')].at(-1) ?? null;
    const word = el.querySelector('[data-testid="side-chat-status"] > span');
    return {
      titleHeight: box(h2)?.height ?? 0,
      titlesMid: (box(titles)?.top ?? 0) + (box(titles)?.height ?? 0) / 2,
      closeMid: (box(close)?.top ?? 0) + (box(close)?.height ?? 0) / 2,
      changesMid: (() => {
        const changes = box(el.querySelector('[data-testid="side-chat-changes"]'));
        return (changes?.top ?? 0) + (changes?.height ?? 0) / 2;
      })(),
      statusInk: word === null ? '' : getComputedStyle(word).color,
      waitInk: (() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--task-wait-ink)';
        document.body.appendChild(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        return ink;
      })(),
    };
  });
  expect(geometry.titleHeight).toBeLessThanOrEqual(22);
  expect(Math.abs(geometry.closeMid - geometry.titlesMid)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.changesMid - geometry.titlesMid)).toBeLessThanOrEqual(2);
  expect(geometry.statusInk).toBe(geometry.waitInk);
  await expect(page.getByTestId('thread-usage')).toHaveCount(0);
});

test('the request shows once as an owner bubble with its origin under it, and replies sit in reply bubbles', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  const request = page.getByTestId('thread-request');
  await expect(request).toHaveText('Fold finished turns before review.');
  await expect(page.getByTestId('thread-purpose')).toHaveCount(0);
  await expect(page.locator('.side-panel').getByText('Fold finished turns before review.')).toHaveCount(1);
  const [bubbleBox, originBox] = await Promise.all([
    request.boundingBox(),
    page.getByTestId('thread-origin').boundingBox(),
  ]);
  expect((originBox?.y ?? 0) - ((bubbleBox?.y ?? 0) + (bubbleBox?.height ?? 0))).toBeLessThan(12);
  const fills = await page
    .getByTestId('transcript-col')
    .locator('[data-slot="reply-bubble"]')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  const replyFill = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--reply-bubble-fill)';
    document.body.appendChild(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return fill;
  });
  expect(fills.length).toBeGreaterThan(0);
  expect(new Set(fills)).toEqual(new Set([replyFill]));
  const updates = await page
    .getByTestId('thread-updates')
    .evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(updates).toBe('0px');
});

test('the more menu offers rename, move and usage beside the existing actions', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /重命名/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /重命名/ }).click();
  await expect(page.getByRole('dialog', { name: '重命名任务' })).toBeVisible();
  await expect(page.getByTestId('task-rename-input')).toHaveValue(
    'Fold finished turns into purpose and duration',
  );
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  await page.getByRole('menuitem', { name: /用量/ }).click();
  await expect(page.getByRole('dialog', { name: '用量' }).getByTestId('thread-usage')).toBeVisible();
  await page.goto(`${HOME}&thread=home-c-idle`);
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  await expect(page.getByRole('menuitem', { name: /移到项目/ })).toBeVisible();
});

test.describe('phone width thread', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('an open task covers the whole screen, chrome and tab bar included', async ({ page }) => {
    await page.goto(`${HOME}&thread=home-c-review`);
    await expect(panel(page)).toBeVisible();
    await page
      .locator('.side-panel')
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = await page.locator('aside.side-panel').boundingBox();
    expect({
      x: Math.round(box?.x ?? -1),
      y: Math.round(box?.y ?? -1),
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0),
    }).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    const tabs = page.locator('[data-slot="phone-tabs"]');
    if ((await tabs.count()) > 0) {
      const covered = await tabs.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit?.closest('aside.side-panel') !== null;
      });
      expect(covered).toBe(true);
    }
  });
});
