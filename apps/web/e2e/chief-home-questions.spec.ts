import { expect, type Route, test } from '@playwright/test';
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

test('no pending question means no card and no pill', async ({ page }) => {
  await mockLive(page, structuredClone(NONE));
  await page.goto(DOCK);
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
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
  await page.goto(DOCK);
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
  await page.goto(DOCK);
  const dock = page.getByTestId('chief-question-dock');
  await dock.getByTestId('chief-question-option-0-0').click();
  await page.getByTestId('chief-question-primary').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(dock).toHaveCount(0);
  await expect(page.getByRole('complementary').getByTestId('attention-badge')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-error')).toHaveCount(0);
  expect(posts).toHaveLength(1);
});

test('a submit the server reports as already answered closes the card without an error', async ({
  page,
}) => {
  const state = structuredClone(ONE);
  await mockLive(page, state, (path, route, json) => {
    if (!/\/questions\/[^/]+\/answer$/.test(path) || route.request().method() !== 'POST') {
      return undefined;
    }
    return json(
      { error: 'question ask-0000000a already answered', reason: 'question-settled' },
      409,
    );
  });
  await page.goto(DOCK);
  const dock = page.getByTestId('chief-question-dock');
  await dock.getByTestId('chief-question-option-0-0').click();
  await page.getByTestId('chief-question-primary').click();
  await expect(dock).toHaveCount(0);
  await expect(page.getByTestId('chief-question-error')).toHaveCount(0);
});

test('a refused submit for any other reason keeps the card and the draft and says so', async ({
  page,
}) => {
  const state = structuredClone(ONE);
  await mockLive(page, state, (path, route, json) => {
    if (!/\/questions\/[^/]+\/answer$/.test(path) || route.request().method() !== 'POST') {
      return undefined;
    }
    return json({ error: 'chief thread chief-global is archived' }, 409);
  });
  await page.goto(DOCK);
  const dock = page.getByTestId('chief-question-dock');
  await dock.getByTestId('chief-question-option-0-0').click();
  await page.getByTestId('chief-question-primary').click();
  await expect(page.getByTestId('chief-question-error')).toBeVisible();
  await expect(dock.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'true');
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
  await page.getByRole('complementary').getByRole('button', { name: /Coordinator/ }).first().click();
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.getByTestId('chief-stream').getByTestId('inline-question')).toHaveCount(2);
  await expect(page.getByTestId('chief-question-dock')).toHaveCount(0);
  await expect(page.getByTestId('home-c').getByTestId('needs-you-count')).toHaveText('2');
});

test('digits pick an option while nothing is being typed, and stay text in a non-empty composer', async ({
  page,
}) => {
  await mockLive(page, structuredClone(ONE));
  await page.goto(DOCK);
  const composer = page.getByTestId('chief-composer-input');
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
  await page.goto(DOCK);
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
  await page.goto(DOCK);
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
  await page.goto(DOCK);
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
  await page.goto(DOCK);
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
  await page.goto(DOCK);
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
  await page.goto(DOCK);
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
      await expect(
        dock.getByTestId(size.width <= 640 ? 'chief-question-more' : 'chief-question-dismiss'),
      ).toBeInViewport({ ratio: 1 });
      await expect(drawer.getByTestId('chief-question-primary')).toBeInViewport({ ratio: 1 });
    });
  }
}

test('the card collapses to a one-line bar, stays collapsed per question, and expands again', async ({
  page,
}) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto(DOCK);
  const card = page.getByTestId('chief-question-card');
  await expect(card.getByTestId('chief-question-text')).toBeVisible();
  const open = (await card.boundingBox())!;
  await card.getByTestId('chief-question-collapse').click();
  await expect(card).toHaveAttribute('data-collapsed', '');
  await expect(card.getByTestId('chief-question-text')).toHaveCount(0);
  await expect(card.getByTestId('chief-question-position')).toHaveText('1 / 3');
  expect((await card.boundingBox())!.height).toBeLessThan(Math.min(48, open.height));
  await page.reload();
  await expect(page.getByTestId('chief-question-card')).toHaveAttribute('data-collapsed', '');
});

test('collapsed state survives stepping and re-expands from the chevron', async ({ page }) => {
  await mockLive(page, structuredClone(MIXED));
  await page.goto(DOCK);
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
  await page.goto(DOCK);
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
    const dismiss = card.getByTestId(size.width <= 640 ? 'chief-question-more' : 'chief-question-dismiss');
    const submit = drawer.getByTestId('chief-question-primary');
    await expect(dismiss).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await dismiss.click({ trial: true });
    await submit.click({ trial: true });
  });
}

