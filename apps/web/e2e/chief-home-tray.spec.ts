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

const DOCK = `/app/schedules?chief=${THREAD.id}`;

async function openWithQuestion(page: Page, todos: unknown[] = [], url = '/app') {
  const state = withQuestion(todos);
  const answered: unknown[] = [];
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto(url);
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
      if (route.request().method() !== 'POST' || !/^\/api\/todos\/[^/]+\//.test(path)) {
        return undefined;
      }
      sent.push({ path, body: route.request().postDataJSON() });
      return json({ todoId: 'todo-1', buildId: 'build-1', requestId: 'ask-split', delivered: 'steer' });
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
    expect(sent).toEqual([
      { path: '/api/todos/todo-1/questions/ask-split/answer', body: { answer: 'Tenant' } },
    ]);
    await expect(rows).toHaveCount(4);
    await expect(chip.getByTestId('needs-you-count')).toHaveText('4');
    await page.locator('.side-panel').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('needs-you-inbox')).toHaveCount(0);
    await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  });
}

test('a one-click answer that fails says so on the row, keeps the options, and a retry goes through', async ({
  page,
}) => {
  const asking = {
    ...FIVE[0],
    phase: 'needs_input',
    waitingOn: { on: 'owner', retryAt: null },
    ask: {
      text: 'Split by tenant or by region first?',
      requestId: 'ask-split',
      options: [{ label: 'Tenant' }, { label: 'Region' }],
      defaultAnswer: null,
    },
  };
  let calls = 0;
  await mockLive(page, { threads: [THREAD], messages: HISTORY, todos: [asking] }, (path, route, json) => {
    if (route.request().method() !== 'POST' || !path.endsWith('/questions/ask-split/answer')) {
      return undefined;
    }
    calls += 1;
    return calls === 1
      ? json({ error: 'requestId ask-split is not pending yet' }, 500)
      : json({ todoId: 'todo-1', buildId: 'build-1', requestId: 'ask-split', delivered: 'steer' });
  });
  await page.goto('/app?pane=inbox');
  const row = page.getByTestId('needs-you-inbox-row');
  await row.getByTestId('needs-you-inbox-toggle').click();
  await row.getByRole('button', { name: 'Region', exact: true }).click();
  await expect(row.getByTestId('needs-you-inbox-error')).toHaveText('Not sent. Try again.');
  await expect(row.getByRole('button', { name: 'Region', exact: true })).toBeEnabled();
  await row.getByRole('button', { name: 'Region', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(calls).toBe(2);
});

test('a thread whose machine must update cairn waits on you in the inbox and in the one count', async ({
  page,
}) => {
  const stuck = {
    ...todoIn(9, 'building', 'Rerun the relay probe on omarchy'),
    waitingOn: { on: 'machine-update', retryAt: null },
  };
  await mockLive(page, { threads: [THREAD], messages: HISTORY, todos: [stuck, FIVE[0]] });
  await page.goto('/app');
  const chip = page.getByTestId('home-c').getByTestId('needs-you-chip');
  await expect(chip.getByTestId('needs-you-count')).toHaveText('2');
  await expect(page.getByRole('complementary').getByTestId('attention-badge')).toHaveText('2');
  await chip.click();
  const row = page.getByTestId('needs-you-inbox-row').filter({ hasText: 'Rerun the relay probe on omarchy' });
  await expect(row.getByTestId('needs-you-inbox-ask')).toHaveText(
    'The machine running it needs a cairn update before it can receive the answer.',
  );
  await row.getByTestId('needs-you-inbox-toggle').click();
  await expect(row.getByRole('textbox')).toHaveCount(0);
});

test('after the first request is answered, the next request on the same thread has live controls', async ({
  page,
}) => {
  const ask = (requestId: string, text: string, options: string[]) => ({
    text,
    requestId,
    options: options.map((label) => ({ label })),
    defaultAnswer: null,
  });
  const asking = {
    ...todoIn(4, 'needs_input', 'Rename the sidebar groups'),
    waitingOn: { on: 'owner', retryAt: null },
    ask: ask('ask-first', 'Keep the old names?', ['Keep', 'Rename']),
  };
  const state = { threads: [THREAD], messages: HISTORY, todos: [asking] };
  const posts: string[] = [];
  await mockLive(page, state, (path, route, json) => {
    if (route.request().method() !== 'POST' || !/\/questions\/[^/]+\/answer$/.test(path)) {
      return undefined;
    }
    posts.push(path);
    state.todos = [{ ...asking, ask: ask('ask-second', 'Which order?', ['Alphabetical', 'By status']) }];
    return json({ todoId: 'todo-4', buildId: 'build-4', requestId: 'x', delivered: 'steer' });
  });
  await page.goto('/app?pane=inbox');
  const row = page.getByTestId('needs-you-inbox-row');
  await row.getByTestId('needs-you-inbox-toggle').click();
  await row.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(row.getByTestId('needs-you-inbox-ask')).toHaveText('Which order?');
  await row.getByTestId('needs-you-inbox-toggle').click();
  const next = row.getByRole('button', { name: 'By status', exact: true });
  await expect(next).toBeEnabled();
  await expect(row.getByRole('textbox', { name: 'Reply to #4' })).toBeEditable();
  await next.click();
  await expect.poll(() => posts).toEqual([
    '/api/todos/todo-4/questions/ask-first/answer',
    '/api/todos/todo-4/questions/ask-second/answer',
  ]);
});

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
  const card = page.getByTestId('chief-stream').getByTestId('inline-question');
  const option = card.getByTestId('quick-question-option-0');
  await expect(option).toContainText('About 6 minutes');
  await expect(card.getByTestId('quick-question-option-1')).toContainText('Docs only, low risk');
  expect(await option.getAttribute('title')).toBeNull();
});

