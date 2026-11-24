import { expect, type Page, type Route, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

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

const A = 'Model · #74';
const B = 'Merge · #2271';
const shown = (page: Page) => page.getByTestId('chief-question').getByTestId('chief-question-text');

async function focusQuestion(page: Page, header: string) {
  const panel = page.getByRole('complementary', { name: '任务' });
  if (!(await panel.isVisible()))
    await page.getByTestId('home-c').getByRole('button', { name: /^任务/ }).first().click();
  await panel.locator('[data-section="needs_input"] [data-slot="task-row"]').filter({ hasText: header }).click();
}
const NONE = { ...TWO, messages: TWO.messages.slice(0, 1) };

const receipts = (page: Page) =>
  page
    .getByTestId('chief-stream')
    .getByTestId('chief-question-receipt')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        [...node.querySelectorAll('[data-testid^="chief-question-receipt-"]')].map((part) => part.textContent ?? ''),
      ),
    );

test('C11: a pending question is one card docked above the composer: the question in the reply serif, numbered rows with their descriptions, the first tagged 推荐 and none picked', async ({
  page,
}) => {
  const posts: string[] = [];
  await mockLive(page, structuredClone(ONE), (path, route) => {
    if (route.request().method() === 'POST') posts.push(path);
    return undefined;
  });
  await page.goto('/app');
  const question = page.getByTestId('chief-composer-block').getByTestId('chief-question');
  await expect(question).toBeVisible();
  await expect(page.getByTestId('chief-stream').getByTestId('chief-question')).toHaveCount(0);
  const text = question.getByTestId('chief-question-text');
  await expect(text).toHaveText('relay-186 cannot run glm-5.3-flash. Which model?');
  await expect(text).toHaveAttribute('title', 'Model · #74');
  await expect(text).toHaveCSS('font-family', /Songti|serif/i);
  await expect(question.getByTestId('chief-question-prev')).toHaveCount(0);
  const card = (await question.boundingBox())!;
  const composer = (await page.getByTestId('home-c').locator('.chief-composer').boundingBox())!;
  expect(Math.round(composer.y - (card.y + card.height))).toBe(8);
  expect(Math.round(card.x)).toBe(Math.round(composer.x));
  expect(Math.round(card.width)).toBe(Math.round(composer.width));
  await expect(question).toHaveCSS('border-top-left-radius', '14px');
  const first = question.getByTestId('chief-question-option-0-0');
  const second = question.getByTestId('chief-question-option-0-1');
  await expect(first).toHaveText('1Claude subscription推荐Verified');
  await expect(second).toHaveText('2wokey · deepseek-v4.1-flashMetered');
  await expect(question.getByTestId('chief-question-recommended')).toHaveCount(1);
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  expect(Math.round((await first.boundingBox())!.height)).toBeGreaterThanOrEqual(40);
  await expect(question.getByTestId('chief-question-other-0')).toHaveAttribute(
    'placeholder',
    '输入你自己的回答…',
  );
  await expect(question.getByTestId('chief-question-skip')).toHaveText('跳过');
  await expect(question.getByTestId('chief-question-minimize')).toHaveAccessibleName('收起');
  await expect(page.getByTestId('chief-composer-input')).toHaveAttribute('placeholder', '或者直接回复…');
  await expect.poll(() => posts.some((path) => path.includes('/questions/'))).toBe(false);
});

test('no pending question means no chips and no pill', async ({ page }) => {
  await mockLive(page, structuredClone(NONE));
  await page.goto('/app');
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  await expect(page.getByTestId('chief-question')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
  await expect(page).toHaveTitle('Cairn');
});

test('the header carries no question pill on any page', async ({ page }) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app/settings/account');
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
});

test('a row answers at once and the badge drops; the next question takes its place, and each answer leaves one receipt', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(TWO);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  const question = page.getByTestId('chief-question');
  await expect(shown(page)).toContainText('Which model?');
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(page).toHaveTitle('(2) Cairn');
  await question.getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]?.path).toContain(`/chief/threads/${THREAD.id}/questions/ask-0000000a/answer`);
  expect(answered[0]?.body).toEqual({ answers: [{ header: 'Model · #74', choices: ['Claude subscription'] }] });
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(question.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await expect(page).toHaveTitle('(1) Cairn');
  await question.getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered.length).toBe(2);
  await expect(question).toHaveCount(0);
  await expect(page.getByTestId('chief-stream').locator('[data-question-answer]')).toHaveCount(0);
  await expect.poll(() => receipts(page)).toEqual([
    ['relay-186 cannot run glm-5.3-flash. Which model?', 'Claude subscription'],
    ['This touches a protected path. Who merges it?', 'Send it to ian'],
  ]);
  await expect(page.getByTestId('chief-question-receipt').last()).toBeInViewport();
  await expect(page).toHaveTitle('Cairn');
});

