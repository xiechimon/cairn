import { expect, type Page, type Route, test } from '@playwright/test';
import { mockLive, TASK, THREAD } from './chief-home-mock';

function question(requestId: string, header: string, text: string, options: unknown[]) {
  return {
    id: `row-${requestId}`,
    role: 'assistant',
    createdAt: requestId === 'ask-0000000a' ? 20 : 21,
    content: JSON.stringify({
      kind: 'ask_user_question',
      requestId,
      status: 'pending',
      questions: [{ header, question: text, options }],
      answers: null,
      provenance: 'watch:todo-1',
    }),
  };
}

const DOCK = `/app/schedules?chief=${THREAD.id}`;

const TWO = {
  threads: [THREAD],
  messages: [
    { id: 'request', role: 'user', content: 'Ship the relay fix', createdAt: 10 },
    question('ask-0000000a', 'Model · #74', 'relay-186 cannot run glm-5.3-flash. Which model?', [
      { label: 'wokey · deepseek-v4.1-flash', description: 'Metered' },
      { label: 'Claude subscription', description: 'Verified', recommended: true },
    ]),
    question('ask-0000000b', 'Merge · #2271', 'This touches a protected path. Who merges it?', [
      { label: 'Hold it' },
      { label: 'Send it to ian', recommended: true },
    ]),
  ],
  todos: [],
};

function answerRoute(state: typeof TWO, answered: { path: string; body: unknown }[]) {
  return (
    path: string,
    route: { request: () => { method: () => string; postDataJSON: () => unknown } },
    json: (body: unknown, status?: number) => unknown,
  ) => {
    const match = /\/chief\/threads\/([^/]+)\/questions\/([^/]+)\/answer$/.exec(path);
    if (match === null || route.request().method() !== 'POST') return undefined;
    const requestId = match[2] ?? '';
    const body = route.request().postDataJSON() as { answers: unknown[] };
    answered.push({ path, body });
    state.messages = state.messages.map((row) =>
      row.id === `row-${requestId}`
        ? {
            ...row,
            content: JSON.stringify({
              ...JSON.parse(row.content as string),
              status: 'answered',
              answers: body.answers,
            }),
          }
        : row,
    );
    return json(JSON.parse(state.messages.find((row) => row.id === `row-${requestId}`)!.content as string));
  };
}

const ONE = { ...TWO, messages: TWO.messages.slice(0, 2) };
const NONE = { ...TWO, messages: TWO.messages.slice(0, 1) };

test('the header carries no question pill on any page', async ({ page }) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app/schedules');
  await expect(page.getByTestId('page-topbar')).toBeVisible();
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
  await page.goto('/app?chief=settings');
  await expect(page.getByTestId('chief-settings-topbar')).toBeVisible();
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
});

for (const where of ['conversation', 'inbox'] as const) {
  test(`your own words answer the Coordinator question from the ${where}`, async ({ page }) => {
    const answered: { path: string; body: unknown }[] = [];
    const state = structuredClone(ONE);
    await mockLive(page, state, answerRoute(state, answered));
    await page.goto(where === 'inbox' ? '/app?pane=inbox' : '/app');
    const scope =
      where === 'inbox'
        ? page.getByTestId('needs-you-inbox-question')
        : page.getByTestId('chief-stream').getByTestId('inline-question');
    if (where === 'inbox') await scope.getByTestId('needs-you-inbox-toggle').click();
    await scope.getByTestId('quick-question-own').fill('Use the metered key this once');
    await scope.getByTestId('quick-question-own').press('Enter');
    await expect
      .poll(() => answered.map((row) => row.body))
      .toEqual([{ answers: [{ header: 'Model · #74', choices: ['Use the metered key this once'] }] }]);
    await expect(scope).toHaveCount(0);
  });
}

const inline = (page: Page) => page.getByTestId('chief-stream').getByTestId('inline-question');
const badge = (page: Page) => page.getByRole('complementary').getByTestId('attention-badge');

test('answering a question in the conversation removes its card and drops the badge; the other one stays', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(TWO);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  await expect(inline(page)).toHaveCount(2);
  await expect(badge(page)).toHaveText('2');
  await inline(page).first().getByTestId('quick-question-option-0').click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]?.path).toContain(`/chief/threads/${THREAD.id}/questions/ask-0000000a/answer`);
  await expect(inline(page)).toHaveCount(1);
  await expect(inline(page)).toContainText('Who merges it?');
  await expect(badge(page)).toHaveText('1');
});

test('a successful answer closes the card at once, even while the conversation still reads it as pending', async ({
  page,
}) => {
  const posts: string[] = [];
  const state = structuredClone(ONE);
  await mockLive(page, state, (path, route, json) => {
    const match = /\/questions\/([^/]+)\/answer$/.exec(path);
    if (match === null || route.request().method() !== 'POST') return undefined;
    posts.push(path);
    const row = state.messages.find((m) => m.id === `row-${match[1]}`)!;
    const body = route.request().postDataJSON() as { answers: unknown[] };
    return json({ ...JSON.parse(row.content as string), status: 'answered', answers: body.answers });
  });
  await page.goto('/app');
  await inline(page).getByTestId('quick-question-option-0').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(inline(page)).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  await expect(page.getByTestId('quick-question-error')).toHaveCount(0);
  expect(posts).toHaveLength(1);
});

test('a submit the server reports as already answered closes the card without an error', async ({ page }) => {
  await mockLive(page, structuredClone(ONE), (path, route, json) => {
    if (!/\/questions\/[^/]+\/answer$/.test(path) || route.request().method() !== 'POST') return undefined;
    return json({ error: 'question ask-0000000a already answered', reason: 'question-settled' }, 409);
  });
  await page.goto('/app');
  await inline(page).getByTestId('quick-question-option-0').click();
  await expect(inline(page)).toHaveCount(0);
  await expect(page.getByTestId('quick-question-error')).toHaveCount(0);
});

