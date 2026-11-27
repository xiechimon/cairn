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
const cardOf = (page: Page, requestId: string) =>
  page.getByTestId('chief-stream').locator(`[data-testid="chief-question"][data-request-id="${requestId}"]`);
const cardA = (page: Page) => cardOf(page, 'ask-0000000a');
const cardB = (page: Page) => cardOf(page, 'ask-0000000b');

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

function releaseHeld(held: Route[], name: string) {
  return async () => {
    let n = 0;
    for (const route of held.splice(0)) {
      n += 1;
      if (route.request().url().endsWith('/grant'))
        await route.fulfill({
          json: { uploadUrl: '/api/uploads', grant: `grant-${n}`, key: `t1/${name}-${n}.log`, attachmentId: `${name}-${n}` },
        });
      else await route.fulfill({ json: { id: 'x', key: 'x', sizeBytes: 4 } });
    }
  };
}

test('C11: a pending question is a card in the conversation where it was asked: the question in the reply serif, numbered rows with their descriptions, the first tagged 推荐 and none picked, its own text row and 跳过; the composer stays the chat composer', async ({
  page,
}) => {
  const posts: string[] = [];
  await mockLive(page, structuredClone(ONE), (path, route) => {
    if (route.request().method() === 'POST') posts.push(path);
    return undefined;
  });
  await page.goto('/app');
  const question = cardA(page);
  await expect(question).toBeVisible();
  await expect(page.getByTestId('chief-composer-block').getByTestId('chief-question')).toHaveCount(0);
  const text = question.getByTestId('chief-question-text');
  await expect(text).toHaveText('relay-186 cannot run glm-5.3-flash. Which model?');
  await expect(text).toHaveAttribute('title', 'Model · #74');
  await expect(text).toHaveCSS('font-family', /Songti|serif/i);
  await expect(question.getByTestId('chief-question-prev')).toHaveCount(0);
  await expect(question.getByTestId('chief-question-pager')).toHaveCount(0);
  const card = (await question.boundingBox())!;
  const asked = (await page.getByTestId('chief-stream').getByText('Ship the relay fix').boundingBox())!;
  const composer = (await page.getByTestId('home-c').locator('.chief-composer').boundingBox())!;
  expect(card.y).toBeGreaterThan(asked.y + asked.height);
  expect(card.y + card.height).toBeLessThanOrEqual(composer.y);
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
  await expect(question.getByRole('button', { name: '收起' })).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).not.toHaveAttribute(
    'placeholder',
    'relay-186 cannot run glm-5.3-flash. Which model?',
  );
  await expect.poll(() => posts.some((path) => path.includes('/questions/'))).toBe(false);
});

const FREE_ROW = {
  ...question('ask-0000000f', 'Branch · #5', 'What should the branch be called?', []),
  createdAt: 15,
};

const FREE = {
  threads: [THREAD],
  messages: [
    { id: 'request', role: 'user', content: 'Ship the relay fix', createdAt: 10 },
    FREE_ROW,
    ...TWO.messages.slice(1),
  ],
  todos: [],
};

test('a question with no options is a Coordinator message among the choice cards, and the next composer message is an ordinary send that leaves the cards waiting', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(FREE);
  const sent = await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const asked = stream.getByTestId('chief-reply').filter({ hasText: 'What should the branch be called?' });
  await expect(asked).toBeVisible();
  await expect(cardOf(page, 'ask-0000000f')).toHaveCount(0);
  await expect(stream.getByTestId('chief-question')).toHaveCount(2);
  const askedBox = (await asked.boundingBox())!;
  const aBox = (await cardA(page).boundingBox())!;
  expect(askedBox.y + askedBox.height).toBeLessThanOrEqual(aBox.y);
  const composer = page.getByTestId('chief-composer-input');
  await composer.fill('relay-fix');
  await composer.press('Enter');
  await expect.poll(() => sent).toContain('relay-fix');
  await expect(stream.getByTestId('chief-bubble').filter({ hasText: 'relay-fix' })).toBeVisible();
  await expect(composer).toHaveValue('');
  await expect(stream.getByTestId('chief-question')).toHaveCount(2);
  expect(answered).toEqual([]);
});

