import { expect, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const historyOf = (total: number): Row[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `h-${String(i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `question ${i}` : `answer ${i}`,
    createdAt: 1_000 + i,
  }));

function pageBefore(history: Row[], size: number, before: string | null) {
  const end = before === null ? history.length : history.findIndex((row) => row.id === before);
  const start = Math.max(0, end - size);
  return {
    messages: history.slice(start, end),
    nextCursor: start > 0 ? (history[start]?.id ?? null) : null,
  };
}

async function mockPagedHistory(page: Page, total = 250, size = 100, olderFails = false) {
  const history = historyOf(total);
  const requested: (string | null)[] = [];
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    const before = new URL(route.request().url()).searchParams.get('before');
    requested.push(before);
    if (olderFails && before !== null) return json({ error: 'older page failed' }, 500);
    return json(pageBefore(history, size, before));
  });
  return requested;
}

const stream = (page: Page) => page.getByTestId('home-c').getByTestId('chief-stream');
const viewport = (page: Page) => page.getByTestId('home-c').getByTestId('chief-body');
const row = (page: Page, text: string) => stream(page).getByText(text, { exact: true });

async function offsetOf(page: Page, text: string, scrollToTop = false): Promise<number> {
  return viewport(page).evaluate(
    (node, [label, toTop]) => {
      if (toTop) {
        node.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
        node.scrollTop = 0;
      }
      const target = [...node.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && el.textContent === label,
      );
      if (target === undefined) throw new Error(`${label} is not rendered`);
      return target.getBoundingClientRect().top - node.getBoundingClientRect().top;
    },
    [text, scrollToTop] as const,
  );
}

test('a long Coordinator history opens on its newest page, at the newest message', async ({
  page,
}) => {
  const requested = await mockPagedHistory(page);
  await page.goto('/app');
  await expect(row(page, 'answer 249')).toBeInViewport();
  await expect(row(page, 'question 150')).toHaveCount(1);
  await expect(row(page, 'question 148')).toHaveCount(0);
  await expect(page.getByTestId('home-c-lead')).toHaveCount(0);
  await expect(page.getByTestId('home-c')).not.toContainText('往上滑看更早的对话');
  expect(requested).toEqual([null]);
  await evidenceShot(page, 'opens-at-newest.png');
});

test('scrolling to the top loads the older page and keeps the reading position', async ({
  page,
}) => {
  const requested = await mockPagedHistory(page);
  await page.goto('/app');
  await expect(row(page, 'answer 249')).toBeInViewport();
  const before = await offsetOf(page, 'question 150', true);
  await expect(row(page, 'question 148')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0150']);
  await expect.poll(() => offsetOf(page, 'question 150')).toBeCloseTo(before, 0);

  await offsetOf(page, 'question 50', true);
  await expect(row(page, 'question 0')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0150', 'h-0050']);
});

test('a newest page too short to fill the view keeps loading older pages until history ends', async ({
  page,
}) => {
  const requested = await mockPagedHistory(page, 9, 3);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/app');
  await expect(row(page, 'question 0')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0006', 'h-0003']);
  await expect(row(page, 'question 8')).toBeInViewport();
});

test('a failing older page is not retried on its own while the reader stays at the top', async ({
  page,
}) => {
  const requested = await mockPagedHistory(page, 250, 100, true);
  await page.goto('/app');
  await expect(row(page, 'answer 249')).toBeInViewport();
  await offsetOf(page, 'question 150', true);
  await expect.poll(() => requested.filter((before) => before !== null).length).toBe(2);
  await page.waitForTimeout(3_000);
  expect(requested.filter((before) => before !== null)).toHaveLength(2);
  await expect(row(page, 'question 150')).toHaveCount(1);
});

test('typing in the composer does not re-render the conversation rows', async ({ page }) => {
  await mockPagedHistory(page, 40, 100);
  await page.goto('/app');
  await expect(row(page, 'answer 39')).toBeInViewport();
  const rowProps = () =>
    viewport(page).evaluate((node) => {
      const w = window as unknown as { __rowProps?: unknown[] };
      const props = [...node.querySelectorAll('[data-slot="message-scroller-item"]')].map((el) => {
        const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
        return key === undefined ? null : (el as unknown as Record<string, unknown>)[key];
      });
      if (w.__rowProps === undefined) {
        w.__rowProps = props;
        return { rows: props.length, rerendered: 0 };
      }
      const before = w.__rowProps;
      return {
        rows: props.length,
        rerendered: props.filter((p, i) => p === null || p !== before[i]).length,
      };
    });
  expect((await rowProps()).rows).toBe(40);
  await page.getByTestId('home-c').getByTestId('chief-composer-input').pressSequentially('hello');
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toHaveValue('hello');
  expect(await rowProps()).toEqual({ rows: 40, rerendered: 0 });
});
