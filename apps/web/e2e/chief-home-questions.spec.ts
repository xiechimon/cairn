import { expect, test } from '@playwright/test';
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
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
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
  await page.getByTestId('chief-question-primary').click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]?.path).toContain(`/chief/threads/${THREAD.id}/questions/ask-0000000a/answer`);
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(dock.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await expect(badge).toHaveText('1');
  await dock.getByTestId('chief-question-option-0-0').click();
  await page.getByTestId('chief-question-primary').click();
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
  await page.getByTestId('chief-composer-input').fill('Use the metered key this once');
  await page.getByTestId('chief-question-primary').click();
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
  const composer = page.getByTestId('chief-composer-input');
  await composer.fill('Keep this text');
  await page.getByTestId('chief-question-next').click();
  await expect(composer).toHaveValue('');
  await page.getByTestId('chief-question-prev').click();
  await expect(composer).toHaveValue('Keep this text');
  await page.getByTestId('chief-question-primary').click();
  await expect(page.getByTestId('chief-question-error')).toBeVisible();
  await expect(composer).toHaveValue('Keep this text');
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
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
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
    const send = drawer.getByTestId('chief-question-primary');
    await expect(send).toBeVisible();
    await dock.getByTestId('chief-question-option-0-0').click();
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
      .evaluate((node) => {
        const scroller = node.parentElement!.parentElement!;
        return scroller.scrollHeight > scroller.clientHeight;
      });
    expect(scrolls).toBe(true);
    await dock.getByTestId('chief-question-option-0-5').scrollIntoViewIfNeeded();
    await expect(send).toBeVisible();
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

test('the primary button sits in the composer with its shortcut and Ctrl+Enter or Cmd+Enter submits from the card or the composer', async ({
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
  const keys = page.getByTestId('chief-question-primary').locator('[data-slot="kbd"]');
  await expect(page.locator('.chief-composer').getByTestId('chief-question-primary')).toBeVisible();
  await expect(dock.getByRole('button', { name: /提交回答/ })).toHaveCount(0);
  await expect(keys).toHaveCount(2);
  await expect(keys.last().locator('svg')).toBeVisible();
  await expect(keys.last()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await dock.getByTestId('chief-question-option-0-1').click();
  await dock.getByTestId('chief-question-option-0-1').press('Control+Enter');
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toEqual({ answers: [{ header: 'Model · #74', choices: ['wokey · deepseek-v4.1-flash'] }] });
});

test('selecting an option then Next, typing text then Next, and an empty composer with nothing selected', async ({
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
  await expect(composer).toHaveAttribute('placeholder', '输入你自己的回答，或留空使用选中的选项');
  await page.getByTestId('chief-question-option-0-0').click();
  await expect(primary).toBeEnabled();
  await composer.fill('typed answer wins');
  await composer.press('Enter');
  await expect.poll(() => answered).toEqual([
    { answers: [{ header: 'Model · #74', choices: ['typed answer wins'] }] },
  ]);
});

test('a multi-step request: Next moves on with the composer cleared, and Submit sends every answer', async ({
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
  await expect(primary).toContainText('下一步');
  await expect(primary).toBeDisabled();
  await page.getByTestId('chief-question-option-0-0').click();
  await primary.click();
  await expect(page.getByTestId('chief-question-position')).toHaveText('2 / 3');
  await expect(composer).toHaveValue('');
  await expect(primary).toBeDisabled();
  await expect(primary).toContainText('提交回答');
  await composer.fill('Intro and a custom section');
  await expect(primary).toBeEnabled();
  await primary.click();
  await expect
    .poll(() => answered)
    .toEqual([
      {
        answers: [
          { header: 'Theme', choices: ['Light'] },
          { header: 'Sections', choices: ['Intro and a custom section'] },
        ],
      },
    ]);
});

test('the expanded header is a quiet label and only the collapsed bar shows Needs you', async ({
  page,
}) => {
  await mockLive(page, structuredClone(ONE));
  await page.goto('/app');
  const card = page.getByTestId('chief-question-card');
  await expect(card.getByTestId('chief-question-collapse')).toContainText('问题 · Model · #74');
  await expect(card.getByTestId('chief-question-status')).toHaveClass(/sr-only/);
  await card.getByTestId('chief-question-collapse').click();
  await expect(card.getByTestId('chief-question-status')).not.toHaveClass(/sr-only/);
  await expect(card.getByTestId('chief-question-status')).toBeVisible();
});

for (const locale of ['zh', 'en'] as const) {
  for (const size of [
    { name: '320px phone', width: 320, height: 640 },
    { name: '375px phone', width: 375, height: 667 },
    { name: 'desktop drawer', width: 1440, height: 900 },
  ]) {
    test(`nothing in the card or composer overflows or is clipped (${locale}, ${size.name}, 6 long options)`, async ({
      page,
    }) => {
      await page.addInitScript((value) => localStorage.setItem('cairn-locale', value), locale);
      await page.setViewportSize({ width: size.width, height: size.height });
      await mockLive(page, structuredClone(LONG));
      await page.goto('/app/schedules?chief=chief-home');
      const drawer = page.locator('.chief-drawer');
      await expect(drawer.getByTestId('chief-question-card')).toBeVisible();
      await expect(drawer.getByTestId('chief-composer-input')).toBeVisible();
      const defects = await drawer.evaluate((root) => {
        const found: string[] = [];
        const scopes = [
          root.querySelector('[data-testid="chief-question-card"]'),
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
            const box = el.getBoundingClientRect();
            if (box.width <= 1 && box.height <= 1) continue;
            if (box.left < frame.left - 0.5 || box.right > frame.right + 0.5)
              found.push(`${name} leaves the frame horizontally`);
            const ellipsis =
              style.textOverflow === 'ellipsis' ||
              (el instanceof HTMLTextAreaElement && el.value === '');
            if (!ellipsis && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
              found.push(`${name} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
          }
          for (const el of scope.querySelectorAll('button, textarea, input')) {
            const box = el.getBoundingClientRect();
            if (box.width === 0) continue;
            if (box.bottom > frame.bottom + 0.5 || box.top < frame.top - 0.5) {
              let scrolls = false;
              for (let up = el.parentElement; up !== null && up !== scope; up = up.parentElement)
                if (/(auto|scroll)/.test(getComputedStyle(up).overflowY)) scrolls = true;
              if (!scrolls) found.push(`${el.tagName.toLowerCase()} leaves the frame vertically`);
            }
          }
        }
        const placeholder = root.querySelector('[data-testid="chief-composer-placeholder"]');
        if (placeholder !== null && getComputedStyle(placeholder).textOverflow !== 'ellipsis')
          found.push('composer placeholder does not ellipsize');
        return found;
      });
      expect(defects).toEqual([]);
      const dock = drawer.getByTestId('chief-question-dock');
      await expect(dock.getByTestId('chief-question-dismiss')).toBeInViewport({ ratio: 1 });
      await expect(drawer.getByTestId('chief-question-primary')).toBeInViewport({ ratio: 1 });
    });
  }
}

for (const size of [
  { name: '1440 home', url: '/app', width: 1440, height: 900 },
  { name: '380px drawer', url: '/app/schedules?chief=chief-home', width: 1440, height: 900 },
  { name: '375px phone', url: '/app', width: 375, height: 667 },
]) {
  test(`the card is as wide as the composer and fused to its top (${size.name})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(TWO));
    await page.goto(size.url);
    const scope = size.name === '380px drawer' ? page.locator('.chief-drawer') : page;
    const card = scope.getByTestId('chief-question-card');
    const composer = scope.locator('.chief-composer');
    await expect(card).toBeVisible();
    await expect
      .poll(async () => {
        const cardBox = (await card.boundingBox())!;
        const composerBox = (await composer.boundingBox())!;
        return [
          Math.round(cardBox.x - composerBox.x),
          Math.round(cardBox.width - composerBox.width),
          Math.round(cardBox.y + cardBox.height - composerBox.y),
        ];
      })
      .toEqual([0, 0, 0]);
  });
}

test('the card collapses to a one-line bar, stays collapsed per question, and expands again', async ({
  page,
}) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto('/app');
  const card = page.getByTestId('chief-question-card');
  await expect(card.getByTestId('chief-question-text')).toBeVisible();
  const open = (await card.boundingBox())!;
  await card.getByTestId('chief-question-collapse').click();
  await expect(card).toHaveAttribute('data-collapsed', '');
  await expect(card.getByTestId('chief-question-text')).toHaveCount(0);
  await expect(card.getByTestId('chief-question-position')).toHaveText('1 / 3');
  expect((await card.boundingBox())!.height).toBeLessThan(open.height / 3);
  await page.reload();
  await expect(page.getByTestId('chief-question-card')).toHaveAttribute('data-collapsed', '');
});

test('collapsed state survives stepping and re-expands from the chevron', async ({ page }) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto('/app');
  const card = page.getByTestId('chief-question-card');
  await card.getByRole('button', { name: '收起提问' }).last().click();
  await expect(card).toHaveAttribute('data-collapsed', '');
  await card.getByRole('button', { name: '展开提问' }).last().click();
  await expect(card).not.toHaveAttribute('data-collapsed', '');
  await expect(card.getByTestId('chief-question-text')).toBeVisible();
});

test('dismissing shows a five-second undo; undo keeps the question, waiting cancels it', async ({
  page,
}) => {
  const cancelled: string[] = [];
  await mockLive(page, structuredClone(ONE), (path, route, json) => {
    if (!path.endsWith('/cancel') || route.request().method() !== 'POST') return undefined;
    cancelled.push(path);
    return json({});
  });
  await page.goto('/app');
  const card = page.getByTestId('chief-question-card');
  await page.getByTestId('chief-question-dismiss').click();
  await expect(card).toHaveCount(0);
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已取消提问' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: '撤销' }).click();
  await expect(card).toBeVisible();
  expect(cancelled).toEqual([]);
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
  { name: 'drawer', url: '/app/schedules?chief=chief-home', width: 1440, height: 900 },
  { name: '375px phone', url: '/app/schedules?chief=chief-home', width: 375, height: 667 },
]) {
  test(`a very long header and prompt scroll inside the card and keep dismiss and submit clickable (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(VERY_LONG));
    await page.goto(size.url);
    const drawer = page.locator('.chief-drawer');
    const card = drawer.getByTestId('chief-question-card');
    await expect(card).toBeVisible();
    await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThanOrEqual(size.height * 0.4 + 1);
    await drawer.getByTestId('chief-question-option-0-0').scrollIntoViewIfNeeded();
    await drawer.getByTestId('chief-question-option-0-0').click();
    const dismiss = card.getByTestId('chief-question-dismiss');
    const submit = drawer.getByTestId('chief-question-primary');
    await expect(dismiss).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await dismiss.click({ trial: true });
    await submit.click({ trial: true });
  });
}

test('each pending request keeps its own composer draft when moving A, B, A, B', async ({ page }) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  await composer.fill('draft for A');
  await page.getByTestId('chief-question-next').click();
  await expect(page.getByTestId('chief-question-position')).toHaveText('2 / 2');
  await expect(composer).toHaveValue('');
  await composer.fill('draft for B');
  await page.getByTestId('chief-question-prev').click();
  await expect(composer).toHaveValue('draft for A');
  await page.getByTestId('chief-question-next').click();
  await expect(composer).toHaveValue('draft for B');
  await page.getByTestId('chief-question-prev').click();
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
  await page.getByRole('button', { name: '对某个 thread 说' }).click();
  await page.getByRole('menuitemradio').filter({ hasText: '#9' }).click();
  await expect(page.getByTestId('chief-question-primary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  await expect(composer).not.toHaveAttribute('placeholder', '输入你自己的回答，或留空使用选中的选项');
  await composer.fill('thread note');
  await composer.press('Enter');
  await expect.poll(() => messaged.length).toBe(1);
  expect(answered).toEqual([]);
  await expect(page.getByTestId('chief-question-card')).toBeVisible();
});

test('with a thread targeted, digits type, option clicks and page switches leave the thread draft alone', async ({
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
  await page.getByRole('button', { name: '对某个 thread 说' }).click();
  await page.getByRole('menuitemradio').filter({ hasText: '#9' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await composer.click();
  await expect(composer).toBeFocused();
  await page.keyboard.type('1abc');
  await expect(composer).toHaveValue('1abc');
  await expect(page.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('chief-question-option-0-1').click();
  await expect(page.getByTestId('chief-question-option-0-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('1abc');
  await page.getByTestId('chief-question-next').click();
  await expect(page.getByTestId('chief-question-position')).toHaveText('2 / 2');
  await expect(composer).toHaveValue('1abc');
  await page.getByTestId('chief-question-prev').click();
  await expect(composer).toHaveValue('1abc');
  await composer.press('Enter');
  await expect.poll(() => messaged.length).toBe(1);
  expect(messaged[0]?.content).toBe('1abc');
  expect(answered).toEqual([]);
});

test('answer drafts per request and the thread draft stay separate through every transition', async ({
  page,
}) => {
  const answered: { path: string; body: { answers: unknown[] } }[] = [];
  const messaged: { content?: string }[] = [];
  const state = { ...structuredClone(TWO), todos: [{ ...TASK, phase: 'confirm' }] };
  const answer = answerRoute(state, answered as { path: string; body: unknown }[]);
  await mockLive(page, state, (path, route, json) => {
    if (/^\/api\/todos\/[^/]+\/messages$/.test(path) && route.request().method() === 'POST') {
      messaged.push(route.request().postDataJSON());
      return json({ todoId: 'todo-1', conversationId: 'build-1', delivered: 'revision' }, 201);
    }
    return answer(path, route, json);
  });
  await page.goto('/app');
  const composer = page.getByTestId('chief-composer-input');
  const option = (n: number) => page.getByTestId(`chief-question-option-0-${n}`);
  const toThread = async () => {
    await page.getByRole('button', { name: '对某个 thread 说' }).click();
    await page.getByRole('menuitemradio').filter({ hasText: '#9' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
  const toCoordinator = async () => {
    await page.getByTestId('composer-thread-target').click();
    await page.getByRole('menuitemradio').filter({ hasText: '默认，由它安排' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
  const focusComposer = async () => {
    await composer.click();
    await expect(composer).toBeFocused();
  };
  const steps: { name: string; run: () => Promise<void>; composer: string; extra?: () => Promise<void> }[] = [
    { name: 'type the answer for A', run: () => composer.fill('ansA'), composer: 'ansA' },
    { name: 'target the thread: its own draft is empty', run: toThread, composer: '' },
    { name: 'type into the thread', run: () => composer.fill('noteX'), composer: 'noteX' },
    { name: 'digits type into the thread draft', run: async () => { await focusComposer(); await page.keyboard.press('End'); await page.keyboard.type('1'); }, composer: 'noteX1',
      extra: async () => { await expect(option(0)).toHaveAttribute('aria-pressed', 'false'); } },
    { name: 'click an option while the thread is targeted', run: () => option(1).click(), composer: 'noteX1',
      extra: async () => { await expect(option(1)).toHaveAttribute('aria-pressed', 'true'); } },
    { name: 'switch page to B while the thread is targeted', run: () => page.getByTestId('chief-question-next').click(), composer: 'noteX1' },
    { name: 'back to A while the thread is targeted', run: () => page.getByTestId('chief-question-prev').click(), composer: 'noteX1' },
    { name: 'target the Coordinator: A answer is back', run: toCoordinator, composer: 'ansA' },
    { name: 'switch page to B: empty', run: () => page.getByTestId('chief-question-next').click(), composer: '' },
    { name: 'type the answer for B', run: () => composer.fill('ansB'), composer: 'ansB' },
    { name: 'back to A: its answer is intact', run: () => page.getByTestId('chief-question-prev').click(), composer: 'ansA' },
    { name: 'digit in a non-empty answer types', run: async () => { await focusComposer(); await page.keyboard.press('End'); await page.keyboard.type('2'); }, composer: 'ansA2',
      extra: async () => { await expect(option(1)).toHaveAttribute('aria-pressed', 'true'); } },
    { name: 'forward to B: its answer is intact', run: () => page.getByTestId('chief-question-next').click(), composer: 'ansB' },
    { name: 'target the thread again: its draft is intact', run: toThread, composer: 'noteX1' },
    { name: 'Enter sends to the thread, answers untouched', run: () => composer.press('Enter'), composer: '',
      extra: async () => {
        await expect.poll(() => messaged.map((m) => m.content)).toEqual(['noteX1']);
        expect(answered).toEqual([]);
      } },
    { name: 'target the Coordinator: B answer still there', run: toCoordinator, composer: 'ansB' },
    { name: 'Enter answers B with the typed text', run: () => composer.press('Enter'), composer: 'ansB',
      extra: async () => {
        await expect.poll(() => answered.map((row) => row.body.answers)).toEqual([[{ header: 'Merge · #2271', choices: ['ansB'] }]]);
      } },
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