test('a failed answer keeps the card and says so', async ({ page }) => {
  await mockLive(page, structuredClone(ONE), (path, route, json) => {
    if (!path.endsWith('/answer') || route.request().method() !== 'POST') return undefined;
    return json({ error: 'boom' }, 500);
  });
  await page.goto('/app');
  await page.getByTestId('chief-question-option-0-1').click();
  await expect(page.getByTestId('chief-question-error')).toBeVisible();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: '提交回答失败' })).toBeVisible();
  await expect(page.getByTestId('chief-question-option-0-1')).toBeEnabled();
  await expect(page.getByTestId('chief-question-option-0-1')).toHaveAttribute('aria-pressed', 'true');
});

test('free text answers inline', async ({ page }) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(ONE);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  const question = page.getByTestId('chief-question');
  await page.getByTestId('chief-composer-input').fill('Use the metered key this once');
  await page.getByTestId('chief-question-primary').click();
  await expect
    .poll(() => answered.map((row) => row.body))
    .toEqual([{ answers: [{ header: 'Model · #74', choices: ['Use the metered key this once'] }] }]);
  await expect(question).toHaveCount(0);
});

test('the tab title counts pending questions and the Coordinator row opens the question from another page', async ({
  page,
}) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app/usage');
  await expect(page.getByTestId('usage-empty')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveTitle('(2) Cairn');
  await page.goto('/app?pane=tasks&tab=scheduled');
  await expect(page).toHaveTitle('(2) Cairn');
  await expect(page.getByRole('complementary', { name: '任务' })).toBeVisible();
  await page.getByTestId('sidebar-reopen').click();
  await page.mouse.move(700, 400);
  await page.getByRole('complementary').getByRole('button', { name: /Coordinator/ }).first().click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page).not.toHaveURL(/tab=scheduled/);
  await expect(page.getByTestId('chief-question')).toBeInViewport();
  await expect(shown(page)).toContainText('Which model?');
});

test('moving between questions from the tasks panel keeps a typed draft, and a failed submit keeps it too', async ({ page }) => {
  let fail = true;
  await mockLive(page, structuredClone(TWO), (path, route, json) => {
    if (!path.endsWith('/answer') || route.request().method() !== 'POST') return undefined;
    if (fail) {
      fail = false;
      return json({ error: 'boom' }, 500);
    }
    return json({});
  });
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  await composer.fill('Keep this text');
  await focusQuestion(page, B);
  await expect(shown(page)).toContainText('Who merges it?');
  await expect(composer).toHaveValue('');
  await focusQuestion(page, A);
  await expect(composer).toHaveValue('Keep this text');
  await page.getByTestId('chief-question-primary').click();
  await expect(page.getByTestId('chief-question-error')).toBeVisible();
  await expect(composer).toHaveValue('Keep this text');
  await expect(shown(page)).toContainText('Which model?');
});

test('at 375px the card sits under the conversation, above the composer, inside the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const history = Array.from({ length: 14 }, (_, n) => ({
    id: `hist-${n}`,
    role: n % 2 === 0 ? 'user' : 'assistant',
    content: `History message ${n}`,
    createdAt: 100 + n,
  }));
  const state = structuredClone(TWO);
  state.messages = [
    ...history,
    ...state.messages.map((row, n) => ({ ...row, createdAt: 200 + n })),
    { id: 'tail', role: 'assistant', content: 'The final message', createdAt: 300 },
  ];
  await mockLive(page, state);
  await page.goto('/app');
  const question = page.getByTestId('chief-question');
  await expect(question).toBeVisible();
  const composer = page.getByTestId('home-c').locator('.chief-composer');
  await expect(composer).toBeInViewport({ ratio: 1 });
  await expect(question.getByTestId('chief-question-option-0-0')).toBeInViewport({ ratio: 1 });
  const questionBox = (await question.boundingBox())!;
  const composerBox = (await composer.boundingBox())!;
  const lastBox = (await page.getByText('The final message').boundingBox())!;
  expect(questionBox.y + questionBox.height).toBeLessThanOrEqual(composerBox.y);
  expect(questionBox.x).toBeGreaterThanOrEqual(0);
  expect(questionBox.x + questionBox.width).toBeLessThanOrEqual(375);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(questionBox.y);
});

