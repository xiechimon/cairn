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

test('a pending question is its text and outlined chips at the end of the conversation, with nothing docked above the composer (D119)', async ({
  page,
}) => {
  const posts: string[] = [];
  await mockLive(page, structuredClone(ONE), (path, route) => {
    if (route.request().method() === 'POST') posts.push(path);
    return undefined;
  });
  await page.goto('/app');
  const question = page.getByTestId('chief-stream').getByTestId('chief-question');
  await expect(question.getByTestId('chief-question-chips')).toBeVisible();
  await expect(question.getByTestId('chief-question-text')).toHaveText(
    'relay-186 cannot run glm-5.3-flash. Which model?',
  );
  await expect(question.getByTestId('chief-question-header')).toHaveCount(0);
  await expect(question.getByText('Model · #74')).toBeHidden();
  await expect(question).toHaveAccessibleDescription('Model · #74');
  await question.getByTestId('chief-question-text').hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Model · #74');
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('chief-composer-block').getByTestId('chief-question')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
  const text = (await question.getByTestId('chief-question-text').boundingBox())!;
  const chip = (await question.getByTestId('chief-question-option-0-0').boundingBox())!;
  const composer = (await page.getByTestId('home-c').locator('.chief-composer').boundingBox())!;
  expect(chip.y).toBeGreaterThan(text.y + text.height);
  expect(chip.y + chip.height).toBeLessThan(composer.y);
  await expect(question.getByTestId('chief-question-option-0-0')).toContainText('Claude subscription');
  const recommended = question.getByTestId('chief-question-option-0-0');
  await expect(recommended).toHaveAttribute('data-recommended', '');
  await expect(recommended).not.toContainText('推荐');
  await expect(recommended).not.toContainText('Verified');
  await expect(recommended).toHaveAccessibleDescription('推荐 · Verified');
  await expect(recommended).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(question.getByTestId('chief-question-option-0-1')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await recommended.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('推荐 · Verified');
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('1');
  await expect(page.getByTestId('chief-question-descriptions')).toHaveCount(0);
  await expect(question.getByRole('button', { name: '取消提问' })).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveAttribute('placeholder', '输入你自己的回答…');
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
  await page.goto('/app/schedules');
  await expect(page.getByTestId('page-topbar')).toBeVisible();
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
  await page.goto('/app?chief=settings');
  await expect(page.getByTestId('chief-settings-topbar')).toBeVisible();
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
});

test('a chip answers at once and the badge drops; the next question takes its place', async ({
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
  const answers = page.getByTestId('chief-stream').locator('[data-question-answer]');
  await expect(answers).toHaveText(['Claude subscription', 'Send it to ian']);
  await expect(page.getByTestId('chief-stream').getByTestId('chief-question-line')).toHaveCount(0);
  await expect(page).toHaveTitle('Cairn');
});

test('a failed chip answer keeps the chips and says so', async ({ page }) => {
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
  await page.goto('/app/schedules');
  await expect(page).toHaveTitle('(2) Cairn');
  await expect(page.getByTestId('chief-question')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(0);
  await page.getByRole('complementary').getByRole('button', { name: /Coordinator/ }).first().click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByTestId('chief-question').getByTestId('chief-question-chips')).toBeInViewport();
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

test('at 375px the question and its chips sit at the end of the conversation above the composer', async ({
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

test('digits pick an option while nothing is being typed, and stay text in a non-empty composer', async ({
  page,
}) => {
  await mockLive(page, structuredClone(ONE));
  await page.goto('/app');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  const option = page.getByTestId('chief-question-option-0-0');
  await expect(option).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('2');
  await expect(page.getByTestId('chief-question-option-0-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('');
  await composer.click();
  await page.keyboard.press('1');
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('');
  await composer.fill('ship it');
  await page.keyboard.press('2');
  await expect(composer).toHaveValue('ship it2');
  await expect(page.getByTestId('chief-question-option-0-1')).toHaveAttribute('aria-pressed', 'false');
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
  test(`six long options wrap as chips and every chip, the composer and send stay reachable (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(LONG));
    await page.goto('/app?chief=chief-home');
    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();
    const question = coordinator.getByTestId('chief-question');
    await expect(question.getByTestId('chief-question-chips')).toBeVisible();
    const input = coordinator.getByTestId('chief-composer-input');
    await expect(input).toBeInViewport({ ratio: 1 });
    const send = coordinator.getByTestId('chief-question-primary');
    await expect(send).toBeInViewport({ ratio: 1 });
    for (let n = 0; n < 6; n += 1) {
      const chip = question.getByTestId(`chief-question-option-0-${n}`);
      await chip.scrollIntoViewIfNeeded();
      await expect(chip).toBeInViewport({ ratio: 1 });
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

test('one question at a time, the oldest first, with nothing above the bubble; a chip on an early step moves on; the tasks panel focuses another request', async ({
  page,
}) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto('/app');
  const block = page.getByTestId('chief-question');
  await expect(block.getByTestId('chief-question-text')).toHaveCount(1);
  await expect(block.getByTestId('chief-question-text')).toContainText('Which theme?');
  await expect(block.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(block.getByTestId('chief-question-prev')).toHaveCount(0);
  await expect(block.getByTestId('chief-question-next')).toHaveCount(0);
  const bubble = (await block.getByTestId('chief-question-text').boundingBox())!;
  const section = (await block.boundingBox())!;
  expect(bubble.y - section.y).toBeLessThanOrEqual(1);
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
  await page.waitForTimeout(500);
  expect(posts.map((post) => post.path)).toEqual([]);
  await expect(stream.getByTestId('chief-bubble')).toHaveCount(bubblesBefore);
  await expect(stream.locator('[data-question-answer]')).toHaveCount(0);
  await expect(stream.getByTestId('chief-question-line')).toHaveCount(0);
  await page.getByTestId('chief-question-submit').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]?.path).toContain('/questions/ask-0000000a/answer');
  expect(posts[0]?.body).toEqual({
    answers: [
      { header: 'Theme', choices: ['Dark'] },
      { header: 'Sections', choices: ['Details'] },
    ],
  });
  const answerBubble = stream.locator('[data-question-answer]');
  await expect(answerBubble).toHaveCount(1);
  await expect(answerBubble).toHaveAttribute('data-question-answer', 'ask-0000000a');
  expect(await answerBubble.evaluate((el) => (el as HTMLElement).innerText)).toBe('Dark\nDetails');
  await expect(stream.getByTestId('chief-question-line')).toHaveCount(0);
  await expect(stream.getByTestId('chief-bubble')).toHaveCount(bubblesBefore + 1);
  const looks = await stream.getByTestId('chief-bubble').evaluateAll((bubbles) =>
    bubbles.map((bubble) => {
      const cs = getComputedStyle(bubble);
      const column = bubble.closest('[data-testid="chief-msg"]')!.getBoundingClientRect();
      return {
        slot: bubble.getAttribute('data-slot'),
        fill: cs.backgroundColor,
        ink: cs.color,
        radius: cs.borderTopLeftRadius,
        padding: cs.padding,
        font: `${cs.fontSize}/${cs.lineHeight}`,
        right: Math.round(column.right - bubble.getBoundingClientRect().right),
      };
    }),
  );
  expect(looks).toHaveLength(2);
  expect(looks[1]).toEqual(looks[0]);
  expect(looks[1]?.slot).toBe('user-bubble');
  expect(looks[1]?.right).toBe(0);
  expect(posts).toHaveLength(1);
  await page.screenshot({ path: test.info().outputPath('answered-request.png') });
});

test('question chips look like suggested-reply chips: outlined 28px pills with regular ink and no fill', async ({
  page,
}) => {
  await mockLive(page, structuredClone(ONE));
  await page.goto('/app');
  const chip = page.getByTestId('chief-question-option-0-1');
  await expect(chip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(chip).toHaveCSS('border-top-width', '1px');
  await expect(chip).toHaveCSS('font-weight', '400');
  await expect(chip).toHaveCSS('height', '28px');
  await expect(chip).toHaveCSS('border-radius', /e\+\d+px$/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('2');
  await page.mouse.move(0, 0);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('the send button answers with the picked chip, and Ctrl+Enter or Cmd+Enter submits from the chips or the composer', async ({
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
  await question.getByTestId('chief-question-option-0-1').focus();
  await page.keyboard.press('2');
  await expect(question.getByTestId('chief-question-option-0-1')).toHaveAttribute('aria-pressed', 'true');
  await question.getByTestId('chief-question-option-0-1').press('Control+Enter');
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toEqual({ answers: [{ header: 'Model · #74', choices: ['wokey · deepseek-v4.1-flash'] }] });
});

test('a digit-picked option then typed text, and an empty composer with nothing picked', async ({
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
  await composer.click();
  await page.keyboard.press('1');
  await expect(page.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(primary).toBeEnabled();
  await composer.fill('typed answer wins');
  await composer.press('Enter');
  await expect.poll(() => answered).toEqual([
    { answers: [{ header: 'Model · #74', choices: ['typed answer wins'] }] },
  ]);
});

test('a multi-step request: a chip moves on with the composer cleared, multi-select chips toggle, and send submits every answer', async ({
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
      await expect(coordinator.getByTestId('chief-question-chips')).toBeVisible();
      await expect(coordinator.getByTestId('chief-composer-input')).toBeVisible();
      const defects = await coordinator.evaluate((root) => {
        const found: string[] = [];
        const scopes = [
          root.querySelector('[data-testid="chief-question-chips"]'),
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
      const bubble = coordinator.getByTestId('chief-question-text');
      await bubble.scrollIntoViewIfNeeded();
      await bubble.hover();
      const more = coordinator.getByTestId('chief-question-tools').getByTestId('chief-msg-more');
      await expect(more).toBeInViewport({ ratio: 1 });
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

test('Escape on the chips or the question bubble menu dismisses with a five-second undo; undo keeps the question, waiting cancels it', async ({
  page,
}) => {
  const cancelled: string[] = [];
  await mockLive(page, structuredClone(ONE), (path, route, json) => {
    if (!path.endsWith('/cancel') || route.request().method() !== 'POST') return undefined;
    cancelled.push(path);
    return json({});
  });
  await page.goto('/app');
  const card = page.getByTestId('chief-question-chips');
  await page.getByTestId('chief-question-option-0-0').focus();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已取消提问' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: '撤销' }).click();
  await expect(card).toBeVisible();
  expect(cancelled).toEqual([]);
  await page.getByTestId('chief-question-text').hover();
  await page.getByTestId('chief-question-tools').getByTestId('chief-msg-more').click();
  await expect(page.getByTestId('chief-question-dismiss')).toHaveText('取消提问');
  await page.getByTestId('chief-question-dismiss').click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => cancelled.length, { timeout: 8000 }).toBe(1);
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
  test(`a very long prompt wraps in the conversation and keeps the chips, Escape-dismiss and send working (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(VERY_LONG));
    await page.goto(size.url);
    const coordinator = page.getByTestId('home-c');
    const card = coordinator.getByTestId('chief-question-chips');
    await expect(card).toBeVisible();
    await expect(coordinator.getByTestId('chief-question-header')).toHaveCount(0);
    const text = (await coordinator.getByTestId('chief-question-text').boundingBox())!;
    expect(text.x + text.width).toBeLessThanOrEqual(size.width);
    await coordinator.getByTestId('chief-question-option-0-0').scrollIntoViewIfNeeded();
    await coordinator.getByTestId('chief-question-option-0-0').click({ trial: true });
    await coordinator.getByTestId('chief-question-option-0-0').focus();
    await page.keyboard.press('1');
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

test('targeting a thread turns the composer back into a normal send and leaves the question pending', async ({
  page,
}) => {
  const answered: string[] = [];
  const messaged: unknown[] = [];
  const withTodo = { ...structuredClone(ONE), todos: [{ ...TASK, phase: 'confirm' }] };
  await mockLive(page, withTodo, (path, route, json) => {
    if (path.endsWith('/answer') && route.request().method() === 'POST') {
      answered.push(path);
      return json({});
    }
    if (/^\/api\/todos\/[^/]+\/messages$/.test(path) && route.request().method() === 'POST') {
      messaged.push(route.request().postDataJSON());
      return json({ todoId: 'todo-1', conversationId: 'build-1', delivered: 'revision' }, 201);
    }
    return undefined;
  });
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  await expect(page.getByTestId('chief-question-primary')).toBeVisible();
  await page.locator('[data-testid="composer-plus"]:visible').click();
  await page.getByRole('menuitemradio').filter({ hasText: '#9' }).click();
  await expect(page.getByTestId('chief-question-primary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  await expect(composer).not.toHaveAttribute('placeholder', '输入你自己的回答…');
  await composer.fill('thread note');
  await composer.press('Enter');
  await expect.poll(() => messaged.length).toBe(1);
  expect(answered).toEqual([]);
  await expect(page.getByTestId('chief-question-chips')).toBeVisible();
});

test('with a thread targeted, digits type, page switches and a chip answer leave the thread draft alone', async ({
  page,
}) => {
  const answered: string[] = [];
  const messaged: { content?: string }[] = [];
  const withTodo = { ...structuredClone(TWO), todos: [{ ...TASK, phase: 'confirm' }] };
  await mockLive(page, withTodo, (path, route, json) => {
    if (path.endsWith('/answer') && route.request().method() === 'POST') {
      answered.push(path);
      return json({});
    }
    if (/^\/api\/todos\/[^/]+\/messages$/.test(path) && route.request().method() === 'POST') {
      messaged.push(route.request().postDataJSON());
      return json({ todoId: 'todo-1', conversationId: 'build-1', delivered: 'revision' }, 201);
    }
    return undefined;
  });
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  await page.locator('[data-testid="composer-plus"]:visible').click();
  await page.getByRole('menuitemradio').filter({ hasText: '#9' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await composer.click();
  await expect(composer).toBeFocused();
  await page.keyboard.type('1abc');
  await expect(composer).toHaveValue('1abc');
  await expect(page.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'false');
  await focusQuestion(page, B);
  await expect(shown(page)).toContainText('Who merges it?');
  await expect(composer).toHaveValue('1abc');
  await focusQuestion(page, A);
  await expect(composer).toHaveValue('1abc');
  await page.getByTestId('chief-question-option-0-1').click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toContain('/questions/ask-0000000a/answer');
  await expect(composer).toHaveValue('1abc');
  await composer.press('Enter');
  await expect.poll(() => messaged.length).toBe(1);
  expect(messaged[0]?.content).toBe('1abc');
  expect(answered).toHaveLength(1);
});

test('an answer upload in flight still blocks a chip answer and moving to another question after a withdraw switches to the thread composer', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = {
    ...structuredClone(TWO),
    threads: [
      { ...THREAD, activeRun: { phase: 'chief' }, pending: [{ messageId: 'q1', state: 'queued' }] },
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
  await page.getByTestId('home-c').getByTestId('queued-message').getByRole('button', { name: '撤回' }).click();
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
  const messaged: { content?: string }[] = [];
  const state = {
    ...structuredClone(TWO),
    threads: [
      { ...THREAD, activeRun: { phase: 'chief' }, pending: [{ messageId: 'q1', state: 'queued' }] },
    ],
    todos: [{ ...TASK, phase: 'confirm' }],
  };
  state.messages = [...state.messages, { id: 'q1', role: 'user', content: 'queued note', createdAt: 30 }];
  const answer = answerRoute(state, answered as { path: string; body: unknown }[]);
  await mockLive(page, state, (path, route, json) => {
    if (path === `/api/teams/t1/chief/threads/${THREAD.id}/messages/q1` && route.request().method() === 'DELETE') {
      state.threads = [{ ...THREAD, activeRun: null, pending: [] }];
      state.messages = state.messages.filter((row) => row.id !== 'q1');
      return json({ ok: true });
    }
    if (/^\/api\/todos\/[^/]+\/messages$/.test(path) && route.request().method() === 'POST') {
      messaged.push(route.request().postDataJSON());
      return json({ todoId: 'todo-1', conversationId: 'build-1', delivered: 'revision' }, 201);
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
  const pickByKey = async (n: number) => {
    await option(n).focus();
    await page.keyboard.press(String(n + 1));
  };
  const toThread = async () => {
    await page.locator('[data-testid="composer-plus"]:visible').click();
    await page.getByRole('menuitemradio').filter({ hasText: '#9' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
  const toCoordinator = async () => {
    await page.getByTestId('composer-thread-target').click();
    await page.getByRole('menuitemradio').filter({ hasText: '默认，由它安排' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
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
        await expect(page.getByTestId('chief-composer-placeholder')).toHaveText('输入你自己的回答…');
      },
    },
    {
      name: 'withdrawing a queued message while answering shows it in the focused thread composer',
      run: async () => {
        await composer.fill('customA');
        await page.getByTestId('home-c').getByTestId('queued-message').getByRole('button', { name: '撤回' }).click();
      },
      composer: 'queued note',
      extra: async () => {
        await expect(composer).toBeFocused();
        await expect(page.getByTestId('home-c').getByTestId('queued-message')).toHaveCount(0);
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
    { name: 'target the thread: its own draft is empty', run: toThread, composer: '' },
    { name: 'type into the thread', run: () => composer.fill('noteX'), composer: 'noteX' },
    {
      name: 'digits type into the thread draft',
      run: async () => {
        await focusComposer();
        await page.keyboard.press('End');
        await page.keyboard.type('1');
      },
      composer: 'noteX1',
      extra: async () => {
        await expect(option(0)).toHaveAttribute('aria-pressed', 'false');
      },
    },
    {
      name: 'pick an option by key inside the chips while the thread is targeted',
      run: () => pickByKey(1),
      composer: 'noteX1',
      extra: async () => {
        await expect(option(1)).toHaveAttribute('aria-pressed', 'true');
      },
    },
    {
      name: 'focus B from the tasks panel while the thread is targeted',
      run: () => focusQuestion(page, B),
      composer: 'noteX1',
    },
    {
      name: 'back to A while the thread is targeted',
      run: () => focusQuestion(page, A),
      composer: 'noteX1',
    },
    { name: 'target the Coordinator: the option replaced A custom text', run: toCoordinator, composer: '' },
    {
      name: 'typing custom text clears the option',
      run: () => composer.fill('ansA2'),
      composer: 'ansA2',
      extra: async () => {
        await expect(option(1)).toHaveAttribute('aria-pressed', 'false');
      },
    },
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
        await goInApp('/app/schedules');
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
      name: 'moving to A and the destination switch are blocked while it uploads',
      run: async () => {
        await focusQuestion(page, A);
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: '附件上传中' }).first()).toBeVisible();
        await page.locator('[data-testid="composer-plus"]:visible').click();
        await expect(page.getByRole('menuitem', { name: '对某个 thread 说' })).toBeDisabled();
        await expect(page.getByTitle('附件上传中').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
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
    { name: 'target the thread again: its draft is intact', run: toThread, composer: 'noteX1' },
    {
      name: 'Enter sends to the thread, answers untouched',
      run: () => composer.press('Enter'),
      composer: '',
      extra: async () => {
        await expect.poll(() => messaged.map((m) => m.content)).toEqual(['noteX1']);
        expect(answered).toEqual([]);
      },
    },
    { name: 'target the Coordinator: B answer still there', run: toCoordinator, composer: 'ansB' },
    {
      name: 'custom text then an option: the option is what is shown',
      run: () => pickByKey(0),
      composer: '',
      extra: async () => {
        await expect(option(0)).toHaveAttribute('aria-pressed', 'true');
      },
    },
    {
      name: 'submit B: the option is what is sent',
      run: () => composer.press('Enter'),
      composer: '',
      extra: async () => {
        await expect
          .poll(() => answered.map((row) => row.body.answers))
          .toEqual([[{ header: 'Merge · #2271', choices: ['Send it to ian'] }]]);
      },
    },
    {
      name: 'A shows its custom text again after B is answered',
      run: async () => {
        await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
      },
      composer: 'ansA22',
    },
    {
      name: 'an option then custom text: the text is what is shown',
      run: async () => {
        await pickByKey(0);
        await composer.fill('finalA');
      },
      composer: 'finalA',
      extra: async () => {
        await expect(option(0)).toHaveAttribute('aria-pressed', 'false');
      },
    },
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
