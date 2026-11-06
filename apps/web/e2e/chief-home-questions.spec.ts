import { expect, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock';

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

test('a pending Coordinator question stays quiet in the header until the user opens it (#2853)', async ({
  page,
}) => {
  const posts: string[] = [];
  await mockLive(page, structuredClone(TWO), (path, route) => {
    if (route.request().method() === 'POST') posts.push(path);
    return undefined;
  });
  await page.goto('/app');
  const entry = page.getByTestId('chief-question-entry');
  await expect(entry).toBeVisible();
  await expect(page.getByTestId('chief-question-count')).toHaveText('2');
  await expect(page.getByTestId('chief-question-panel')).toHaveCount(0);
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await expect(page.getByTestId('home-c').getByTestId('chief-question-card')).toHaveCount(0);
  await expect(page.locator('.chief-fab')).toHaveCount(0);
  await expect(page.getByTestId('home-c').getByTestId('chief-composer-input')).toBeVisible();
  await expect.poll(() => posts.some((path) => path.includes('/questions/'))).toBe(false);
});

test('Later closes the panel without answering or cancelling, and the draft returns (#2853)', async ({
  page,
}) => {
  const posts: { path: string; method: string }[] = [];
  await mockLive(page, structuredClone(TWO), (path, route) => {
    posts.push({ path, method: route.request().method() });
    return undefined;
  });
  await page.goto('/app');
  await page.getByTestId('chief-question-entry').click();
  const panel = page.getByTestId('chief-question-panel');
  await expect(panel).toBeVisible();
  const card = panel.getByTestId('chief-question-card');
  await card.getByTestId('chief-question-option-0-0').click();
  await expect(card.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'true');
  await panel.getByTestId('chief-question-later').click();
  await expect(panel).toHaveCount(0);
  expect(posts.filter((row) => row.path.includes('/questions/'))).toEqual([]);
  await page.getByTestId('chief-question-entry').click();
  await expect(panel.getByTestId('chief-question-option-0-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('chief-question-count')).toHaveText('2');
});

test('the draft survives leaving home and returning from another page (#2853)', async ({ page }) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app');
  await page.getByTestId('chief-question-entry').click();
  await page.getByTestId('chief-question-card').getByTestId('chief-question-other-0').click();
  await page.getByTestId('chief-question-input-0').fill('Use the metered key this once');
  await page.getByTestId('chief-question-later').click();
  await expect(page.getByTestId('chief-question-panel')).toHaveCount(0);
  await page.getByTestId('sidebar-settings').click();
  await expect(page.getByTestId('settings-content')).toBeVisible();
  await expect(page.getByTestId('page-toolbar').getByTestId('chief-question-count')).toHaveText('2');
  await page.getByTestId('page-toolbar').getByTestId('chief-question-entry').click();
  const panel = page.getByTestId('chief-question-panel');
  await expect(panel.getByTestId('chief-question-other-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('chief-question-input-0')).toHaveValue(
    'Use the metered key this once',
  );
});

test('submit posts to the originating thread and leaves the other request pending (#2853)', async ({
  page,
}) => {
  const answered: { path: string; body: unknown }[] = [];
  const state = structuredClone(TWO);
  await mockLive(page, state, (path, route, json) => {
    const match = /\/chief\/threads\/([^/]+)\/questions\/([^/]+)\/answer$/.exec(path);
    if (match === null || route.request().method() !== 'POST') return undefined;
    const threadId = match[1] ?? '';
    const requestId = match[2] ?? '';
    const body = route.request().postDataJSON();
    answered.push({ path, body });
    state.messages = state.messages.map((row) =>
      row.id === `row-${requestId}`
        ? {
            ...row,
            content: JSON.stringify({
              ...JSON.parse(row.content as string),
              status: 'answered',
              answers: (body as { answers: unknown[] }).answers,
            }),
          }
        : row,
    );
    expect(threadId).toBe(THREAD.id);
    return json(JSON.parse(state.messages.find((row) => row.id === `row-${requestId}`)!.content as string));
  });
  await page.goto('/app');
  await page.getByTestId('chief-question-entry').click();
  const panel = page.getByTestId('chief-question-panel');
  await panel.getByTestId('chief-question-option-0-0').click();
  await panel.getByRole('button', { name: '提交回答' }).click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]?.path).toContain(`/chief/threads/${THREAD.id}/questions/ask-0000000a/answer`);
  await expect(page.getByTestId('chief-question-count')).toHaveText('1');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('chief-question-text')).toContainText('Who merges it?');
});

test('a failed submit keeps the typed draft (#2853)', async ({ page }) => {
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
  await page.getByTestId('chief-question-entry').click();
  const card = page.getByTestId('chief-question-card');
  await card.getByTestId('chief-question-other-0').click();
  await card.getByTestId('chief-question-input-0').fill('Keep this text');
  await card.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByTestId('chief-question-error')).toBeVisible();
  await expect(card.getByTestId('chief-question-input-0')).toHaveValue('Keep this text');
  await expect(page.getByTestId('chief-question-count')).toHaveText('2');
});

test('a pending question stays in the header on project home, settings, and not-found (#2853)', async ({
  page,
}) => {
  await mockLive(page, { ...structuredClone(TWO), projects: [PROJECT] });
  await page.goto('/app?project=proj-1');
  await expect(page.getByTestId('project-home')).toBeVisible();
  await expect(page.getByTestId('chief-question-entry')).toBeVisible();
  await expect(page.getByTestId('chief-question-count')).toHaveText('2');
  await page.getByTestId('chief-question-entry').click();
  await expect(page.getByTestId('chief-question-panel')).toBeVisible();
  await page.getByTestId('chief-question-later').click();

  await page.goto('/app?chief=settings');
  await expect(page.getByTestId('chief-settings-col')).toBeVisible();
  await expect(page.getByTestId('chief-settings-topbar').getByTestId('chief-question-count')).toHaveText(
    '2',
  );

  await page.goto('/app?project=missing-project');
  await expect(page.getByTestId('project-not-found')).toBeVisible();
  await expect(page.getByTestId('chief-question-entry')).toBeVisible();
  await expect(page.getByTestId('chief-question-count')).toHaveText('2');
  await page.getByTestId('chief-question-entry').click();
  await expect(page.getByTestId('chief-question-panel')).toBeVisible();
});

test('number keys only choose when the question card is visible (#2853)', async ({ page }) => {
  await mockLive(page, structuredClone(TWO));
  await page.goto('/app');
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await expect(page.getByTestId('chief-question-entry')).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(page.getByTestId('chief-question-panel')).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type('1');
  await expect(composer).toHaveValue('1');
  await composer.fill('');
  await page.getByTestId('chief-question-entry').click();
  const option = page.getByTestId('chief-question-option-0-0');
  await expect(option).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('1');
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  await expect(composer).toHaveValue('');
});
