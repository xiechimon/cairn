import { expect, test } from '@playwright/test';
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
const NONE = { ...TWO, messages: TWO.messages.slice(0, 1) };

test('a pending question is a card directly above the composer, and the header has no question pill (D119)', async ({
  page,
}) => {
  const posts: string[] = [];
  await mockLive(page, structuredClone(ONE), (path, route) => {
    if (route.request().method() === 'POST') posts.push(path);
    return undefined;
  });
  await page.goto('/app');
  const dock = page.getByTestId('chief-composer-block').getByTestId('chief-question-dock');
  await expect(dock.getByTestId('chief-question-card')).toBeVisible();
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-count')).toHaveCount(0);
  await expect(page.getByTestId('chief-stream').getByTestId('chief-question-card')).toHaveCount(0);
  const dockBox = await dock.boundingBox();
  const composerBox = await page.getByTestId('home-c').locator('.chief-composer').boundingBox();
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(composerBox!.y);
  expect(composerBox!.y - (dockBox!.y + dockBox!.height)).toBeLessThan(24);
  await expect.poll(() => posts.some((path) => path.includes('/questions/'))).toBe(false);
});

test('no pending question means no card and no pill', async ({ page }) => {
  await mockLive(page, structuredClone(NONE));
  await page.goto('/app');
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-entry')).toHaveCount(0);
  await expect(page.getByTestId('attention-badge')).toHaveCount(0);
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

test('answering removes the card and the badge count; the next question takes its place', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(TWO);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  const dock = page.getByTestId('chief-question-dock');
  const badge = page.getByRole('complementary').getByTestId('attention-badge');
  await expect(page.getByTestId('chief-question-position')).toHaveText('1 / 2');
  await expect(badge).toHaveText('2');
  await dock.getByTestId('chief-question-option-0-0').click();
  await dock.getByRole('button', { name: '提交回答' }).click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]?.path).toContain(`/chief/threads/${THREAD.id}/questions/ask-0000000a/answer`);
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(dock.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await expect(badge).toHaveText('1');
  await dock.getByTestId('chief-question-option-0-0').click();
  await dock.getByRole('button', { name: '提交回答' }).click();
  await expect.poll(() => answered.length).toBe(2);
  await expect(dock).toHaveCount(0);
  await expect(badge).toHaveCount(0);
});

test('free text answers inline', async ({ page }) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(ONE);
  await mockLive(page, state, answerRoute(state, answered));
  await page.goto('/app');
  const dock = page.getByTestId('chief-question-dock');
  await dock.getByTestId('chief-question-other-0').click();
  await dock.getByTestId('chief-question-input-0').fill('Use the metered key this once');
  await dock.getByRole('button', { name: '提交回答' }).click();
  await expect
    .poll(() => answered.map((row) => row.body))
    .toEqual([{ answers: [{ header: 'Model · #74', choices: ['Use the metered key this once'] }] }]);
  await expect(dock).toHaveCount(0);
});

test('the sidebar Coordinator badge counts pending questions and opens the card from another page', async ({
  page,
}) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app/schedules');
  const badge = page.getByRole('complementary').getByTestId('attention-badge');
  await expect(badge).toHaveText('2');
  await expect(page.getByTestId('chief-question-dock')).toBeHidden();
  await page.getByRole('complementary').getByRole('button', { name: /Coordinator/ }).first().click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByTestId('chief-question-dock').getByTestId('chief-question-card')).toBeVisible();
  await expect(page.getByTestId('chief-question-position')).toHaveText('1 / 2');
});

test('stepping keeps a typed draft, and a failed submit keeps it too', async ({ page }) => {
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
  const card = page.getByTestId('chief-question-card');
  await card.getByTestId('chief-question-other-0').click();
  await card.getByTestId('chief-question-input-0').fill('Keep this text');
  await page.getByTestId('chief-question-next').click();
  await page.getByTestId('chief-question-prev').click();
  await expect(card.getByTestId('chief-question-input-0')).toHaveValue('Keep this text');
  await card.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByTestId('chief-question-error')).toBeVisible();
  await expect(card.getByTestId('chief-question-input-0')).toHaveValue('Keep this text');
  await expect(page.getByTestId('chief-question-position')).toHaveText('1 / 2');
});

