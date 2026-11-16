import { expect, type Page, test } from '@playwright/test';
import { type MockState, mockLive, PROJECT, type Row, taskEntry, THREAD } from './chief-home-mock';

const RELAY = { ...PROJECT, id: 'proj-2', name: 'Credential relay' };

async function open(page: Page, state: Partial<MockState> = {}) {
  await mockLive(page, {
    threads: [THREAD],
    messages: [],
    projects: [PROJECT, RELAY],
    tasks: [taskEntry({ id: 't-ask', projectId: RELAY.id, section: 'needs_input' })],
    ...state,
  });
  await page.goto('/app');
}

test('the empty Coordinator home hangs each project and New project on the ink spiral', async ({ page }) => {
  await open(page);
  const spiral = page.getByTestId('home-spiral');
  await expect(spiral).toBeVisible();
  const projects = spiral.getByTestId('home-spiral-project');
  await expect(projects).toHaveText(['Credential relay', 'cairn']);
  await expect(projects.first()).toHaveAttribute('aria-description', '有任务在等你');
  await expect(projects.last()).not.toHaveAttribute('aria-description');
  await expect(spiral.getByTestId('home-spiral-new-project')).toHaveText('新建项目');
});

test('a project on the spiral opens its conversation, like its sidebar row', async ({ page }) => {
  await open(page);
  await page.getByTestId('home-spiral').getByRole('button', { name: 'cairn' }).click();
  await expect(page).toHaveURL(/[?&]project=proj-1/);
  await expect(page).toHaveURL(/[?&]chat=1/);
  await expect(page.getByTestId('home-spiral')).toHaveCount(0);
});

test('New project on the spiral opens the new-project page', async ({ page }) => {
  await open(page);
  await page.getByTestId('home-spiral-new-project').click();
  await expect(page).toHaveURL(/\/app\/project\/new/);
});

test('the spiral leaves once the conversation has messages', async ({ page }) => {
  const messages: Row[] = [
    { id: 'm1', role: 'user', content: 'hi', createdAt: 1_000 },
    { id: 'm2', role: 'assistant', content: 'hello', createdAt: 1_001 },
  ];
  await open(page, { messages });
  await expect(page.getByText('hello')).toBeVisible();
  await expect(page.getByTestId('home-spiral')).toHaveCount(0);
});

test('a short window and a phone skip the spiral', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 680 });
  await open(page);
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(page.getByTestId('home-spiral')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('home-spiral')).toHaveCount(0);
});
