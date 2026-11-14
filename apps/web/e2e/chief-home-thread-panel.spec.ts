import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';
const panel = (page: Page) => page.getByTestId('side-chat');

test('a review thread keeps its updates out of the conversation and in the plan dialog, and the head shows the update count', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('thread-updates')).toHaveCount(0);
  await expect(page.getByTestId('side-chat-status')).toContainText('待你决定·1 条更新');
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  await page.getByRole('menuitem', { name: '计划' }).click();
  const plan = page.getByTestId('side-chat-plan');
  await expect(plan.getByTestId('thread-updates')).toContainText('决定与更新');
  await expect(plan.getByTestId('thread-updates')).toContainText('r7 rebaseline probe');
  await expect(plan.getByTestId('thread-updates').locator('time')).toContainText('更新');
  await expect(plan.getByTestId('doc-body')).toBeVisible();
});

test('a working thread has no updates and no plan row in the more menu', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-c`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('thread-updates')).toHaveCount(0);
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  await expect(page.getByRole('menuitem', { name: '计划' })).toHaveCount(0);
});

test('the origin line is one right-aligned link that scrolls the conversation to the request', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(page.getByTestId('thread-origin')).toHaveText('在主对话中查看');
  const [origin, jump, request] = await Promise.all([
    page.getByTestId('thread-origin').boundingBox(),
    page.getByTestId('thread-origin-jump').boundingBox(),
    page.getByTestId('thread-request').boundingBox(),
  ]);
  expect(Math.round((jump?.x ?? 0) + (jump?.width ?? 0))).toBe(
    Math.round((origin?.x ?? 0) + (origin?.width ?? 0)),
  );
  expect(
    Math.abs((jump?.x ?? 0) + (jump?.width ?? 0) - ((request?.x ?? 0) + (request?.width ?? 0))),
  ).toBeLessThanOrEqual(8);
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

test('a task waiting for review has no chip above the composer; finishing lives in the more menu', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId('side-chat-action')).toHaveCount(0);
  await expect(
    page.locator('.side-panel').getByRole('button', { name: /^(完成…|完成|标记完成)$/ }),
  ).toHaveCount(0);
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  await page.getByRole('menuitem', { name: '完成' }).click();
  await expect(page.getByRole('dialog', { name: '完成任务' })).toBeVisible();
});

test('a plan waiting for approval shows no plan card or plan update in the conversation', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-confirm`);
  await expect(page.getByTestId('side-chat-action')).toHaveAttribute('data-action', 'approve');
  await expect(page.getByTestId('transcript-col')).not.toContainText('方案');
  await expect(page.getByRole('button', { name: '打开方案' })).toHaveCount(0);
  await page.getByTestId('side-chat-action').getByRole('button', { name: '查看计划' }).click();
  await expect(page.getByTestId('side-chat-plan')).toBeVisible();
});