test('at 375px the card sits above the composer and the last message stays visible', async ({
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
  const dock = page.getByTestId('chief-question-dock');
  await expect(dock).toBeVisible();
  await expect(page.getByText('The final message')).toBeVisible();
  const composer = page.getByTestId('home-c').locator('.chief-composer');
  await expect(composer).toBeInViewport({ ratio: 1 });
  const dockBox = await dock.boundingBox();
  const composerBox = await composer.boundingBox();
  const lastBox = await page.getByText('The final message').boundingBox();
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(composerBox!.y);
  expect(dockBox!.x).toBeGreaterThanOrEqual(0);
  expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(375);
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(dockBox!.y);
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

test('digits typed into the free-text answer stay text', async ({ page }) => {
  await mockLive(page, structuredClone(ONE));
  await page.goto('/app');
  const dock = page.getByTestId('chief-question-dock');
  await dock.getByTestId('chief-question-other-0').click();
  const input = dock.getByTestId('chief-question-input-0');
  await input.click();
  await page.keyboard.type('12');
  await expect(input).toHaveValue('12');
  await expect(dock.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'false');
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

for (const size of [
  { name: '600px drawer', width: 1440, height: 900 },
  { name: '375px phone', width: 375, height: 667 },
]) {
  test(`a long question scrolls inside its card and keeps the composer and send button reachable (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(LONG));
    await page.goto('/app/schedules?chief=chief-home');
    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    const dock = drawer.getByTestId('chief-question-dock');
    await expect(dock.getByTestId('chief-question-card')).toBeVisible();
    const input = drawer.getByTestId('chief-composer-input');
    await expect(input).toBeVisible();
    const send = drawer.getByRole('button', { name: '发送' });
    await expect(send).toBeVisible();
    await send.click({ trial: true });
    const frame = await drawer.boundingBox();
    const sendBox = await send.boundingBox();
    const dockBox = await dock.boundingBox();
    const inputBox = await input.boundingBox();
    expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
    expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(inputBox!.y);
    expect(dockBox!.height).toBeLessThanOrEqual(frame!.height * 0.65 + 1);
    const scrolls = await dock
      .getByTestId('chief-question-option-0-5')
      .evaluate((node) => node.parentElement!.scrollHeight > node.parentElement!.clientHeight);
    expect(scrolls).toBe(true);
    await dock.getByTestId('chief-question-option-0-5').scrollIntoViewIfNeeded();
    await expect(dock.getByRole('button', { name: '提交回答' })).toBeVisible();
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

test('one pager in the card header counts every question across requests, with no second pager', async ({
  page,
}) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto('/app');
  const dock = page.getByTestId('chief-question-dock');
  await expect(dock.getByTestId('chief-question-position')).toHaveCount(1);
  await expect(page.getByTestId('chief-question-card').getByTestId('chief-question-position')).toHaveText('1 / 3');
  await expect(page.getByTestId('chief-question-prev')).toBeDisabled();
  await expect(page.getByTestId('chief-question-next')).toBeDisabled();
  await dock.getByTestId('chief-question-option-0-0').click();
  await page.getByTestId('chief-question-next').click();
  await expect(page.getByTestId('chief-question-position')).toHaveText('2 / 3');
  await expect(dock.getByTestId('chief-question-text')).toContainText('Which sections?');
  await page.getByTestId('chief-question-next').click();
  await expect(page.getByTestId('chief-question-position')).toHaveText('3 / 3');
  await expect(dock.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await expect(page.getByTestId('chief-question-next')).toBeDisabled();
  await page.getByTestId('chief-question-prev').click();
  await page.getByTestId('chief-question-prev').click();
  await expect(page.getByTestId('chief-question-position')).toHaveText('1 / 3');
  await expect(dock.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'true');
});

test('a picked option fills only its mark, with no row background', async ({ page }) => {
  await mockLive(page, structuredClone(ONE));
  await page.goto('/app');
  const option = page.getByTestId('chief-question-option-0-0');
  await option.click();
  await page.mouse.move(0, 0);
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await expect(option).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('the primary button shows its shortcut and Ctrl+Enter or Cmd+Enter submits from inside the card', async ({
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
  const dock = page.getByTestId('chief-question-dock');
  await expect(dock.getByRole('button', { name: /提交回答/ }).locator('kbd')).toBeVisible();
  await dock.getByTestId('chief-question-option-0-1').click();
  await dock.getByTestId('chief-question-option-0-1').press('Control+Enter');
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toEqual({ answers: [{ header: 'Model · #74', choices: ['wokey · deepseek-v4.1-flash'] }] });
});