const LONG_OPTIONS = Array.from({ length: 6 }, (_, n) => ({
  label: `Option ${n + 1}: a deliberately long label that keeps wrapping across several lines of the chip row`,
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

for (const size of [
  { name: '1440 desktop', width: 1440, height: 900 },
  { name: '375px phone', width: 375, height: 667 },
]) {
  test(`six long options with descriptions scroll inside the card and every row, the composer and send stay reachable (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(LONG));
    await page.goto('/app?chief=chief-home');
    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();
    const question = coordinator.getByTestId('chief-question');
    await expect(question).toBeVisible();
    expect((await question.boundingBox())!.height).toBeLessThanOrEqual(Math.min(size.height * 0.6, 560) + 1);
    const input = coordinator.getByTestId('chief-composer-input');
    await expect(input).toBeInViewport({ ratio: 1 });
    const send = coordinator.getByTestId('chief-question-primary');
    await expect(send).toBeInViewport({ ratio: 1 });
    for (let n = 0; n < 6; n += 1) {
      const chip = question.getByTestId(`chief-question-option-0-${n}`);
      await chip.scrollIntoViewIfNeeded();
      await expect(chip).toBeInViewport({ ratio: 0.95 });
      const box = (await chip.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    }
    await expect(send).toBeInViewport({ ratio: 1 });
  });
}

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

test('one card at a time, the oldest first; the 1/N pager walks every question and step; a row on an early step moves on; the tasks panel focuses another request', async ({
  page,
}) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto('/app');
  const block = page.getByTestId('chief-question');
  await expect(block.getByTestId('chief-question-text')).toHaveCount(1);
  await expect(block.getByTestId('chief-question-text')).toContainText('Which theme?');
  const pager = block.getByTestId('chief-question-pager');
  await expect(pager).toHaveText('1/3');
  await expect(block.getByTestId('chief-question-prev')).toBeDisabled();
  await block.getByTestId('chief-question-next').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Which sections?');
  await expect(pager).toHaveText('2/3');
  await block.getByTestId('chief-question-next').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await expect(pager).toHaveText('3/3');
  await expect(block.getByTestId('chief-question-next')).toBeDisabled();
  await block.getByTestId('chief-question-prev').click();
  await block.getByTestId('chief-question-prev').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Which theme?');
  await block.getByTestId('chief-question-option-0-0').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Which sections?');
  await focusQuestion(page, 'Merge · #2271');
  await expect(block.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await focusQuestion(page, 'Theme');
  await expect(block.getByTestId('chief-question-text')).toContainText('Which sections?');
});

test('a multi-question request sends nothing and starts no turn until its last question is answered; one submit carries every answer', async ({
  page,
}) => {
  const posts: { path: string; body: unknown }[] = [];
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(MIXED);
  const answer = answerRoute(state, answered);
  await mockLive(page, state, (path, route, json) => {
    if (route.request().method() === 'POST' && !path.startsWith('/api/auth/'))
      posts.push({ path, body: route.request().postDataJSON() });
    return answer(path, route, json);
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const block = page.getByTestId('chief-question');
  await expect(block.getByTestId('chief-question-text')).toContainText('Which theme?');
  const bubblesBefore = await stream.getByTestId('chief-bubble').count();
  expect(bubblesBefore).toBe(1);
  await block.getByTestId('chief-question-option-0-1').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Which sections?');
  await block.getByTestId('chief-question-option-1-1').click();
  await expect(block.getByTestId('chief-question-option-1-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(block.getByTestId('chief-question-count')).toHaveText('已选 1 个');
  await page.waitForTimeout(500);
  expect(posts.map((post) => post.path)).toEqual([]);
  await expect(stream.getByTestId('chief-bubble')).toHaveCount(bubblesBefore);
  await expect(stream.getByTestId('chief-question-receipt')).toHaveCount(0);
  await page.getByTestId('chief-question-submit').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]?.path).toContain('/questions/ask-0000000a/answer');
  expect(posts[0]?.body).toEqual({
    answers: [
      { header: 'Theme', choices: ['Dark'] },
      { header: 'Sections', choices: ['Details'] },
    ],
  });
  await expect.poll(() => receipts(page)).toEqual([
    ['Which theme?', 'Dark', 'Which sections?', 'Details'],
  ]);
  await expect(stream.getByTestId('chief-bubble')).toHaveCount(bubblesBefore);
  expect(posts).toHaveLength(1);
  const receipt = stream.getByTestId('chief-question-receipt');
  await expect(receipt).toHaveCSS('border-top-left-radius', '14px');
  const look = await receipt.evaluate((el) => {
    const [question, answer] = [...el.querySelectorAll<HTMLElement>('[data-testid^="chief-question-receipt-"]')];
    return {
      question: getComputedStyle(question!).fontSize,
      answer: getComputedStyle(answer!).fontSize,
      chips: el.querySelectorAll('button').length,
    };
  });
  expect(look).toEqual({ question: '13px', answer: '14px', chips: 0 });
  await page.screenshot({ path: test.info().outputPath('answered-request.png') });
});

test('the send button answers with what is typed, and Ctrl+Enter submits it from a focused row', async ({
  page,
}) => {
  const answered: unknown[] = [];
  const state = structuredClone(ONE);
  await mockLive(page, state, (path, route, json) => {
    if (!path.endsWith('/answer') || route.request().method() !== 'POST') return undefined;
    answered.push(route.request().postDataJSON());
    return json({});
  });
  await page.goto('/app');
  const question = page.getByTestId('chief-question');
  const primary = page.locator('.chief-composer').getByTestId('chief-question-primary');
  await expect(primary).toBeVisible();
  await expect(primary).toHaveAttribute('aria-label', '提交回答');
  await expect(primary.locator('[data-slot="kbd"]')).toHaveCount(0);
  await expect(question.getByRole('button', { name: /提交回答/ })).toHaveCount(0);
  await expect(primary).toBeDisabled();
  await page.getByTestId('chief-composer-input').fill('the cheaper one');
  await expect(primary).toBeEnabled();
  await question.getByTestId('chief-question-option-0-1').press('Control+Enter');
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toEqual({ answers: [{ header: 'Model · #74', choices: ['the cheaper one'] }] });
});

test('a clicked option answers at once, and an empty composer with nothing picked cannot send', async ({
  page,
}) => {
  const answered: unknown[] = [];
  await mockLive(page, structuredClone(ONE), (path, route, json) => {
    if (!path.endsWith('/answer') || route.request().method() !== 'POST') return undefined;
    answered.push(route.request().postDataJSON());
    return json({});
  });
  await page.goto('/app');
  const primary = page.getByTestId('chief-question-primary');
  const composer = page.getByTestId('chief-composer-input');
  await expect(primary).toBeDisabled();
  await composer.press('Enter');
  expect(answered).toEqual([]);
  await page.getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered).toEqual([
    { answers: [{ header: 'Model · #74', choices: ['Claude subscription'] }] },
  ]);
});

test('a multi-step request: a row moves on with the composer cleared, multi-select rows check, and send submits every answer', async ({
  page,
}) => {
  const answered: unknown[] = [];
  const state = structuredClone(MIXED);
  await mockLive(page, state, (path, route, json) => {
    if (!path.endsWith('/answer') || route.request().method() !== 'POST') return undefined;
    answered.push(route.request().postDataJSON());
    return json({});
  });
  await page.goto('/app');
  const primary = page.getByTestId('chief-question-primary');
  const composer = page.getByTestId('chief-composer-input');
  await expect(primary).toHaveAttribute('aria-label', '下一步');
  await expect(primary).toBeDisabled();
  await page.getByTestId('chief-question-option-0-0').click();
  await expect(shown(page)).toContainText('Which sections?');
  await expect(composer).toHaveValue('');
  await expect(primary).toBeDisabled();
  await expect(primary).toHaveAttribute('aria-label', '提交回答');
  const submit = page.getByTestId('chief-question-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('chief-question-option-1-1').click();
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chief-question-option-1-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(submit).toBeEnabled();
  expect(answered).toEqual([]);
  await composer.fill('a custom section');
  await expect(primary).toBeEnabled();
  await primary.click();
  await expect
    .poll(() => answered)
    .toEqual([
      {
        answers: [
          { header: 'Theme', choices: ['Light'] },
          { header: 'Sections', choices: ['Details', 'a custom section'] },
        ],
      },
    ]);
});

for (const locale of ['zh', 'en'] as const) {
  for (const size of [
    { name: '320px phone', width: 320, height: 640 },
    { name: '375px phone', width: 375, height: 667 },
    { name: '1440 desktop', width: 1440, height: 900 },
  ]) {
    test(`nothing in the question or composer overflows or is clipped (${locale}, ${size.name}, 6 long options)`, async ({
      page,
    }) => {
      await page.addInitScript((value) => localStorage.setItem('cairn-locale', value), locale);
      await page.setViewportSize({ width: size.width, height: size.height });
      await mockLive(page, structuredClone(LONG));
      await page.goto('/app?chief=chief-home');
      const coordinator = page.getByTestId('home-c');
      await expect(coordinator.getByTestId('chief-question')).toBeVisible();
      await expect(coordinator.getByTestId('chief-composer-input')).toBeVisible();
      const defects = await coordinator.evaluate((root) => {
        const found: string[] = [];
        const scopes = [
          root.querySelector('[data-testid="chief-question"]'),
          root.querySelector('.chief-composer'),
        ];
        for (const scope of scopes) {
          if (scope === null) continue;
          const frame = scope.getBoundingClientRect();
          for (const el of scope.querySelectorAll('*')) {
            const name = `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? el.className.toString().slice(0, 40)}]`;
            const style = getComputedStyle(el);
            if (style.display === 'none') continue;
            if (el.classList.contains('sr-only') || el.closest('.sr-only') !== null) continue;
            const toolbar = el.closest('[data-placement]');
            if (toolbar !== null && getComputedStyle(toolbar).opacity === '0') continue;
            const box = el.getBoundingClientRect();
            if (box.width <= 1 && box.height <= 1) continue;
            if (box.left < frame.left - 0.5 || box.right > frame.right + 0.5)
              found.push(`${name} leaves the frame horizontally`);
            const ellipsis =
              style.textOverflow === 'ellipsis' ||
              (el instanceof HTMLTextAreaElement && el.value === '');
            const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
            if (clips && !ellipsis && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
              found.push(`${name} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
          }
        }
        const placeholder = root.querySelector('[data-testid="chief-composer-placeholder"]');
        if (placeholder !== null && getComputedStyle(placeholder).textOverflow !== 'ellipsis')
          found.push('composer placeholder does not ellipsize');
        return found;
      });
      expect(defects).toEqual([]);
      await expect(coordinator.getByTestId('chief-question-minimize')).toBeInViewport({ ratio: 1 });
      await expect(coordinator.getByTestId('chief-question-primary')).toBeInViewport({ ratio: 1 });
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`the composer is one raised field: a 1px ring on every side and a soft drop (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await mockLive(page, structuredClone(ONE));
    await page.goto('/app');
    await expect(page.getByTestId('chief-composer-input')).toBeVisible();
    const composer = page.getByTestId('home-c').locator('.chief-composer');
    await expect(composer).toBeVisible();
    const read = () =>
      composer.evaluate((el) => {
        const style = getComputedStyle(el);
        const layers = style.boxShadow.split(/,(?![^(]*\))/).map((layer) => layer.trim());
        return {
          ring: layers.find((layer) => layer.endsWith('inset')) ?? '',
          drops: layers.filter((layer) => !layer.endsWith('inset')).length,
          radius: style.borderTopLeftRadius,
          height: el.getBoundingClientRect().height,
        };
      });
    const resting = await read();
    expect(resting.ring).toMatch(/ 0px 0px 0px 1px inset$/);
    expect(resting.drops).toBeGreaterThanOrEqual(1);
    expect(resting.radius).toBe('14px');
    expect(Math.round(resting.height)).toBe(46);
    await composer.locator('textarea').focus();
    await expect.poll(async () => (await read()).ring).not.toBe(resting.ring);
  });
}

test('Escape or 收起 minimizes the card: the composer shows the question and a restore chevron brings it back', async ({
  page,
}) => {
  await mockLive(page, structuredClone(ONE));
  await page.goto('/app');
  const card = page.getByTestId('chief-question');
  await page.getByTestId('chief-question-option-0-0').focus();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveAttribute('placeholder', 'relay-186 cannot run glm-5.3-flash. Which model?');
  await page.getByTestId('chief-question-restore').click();
  await expect(card).toBeVisible();
  await card.getByTestId('chief-question-minimize').click();
  await expect(card).toHaveCount(0);
  await page.getByTestId('chief-question-restore').click();
  await expect(page.getByTestId('chief-composer-input')).toHaveAttribute('placeholder', '或者直接回复…');
});

test('Skip takes the card away with a five-second undo; undo keeps the question, waiting skips it and leaves 已跳过', async ({
  page,
}) => {
  const cancelled: string[] = [];
  const state = structuredClone(ONE);
  await mockLive(page, state, (path, route, json) => {
    if (!path.endsWith('/cancel') || route.request().method() !== 'POST') return undefined;
    cancelled.push(path);
    state.messages = state.messages.map((row) =>
      row.id === 'row-ask-0000000a'
        ? { ...row, content: JSON.stringify({ ...JSON.parse(row.content as string), status: 'cancelled' }) }
        : row,
    );
    return json({});
  });
  await page.goto('/app');
  const card = page.getByTestId('chief-question');
  await page.getByTestId('chief-question-skip').click();
  await expect(card).toHaveCount(0);
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已跳过提问' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: '撤销' }).click();
  await expect(card).toBeVisible();
  expect(cancelled).toEqual([]);
  await page.getByTestId('chief-question-skip').click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => cancelled.length, { timeout: 8000 }).toBe(1);
  await expect.poll(() => receipts(page), { timeout: 8000 }).toEqual([
    ['relay-186 cannot run glm-5.3-flash. Which model?', '已跳过'],
  ]);
});

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

for (const size of [
  { name: '1440 desktop', url: '/app?chief=chief-home', width: 1440, height: 900 },
  { name: '375px phone', url: '/app?chief=chief-home', width: 375, height: 667 },
]) {
  test(`a very long prompt wraps in the card and keeps the rows, Escape-minimize and send working (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(VERY_LONG));
    await page.goto(size.url);
    const coordinator = page.getByTestId('home-c');
    const card = coordinator.getByTestId('chief-question');
    await expect(card).toBeVisible();
    const text = (await coordinator.getByTestId('chief-question-text').boundingBox())!;
    expect(text.x + text.width).toBeLessThanOrEqual(size.width);
    await coordinator.getByTestId('chief-question-option-0-0').scrollIntoViewIfNeeded();
    await coordinator.getByTestId('chief-question-option-0-0').click({ trial: true });
    await coordinator.getByTestId('chief-composer-input').fill('Maybe');
    const submit = coordinator.getByTestId('chief-question-primary');
    await expect(submit).toBeInViewport({ ratio: 1 });
    await submit.click({ trial: true });
    await card.getByTestId('chief-question-option-0-0').press('Escape');
    await expect(card).toHaveCount(0);
  });
}