for (const size of [
  { name: 'desktop', width: 1470, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`on home the Coordinator question waits in the conversation where it was asked, the composer stays free, and one click answers it (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const { answered } = await openWithQuestion(page);
    const stream = page.getByTestId('chief-stream');
    const card = stream.getByTestId('inline-question');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Merge now or wait for CI?');
    await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
    const asked = await stream.getByText('Merge it when it is safe').boundingBox();
    const cardBox = await card.boundingBox();
    expect(cardBox!.y).toBeGreaterThan(asked!.y);
    const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
    await expect(composer).not.toHaveAttribute('placeholder', /answer/i);
    const composerBox = await page.getByTestId('home-c').locator('.chief-composer').boundingBox();
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(composerBox!.y);
    await expect(page.getByTestId('home-c').getByTestId('needs-you-count')).toHaveText('1');
    await card.getByTestId('quick-question-option-0').click();
    await expect.poll(() => answered.length).toBe(1);
    expect(answered[0]).toEqual({ answers: [{ header: 'Merge', choices: ['Wait for CI'] }] });
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('complementary').getByTestId('attention-badge')).toHaveCount(0);
    await expect(page.getByTestId('home-c').getByTestId('needs-you-chip')).toHaveCount(0);
  });
}

test('the chip and the sidebar badge count the same things, and the inbox lists the Coordinator question beside the threads', async ({
  page,
}) => {
  const { answered } = await openWithQuestion(page, FIVE.slice(0, 2));
  const chip = page.getByTestId('home-c').getByTestId('needs-you-chip');
  await expect(chip.getByTestId('needs-you-count')).toHaveText('3');
  await expect(page.getByRole('complementary').getByTestId('attention-badge')).toHaveText('3');
  await chip.click();
  const question = page.getByTestId('needs-you-inbox-question');
  await expect(question).toContainText('Merge now or wait for CI?');
  await expect(page.getByTestId('needs-you-inbox-row')).toHaveCount(2);
  await question.getByTestId('needs-you-inbox-toggle').click();
  await question.getByTestId('quick-question-option-1').click();
  await expect.poll(() => answered.length).toBe(1);
  await expect(question).toHaveCount(0);
  await expect(chip.getByTestId('needs-you-count')).toHaveText('2');
  await expect(page.getByRole('complementary').getByTestId('attention-badge')).toHaveText('2');
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