for (const status of ['answered', 'cancelled'] as const) {
  test(`a question with no options stays a Coordinator message once ${status}, with no receipt`, async ({
    page,
  }) => {
    const row = {
      ...FREE_ROW,
      content: JSON.stringify({
        ...JSON.parse(FREE_ROW.content),
        status,
        answers: status === 'answered' ? [{ header: 'Branch · #5', text: 'relay-fix' }] : null,
      }),
    };
    await mockLive(page, {
      threads: [THREAD],
      messages: [{ id: 'request', role: 'user', content: 'Ship the relay fix', createdAt: 10 }, row],
      todos: [],
    });
    await page.goto('/app');
    const stream = page.getByTestId('chief-stream');
    await expect(
      stream.getByTestId('chief-reply').filter({ hasText: 'What should the branch be called?' }),
    ).toBeVisible();
    await expect(stream.getByTestId('chief-question')).toHaveCount(0);
    await expect(stream.getByTestId('chief-question-receipt')).toHaveCount(0);
  });
}

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

test('every pending request is its own card in stream order; a row answers at once and the badge drops, the other card stays, and each answer leaves one receipt', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(TWO);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  const question = page.getByTestId('chief-question');
  await expect(question).toHaveCount(2);
  await expect(cardA(page).getByTestId('chief-question-text')).toContainText('Which model?');
  await expect(cardB(page).getByTestId('chief-question-text')).toContainText('Who merges it?');
  const [aBox, bBox] = [(await cardA(page).boundingBox())!, (await cardB(page).boundingBox())!];
  expect(aBox.y + aBox.height).toBeLessThanOrEqual(bBox.y);
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-pager')).toHaveCount(0);
  await expect(page).toHaveTitle('(2) Cairn');
  await cardA(page).getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]?.path).toContain(`/chief/threads/${THREAD.id}/questions/ask-0000000a/answer`);
  expect(answered[0]?.body).toEqual({ answers: [{ header: 'Model · #74', choices: ['Claude subscription'] }] });
  await expect(cardA(page)).toHaveCount(0);
  await expect(question).toHaveCount(1);
  await expect(cardB(page).getByTestId('chief-question-text')).toContainText('Who merges it?');
  await expect(page).toHaveTitle('(1) Cairn');
  await cardB(page).getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered.length).toBe(2);
  await expect(question).toHaveCount(0);
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

test('the card text row answers with what is typed', async ({ page }) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(ONE);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  const other = cardA(page).getByTestId('chief-question-other-0');
  await other.fill('Use the metered key this once');
  await other.press('Enter');
  await expect
    .poll(() => answered.map((row) => row.body))
    .toEqual([{ answers: [{ header: 'Model · #74', choices: ['Use the metered key this once'] }] }]);
  await expect(cardA(page)).toHaveCount(0);
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
  await expect(cardB(page)).toBeInViewport();
  await expect(cardB(page).getByTestId('chief-question-text')).toContainText('Who merges it?');
});

test('each card keeps its own written answer while the tasks panel moves between them, the composer stays untouched, and a failed submit keeps the text', async ({
  page,
}) => {
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
  const otherA = cardA(page).getByTestId('chief-question-other-0');
  const otherB = cardB(page).getByTestId('chief-question-other-0');
  await otherA.fill('draft for A');
  await otherB.fill('draft for B');
  await focusQuestion(page, A);
  await expect(cardA(page)).toBeInViewport();
  await focusQuestion(page, B);
  await expect(cardB(page)).toBeInViewport();
  await focusQuestion(page, A);
  await expect(otherA).toHaveValue('draft for A');
  await expect(otherB).toHaveValue('draft for B');
  await expect(composer).toHaveValue('');
  await otherA.press('Enter');
  await expect(cardA(page).getByTestId('chief-question-error')).toBeVisible();
  await expect(otherA).toHaveValue('draft for A');
  await expect(otherB).toHaveValue('draft for B');
  await expect(composer).toHaveValue('');
});

