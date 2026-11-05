import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';
import { expandTurns } from './helpers';

const historyOf = (total: number): Row[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `h-${String(i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `question ${i}` : `answer ${i}`,
    createdAt: 1_000 + i,
  }));

async function mockSlowSend(page: Page, total = 250) {
  const history = historyOf(total);
  let running = false;
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/chief/threads' && route.request().method() === 'GET')
      return json([{ ...THREAD, activeRun: running ? { phase: 'chief' } : null }]);
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() === 'POST') {
      const content = (route.request().postDataJSON() as { content: string }).content;
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          history.push({
            id: `s-${history.length}`,
            role: 'user',
            content,
            createdAt: 1_000 + history.length,
          });
          running = true;
          void json({ thread: THREAD }, 201).then(resolve);
        }, 300),
      );
    }
    const before = new URL(route.request().url()).searchParams.get('before');
    const end = before === null ? history.length : history.findIndex((row) => row.id === before);
    const start = Math.max(0, end - 100);
    return json({
      messages: history.slice(start, end),
      nextCursor: start > 0 ? (history[start]?.id ?? null) : null,
    });
  });
}

const home = (page: Page) => page.getByTestId('home-c');
const viewport = (page: Page) => home(page).getByTestId('chief-body');
const row = (page: Page, text: string) =>
  home(page).getByTestId('chief-stream').getByText(text, { exact: true });
const opacityOf = (locator: Locator) =>
  locator.evaluate((node) => Number(getComputedStyle(node).opacity));
const messageOf = (page: Page, text: string) =>
  home(page)
    .getByTestId('chief-msg')
    .filter({ has: page.getByText(text, { exact: true }) });

test('a sent message scrolls into view even when the reader was scrolled up', async ({ page }) => {
  await mockSlowSend(page);
  await page.goto('/app');
  await expect(row(page, 'answer 249')).toBeInViewport();
  await viewport(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - 600;
  });
  await expect(row(page, 'answer 249')).not.toBeInViewport();

  const input = home(page).getByTestId('chief-composer-input');
  await input.fill('follow me down');
  await input.press('Enter');

  await expect(row(page, 'follow me down')).toBeInViewport();
  const streamUrl = `/api/conversations/${THREAD.id}/stream`;
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), streamUrl))
    .toBe(true);
  await page.evaluate((u) => {
    window.__es.find((es) => es.url.includes(u))?.emit({ type: 'text_delta', text: 'typing back' });
  }, streamUrl);
  await expect(home(page).getByText('typing back')).toBeInViewport();
  await expect(row(page, 'follow me down')).toBeInViewport();
  await expect
    .poll(() => opacityOf(messageOf(page, 'follow me down').getByTestId('chief-msg-tools')))
    .toBe(1);
  await evidenceShot(page, 'chief-follow-send.png');
});

test('only the newest message keeps its actions visible; older ones show them on hover', async ({
  page,
}) => {
  await mockSlowSend(page, 6);
  await page.goto('/app');
  await expandTurns(page);
  await viewport(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.mouse.move(0, 0);
  await expect(row(page, 'answer 5')).toBeInViewport();

  const newestFoot = messageOf(page, 'answer 5').getByTestId('chief-msg-foot');
  const olderFoot = messageOf(page, 'answer 3').getByTestId('chief-msg-foot');
  const olderUserTools = messageOf(page, 'question 4').getByTestId('chief-msg-tools');

  await expect.poll(() => opacityOf(newestFoot)).toBe(1);
  await expect.poll(() => opacityOf(olderFoot)).toBe(0);
  await expect.poll(() => opacityOf(olderUserTools)).toBe(0);

  await messageOf(page, 'answer 3').hover();
  await expect.poll(() => opacityOf(olderFoot)).toBe(1);
  await messageOf(page, 'question 4').hover();
  await expect.poll(() => opacityOf(olderUserTools)).toBe(1);
});
