import { expect, test } from '@playwright/test';
import { createTodoRow, mockLive, PROJECT, READY_MACHINE, TASK as BASE_TASK, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const TASK = { ...BASE_TASK, title: 'Read the cairn repo', phase: 'building' };

test('a reply that created a task gets one reference row with the state, and the mention is the title as a plain link', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'Look at the repo', createdAt: 10 },
      createTodoRow('m1b', TASK, 12),
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
      createTodoRow('m1b', done, 12),
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
        createTodoRow('m1b', waiting, 12),
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

test('a reply that only mentions a task it did not create gets no reference row', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      {
        id: 'm2',
        role: 'assistant',
        content: `Nothing started. [#${TASK.seqNum}](todo:${TASK.id}) is still queued.`,
        createdAt: 13,
      },
    ],
    todos: [TASK],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  await expect(stream.locator('a[data-slot="task-mention"]')).toHaveText('Read the cairn repo');
  await expect(stream.getByTestId('chief-task-ref')).toHaveCount(0);
});

test('sibling tasks hang off one unbroken trunk: one stroke width, one x, an elbow into each tile centre', async ({
  page,
}) => {
  const second = { ...TASK, id: 'todo-2', seqNum: 10, title: 'Rotate the relay token', phase: 'review' };
  const third = { ...TASK, id: 'todo-3', seqNum: 11, title: 'Pin the CI image', phase: 'queued' };
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      createTodoRow('m1a', TASK, 11),
      createTodoRow('m1b', second, 12),
      createTodoRow('m1c', third, 12),
      { id: 'm2', role: 'assistant', content: 'Started three tasks.', createdAt: 13 },
    ],
    todos: [TASK, second, third],
    tasks: [],
  });
  await page.goto('/app');
  const refs = page.getByTestId('chief-stream').getByTestId('chief-task-ref');
  await expect(refs).toHaveCount(3);
  const g = await page.getByTestId('chief-task-refs').evaluate((root) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const bubble = box(root.closest('[data-testid="chief-msg"]')!.querySelector('[data-testid="chief-reply-bubble"]')!);
    const rows = [...root.querySelectorAll('[data-testid="chief-task-ref"]')];
    const strokes = [...root.querySelectorAll('[data-slot="task-ref-guide"] line, [data-slot="task-ref-guide"] path')];
    const trunk = [...root.querySelectorAll('[data-slot="task-ref-trunk"]')].map(box);
    const elbows = [...root.querySelectorAll('[data-slot="task-ref-elbow"]')].map(box);
    return {
      widths: [...new Set(strokes.map((s) => getComputedStyle(s).strokeWidth))],
      colors: [...new Set(strokes.map((s) => getComputedStyle(s).stroke))],
      rowElbowSvgs: root.querySelectorAll('[data-testid="chief-task-ref"] svg[data-slot]').length,
      trunkX: [...new Set(trunk.map((t) => Math.round((t.left + t.width / 2 - bubble.left) * 100) / 100))],
      trunkGaps: trunk.slice(1).map((t, i) => t.top - trunk[i]!.bottom),
      trunkTop: trunk[0]!.top,
      trunkBottom: trunk.at(-1)!.bottom,
      rows: rows.map((row, i) => {
        const tile = box(row.querySelector('span.grid')!);
        const elbow = elbows[i]!;
        return {
          tileLeft: tile.left - bubble.left,
          tileMid: tile.top + tile.height / 2,
          elbowBottom: elbow.bottom,
          elbowRight: elbow.right,
          tileTopGap: i === 0 ? tile.top : tile.top - box(rows[i - 1]!.querySelector('span.grid')!).bottom,
        };
      }),
    };
  });
  expect(g.widths).toEqual(['1.5px']);
  expect(g.colors).toHaveLength(1);
  expect(g.rowElbowSvgs).toBe(0);
  expect(g.trunkX).toEqual([18.75]);
  for (const gap of g.trunkGaps) expect(Math.abs(gap)).toBeLessThanOrEqual(0.01);
  const [a, b, c] = g.rows;
  expect(g.trunkTop).toBeLessThanOrEqual(a!.tileMid);
  expect(c!.tileMid - g.trunkBottom).toBeCloseTo(14, 1);
  for (const row of g.rows) {
    expect(row.tileLeft).toBe(32);
    expect(Math.abs(row.elbowBottom - row.tileMid)).toBeLessThanOrEqual(0.5);
  }
  expect(b!.tileTopGap).toBe(8);
  expect(c!.tileTopGap).toBe(8);
});

test('hovering a task row shows where it runs: project, machine and, for a local project, its folder', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'Look at the repo', createdAt: 10 },
      createTodoRow('m1b', TASK, 12),
      { id: 'm2', role: 'assistant', content: 'Started it.', createdAt: 13 },
    ],
    todos: [TASK],
    tasks: [],
    projects: [{ ...PROJECT, name: 'notes-sync', repoKind: 'local', localPath: '/srv/notes-sync' }],
    machines: [READY_MACHINE, { id: 'm-other', name: 'mac-mini', online: true }],
  });
  await page.route(`**/api/builds/${TASK.latestBuildId}/steps`, (route) =>
    route.fulfill({ json: [{ id: 's1', machineId: 'm-other' }, { id: 's2', machineId: null }] }),
  );
  await page.goto('/app');
  const ref = page.getByTestId('chief-stream').getByTestId('chief-task-ref');
  await expect(page.getByTestId('chief-task-ref-hover')).toHaveCount(0);
  await expect(ref).toHaveRole('link');
  await ref.hover();
  const card = page.getByTestId('chief-task-ref-hover');
  await expect(card).toContainText('Read the cairn repo');
  await expect(card.locator('[data-slot="task-ref-project"] dd')).toHaveText('notes-sync');
  await expect(card.locator('[data-slot="task-ref-machine"] dd')).toHaveText('mac-mini');
  await expect(card.locator('[data-slot="task-ref-folder"] dd')).toHaveText('/srv/notes-sync');
});
