import { expect, test } from '@playwright/test';
import { mockLive, TASK as BASE_TASK, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const TASK = { ...BASE_TASK, title: 'Read the cairn repo', phase: 'building' };

test('a reply that mentions a task gets one reference row with the state, and the mention is the title as a plain link', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'Look at the repo', createdAt: 10 },
      {
        id: 'm2',
        role: 'assistant',
        content: `Started [#${TASK.seqNum}](todo:${TASK.id}) and it is reading the repo.`,
        createdAt: 13,
      },
    ],
    todos: [TASK],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref');
  await expect(ref).toHaveCount(1);
  await expect(ref).toContainText('Read the cairn repo');
  await expect(ref.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await expect(ref).not.toContainText('In progress');
  await expect(ref).toHaveAccessibleName(/Read the cairn repo.*Running/);
  const mention = stream.locator('a[data-slot="task-mention"]');
  await expect(mention).toHaveText('Read the cairn repo');
  await expect(mention.locator('svg')).toHaveCount(0);
  await expect(stream.locator('.mention-chip--todo')).toHaveCount(0);
  await expect(stream.locator('svg[data-glyph="progress"]')).toHaveCount(1);
  await expect(mention).toHaveAttribute('href', new RegExp(`thread=${TASK.id}`));
  await ref.click();
  await expect(page).toHaveURL(new RegExp(`thread=${TASK.id}`));
});

test('a reply with no task reference has no reference row', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [{ id: 'm2', role: 'assistant', content: 'Nothing to dispatch.', createdAt: 13 }],
    todos: [TASK],
    tasks: [],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream').getByText('Nothing to dispatch.')).toBeVisible();
  await expect(page.getByTestId('chief-task-ref')).toHaveCount(0);
});

test('no status word trails the title: the glyph and the accessible name carry the state, and the mention keeps the line height', async ({
  page,
}) => {
  const done = { ...TASK, phase: 'done' };
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      {
        id: 'm2',
        role: 'assistant',
        content: `Started [#${done.seqNum}](todo:${done.id}) and it is reading the repo.`,
        createdAt: 13,
      },
    ],
    todos: [done],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref');
  await expect(ref).toContainText('Read the cairn repo');
  await expect(ref).not.toContainText('In progress');
  await expect(ref).toHaveAccessibleName(/Read the cairn repo.*Done/);
  await expect(ref.locator('svg[data-glyph="done"]')).toHaveCount(1);
  const mention = stream.locator('a[data-slot="task-mention"]');
  const tile = ref.locator('span.grid');
  await expect(tile).toHaveCSS('width', '20px');
  const heights = await mention.evaluate((el) => {
    const p = el.closest('p');
    if (p === null) return null;
    const clone = p.cloneNode(true) as HTMLElement;
    clone.querySelector('a[data-slot="task-mention"]')?.replaceWith(document.createTextNode('x'));
    p.after(clone);
    const result = [p.getBoundingClientRect().height, clone.getBoundingClientRect().height];
    clone.remove();
    return result;
  });
  expect(heights?.[0]).toBe(heights?.[1]);
  await ref.focus();
  await expect(ref).toBeFocused();
  await expect(ref).toHaveAccessibleName(/Done|已完成|Read the cairn repo/);
});

for (const theme of ['light', 'dark'] as const) {
  test(`a task waiting for the owner shows the green eye on its reference row and link ink in the sentence (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    const waiting = { ...TASK, phase: 'review' };
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        {
          id: 'm2',
          role: 'assistant',
          content: `Ready: [#${waiting.seqNum}](todo:${waiting.id}) is up for review.`,
          createdAt: 13,
        },
      ],
      todos: [waiting],
      tasks: [],
    });
    await page.goto('/app');
    const stream = page.getByTestId('chief-stream');
    const mention = stream.locator('a[data-slot="task-mention"]');
    const eye = stream.getByTestId('chief-task-ref').locator('[data-glyph="eye"]');
    await expect(stream.locator('[data-glyph="eye"]')).toHaveCount(1);
    await expect(eye).toHaveAccessibleName('Review');
    const tokens = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const read = (prop: 'color' | 'backgroundColor', value: string) => {
        probe.style[prop] = value;
        return getComputedStyle(probe)[prop];
      };
      const out = {
        link: read('color', 'var(--chat-link)'),
        tint: read('backgroundColor', 'var(--task-wait-tint)'),
        ink: read('color', 'var(--task-wait-ink)'),
      };
      probe.remove();
      return out;
    });
    await expect(mention).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(mention).toHaveCSS('color', tokens.link);
    await expect(eye).toHaveCSS('background-color', tokens.tint);
    await expect(eye).toHaveCSS('color', tokens.ink);
    await stream.screenshot({ path: testInfo.outputPath(`waiting-task-${theme}.png`) });
  });
}

test('the reference row sits like the reference: indented tile, a rounded elbow clear of the bubble and the tile, regular title', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      {
        id: 'm2',
        role: 'assistant',
        content: `Started [#${TASK.seqNum}](todo:${TASK.id}) and it is reading the repo.`,
        createdAt: 13,
      },
    ],
    todos: [TASK],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const ref = stream.getByTestId('chief-task-ref');
  const g = await ref.evaluate((row) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const msg = row.closest('[data-testid="chief-msg"]')!;
    const bubble = box(msg.querySelector('[data-testid="chief-reply-bubble"]')!);
    const tile = box(row.querySelector('span.grid')!);
    const path = row.querySelector('[data-slot="task-ref-elbow"] path')!;
    const line = box(path);
    const cs = getComputedStyle(path);
    const probe = document.createElement('span');
    probe.style.color = 'var(--task-ref-line)';
    document.body.append(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    const title = row.querySelector('span.truncate')!;
    return {
      tileLeft: tile.left - bubble.left,
      tileSize: [tile.width, tile.height],
      tileToBubble: bubble.top - tile.bottom,
      lineX: line.left - bubble.left,
      lineTop: line.top - (tile.top + tile.height / 2),
      gapToTile: tile.left - (line.right + 0.75),
      gapToBubble: bubble.top - (line.bottom + 0.75),
      d: path.getAttribute('d'),
      stroke: cs.stroke,
      token,
      width: cs.strokeWidth,
      cap: cs.strokeLinecap,
      titleGap: box(title).left - tile.right,
      weight: getComputedStyle(title).fontWeight,
      size: getComputedStyle(title).fontSize,
    };
  });
  expect(g.tileLeft).toBe(32);
  expect(g.tileSize).toEqual([20, 20]);
  expect(g.tileToBubble).toBe(8);
  expect(g.lineX).toBeCloseTo(18, 0);
  expect(Math.abs(g.lineTop)).toBeLessThanOrEqual(0.5);
  expect(g.gapToTile).toBeGreaterThanOrEqual(3);
  expect(g.gapToBubble).toBeGreaterThanOrEqual(3.5);
  expect(g.d).toContain('A6 6');
  expect(g.stroke).toBe(g.token);
  expect(g.width).toBe('1.5px');
  expect(g.cap).toBe('round');
  expect(g.titleGap).toBe(6);
  expect(g.weight).toBe('400');
  expect(g.size).toBe('14px');
});
