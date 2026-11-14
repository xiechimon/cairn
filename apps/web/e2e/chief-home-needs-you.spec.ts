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

test('two pending decisions are answered one at a time above the composer; the recommended option is first and answering it resumes the thread (#1784)', async ({
  page,
}) => {
  const answered: { requestId: string; body: unknown }[] = [];
  const state = {
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
  await mockLive(page, state, (path, route, json) => {
    const match = /\/questions\/([^/]+)\/answer$/.exec(path);
    if (match === null || route.request().method() !== 'POST') return undefined;
    const requestId = match[1] ?? '';
    const body = route.request().postDataJSON() as { answers: unknown[] };
    answered.push({ requestId, body });
    state.messages = state.messages.map((row) =>
      row.id === `row-${requestId}`
        ? {
            ...row,
            content: JSON.stringify({
              ...JSON.parse(row.content),
              status: 'answered',
              answers: body.answers,
            }),
          }
        : row,
    );
    return json(JSON.parse(state.messages.find((row) => row.id === `row-${requestId}`)!.content));
  });
  await page.goto('/app');
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await expect(page.getByTestId('chief-question-text')).toContainText('Which model?');
  const panel = page.getByTestId('chief-question');
  const card = panel.getByTestId('chief-question-chips');
  await expect(panel).toHaveAccessibleName('待回答的提问');
  await expect(card.getByTestId('chief-question-option-0-0')).toContainText('Claude subscription');
  await expect(card.getByTestId('chief-question-option-0-0')).toHaveAttribute('data-recommended', '');
  await expect(card.getByTestId('chief-question-option-0-0')).toHaveAccessibleDescription('推荐 · Verified');
  await expect(card.getByTestId('chief-question-option-0-1')).toContainText('wokey');
  await expect(card.getByTestId('chief-question-other-0')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveAttribute('placeholder', '输入你自己的回答…');
  await card.getByTestId('chief-question-option-0-0').click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toEqual({
    requestId: 'ask-0000000a',
    body: { answers: [{ header: 'Model · #74', choices: ['Claude subscription'] }] },
  });
  await expect(page.getByTestId('chief-question-position')).toHaveCount(0);
  await expect(panel.getByTestId('chief-question-text')).toContainText('Who merges it?');
});

test('own words: the composer text is the answer', async ({ page }) => {
  const answered: unknown[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        question('ask-0000000a', 'Model · #74', 'Which model?', [
          { label: 'Claude subscription', recommended: true },
        ]),
      ],
      todos: [],
    },
    (path, route, json) => {
      if (!path.endsWith('/answer')) return undefined;
      answered.push(route.request().postDataJSON());
      return json({});
    },
  );
  await page.goto('/app');
  const card = page.getByTestId('chief-question').getByTestId('chief-question-chips');
  await expect(card).toBeVisible();
  await page.getByTestId('chief-composer-input').fill('Use the metered key this once');
  await page.getByTestId('chief-question-primary').click();
  await expect
    .poll(() => answered)
    .toEqual([{ answers: [{ header: 'Model · #74', choices: ['Use the metered key this once'] }] }]);
});

test('pending questions show one at a time and the tasks panel rows move between them', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      question('ask-0000000a', 'Model · #74', 'Which model?', [
        { label: 'Claude subscription', recommended: true },
        { label: 'Hold it' },
      ]),
      question('ask-0000000b', 'Merge · #2271', 'Who merges it?', [
        { label: 'Send it to ian', recommended: true },
        { label: 'Hold it' },
      ]),
    ],
    todos: [],
  });
  await page.goto('/app');
  const dock = page.getByTestId('chief-question');
  await expect(dock.getByTestId('chief-question-text')).toContainText('Which model?');
  await expect(dock.getByTestId('chief-question-text')).toHaveCount(1);
  await page.getByTestId('home-c').getByRole('button', { name: /^任务/ }).first().click();
  const rows = page
    .getByRole('complementary', { name: '任务' })
    .locator('[data-section="needs_input"] [data-slot="task-row"]');
  await rows.filter({ hasText: 'Merge · #2271' }).click();
  await expect(dock.getByTestId('chief-question-text')).toContainText('Who merges it?');
  await rows.filter({ hasText: 'Model · #74' }).click();
  await expect(dock.getByTestId('chief-question-text')).toContainText('Which model?');
});

test('a decision from a research task links to its report; one from a code task does not', async ({
  page,
}) => {
  const state = {
    threads: [THREAD],
    messages: [
      question('ask-0000000a', 'Format · #9', 'CSV or Parquet?', [
        { label: 'Parquet', recommended: true },
        { label: 'CSV' },
      ]),
    ],
    todos: [{ ...TASK, phase: 'needs_input', output: 'info' }],
  };
  await mockLive(page, state);
  await page.goto('/app');
  const dock = page.getByTestId('chief-question');
  await expect(dock.getByTestId('chief-question-text')).toContainText('CSV or Parquet?');
  const link = dock.getByTestId('chief-question-report');
  await expect(link).toHaveText('看调研报告');
  await link.click();
  await expect(page).toHaveURL(/[?&]thread=todo-1(&|$)/);

  state.todos = [{ ...TASK, phase: 'needs_input', output: 'code' }];
  await page.goto('/app');
  await expect(dock.getByTestId('chief-question-text')).toContainText('CSV or Parquet?');
  await expect(dock.getByTestId('chief-question-report')).toHaveCount(0);
});
