import { expect, test } from '@playwright/test';
import { mockLive, TASK as BASE_TASK, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const TASK = { ...BASE_TASK, title: 'Read the cairn repo', phase: 'building' };

test('a reply that mentions a task gets a reference row and a status chip that open the thread', async ({
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
  await expect(stream.locator('a.mention-chip svg[data-glyph="progress"]')).toHaveCount(1);
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

test('no status word trails the title: the glyph and the accessible name carry the state, and chips keep the line height', async ({
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
  const chip = stream.locator('a.mention-chip--todo');
  const tile = ref.locator('span.grid');
  await expect(tile).toHaveCSS('width', '20px');
  const heights = await chip.evaluate((el) => {
    const p = el.closest('p');
    if (p === null) return null;
    const clone = p.cloneNode(true) as HTMLElement;
    clone.querySelector('a.mention-chip--todo')?.replaceWith(document.createTextNode('x'));
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
  test(`a task waiting for the owner shows the green eye on a grey chip with link ink (${theme})`, async ({
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
    const chip = stream.locator('a.mention-chip--todo');
    const eye = chip.locator('[data-glyph="eye"]');
    await expect(eye).toHaveCount(1);
    await expect(eye).toHaveAccessibleName('Review');
    const tokens = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const read = (prop: 'color' | 'backgroundColor', value: string) => {
        probe.style[prop] = value;
        return getComputedStyle(probe)[prop];
      };
      const out = {
        fill: read('backgroundColor', 'var(--task-chip-fill)'),
        link: read('color', 'var(--chat-link)'),
        tint: read('backgroundColor', 'var(--task-wait-tint)'),
        ink: read('color', 'var(--task-wait-ink)'),
      };
      probe.remove();
      return out;
    });
    await expect(chip).toHaveCSS('background-color', tokens.fill);
    await expect(chip).toHaveCSS('color', tokens.link);
    await expect(eye).toHaveCSS('background-color', tokens.tint);
    await expect(eye).toHaveCSS('color', tokens.ink);
    await expect(stream.getByTestId('chief-task-ref').locator('[data-glyph="eye"]')).toHaveCount(1);
    await stream.screenshot({ path: testInfo.outputPath(`waiting-chip-${theme}.png`) });
  });
}

test('the reference row sits like the reference: indented tile, elbow hooked from the bubble edge, regular title', async ({
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
    const elbow = row.querySelector('[data-slot="task-ref-elbow"]')!;
    const e = box(elbow);
    const title = row.querySelector('span.truncate')!;
    const cs = getComputedStyle(elbow);
    return {
      tileLeft: tile.left - bubble.left,
      tileSize: [tile.width, tile.height],
      tileToBubble: bubble.top - tile.bottom,
      elbowLeft: e.left - bubble.left,
      elbowTop: e.top - (tile.top + tile.height / 2),
      elbowToBubble: bubble.top - e.bottom,
      elbowRight: e.right - tile.left,
      stroke: cs.borderLeftWidth,
      radius: cs.borderTopLeftRadius,
      titleGap: box(title).left - tile.right,
      weight: getComputedStyle(title).fontWeight,
      size: getComputedStyle(title).fontSize,
    };
  });
  expect(g.tileLeft).toBe(32);
  expect(g.tileSize).toEqual([20, 20]);
  expect(g.tileToBubble).toBe(8);
  expect(g.elbowLeft).toBe(18);
  expect(g.elbowTop).toBe(0);
  expect(g.elbowToBubble).toBe(2);
  expect(g.elbowRight).toBeGreaterThanOrEqual(0);
  expect(g.stroke).toMatch(/^1(\.5)?px$/);
  expect(g.radius).toBe('8px');
  expect(g.titleGap).toBe(6);
  expect(g.weight).toBe('400');
  expect(g.size).toBe('14px');
});