test('a refused submit for any other reason keeps the card, says so and allows another try', async ({ page }) => {
  await mockLive(page, structuredClone(ONE), (path, route, json) => {
    if (!/\/questions\/[^/]+\/answer$/.test(path) || route.request().method() !== 'POST') return undefined;
    return json({ error: 'chief thread chief-global is archived' }, 409);
  });
  await page.goto('/app');
  await inline(page).getByTestId('quick-question-option-0').click();
  await expect(inline(page).getByTestId('quick-question-error')).toBeVisible();
  await expect(inline(page).getByTestId('quick-question-option-0')).toBeEnabled();
});

test('a multi-step request in the conversation sends every answer at once', async ({ page }) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(MIXED);
  await mockLive(page, state, answerRoute(state as typeof TWO, answered));
  await page.goto('/app');
  const card = inline(page).first();
  await card.getByTestId('chief-question-option-0-0').click();
  await card.getByRole('button', { name: /^(Next|下一步)\s/ }).click();
  await card.getByTestId('chief-question-option-1-1').click();
  await card.getByRole('button', { name: /^(Submit answers|提交回答)/ }).click();
  await expect
    .poll(() => answered.map((row) => row.body))
    .toEqual([
      {
        answers: [
          { header: 'Theme', choices: ['Light'] },
          { header: 'Sections', choices: ['Details'] },
        ],
      },
    ]);
});

for (const where of ['conversation', 'inbox'] as const) {
  test(`dismissing the Coordinator question from the ${where} cancels it and removes it everywhere`, async ({
    page,
  }) => {
    const cancelled: string[] = [];
    await mockLive(page, structuredClone(ONE), (path, route, json) => {
      if (!/\/questions\/[^/]+\/cancel$/.test(path) || route.request().method() !== 'POST') {
        return undefined;
      }
      cancelled.push(path);
      return json({ ok: true });
    });
    await page.goto(where === 'inbox' ? '/app?pane=inbox' : '/app');
    const scope =
      where === 'inbox' ? page.getByTestId('needs-you-inbox-question') : inline(page);
    if (where === 'inbox') await scope.getByTestId('needs-you-inbox-toggle').click();
    await scope.getByTestId('quick-question-cancel').click();
    await expect.poll(() => cancelled).toEqual([
      `/api/teams/t1/chief/threads/${THREAD.id}/questions/ask-0000000a/cancel`,
    ]);
    await expect(inline(page)).toHaveCount(0);
    await expect(page.getByTestId('needs-you-inbox-question')).toHaveCount(0);
    await expect(badge(page)).toHaveCount(0);
  });
}

test('a request with several questions takes your own words for each step on home', async ({ page }) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(MIXED);
  await mockLive(page, state, answerRoute(state as typeof TWO, answered));
  await page.goto('/app');
  const card = page.getByTestId('chief-stream').getByTestId('inline-question').first();
  await card.getByTestId('chief-question-own-0').fill('Sepia');
  await card.getByTestId('chief-question-next').click();
  await expect(card.getByTestId('chief-question-text')).toHaveText('Which sections?');
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toHaveValue('');
});

test('the sidebar Coordinator badge counts pending questions and leads home, where each one waits in the conversation', async ({
  page,
}) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app/schedules');
  const badge = page.getByRole('complementary').getByTestId('attention-badge');
  await expect(badge).toHaveText('2');
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(0);
  await page.getByRole('complementary').getByRole('button', { name: /Coordinator/ }).first().click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByTestId('chief-stream').getByTestId('inline-question')).toHaveCount(2);
  await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
  await expect(page.getByTestId('home-c').getByTestId('needs-you-count')).toHaveText('2');
});

const LONG_OPTIONS = Array.from({ length: 6 }, (_, n) => ({
  label: `Option ${n + 1}: a deliberately long label that keeps wrapping across several lines of the card`,
  description: `Description ${n + 1}: the reasoning behind this option is spelled out in a full sentence so the row grows`,
}));

const LONG = {
  threads: [THREAD],
  messages: [
    { id: 'request', role: 'user', content: 'Ship the relay fix', createdAt: 10 },
    question(
      'ask-0000000a',
      'Plan · #3138',
      'Which of these six rollouts should the Coordinator pick, given the long explanation that follows here?',
      LONG_OPTIONS,
    ),
  ],
  todos: [],
};

const MIXED = {
  threads: [THREAD],
  messages: [
    { id: 'request', role: 'user', content: 'Ship the relay fix', createdAt: 10 },
    {
      id: 'row-ask-0000000a',
      role: 'assistant',
      createdAt: 20,
      content: JSON.stringify({
        kind: 'ask_user_question',
        requestId: 'ask-0000000a',
        status: 'pending',
        questions: [
          { header: 'Theme', question: 'Which theme?', options: [{ label: 'Light' }, { label: 'Dark' }] },
          { header: 'Sections', question: 'Which sections?', multiSelect: true, options: [{ label: 'Intro' }, { label: 'Details' }] },
        ],
        answers: null,
      }),
    },
    question('ask-0000000b', 'Merge · #2271', 'Who merges it?', [{ label: 'Hold it' }, { label: 'Send it to ian' }]),
  ],
  todos: [],
};

const VERY_LONG = {
  threads: [THREAD],
  messages: [
    { id: 'request', role: 'user', content: 'Ship the relay fix', createdAt: 10 },
    question(
      'ask-0000000a',
      'A header that keeps going and going '.repeat(8),
      'A prompt that explains far too much before it asks anything at all. '.repeat(30),
      [{ label: 'Yes' }, { label: 'No' }],
    ),
  ],
  todos: [],
};