test('at 375px each card sits in the conversation where it was asked, inside the window, with the composer whole below', async ({
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
  const composer = page.getByTestId('home-c').locator('.chief-composer');
  await expect(page.getByText('The final message')).toBeVisible();
  await expect(composer).toBeInViewport({ ratio: 1 });
  for (const card of [cardA(page), cardB(page)]) {
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId('chief-question-option-0-0')).toBeInViewport({ ratio: 1 });
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
  const before = (await page.getByText('History message 13').boundingBox())!;
  const aBox = (await cardA(page).boundingBox())!;
  const bBox = (await cardB(page).boundingBox())!;
  const lastBox = (await page.getByText('The final message').boundingBox())!;
  expect(before.y + before.height).toBeLessThanOrEqual(aBox.y);
  expect(aBox.y + aBox.height).toBeLessThanOrEqual(bBox.y);
  expect(bBox.y + bBox.height).toBeLessThanOrEqual(lastBox.y);
  await expect(composer).toBeInViewport({ ratio: 1 });
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
  test(`six long options with descriptions: every row and the text row are reachable in the conversation while the composer stays in view (${size.name})`, async ({
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
    for (let n = 0; n < 6; n += 1) {
      const chip = question.getByTestId(`chief-question-option-0-${n}`);
      await chip.scrollIntoViewIfNeeded();
      await expect(chip).toBeInViewport({ ratio: 0.95 });
      const box = (await chip.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    }
    const other = question.getByTestId('chief-question-other-0');
    await other.scrollIntoViewIfNeeded();
    await expect(other).toBeInViewport({ ratio: 1 });
    await expect(input).toBeInViewport({ ratio: 1 });
  });
}

for (const size of [
  { name: '1440 desktop', width: 1440, height: 900 },
  { name: '390px phone', width: 390, height: 844 },
]) {
  test(`the option list stops above the card's bottom edge, and scrolled to the end the last option and the answer row sit whole inside it (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(LONG));
    await page.goto('/app?chief=chief-home');
    const question = page.getByTestId('home-c').getByTestId('chief-question');
    await expect(question).toBeVisible();
    const list = question.locator('[data-slot="question-list"]');
    const inset = () =>
      question.evaluate((dock) =>
        Math.round(dock.getBoundingClientRect().bottom - dock.querySelector('[data-slot="question-list"]')!.getBoundingClientRect().bottom),
      );
    expect(await inset()).toBeGreaterThanOrEqual(8);
    const listBox = (await list.boundingBox())!;
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 200);
    await expect
      .poll(() => list.evaluate((el) => el.scrollHeight <= el.clientHeight || el.scrollTop > 0))
      .toBe(true);
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const geometry = await question.evaluate((dock) => {
      const list = dock.querySelector('[data-slot="question-list"]')!;
      const rows = [...list.querySelectorAll('[data-dock-row]')].map(
        (row) => (row.closest('[data-dock-row], div') as HTMLElement).getBoundingClientRect(),
      );
      const view = list.getBoundingClientRect();
      const card = dock.getBoundingClientRect();
      const last = rows.at(-1)!;
      const lastOption = rows.at(-2)!;
      return {
        atEnd: Math.ceil(list.scrollTop + list.clientHeight) >= list.scrollHeight,
        lastOptionWhole: lastOption.top >= view.top - 0.5 && lastOption.bottom <= view.bottom + 0.5,
        answerRowWhole: last.top >= view.top - 0.5 && last.bottom <= view.bottom + 0.5,
        bottomPadding: Math.round(card.bottom - last.bottom),
      };
    });
    expect(geometry.atEnd).toBe(true);
    expect(geometry.lastOptionWhole).toBe(true);
    expect(geometry.answerRowWhole).toBe(true);
    expect(geometry.bottomPadding).toBeGreaterThanOrEqual(8);
    expect(await inset()).toBeGreaterThanOrEqual(8);
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

test('each request is its own card; the 1/N pager walks only the steps of its own request; a row on an early step moves on; the tasks panel scrolls to the card it names', async ({
  page,
}) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto('/app');
  const block = cardA(page);
  const other = cardB(page);
  await expect(page.getByTestId('chief-question')).toHaveCount(2);
  await expect(block.getByTestId('chief-question-text')).toHaveCount(1);
  await expect(block.getByTestId('chief-question-text')).toContainText('Which theme?');
  await expect(other.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await expect(other.getByTestId('chief-question-pager')).toHaveCount(0);
  const pager = block.getByTestId('chief-question-pager');
  await expect(pager).toHaveText('1/2');
  await expect(block.getByTestId('chief-question-prev')).toBeDisabled();
  await block.getByTestId('chief-question-next').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Which sections?');
  await expect(pager).toHaveText('2/2');
  await expect(block.getByTestId('chief-question-next')).toBeDisabled();
  await expect(other.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await block.getByTestId('chief-question-prev').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Which theme?');
  await block.getByTestId('chief-question-option-0-0').click();
  await expect(block.getByTestId('chief-question-text')).toContainText('Which sections?');
  await focusQuestion(page, 'Merge · #2271');
  await expect(other).toBeInViewport();
  await focusQuestion(page, 'Theme');
  await expect(block).toBeInViewport();
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
  const block = cardA(page);
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
  await block.getByTestId('chief-question-submit').click();
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
  expect(look).toEqual({ question: '14px', answer: '14px', chips: 0 });
  await page.screenshot({ path: test.info().outputPath('answered-request.png') });
});

test('the text row send button appears once something is typed and answers with it, and Ctrl+Enter submits it from a focused row', async ({
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
  const question = cardA(page);
  const submit = question.getByTestId('chief-question-submit');
  await expect(submit).toHaveCount(0);
  await expect(question.getByTestId('chief-question-skip')).toBeVisible();
  await question.getByTestId('chief-question-other-0').fill('the cheaper one');
  await expect(submit).toHaveAttribute('aria-label', '提交回答');
  await expect(submit).toBeEnabled();
  await expect(question.getByTestId('chief-question-skip')).toHaveCount(0);
  await expect(page.locator('.chief-composer').getByRole('button', { name: '提交回答' })).toHaveCount(0);
  await question.getByTestId('chief-question-option-0-1').press('Control+Enter');
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toEqual({ answers: [{ header: 'Model · #74', choices: ['the cheaper one'] }] });
});

test('a clicked option answers at once, and an empty text row with nothing picked sends nothing', async ({
  page,
}) => {
  const answered: unknown[] = [];
  await mockLive(page, structuredClone(ONE), (path, route, json) => {
    if (!path.endsWith('/answer') || route.request().method() !== 'POST') return undefined;
    answered.push(route.request().postDataJSON());
    return json({});
  });
  await page.goto('/app');
  await cardA(page).getByTestId('chief-question-other-0').press('Enter');
  await page.waitForTimeout(300);
  expect(answered).toEqual([]);
  await cardA(page).getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered).toEqual([
    { answers: [{ header: 'Model · #74', choices: ['Claude subscription'] }] },
  ]);
});

test('a multi-step request: a row moves on, multi-select rows check, the text row adds a custom choice, and submit sends every answer', async ({
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
  const card = cardA(page);
  await card.getByTestId('chief-question-option-0-0').click();
  await expect(card.getByTestId('chief-question-text')).toContainText('Which sections?');
  const submit = card.getByTestId('chief-question-submit');
  await expect(submit).toBeDisabled();
  const details = card.getByTestId('chief-question-option-1-1');
  await expect(async () => {
    await details.click();
    await expect(details).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass();
  await page.mouse.move(0, 0);
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveAttribute('aria-label', '提交回答');
  expect(answered).toEqual([]);
  await card.getByTestId('chief-question-other-1').fill('a custom section');
  await expect(card.getByTestId('chief-question-count')).toHaveText('已选 2 个');
  await submit.click();
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
      const skip = coordinator.getByTestId('chief-question-skip');
      await skip.scrollIntoViewIfNeeded();
      await expect(skip).toBeInViewport({ ratio: 1 });
      await expect(coordinator.getByTestId('chief-composer-input')).toBeInViewport({ ratio: 1 });
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
  const card = cardA(page);
  await card.getByTestId('chief-question-skip').click();
  await expect(card).toHaveCount(0);
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已跳过提问' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: '撤销' }).click();
  await expect(card).toBeVisible();
  expect(cancelled).toEqual([]);
  await card.getByTestId('chief-question-skip').click();
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
  test(`a very long prompt wraps in the card and keeps the rows and the text row send working (${size.name})`, async ({
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
    const other = card.getByTestId('chief-question-other-0');
    await other.scrollIntoViewIfNeeded();
    await other.fill('Maybe');
    const submit = card.getByTestId('chief-question-submit');
    await expect(submit).toBeInViewport({ ratio: 1 });
    await submit.click({ trial: true });
    const submitBox = (await submit.boundingBox())!;
    expect(submitBox.x + submitBox.width).toBeLessThanOrEqual(size.width);
  });
}

test('text typed while the conversation loads stays in the composer when the card shows, and a withdrawn queued message comes back there with the card still usable', async ({
  page,
}) => {
  const state = {
    ...structuredClone(TWO),
    threads: [
      { ...THREAD, activeRun: { phase: 'chief' }, pending: [{ messageId: 'q1', state: 'held' }] },
    ],
  };
  state.messages = [...state.messages, { id: 'q1', role: 'user', content: 'queued note', createdAt: 30 }];
  await mockLive(page, state, (path, route, json) => {
    if (path === `/api/teams/t1/chief/threads/${THREAD.id}/messages/q1` && route.request().method() === 'DELETE') {
      state.threads = [{ ...THREAD, activeRun: null, pending: [] }];
      state.messages = state.messages.filter((row) => row.id !== 'q1');
      return json({ ok: true });
    }
    return undefined;
  });
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
  await page.getByTestId('loading-composer').getByRole('textbox').fill('typed while loading');
  releaseLoad();
  await expect(page.getByTestId('chief-question')).toHaveCount(2);
  await expect(composer).toHaveValue('typed while loading');
  await expect(cardB(page).getByTestId('chief-question-option-0-0')).toBeEnabled();
  await composer.fill('');
  await page.getByTestId('home-c').getByTestId('chief-queued-message').getByRole('button', { name: '撤回' }).click();
  await expect(composer).toHaveValue('queued note');
  await expect(composer).toBeFocused();
  await expect(page.getByTestId('home-c').getByTestId('chief-queued-message')).toHaveCount(0);
  await expect(cardB(page)).toBeVisible();
  await expect(cardB(page).getByTestId('chief-question-option-0-0')).toBeEnabled();
});

test('a question that arrives while you write leaves the composer text and its upload where they are', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(NONE);
  await mockLive(page, state, answerRoute(state, answered));
  const held: Route[] = [];
  await page.route('**/api/uploads/grant', (route) => {
    held.push(route);
  });
  await page.route('**/api/uploads/upload', (route) => {
    held.push(route);
  });
  const release = releaseHeld(held, 'late');
  await page.goto('/app');
  await expect(page.getByText('Ship the relay fix')).toBeVisible();
  await page.waitForFunction(() => window.__es.some((es) => es.url.includes('/stream')));
  const composer = page.getByTestId('chief-composer-input');
  const activeComposer = page.getByTestId('home-c').locator('.chief-composer');
  await composer.fill('threadDraft');
  await activeComposer.locator('input[type="file"]').setInputFiles({
    name: 'late.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('late'),
  });
  await expect(activeComposer.getByTestId('attachment-pending')).toBeVisible();
  const late = question('ask-0000000c', 'Late · #9', 'One more thing?', [{ label: 'Yes' }, { label: 'No' }]);
  state.messages = [...state.messages, { ...late, createdAt: 40 }];
  await page.evaluate(
    ([u, message]) =>
      window.__es.find((es) => es.url.includes(u as string))?.emit({ type: 'message', message }),
    [`/api/conversations/${THREAD.id}/stream`, late] as const,
  );
  const card = cardOf(page, 'ask-0000000c');
  await expect(card).toBeVisible();
  await expect(composer).toHaveValue('threadDraft');
  await expect(async () => {
    await release();
    await expect(activeComposer.getByTestId('attachment-pending')).toHaveCount(0, { timeout: 500 });
  }).toPass();
  await expect(activeComposer.getByTestId('composer-attachments')).toContainText('late.log');
  await card.getByTestId('chief-question-option-0-0').click();
  await expect
    .poll(() => answered.at(-1)?.body)
    .toEqual({ answers: [{ header: 'Late · #9', choices: ['Yes'] }] });
  await expect(composer).toHaveValue('threadDraft');
  await expect(activeComposer.getByTestId('composer-attachments')).toContainText('late.log');
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

test('header leaves Waiting for you after the question is answered', async ({ page }) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(ONE);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'ask');
  await expect(page.getByTestId('chief-status-pill')).toHaveText('等你确认');
  await cardA(page).getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered.length).toBe(1);
  await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('chief-status-pill')).not.toHaveText('等你确认');
});

test('header leaves Waiting for you after the question is skipped', async ({ page }) => {
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
  await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'ask');
  await cardA(page).getByTestId('chief-question-skip').click();
  await expect(cardA(page)).toHaveCount(0);
  await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'idle');
  await expect.poll(() => cancelled.length, { timeout: 8000 }).toBe(1);
  await expect(page.getByTestId('chief-status-mark')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('chief-status-pill')).not.toHaveText('等你确认');
});
