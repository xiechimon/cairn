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
  await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveCount(0);
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
  { name: '1440 desktop', width: 1440, height: 900 },
  { name: '375px phone', width: 375, height: 667 },
]) {
  test(`a long question scrolls inside its card and keeps the composer and send button reachable (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(LONG));
    await page.goto('/app?chief=chief-home');
    const coordinator = page.getByTestId('home-c');
    await expect(coordinator).toBeVisible();
    const dock = coordinator.getByTestId('chief-question-dock');
    await expect(dock.getByTestId('chief-question-card')).toBeVisible();
    const input = coordinator.getByTestId('chief-composer-input');
    await expect(input).toBeVisible();
    const send = coordinator.getByTestId('chief-question-primary');
    await expect(send).toBeVisible();
    await dock.getByTestId('chief-question-option-0-0').click();
    await send.click({ trial: true });
    const frame = await coordinator.boundingBox();
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
    { name: '1440 desktop', width: 1440, height: 900 },
  ]) {
    test(`nothing in the card or composer overflows or is clipped (${locale}, ${size.name}, 6 long options)`, async ({
      page,
    }) => {
      await page.addInitScript((value) => localStorage.setItem('cairn-locale', value), locale);
      await page.setViewportSize({ width: size.width, height: size.height });
      await mockLive(page, structuredClone(LONG));
      await page.goto('/app?chief=chief-home');
      const coordinator = page.getByTestId('home-c');
      await expect(coordinator.getByTestId('chief-question-card')).toBeVisible();
      await expect(coordinator.getByTestId('chief-composer-input')).toBeVisible();
      const defects = await coordinator.evaluate((root) => {
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
      const dock = coordinator.getByTestId('chief-question-dock');
      await expect(
        dock.getByTestId(size.width <= 640 ? 'chief-question-more' : 'chief-question-dismiss'),
      ).toBeInViewport({ ratio: 1 });
      await expect(coordinator.getByTestId('chief-question-primary')).toBeInViewport({ ratio: 1 });
    });
  }
}

for (const size of [
  { name: '1440 home', url: '/app', width: 1440, height: 900 },
  { name: '375px phone', url: '/app', width: 375, height: 667 },
]) {
  test(`the card is as wide as the composer and fused to its top (${size.name})`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(TWO));
    await page.goto(size.url);
    const scope = page.getByTestId('home-c');
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

function surfaceEdges(page: Page) {
  return page.evaluate(() => {
    const read = (el: Element) => {
      const style = getComputedStyle(el);
      const layers = style.boxShadow.split(/,(?![^(]*\))/).map((layer) => layer.trim());
      const rings: Record<string, string> = {};
      let outerRing = false;
      for (const layer of layers) {
        const color = /^(rgba?\([^)]*\)|oklab\([^)]*\)|color\([^)]*\))/.exec(layer)?.[1] ?? '';
        const [x, y, blur, spread] = layer
          .slice(color.length)
          .trim()
          .split(/\s+/)
          .map((part) => Number.parseFloat(part));
        if (!layer.endsWith('inset')) {
          if (blur === 0 && (spread ?? 0) > 0) outerRing = true;
          continue;
        }
        if ((spread ?? 0) > 0) rings.all = color;
        else if ((x ?? 0) > 0) rings.left = color;
        else if ((x ?? 0) < 0) rings.right = color;
        else if ((y ?? 0) > 0) rings.top = color;
        else if ((y ?? 0) < 0) rings.bottom = color;
      }
      const borders = ['Top', 'Right', 'Bottom', 'Left'].map(
        (side) => style.getPropertyValue(`border-${side.toLowerCase()}-width`),
      );
      return { rings, outerRing, borders };
    };
    return {
      card: read(document.querySelector('[data-testid="home-c"] [data-testid="chief-question-card"]')!),
      composer: read(document.querySelector('[data-testid="home-c"] .chief-composer')!),
    };
  });
}

test('a question left pending while the composer targets a thread stays its own outlined card', async ({
  page,
}) => {
  await mockLive(page, { ...structuredClone(ONE), todos: [{ ...TASK, phase: 'confirm' }] });
  await page.goto('/app');
  const scope = page.getByTestId('home-c');
  const card = scope.getByTestId('chief-question-card');
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: '对某个 thread 说' }).click();
  await page.getByRole('menuitemradio').filter({ hasText: '#9' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(card.getByRole('button', { name: '提交回答' })).toBeVisible();
  const { card: top, composer: bottom } = await surfaceEdges(page);
  expect(Object.keys(top.rings)).toEqual(['all']);
  expect(Object.keys(bottom.rings)).toEqual(['all']);
  const cardBox = (await card.boundingBox())!;
  const composerBox = (await scope.locator('.chief-composer').boundingBox())!;
  expect(composerBox.y - (cardBox.y + cardBox.height)).toBeGreaterThan(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the card and composer read as one surface: one hairline per outer edge, none at the seam (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await mockLive(page, structuredClone(ONE));
    await page.goto('/app');
    const scope = page.getByTestId('home-c');
    const card = scope.getByTestId('chief-question-card');
    const composer = scope.locator('.chief-composer');
    await expect(card).toBeVisible();
    const edges = () => surfaceEdges(page);
    const assertOneSurface = async () => {
      const { card: top, composer: bottom } = await edges();
      expect(top.borders).toEqual(['0px', '0px', '0px', '0px']);
      expect(bottom.borders).toEqual(['0px', '0px', '0px', '0px']);
      expect(top.outerRing).toBe(false);
      expect(bottom.outerRing).toBe(false);
      expect(Object.keys(top.rings).sort()).toEqual(['left', 'right', 'top']);
      expect(Object.keys(bottom.rings).sort()).toEqual(['bottom', 'left', 'right']);
      expect(top.rings.left).toBe(bottom.rings.left);
      expect(top.rings.right).toBe(bottom.rings.right);
      expect(top.rings.top).toBe(bottom.rings.bottom);
      return top.rings.left;
    };
    const resting = await assertOneSurface();
    await page.mouse.move(0, 0);
    const seam = (await composer.boundingBox())!;
    const strip = await page.screenshot({
      clip: { x: Math.round(seam.x + seam.width / 2), y: Math.round(seam.y) - 16, width: 1, height: 32 },
    });
    const colors = await page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return [...seen];
    }, strip.toString('base64'));
    expect(colors, 'the 32px across the seam is one flat fill').toHaveLength(1);
    await composer.locator('textarea').focus();
    await expect.poll(async () => (await edges()).card.rings.left).not.toBe(resting);
    await assertOneSurface();
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
  { name: '1440 desktop', url: '/app?chief=chief-home', width: 1440, height: 900 },
  { name: '375px phone', url: '/app?chief=chief-home', width: 375, height: 667 },
]) {
  test(`a very long header and prompt scroll inside the card and keep dismiss and submit clickable (${size.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockLive(page, structuredClone(VERY_LONG));
    await page.goto(size.url);
    const coordinator = page.getByTestId('home-c');
    const card = coordinator.getByTestId('chief-question-card');
    await expect(card).toBeVisible();
    await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThanOrEqual(size.height * 0.4 + 1);
    await coordinator.getByTestId('chief-question-option-0-0').scrollIntoViewIfNeeded();
    await coordinator.getByTestId('chief-question-option-0-0').click();
    const dismiss = card.getByTestId(size.width <= 640 ? 'chief-question-more' : 'chief-question-dismiss');
    const submit = coordinator.getByTestId('chief-question-primary');
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

test('an answer upload in flight still blocks submit and paging after a withdraw switches to the thread composer', async ({
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
  const dock = page.getByTestId('chief-question-dock');
  await composer.fill('typed answer');
  await activeComposer.locator('input[type="file"]').setInputFiles({
    name: 'slow.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('slow'),
  });
  await expect(activeComposer.getByTestId('attachment-pending')).toBeVisible();
  await page.getByTestId('home-c').getByTestId('queued-message').getByRole('button', { name: '撤回' }).click();
  await expect(composer).toHaveValue('queued note');
  const submit = dock.getByRole('button', { name: /^提交回答/ });
  await expect(submit).toBeDisabled();
  await expect(page.getByTestId('chief-question-next')).toBeDisabled();
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
    await expect(submit).toBeEnabled({ timeout: 500 });
  }).toPass();
  await expect(page.getByTestId('chief-question-next')).toBeEnabled();
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
    page.getByTestId('chief-question-dock').getByTestId(`chief-question-option-0-${n}`);
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
        await expect(page.getByTestId('chief-question-dock')).toBeVisible();
      },
      composer: 'typed while loading',
      extra: async () => {
        await expect(page.getByTestId('chief-question-primary')).toHaveCount(0);
        await expect(page.getByTestId('chief-question-dock').getByRole('button', { name: /^提交回答/ })).toBeVisible();
      },
    },
    {
      name: 'emptying the thread text returns the composer to the answer',
      run: () => composer.fill(''),
      composer: '',
      extra: async () => {
        await expect(page.getByTestId('chief-question-primary')).toBeVisible();
        await expect(page.getByTestId('chief-composer-placeholder')).toHaveText('输入你自己的回答，或留空使用选中的选项');
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
        await expect(page.getByTestId('chief-question-dock')).toBeVisible();
        await expect(page.getByTestId('chief-question-primary')).toHaveCount(0);
        await expect(
          page.getByTestId('chief-question-dock').getByRole('button', { name: /^提交回答/ }),
        ).toBeEnabled();
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
      name: 'click an option while the thread is targeted',
      run: () => option(1).click(),
      composer: 'noteX1',
      extra: async () => {
        await expect(option(1)).toHaveAttribute('aria-pressed', 'true');
      },
    },
    {
      name: 'switch page to B while the thread is targeted',
      run: () => page.getByTestId('chief-question-next').click(),
      composer: 'noteX1',
    },
    {
      name: 'back to A while the thread is targeted',
      run: () => page.getByTestId('chief-question-prev').click(),
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
      name: 'switch page to B: empty',
      run: () => page.getByTestId('chief-question-next').click(),
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
        await expect(page.getByTestId('chief-question-position')).toHaveText('2 / 2');
      },
      composer: 'ansB',
      extra: async () => {
        await expect(activeComposer.getByTestId('composer-attachments')).toContainText('away.log');
        await expect(page.getByTestId('chief-question-prev')).toBeEnabled();
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
      name: 'Previous and the destination switch are blocked while it uploads',
      run: async () => {
        await expect(page.getByTestId('chief-question-prev')).toBeDisabled();
        await expect(page.getByRole('button', { name: '对某个 thread 说' })).toBeDisabled();
        await expect(page.getByTitle('附件上传中').first()).toBeVisible();
      },
      composer: 'ansB',
      extra: async () => {
        await expect(page.getByTestId('chief-question-position')).toHaveText('2 / 2');
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
        await expect(page.getByTestId('chief-question-prev')).toBeEnabled();
      },
    },
    {
      name: 'A is unchanged after the upload on B',
      run: () => page.getByTestId('chief-question-prev').click(),
      composer: 'ansA2',
      extra: async () => {
        await expect(page.getByTestId('composer-attachments')).toHaveCount(0);
      },
    },
    {
      name: 'B kept its attachment',
      run: () => page.getByTestId('chief-question-next').click(),
      composer: 'ansB',
      extra: async () => {
        await expect(page.getByTestId('composer-attachments')).toContainText('notes.log');
      },
    },
    {
      name: 'back to A: its answer is intact',
      run: () => page.getByTestId('chief-question-prev').click(),
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
      run: () => page.getByTestId('chief-question-next').click(),
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
      run: () => option(0).click(),
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
        await option(0).click();
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
        await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
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
        await expect(page.getByTestId('chief-question-dock')).toBeVisible();
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
        await page.getByTestId('chief-question-primary').click();
        await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
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
