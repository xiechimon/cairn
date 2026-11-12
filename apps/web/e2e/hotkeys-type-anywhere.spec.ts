import { expect, type Page, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

const HOME = '/app?scenario=home-c';
const SCHEDULES = '/app/schedules?scenario=home-c';

const homeComposer = (page: Page) => page.getByTestId('home-c').getByTestId('chief-composer-input');

test('typing with nothing focused lands the keys in the home composer', async ({ page }) => {
  await page.goto(HOME);
  const composer = homeComposer(page);
  await expect(composer).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type('Hi there');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Hi there');
});

test('typing after clicking a sidebar row still reaches the composer', async ({ page }) => {
  await page.goto(HOME);
  const composer = homeComposer(page);
  await expect(composer).toBeVisible();
  await page.getByRole('button', { name: '搜索' }).focus();
  await page.keyboard.press('x');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('x');
});

test('modifier chords, Space and Enter do not steal focus', async ({ page }) => {
  await page.goto(HOME);
  const composer = homeComposer(page);
  await expect(composer).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const key of ['Meta+c', 'Control+c', 'Alt+c', 'Space', 'Enter', 'Tab', 'Escape', 'ArrowDown']) {
    await page.keyboard.press(key);
    await expect(composer).not.toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  await expect(composer).toHaveValue('');
});

test('an open dialog keeps its keys', async ({ page }) => {
  await page.goto(HOME);
  await page.keyboard.press('Meta+k');
  const field = page.getByRole('dialog', { name: '搜索' }).getByRole('textbox');
  await expect(field).toBeFocused();
  await page.keyboard.type('ab');
  await expect(field).toHaveValue('ab');
  await expect(homeComposer(page)).toHaveValue('');
});

test('C no longer navigates: a page without a composer ignores typing', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.locator('body').press('c');
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(/\/app\/schedules/);
});

async function mockPendingQuestion(page: Page) {
  const question = {
    kind: 'ask_user_question',
    requestId: 'req-1',
    status: 'pending',
    questions: [
      {
        header: 'Model',
        question: 'Which model should rerun it?',
        options: [{ label: 'Claude subscription' }, { label: 'Hold it' }],
      },
    ],
    answers: null,
  };
  await mockLive(page, {
    threads: [THREAD],
    todos: [TASK],
    messages: [
      { id: 'm1', role: 'user', content: 'rerun #9', createdAt: 10 },
      { id: 'm2', role: 'assistant', content: JSON.stringify(question), createdAt: 11 },
    ],
  });
}

test('pending question chips take digits when nothing is focused and leaves a typed composer alone', async ({
  page,
}) => {
  await mockPendingQuestion(page);
  await page.goto('/app');
  const composer = homeComposer(page);
  const option = page.getByTestId('chief-question-option-0-0');
  await expect(option).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('1');
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('');
  await composer.fill('draft');
  await page.keyboard.press('2');
  await expect(composer).toHaveValue('draft2');
  await expect(page.getByTestId('chief-question-option-0-1')).toHaveAttribute('aria-pressed', 'false');
});
