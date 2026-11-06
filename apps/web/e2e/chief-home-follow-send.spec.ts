import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD, toolRow } from './chief-home-mock';
import { evidenceShot } from './evidence';
import { openChiefWindow } from './helpers.js';

const historyOf = (total: number): Row[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `h-${String(i).padStart(4, '0')}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `question ${i}` : `answer ${i}`,
    createdAt: 1_000 + i,
  }));

async function mockSlowSend(page: Page, total = 250): Promise<Row[]> {
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
  return history;
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
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
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

const gapToBottom = (page: Page) =>
  viewport(page).evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
const streamUrl = `/api/conversations/${THREAD.id}/stream`;
const emit = (page: Page, ev: unknown) =>
  page.evaluate(
    ([u, e]) => window.__es.find((es) => es.url.includes(u as string))?.emit(e),
    [streamUrl, ev] as const,
  );
const paragraph = (n: number) => `line ${n} ${'streamed words '.repeat(14)}`;

async function sendAtBottom(page: Page) {
  const history = await mockSlowSend(page);
  await page.goto('/app');
  await expect(row(page, 'answer 249')).toBeInViewport();
  const input = home(page).getByTestId('chief-composer-input');
  await input.fill('stay pinned');
  await input.press('Enter');
  await expect(row(page, 'stay pinned')).toBeInViewport();
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), streamUrl))
    .toBe(true);
  return history;
}

test('the status line after a send is visible without scrolling', async ({ page }) => {
  await sendAtBottom(page);
  await emit(page, { type: 'activity', activity: { phase: 'starting' } });
  const status = home(page).getByText('正在连接模型...');
  await expect(status).toBeInViewport({ ratio: 1 });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await evidenceShot(page, 'chief-stick-status.png');
});

test('streaming growth and a tool row stay pinned while the reader is at the bottom', async ({
  page,
}) => {
  const history = await sendAtBottom(page);
  for (let n = 0; n < 6; n++) {
    await emit(page, { type: 'text_delta', text: `${paragraph(n)}\n\n` });
    await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  }
  const tool = toolRow('tool-1', 'todo_write', {}, 5_000);
  history.push(tool);
  await emit(page, { type: 'message', message: tool });
  await emit(page, { type: 'text_delta', text: `${paragraph(99)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await expect(home(page).getByTestId('jump-to-latest')).toHaveAttribute('data-active', 'false');
  await evidenceShot(page, 'chief-stick-streaming.png');
});

test('scrolling up stops following, and the jump button resumes it', async ({ page }) => {
  await sendAtBottom(page);
  await emit(page, { type: 'text_delta', text: `${paragraph(0)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);

  await viewport(page).hover();
  await page.mouse.wheel(0, -700);
  await expect.poll(() => gapToBottom(page)).toBeGreaterThan(300);
  const parked = await gapToBottom(page);
  for (let n = 1; n < 4; n++) await emit(page, { type: 'text_delta', text: `${paragraph(n)}\n\n` });
  await expect(home(page).getByText(paragraph(3).trim(), { exact: false })).toBeAttached();
  await expect.poll(() => gapToBottom(page)).toBeGreaterThanOrEqual(parked);
  const jump = home(page).getByTestId('jump-to-latest');
  await expect(jump).toHaveAttribute('data-active', 'true');

  await jump.click();
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await emit(page, { type: 'text_delta', text: `${paragraph(4)}\n\n` });
  await expect.poll(() => gapToBottom(page)).toBeLessThanOrEqual(2);
  await expect(jump).toHaveAttribute('data-active', 'false');
});

test('the drawer follows a send and its streaming growth too', async ({ page }) => {
  await mockSlowSend(page);
  await page.goto('/app/schedules');
  await openChiefWindow(page);
  const drawer = page.locator('.chief-drawer');
  await expect(drawer).toBeVisible();
  const body = drawer.getByTestId('chief-body');
  const gap = () => body.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
  await expect(drawer.getByText('answer 249', { exact: true })).toBeInViewport();
  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight - node.clientHeight - 600;
  });
  const input = drawer.getByTestId('chief-composer-input');
  await input.fill('drawer send');
  await input.press('Enter');
  await expect(drawer.getByTestId('chief-stream').getByText('drawer send', { exact: true })).toBeInViewport();
  await expect
    .poll(() => page.evaluate((u) => window.__es.some((es) => es.url.includes(u)), streamUrl))
    .toBe(true);
  for (let n = 0; n < 5; n++) {
    await emit(page, { type: 'text_delta', text: `${paragraph(n)}\n\n` });
    await expect.poll(gap).toBeLessThanOrEqual(2);
  }
});