test('a plan waiting for approval shows its chips like the suggested replies, 24px above the composer', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-confirm`);
  const note = page.getByTestId('side-chat-action');
  await expect(note).toHaveAttribute('data-action', 'approve');
  await expect(note.getByRole('button')).toHaveText(['批准计划', '查看计划']);
  await expect(note).not.toContainText('计划已就绪');
  const face = await note.evaluate((el) => {
    const [first, second] = [...el.querySelectorAll('button')].map((node) =>
      node.getBoundingClientRect(),
    );
    const card = document
      .querySelector('.side-panel [data-testid="composer-card"]')!
      .getBoundingClientRect();
    const button = el.querySelector('button')!;
    return {
      shadow: getComputedStyle(el).boxShadow,
      fill: getComputedStyle(el).backgroundColor,
      buttonFill: getComputedStyle(button).backgroundColor,
      height: first?.height,
      between: Math.round((second?.left ?? 0) - (first?.right ?? 0)),
      leftOfComposer: Math.round((first?.left ?? 0) - card.left),
      aboveComposer: Math.round(card.top - (first?.bottom ?? 0)),
    };
  });
  expect(face).toEqual({
    shadow: 'none',
    fill: 'rgba(0, 0, 0, 0)',
    buttonFill: 'rgba(0, 0, 0, 0)',
    height: 28,
    between: 12,
    leftOfComposer: 0,
    aboveComposer: 24,
  });
  const main = await page.getByTestId('home-c').evaluate((el) => {
    const chips = [...el.querySelectorAll('[data-testid="chief-question-chips"] button')]
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.height === 28);
    const card = el.querySelector('.chief-composer')!.getBoundingClientRect();
    return {
      between: Math.round((chips[1]?.left ?? 0) - (chips[0]?.right ?? 0)),
      aboveComposer: Math.round(card.top - (chips[0]?.bottom ?? 0)),
    };
  });
  expect(main).toEqual({ between: face.between, aboveComposer: face.aboveComposer });
});

test('the thread composer is the main composer: the field, then a tool row with plus under it', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await expect(panel(page)).toBeVisible();
  const read = (scope: string, field: string) =>
    page.evaluate(
      ([scopeSel, fieldSel]) => {
        const root = document.querySelector(scopeSel as string)!;
        const card = root.querySelector(fieldSel as string)!;
        const box = card.getBoundingClientRect();
        const plus = [...root.querySelectorAll('[data-testid="composer-plus"]')]
          .map((node) => node.getBoundingClientRect())
          .find((rect) => rect.width > 0)!;
        const input = card.querySelector('textarea')!.getBoundingClientRect();
        const style = getComputedStyle(card);
        return {
          height: Math.round(box.height),
          radius: style.borderTopLeftRadius,
          fill: style.backgroundColor,
          shadow: style.boxShadow,
          inputInset: Math.round(input.left - box.left),
          plusInField: card.querySelector('[data-testid="composer-plus"]') !== null,
          plusBelow: Math.round(plus.top - box.bottom),
          plusInset: Math.round(plus.left - box.left),
          plusSize: Math.round(plus.width),
        };
      },
      [scope, field] as const,
    );
  const thread = await read('.side-panel', '[data-testid="composer-card"]');
  const main = await read('[data-testid="home-c"]', '.chief-composer');
  expect(thread).toEqual(main);
  expect(thread).toMatchObject({ height: 46, plusInField: false, plusBelow: 6, plusSize: 28 });
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
      menuMid: (() => {
        const menu = box(el.querySelector('button[aria-haspopup="menu"]'));
        return (menu?.top ?? 0) + (menu?.height ?? 0) / 2;
      })(),
      controls: [...el.querySelectorAll('button')].map(
        (node) => node.getAttribute('aria-label') ?? node.textContent,
      ),
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
  expect(Math.abs(geometry.menuMid - geometry.titlesMid)).toBeLessThanOrEqual(2);
  expect(geometry.controls).toEqual(['返回', '更多操作…', '关闭']);
  expect(geometry.statusInk).toBe(geometry.waitInk);
  await expect(title).toHaveText('Fold finished turns into purpose and duration');
  await expect(title).toHaveAccessibleName('Fold finished turns into purpose and duration');
  const lead = await head.evaluate((el) => {
    const h2 = el.querySelector('h2')!;
    const tile = el.querySelector('[data-slot="side-chat-glyph"]')!;
    const back = el.querySelector('[data-testid="side-chat-back"] svg')!.getBoundingClientRect();
    const box = tile.getBoundingClientRect();
    const probe = document.createElement('span');
    probe.style.color = 'var(--foreground)';
    document.body.appendChild(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const body = document.querySelector('.side-panel [data-testid="agent-text"]');
    return {
      tile: [Math.round(box.width), Math.round(box.height)],
      tileBorder: getComputedStyle(tile).borderTopWidth,
      tileRing: getComputedStyle(tile).boxShadow !== 'none',
      glyph: Math.round(tile.querySelector('svg')!.getBoundingClientRect().width),
      chevronToTile: Math.round(box.left - (back.left + back.width / 2)),
      tileToTitle: Math.round(h2.getBoundingClientRect().left - box.right),
      titleInk: getComputedStyle(h2).color === ink,
      titleSize: getComputedStyle(h2).fontSize,
      bodySize: body === null ? '' : getComputedStyle(body).fontSize,
    };
  });
  expect(lead).toEqual({
    tile: [24, 24],
    tileBorder: '0px',
    tileRing: true,
    glyph: 16,
    chevronToTile: 26,
    tileToTitle: 12,
    titleInk: true,
    titleSize: lead.bodySize,
    bodySize: lead.bodySize,
  });
  await title.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    'Fold finished turns into purpose and duration',
  );
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
});

test('the more menu offers rename and move beside the existing actions, and no usage item', async ({
  page,
}) => {
  await page.goto(`${HOME}&thread=home-c-review`);
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /重命名/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /用量/ })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: /重命名/ }).click();
  await expect(page.getByRole('dialog', { name: '重命名任务' })).toBeVisible();
  await expect(page.getByTestId('task-rename-input')).toHaveValue(
    'Fold finished turns into purpose and duration',
  );
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeVisible();
  await page.goto(`${HOME}&thread=home-c-idle`);
  await panel(page).getByRole('button', { name: '更多操作…' }).click();
  await expect(page.getByRole('menuitem', { name: /移到项目/ })).toBeVisible();
});

test('a running thread ends in a reply bubble of three typing dots', async ({ page }) => {
  await page.goto(`${HOME}&thread=home-c-working-c`);
  const live = page.locator('.side-panel').getByTestId('live-row');
  await expect(live).toHaveCount(1);
  await expect(live).toHaveAttribute('role', 'status');
  await expect(live).toHaveText('处理中...');
  await expect(live.getByTestId('typing-dot')).toHaveCount(3);
  await expect(live.getByTestId('typing-dot').first()).toHaveCSS('animation-name', 'typing-hop');
  await expect(page.getByTestId('live-pulse')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(live.getByTestId('typing-dot').first()).toHaveCSS('animation-name', 'none');
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