test('each pending request keeps its own composer draft when moving A, B, A, B', async ({ page }) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  await composer.fill('draft for A');
  await focusQuestion(page, B);
  await expect(shown(page)).toContainText('Who merges it?');
  await expect(composer).toHaveValue('');
  await composer.fill('draft for B');
  await focusQuestion(page, A);
  await expect(composer).toHaveValue('draft for A');
  await focusQuestion(page, B);
  await expect(composer).toHaveValue('draft for B');
  await focusQuestion(page, A);
  await expect(composer).toHaveValue('draft for A');
});

test('an answer upload in flight still blocks a row answer and moving to another question after a withdraw switches to the thread composer', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = {
    ...structuredClone(TWO),
    threads: [
      { ...THREAD, activeRun: { phase: 'chief' }, pending: [{ messageId: 'q1', state: 'held' }] },
    ],
  };
  state.messages = [...state.messages, { id: 'q1', role: 'user', content: 'queued note', createdAt: 30 }];
  const answer = answerRoute(state, answered);
  await mockLive(page, state, (path, route, json) => {
    if (path === `/api/teams/t1/chief/threads/${THREAD.id}/messages/q1` && route.request().method() === 'DELETE') {
      state.threads = [{ ...THREAD, activeRun: null, pending: [] }];
      state.messages = state.messages.filter((row) => row.id !== 'q1');
      return json({ ok: true });
    }
    return answer(path, route, json);
  });
  const held: Route[] = [];
  await page.route('**/api/uploads/grant', (route) => {
    held.push(route);
  });
  await page.route('**/api/uploads/upload', (route) => {
    held.push(route);
  });
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  const activeComposer = page.getByTestId('home-c').locator('.chief-composer');
  const dock = page.getByTestId('chief-question');
  await composer.fill('typed answer');
  await activeComposer.locator('input[type="file"]').setInputFiles({
    name: 'slow.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('slow'),
  });
  await expect(activeComposer.getByTestId('attachment-pending')).toBeVisible();
  await page.getByTestId('home-c').getByTestId('chief-queued-message').getByRole('button', { name: '撤回' }).click();
  await expect(composer).toHaveValue('queued note');
  const chip = dock.getByTestId('chief-question-option-0-0');
  await expect(chip).toBeDisabled();
  await focusQuestion(page, B);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: '附件上传中' })).toBeVisible();
  await expect(shown(page)).toContainText('Which model?');
  await expect(async () => {
    let n = 0;
    for (const route of held.splice(0)) {
      n += 1;
      if (route.request().url().endsWith('/grant'))
        await route.fulfill({
          json: { uploadUrl: '/api/uploads', grant: `grant-${n}`, key: `t1/slow-${n}.log`, attachmentId: `slow-${n}` },
        });
      else await route.fulfill({ json: { id: 'x', key: 'x', sizeBytes: 4 } });
    }
    await expect(chip).toBeEnabled({ timeout: 500 });
  }).toPass();
  await focusQuestion(page, B);
  await expect(shown(page)).toContainText('Who merges it?');
  await focusQuestion(page, A);
  await expect(shown(page)).toContainText('Which model?');
  expect(answered).toEqual([]);
  await composer.fill('');
  await expect(composer).toHaveValue('typed answer');
  await expect(activeComposer.getByTestId('composer-attachments')).toContainText('slow.log');
});

