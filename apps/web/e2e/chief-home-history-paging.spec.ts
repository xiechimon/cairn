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

async function mockPagedHistory(page: Page, total = 250, size = 100) {
  const history = historyOf(total);
  const requested: (string | null)[] = [];
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    const before = new URL(route.request().url()).searchParams.get('before');
    requested.push(before);
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
      if (toTop) node.scrollTop = 0;
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
  await expect(row(page, 'answer 149')).toHaveCount(0);
  await expect(page.getByTestId('home-c-earlier')).toHaveText('往上滑看更早的对话');
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
  await expect(row(page, 'answer 149')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0150']);
  await expect.poll(() => offsetOf(page, 'question 150')).toBeCloseTo(before, 0);

  await offsetOf(page, 'question 50', true);
  await expect(row(page, 'question 0')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0150', 'h-0050']);
  await expect(page.getByTestId('home-c-earlier')).toHaveCount(0);
});

test('a newest page too short to fill the view keeps loading older pages until history ends', async ({
  page,
}) => {
  const requested = await mockPagedHistory(page, 9, 3);
  await page.goto('/app');
  await expect(row(page, 'question 0')).toHaveCount(1);
  expect(requested).toEqual([null, 'h-0006', 'h-0003']);
  await expect(row(page, 'question 8')).toBeInViewport();
  await expect(page.getByTestId('home-c-earlier')).toHaveCount(0);
});
