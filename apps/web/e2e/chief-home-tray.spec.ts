import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, TASK, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const QUESTION = {
  id: 'row-ask-1',
  role: 'assistant',
  createdAt: 40,
  content: JSON.stringify({
    kind: 'ask_user_question',
    requestId: 'ask-1',
    status: 'pending',
    questions: [
      {
        header: 'Merge',
        question: 'PR 42 only touches the README. Merge now or wait for CI?',
        options: [
          { label: 'Wait for CI', description: 'About 6 minutes', recommended: true },
          { label: 'Merge now', description: 'Docs only, low risk' },
        ],
      },
    ],
    answers: null,
    provenance: 'watch:todo-1',
  }),
};

const running = { ...THREAD, activeRun: { phase: 'chief' } };

function withQuestion(todos: unknown[] = []) {
  return {
    threads: [running],
    messages: [...HISTORY, { id: 'm7', role: 'user', content: 'Merge it when it is safe', createdAt: 30 }, QUESTION],
    todos,
  };
}

function answerRoute(state: ReturnType<typeof withQuestion>, answered: unknown[]) {
  return (
    path: string,
    route: { request: () => { method: () => string; postDataJSON: () => unknown } },
    json: (body: unknown, status?: number) => unknown,
  ) => {
    if (path === '/api/teams/t1/chief/threads') return json(state.threads);
    if (!/\/questions\/ask-1\/answer$/.test(path) || route.request().method() !== 'POST') return undefined;
    const body = route.request().postDataJSON() as { answers: unknown[] };
    answered.push(body);
    const done = { ...JSON.parse(QUESTION.content), status: 'answered', answers: body.answers };
    state.messages = state.messages.map((row) =>
      row.id === QUESTION.id ? { ...row, content: JSON.stringify(done) } : row,
    );
    return json(done);
  };
}

async function openWithQuestion(page: Page, todos: unknown[] = []) {
  const state = withQuestion(todos);
  const answered: unknown[] = [];
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  return { state, answered };
}

test('no needs-you thread and no question means a plain tab title', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: HISTORY, todos: [TASK] });
  await page.goto('/app');
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  await expect(page).toHaveTitle('Cairn');
});

test('a pending question counts as needs-you on the Tasks toggle and tab title, and the conversation says it is waiting', async ({
  page,
}) => {
  await openWithQuestion(page);
  await expect(page.getByTestId('tasks-badge')).toHaveText('1');
  await expect(page).toHaveTitle('(1) Cairn');
  const stream = page.getByTestId('chief-stream');
  await expect(stream).toContainText('Waiting for your answer');
  await expect(stream).not.toContainText('Working on it');
});

test('a running turn with no question keeps its typing dots', async ({ page }) => {
  await mockLive(page, {
    threads: [running],
    messages: [...HISTORY, { id: 'm7', role: 'user', content: 'Merge it when it is safe', createdAt: 30 }],
    todos: [],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream')).not.toContainText('Waiting for your answer');
  await expect(page.getByTestId('chief-stream').getByTestId('typing-dots')).toBeVisible();
});

test('option descriptions are printed on the card, not hidden in a tooltip', async ({ page }) => {
  await openWithQuestion(page);
  const option = page.getByTestId('chief-question-option-0-0');
  await expect(option).toContainText('About 6 minutes');
  await expect(page.getByTestId('chief-question-option-0-1')).toContainText('Docs only, low risk');
  expect(await option.getAttribute('title')).toBeNull();
});

test('on desktop the question card is capped at 40% of the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await openWithQuestion(page);
  const box = await page.getByTestId('chief-question-card').boundingBox();
  expect(box!.height).toBeLessThanOrEqual(500 * 0.4 + 1);
});

test('on a phone only the question and options show; the controls live under the more menu', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWithQuestion(page);
  const card = page.getByTestId('chief-question-card');
  await expect(card.getByTestId('chief-question-text')).toBeVisible();
  await expect(card.getByTestId('chief-question-option-0-0')).toBeVisible();
  await expect(card.getByTestId('chief-question-collapse')).toBeHidden();
  await expect(card.getByTestId('chief-question-dismiss')).toBeHidden();
  await expect(card.getByTestId('chief-question-position')).toHaveCount(0);
  await card.getByTestId('chief-question-more').click();
  await expect(page.getByRole('menuitem', { name: 'Collapse question' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Dismiss question' }).click();
  await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
});

test('on desktop the more menu stays hidden and the controls show in the header', async ({ page }) => {
  await openWithQuestion(page);
  const card = page.getByTestId('chief-question-card');
  await expect(card.getByTestId('chief-question-more')).toBeHidden();
  await expect(card.getByTestId('chief-question-dismiss')).toBeVisible();
});

test('a single question has no progress bar', async ({ page }) => {
  await openWithQuestion(page);
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-prev')).toHaveCount(0);
});

test('an answered card fades out over 200ms and leaves a one-line summary in the conversation', async ({ page }) => {
  const { answered } = await openWithQuestion(page);
  await page.evaluate(() => {
    const seen: { animation: string; duration: string }[] = [];
    (window as unknown as { __leaving: typeof seen }).__leaving = seen;
    new MutationObserver(() => {
      const node = document.querySelector('[data-testid="chief-question-leaving"]');
      if (node === null || seen.length > 0) return;
      const style = getComputedStyle(node);
      seen.push({ animation: style.animationName, duration: style.animationDuration });
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByTestId('chief-question-option-0-0').click();
  await page.getByTestId('chief-question-primary').click();
  await expect.poll(() => answered.length).toBe(1);
  await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
  const line = page.getByTestId('chief-stream').getByTestId('chief-question-line');
  await expect(line).toHaveText('Answered: Wait for CI');
  await expect(page.getByTestId('chief-stream').getByTestId('chief-question-card')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-leaving')).toHaveCount(0);
  const seen = await page.evaluate(
    () => (window as unknown as { __leaving: { animation: string; duration: string }[] }).__leaving,
  );
  expect(seen).toEqual([{ animation: 'question-fade-out', duration: '0.2s' }]);
  await expect(page).toHaveTitle('Cairn');
});
