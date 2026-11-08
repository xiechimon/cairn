import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, TASK, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

const todoIn = (n: number, phase: string, title: string) => ({
  ...TASK,
  id: `todo-${n}`,
  seqNum: n,
  title,
  phase,
  phaseAt: Date.now(),
  latestBuildId: `build-${n}`,
});

const FIVE = [
  todoIn(1, 'confirm', 'Plan the routing split'),
  todoIn(2, 'review', 'Fix the orb permission'),
  todoIn(3, 'review', 'Fold finished turns'),
  todoIn(4, 'confirm', 'Rename the sidebar groups'),
  todoIn(5, 'review', 'Rerun the relay probe'),
];

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

for (const size of [
  { name: 'desktop', width: 1470, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`needs-you threads live behind the title chip, never above the composer, and open, answer and close in the inbox (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const todos = FIVE.map((todo) => ({ ...todo }));
    todos[0] = {
      ...todos[0]!,
      phase: 'needs_input',
      waitingOn: { on: 'owner', retryAt: null },
      ask: {
        text: 'Split by tenant or by region first?',
        requestId: 'ask-split',
        options: [{ label: 'Tenant' }, { label: 'Region' }],
        defaultAnswer: 'Tenant',
      },
    } as (typeof todos)[number];
    const sent: unknown[] = [];
    await mockLive(page, { threads: [THREAD], messages: HISTORY, todos }, (path, route, json) => {
      if (!/^\/api\/todos\/[^/]+\/messages$/.test(path) || route.request().method() !== 'POST') {
        return undefined;
      }
      sent.push({ path, body: route.request().postDataJSON() });
      return json({ todoId: 'todo-1', conversationId: 'build-1', delivered: 'steer' }, 201);
    });
    await page.goto('/app');
    await expect(page.getByTestId('chief-composer-block').getByTestId('needs-you-inbox-row')).toHaveCount(0);
    const chip = page.getByTestId('home-c').getByTestId('needs-you-chip');
    await expect(chip.getByTestId('needs-you-count')).toHaveText('5');
    await chip.click();
    const rows = page.getByTestId('needs-you-inbox-row');
    await expect(rows).toHaveCount(5);
    const first = rows.filter({ hasText: 'Plan the routing split' });
    await expect(first.getByTestId('needs-you-inbox-ask')).toHaveText('Split by tenant or by region first?');
    await first.getByTestId('needs-you-inbox-toggle').click();
    await expect(first.getByRole('textbox', { name: 'Reply to #1' })).toBeFocused();
    await expect(first.getByRole('button', { name: 'Tenant', exact: true })).toBeVisible();
    if (size.name === 'desktop') {
      const composer = page.getByTestId('home-c').locator('.chief-composer');
      await expect(composer).toBeInViewport();
      const panel = await page.locator('.side-panel').boundingBox();
      const chat = await page.getByTestId('home-c').boundingBox();
      expect(chat!.x + chat!.width).toBeLessThanOrEqual(panel!.x + 1);
    }
    await first.getByRole('button', { name: 'Tenant', exact: true }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ path: '/api/todos/todo-1/messages', body: { content: 'Tenant' } });
    await expect(rows).toHaveCount(4);
    await expect(chip.getByTestId('needs-you-count')).toHaveText('4');
    await page.locator('.side-panel').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('needs-you-inbox')).toHaveCount(0);
    await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  });
}

test('no needs-you thread and no question means no chip and a plain tab title', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: HISTORY, todos: [TASK] });
  await page.goto('/app');
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  await expect(page.getByTestId('needs-you-chip')).toHaveCount(0);
  await expect(page).toHaveTitle('Cairn');
});

test('a pending question counts as needs-you in the badge and tab title, and the conversation says it is waiting', async ({
  page,
}) => {
  await openWithQuestion(page);
  await expect(page.getByRole('complementary').getByTestId('attention-badge')).toHaveText('1');
  await expect(page).toHaveTitle('(1) Cairn');
  const stream = page.getByTestId('chief-stream');
  await expect(stream).toContainText('Waiting for your answer');
  await expect(stream).not.toContainText('Working on it');
  await expect(page.getByTestId('chief-composer-working')).toHaveCount(0);
});

test('a running turn with no question keeps its elapsed timer and working label', async ({ page }) => {
  await mockLive(page, {
    threads: [running],
    messages: [...HISTORY, { id: 'm7', role: 'user', content: 'Merge it when it is safe', createdAt: 30 }],
    todos: [],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-composer-working')).toBeVisible();
  await expect(page.getByTestId('chief-stream')).not.toContainText('Waiting for your answer');
  await expect(page.getByTestId('chief-stream')).toContainText('Working on it');
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

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('every inbox row shows a button that opens its thread', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: HISTORY, todos: FIVE });
  await page.goto('/app?pane=inbox');
  const rows = page.getByTestId('needs-you-inbox-row');
  await expect(rows).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await expect(rows.nth(i).getByRole('button', { name: 'View thread' })).toBeVisible();
  }
});
});
