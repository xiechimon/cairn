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

test('a pending question counts as needs-you on the Tasks toggle and tab title, and the conversation shows no working row above it', async ({
  page,
}) => {
  await openWithQuestion(page);
  await expect(page.getByTestId('tasks-badge')).toHaveText('1');
  await expect(page).toHaveTitle('(1) Cairn');
  await expect(page.getByTestId('chief-question-option-0-0')).toBeVisible();
  const stream = page.getByTestId('chief-stream');
  await expect(stream).not.toContainText('Waiting for your answer');
  await expect(stream).not.toContainText('Working on it');
  await expect(stream.getByTestId('typing-dots')).toHaveCount(0);
});

test('a running turn with no question keeps its typing dots', async ({ page }) => {
  await mockLive(page, {
    threads: [running],
    messages: [...HISTORY, { id: 'm7', role: 'user', content: 'Merge it when it is safe', createdAt: 30 }],
    todos: [],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-stream').getByTestId('typing-dots')).toBeVisible();
});

test('every option shows its description under its label, and the first is tagged Recommended without being picked', async ({ page }) => {
  await openWithQuestion(page);
  const option = page.getByTestId('chief-question-option-0-0');
  await expect(option.getByTestId('chief-question-option-description')).toHaveText('About 6 minutes');
  await expect(option.getByTestId('chief-question-recommended')).toHaveText('Recommended');
  await expect(option).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByTestId('chief-question-option-0-1').getByTestId('chief-question-option-description'),
  ).toHaveText('Docs only, low risk');
});

test('on a phone the card sits above the composer, and Skip takes it away with an undo', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWithQuestion(page);
  const block = page.getByTestId('chief-composer-block').getByTestId('chief-question');
  await expect(block.getByTestId('chief-question-text')).toBeVisible();
  await expect(block.getByTestId('chief-question-option-0-0')).toBeInViewport({ ratio: 1 });
  await expect(block.getByTestId('chief-question-pager')).toHaveCount(0);
  const card = (await block.boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(375);
  await block.getByTestId('chief-question-skip').click();
  await expect(page.getByTestId('chief-question')).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Question skipped' })).toBeVisible();
});

test('a single question has no progress bar', async ({ page }) => {
  await openWithQuestion(page);
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-prev')).toHaveCount(0);
});

test('an answer leaves one receipt in the conversation: the question over the answer', async ({ page }) => {
  const { answered } = await openWithQuestion(page);
  await page.getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered.length).toBe(1);
  await expect(page.getByTestId('chief-question')).toHaveCount(0);
  const receipt = page.getByTestId('chief-stream').getByTestId('chief-question-receipt');
  await expect(receipt).toHaveCount(1);
  await expect(receipt.getByTestId('chief-question-receipt-question')).toHaveText(
    JSON.parse(QUESTION.content).questions[0].question,
  );
  await expect(receipt.getByTestId('chief-question-receipt-answer')).toHaveText('Wait for CI');
  await expect(page.getByTestId('chief-stream').locator('[data-question-answer]')).toHaveCount(0);
  await expect(page).toHaveTitle('Cairn');
});
