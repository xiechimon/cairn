import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock.js';
import { pressAndExpect, settleTransitions } from './helpers.js';

const PROJECT_X = { ...PROJECT, id: 'proj-x', name: 'X', repoName: 'X' };
const THREAD_X = { ...THREAD, id: 'chief-x', projectId: 'proj-x', title: 'X' };

const X_MESSAGES = [
  { id: 'mx-1', role: 'user', origin: 'user', projectId: 'proj-x', content: '第一条：1+1等于几', createdAt: 10 },
  { id: 'mx-2', role: 'user', origin: 'user', projectId: 'proj-x', content: '第二条：再加2呢', createdAt: 20 },
  { id: 'mx-3', role: 'assistant', projectId: 'proj-x', content: '1+1 等于 2。', createdAt: 30 },
  { id: 'mx-4', role: 'assistant', projectId: 'proj-x', content: '再加 2 等于 4。', createdAt: 40 },
];

const COORD_MESSAGES = [
  { id: 'mc-1', role: 'user', origin: 'user', content: 'Coordinator 里也讨论过 1+1', createdAt: 50 },
];

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });
const field = (page: Page) => panel(page).getByRole('textbox', { name: '搜索' });
const messageRows = (page: Page) => panel(page).locator('[data-row-kind="message"]');

async function installLiveSearch(page: Page) {
  await mockLive(
    page,
    {
      threads: [THREAD, THREAD_X],
      projects: [PROJECT_X],
      messages: COORD_MESSAGES,
      channels: { 'proj-x': X_MESSAGES },
      todos: [],
      tasks: [],
    },
    (path, route, json) => {
      if (path !== '/api/search') return undefined;
      const q = (new URL(route.request().url()).searchParams.get('q') ?? '').trim().toLowerCase();
      const hits = [
        ...X_MESSAGES.map((m) => ({
          id: m.id,
          threadId: THREAD_X.id,
          projectId: 'proj-x',
          projectName: 'X',
          role: m.role,
          snippet: m.content,
          createdAt: m.createdAt,
        })),
        ...COORD_MESSAGES.map((m) => ({
          id: m.id,
          threadId: THREAD.id,
          projectId: null,
          projectName: null,
          role: m.role,
          snippet: m.content,
          createdAt: m.createdAt,
        })),
      ].filter((m) => q !== '' && m.snippet.toLowerCase().includes(q));
      return json({ todos: [], projects: [], messages: hits });
    },
  );
}

test('searches Chinese and symbol messages, clicks a hit to open the thread and scroll to the message', async ({
  page,
}) => {
  await installLiveSearch(page);
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream')).toBeVisible();

  await pressAndExpect(page, 'Meta+k', panel(page));
  await field(page).fill('再加');
  await expect(messageRows(page)).toHaveCount(2);
  await expect(messageRows(page).first()).toContainText('第二条：再加2呢');
  await expect(messageRows(page).first()).toContainText('X');

  await messageRows(page).first().click();
  await expect(panel(page)).toBeHidden();
  await expect(page).toHaveURL(/project=proj-x/);
  await expect(page).toHaveURL(/chat=1/);
  await expect(page).not.toHaveURL(/msg=/);
  await expect(page.locator('[data-testid="chief-stream"] [data-message-id="mx-2"]')).toBeInViewport();
});

test('navigates message hits via keyboard arrows and Enter and surfaces missing-message toast', async ({
  page,
}) => {
  await installLiveSearch(page);
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream')).toBeVisible();

  await pressAndExpect(page, 'Meta+k', panel(page));
  await field(page).fill('1+1');
  await expect(messageRows(page)).toHaveCount(3);
  await field(page).press('ArrowDown');
  await expect(messageRows(page).first()).toHaveAttribute('data-selected', '');
  await field(page).press('Enter');
  await expect(panel(page)).toBeHidden();
  await expect(page).toHaveURL(/project=proj-x/);
  await expect(page.locator('[data-testid="chief-stream"] [data-message-id="mx-1"]')).toBeInViewport();

  await page.goto('/app?project=proj-x&chat=1&msg=missing-id');
  await expect(page.getByText('未能定位到这条消息')).toBeVisible();
  await expect(page).not.toHaveURL(/msg=/);
});

test('message search panel fits 390px without overflow and passes WCAG 2.2 AA in light and dark', async ({
  page,
}) => {
  await installLiveSearch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await pressAndExpect(page, 'Meta+k', panel(page));
  await field(page).fill('再加');
  await expect(messageRows(page)).toHaveCount(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['light', 'dark'] as const) {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/app');
    await pressAndExpect(page, 'Meta+k', panel(page));
    await field(page).fill('再加');
    await expect(messageRows(page)).toHaveCount(2);
    await settleTransitions(page);
    const { violations } = await new AxeBuilder({ page })
      .include('.search-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations).toEqual([]);
  }
});