test('answer drafts per request and the thread draft stay separate through every transition', async ({
  page,
}) => {
  const answered: { path: string; body: { answers: unknown[] } }[] = [];
  const state = {
    ...structuredClone(TWO),
    threads: [
      { ...THREAD, activeRun: { phase: 'chief' }, pending: [{ messageId: 'q1', state: 'held' }] },
    ],
  };
  state.messages = [...state.messages, { id: 'q1', role: 'user', content: 'queued note', createdAt: 30 }];
  const answer = answerRoute(state, answered as { path: string; body: unknown }[]);
  await mockLive(page, state, (path, route, json) => {
    if (path === `/api/teams/t1/chief/threads/${THREAD.id}/messages/q1` && route.request().method() === 'DELETE') {
      state.threads = [{ ...THREAD, activeRun: null, pending: [] }];
      state.messages = state.messages.filter((row) => row.id !== 'q1');
      return json({ ok: true });
    }
    return answer(path, route, json);
  });
  const heldUploads: Route[] = [];
  await page.route('**/api/uploads/grant', (route) => {
    heldUploads.push(route);
  });
  await page.route('**/api/uploads/upload', (route) => {
    heldUploads.push(route);
  });
  let uploadsDone = 0;
  const releaseUploads = async () => {
    let n = 0;
    for (const route of heldUploads.splice(0)) {
      n += 1;
      if (route.request().url().endsWith('/grant'))
        await route.fulfill({
          json: { uploadUrl: '/api/uploads', grant: `grant-${n}`, key: `t1/att-${n}.log`, attachmentId: `att-${n}` },
        });
      else {
        await route.fulfill({ json: { id: 'x', key: 'x', sizeBytes: 3 } });
        uploadsDone += 1;
      }
    }
  };
  let releaseLoad: () => void = () => undefined;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  await page.route('**/api/**', async (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    await loadGate;
    return route.fallback();
  });
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  const activeComposer = page.getByTestId('home-c').locator('.chief-composer');
  const option = (n: number) =>
    page.getByTestId('chief-question').getByTestId(`chief-question-option-0-${n}`);
  const goInApp = (path: string) =>
    page.evaluate((to) => {
      window.history.pushState({}, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  const focusComposer = async () => {
    await composer.click();
    await expect(composer).toBeFocused();
  };
  const steps: {
    name: string;
    run: () => Promise<void>;
    composer: string;
    extra?: () => Promise<void>;
  }[] = [
    {
      name: 'text typed while loading lands in the thread composer while a question is pending',
      run: async () => {
        await page.getByTestId('loading-composer').getByRole('textbox').fill('typed while loading');
        releaseLoad();
        await expect(page.getByTestId('chief-question')).toBeVisible();
      },
      composer: 'typed while loading',
      extra: async () => {
        await expect(page.getByTestId('chief-question-primary')).toHaveCount(0);
        await expect(option(0)).toBeEnabled();
      },
    },
    {
      name: 'emptying the thread text returns the composer to the answer',
      run: () => composer.fill(''),
      composer: '',
      extra: async () => {
        await expect(page.getByTestId('chief-question-primary')).toBeVisible();
        await expect(page.getByTestId('chief-composer-input')).toHaveAttribute('placeholder', '或者直接回复…');
      },
    },
    {
      name: 'withdrawing a queued message while answering shows it in the focused thread composer',
      run: async () => {
        await composer.fill('customA');
        await page.getByTestId('home-c').getByTestId('chief-queued-message').getByRole('button', { name: '撤回' }).click();
      },
      composer: 'queued note',
      extra: async () => {
        await expect(composer).toBeFocused();
        await expect(page.getByTestId('home-c').getByTestId('chief-queued-message')).toHaveCount(0);
        await expect(page.getByTestId('chief-question')).toBeVisible();
        await expect(page.getByTestId('chief-question-primary')).toHaveCount(0);
        await expect(option(0)).toBeEnabled();
      },
    },
    {
      name: 'emptying the restored text returns to the answer, whose draft is untouched',
      run: () => composer.fill(''),
      composer: 'customA',
      extra: async () => {
        await expect(page.getByTestId('chief-question-primary')).toBeVisible();
      },
    },
    {
      name: 'slash and mention in the answer are plain text with no menu',
      run: async () => {
        await composer.fill('');
        await focusComposer();
        await page.keyboard.type('/re @ag');
      },
      composer: '/re @ag',
      extra: async () => {
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(composer).not.toHaveAttribute('aria-expanded');
      },
    },
    { name: 'type the answer for A', run: () => composer.fill('ansA'), composer: 'ansA' },
    { name: 'retype the answer for A', run: () => composer.fill('ansA2'), composer: 'ansA2' },
    {
      name: 'focus B: empty',
      run: () => focusQuestion(page, B),
      composer: '',
    },
    { name: 'type the answer for B', run: () => composer.fill('ansB'), composer: 'ansB' },
    {
      name: 'an answer upload finishes into its answer while the user is on another page',
      run: async () => {
        await activeComposer.locator('input[type="file"]').setInputFiles({
          name: 'away.log',
          mimeType: 'text/plain',
          buffer: Buffer.from('away'),
        });
        await expect(activeComposer.getByTestId('attachment-pending')).toBeVisible();
        await goInApp('/app/machines/authorize');
        await expect(page.getByTestId('home-c')).toHaveCount(0);
        const before = uploadsDone;
        await expect(async () => {
          await releaseUploads();
          expect(uploadsDone).toBeGreaterThan(before);
        }).toPass();
        await goInApp('/app');
        await expect(shown(page)).toContainText('Who merges it?');
      },
      composer: 'ansB',
      extra: async () => {
        await expect(activeComposer.getByTestId('composer-attachments')).toContainText('away.log');
      },
    },
    {
      name: 'start a slow upload on B',
      run: async () => {
        await activeComposer.locator('input[type="file"]').setInputFiles({
          name: 'notes.log',
          mimeType: 'text/plain',
          buffer: Buffer.from('boom'),
        });
        await expect(page.getByTestId('attachment-pending')).toBeVisible();
      },
      composer: 'ansB',
    },
    {
      name: 'moving to A is blocked while it uploads',
      run: async () => {
        await focusQuestion(page, A);
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: '附件上传中' }).first()).toBeVisible();
      },
      composer: 'ansB',
      extra: async () => {
        await expect(shown(page)).toContainText('Who merges it?');
      },
    },
    {
      name: 'the upload finishes into B',
      run: async () => {
        await expect(async () => {
          await releaseUploads();
          await expect(page.getByTestId('attachment-pending')).toHaveCount(0, { timeout: 500 });
        }).toPass();
      },
      composer: 'ansB',
      extra: async () => {
        await expect(page.getByTestId('composer-attachments')).toContainText('notes.log');
      },
    },
    {
      name: 'A is unchanged after the upload on B',
      run: () => focusQuestion(page, A),
      composer: 'ansA2',
      extra: async () => {
        await expect(page.getByTestId('composer-attachments')).toHaveCount(0);
      },
    },
    {
      name: 'B kept its attachment',
      run: () => focusQuestion(page, B),
      composer: 'ansB',
      extra: async () => {
        await expect(page.getByTestId('composer-attachments')).toContainText('notes.log');
      },
    },
    {
      name: 'back to A: its answer is intact',
      run: () => focusQuestion(page, A),
      composer: 'ansA2',
    },
    {
      name: 'a digit in a non-empty answer types',
      run: async () => {
        await focusComposer();
        await page.keyboard.press('End');
        await page.keyboard.type('2');
      },
      composer: 'ansA22',
      extra: async () => {
        await expect(option(1)).toHaveAttribute('aria-pressed', 'false');
      },
    },
    {
      name: 'forward to B: its answer is intact',
      run: () => focusQuestion(page, B),
      composer: 'ansB',
    },
    {
      name: 'custom text then an option on B: the option is sent at once and A shows its text again',
      run: async () => {
        await option(0).click();
        await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
      },
      composer: 'ansA22',
      extra: async () => {
        await expect
          .poll(() => answered.map((row) => row.body.answers))
          .toEqual([[{ header: 'Merge · #2271', choices: ['Send it to ian'] }]]);
      },
    },
    { name: 'replace the answer for A', run: () => composer.fill('finalA'), composer: 'finalA' },
    {
      name: 'Enter with an upload in flight sends nothing until the upload finishes',
      run: async () => {
        await activeComposer.locator('input[type="file"]').setInputFiles({
          name: 'notes.log',
          mimeType: 'text/plain',
          buffer: Buffer.from('boom'),
        });
        await expect(page.getByTestId('attachment-pending')).toBeVisible();
        await composer.press('Enter');
        await page.waitForTimeout(500);
      },
      composer: 'finalA',
      extra: async () => {
        expect(answered).toHaveLength(1);
        await expect(page.getByTestId('chief-question-primary')).toBeDisabled();
        await expect.poll(() => heldUploads.length).toBeGreaterThan(0);
        await expect(async () => {
          await releaseUploads();
          await expect(page.getByTestId('attachment-pending')).toHaveCount(0, { timeout: 500 });
        }).toPass();
        await expect(page.getByTestId('chief-question-primary')).toBeEnabled();
        expect(answered).toHaveLength(1);
      },
    },
    {
      name: 'Enter twice fast sends exactly one answer, the text',
      run: async () => {
        await Promise.all([composer.press('Enter'), composer.press('Enter')]);
        await page.waitForTimeout(800);
      },
      composer: '',
      extra: async () => {
        await expect
          .poll(() => answered.map((row) => row.body.answers))
          .toEqual([
            [{ header: 'Merge · #2271', choices: ['Send it to ian'] }],
            [{ header: 'Model · #74', choices: [expect.stringMatching(/attachment:t1\/att-1\.log\)\nfinalA$/)] }],
          ]);
      },
    },
    {
      name: 'an upload in the thread composer finishes there when a question arrives mid-upload',
      run: async () => {
        await expect(page.getByTestId('chief-question')).toHaveCount(0);
        await composer.fill('threadDraft');
        await activeComposer.locator('input[type="file"]').setInputFiles({
          name: 'late.log',
          mimeType: 'text/plain',
          buffer: Buffer.from('late'),
        });
        await expect(activeComposer.getByTestId('attachment-pending')).toBeVisible();
        const late = question('ask-0000000c', 'Late · #9', 'One more thing?', [
          { label: 'Yes' },
          { label: 'No' },
        ]);
        state.messages = [...state.messages, { ...late, createdAt: 40 }];
        await page.evaluate(
          ([u, message]) =>
            window.__es.find((es) => es.url.includes(u as string))?.emit({ type: 'message', message }),
          [`/api/conversations/${THREAD.id}/stream`, late] as const,
        );
        await expect(page.getByTestId('chief-question')).toBeVisible();
        await expect(composer).toHaveValue('');
        await expect(async () => {
          await releaseUploads();
          await expect(page.getByTestId('home-c').getByTestId('attachment-pending')).toHaveCount(0, {
            timeout: 500,
          });
        }).toPass();
      },
      composer: '',
      extra: async () => {
        await expect(activeComposer.getByTestId('composer-attachments')).toHaveCount(0);
      },
    },
    {
      name: 'the answer draft stayed empty and the thread draft holds the late upload',
      run: async () => {
        await option(0).click();
        await expect(page.getByTestId('chief-question')).toHaveCount(0);
      },
      composer: 'threadDraft',
      extra: async () => {
        await expect
          .poll(() => answered.at(-1)?.body.answers)
          .toEqual([{ header: 'Late · #9', choices: ['Yes'] }]);
        await expect(activeComposer.getByTestId('composer-attachments')).toContainText('late.log');
      },
    },
  ];
  const failed: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
      await expect(composer).toHaveValue(step.composer, { timeout: 2000 });
      await step.extra?.();
    } catch {
      failed.push(step.name);
    }
  }
  expect(failed).toEqual([]);
});

test('a question that arrives while you watch rises into its card; a reload shows it still', async ({
  page,
}) => {
  const state = structuredClone({ ...TWO, messages: TWO.messages.slice(0, 1) });
  await mockLive(page, state);
  await page.goto('/app');
  await expect(page.getByText('Ship the relay fix')).toBeVisible();
  await page.waitForFunction(() => window.__es.some((es) => es.url.includes('/stream')));
  const late = question('ask-0000000a', A, 'Which model?', [{ label: 'First' }, { label: 'Second' }]);
  state.messages = [...state.messages, late];
  await page.evaluate(
    ([u, message]) =>
      window.__es.find((es) => es.url.includes(u as string))?.emit({ type: 'message', message }),
    [`/api/conversations/${THREAD.id}/stream`, late] as const,
  );
  const card = page.getByTestId('chief-question');
  await expect(card).toHaveClass(/dock-enter/);
  await expect(card).toHaveCSS('animation-duration', '0.18s');

  await page.reload();
  await expect(page.getByTestId('chief-question-option-0-0')).toBeVisible();
  await expect(page.getByTestId('chief-question')).not.toHaveClass(/dock-enter/);
});
