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

test('two pending decisions are two cards; the recommended option is first and answering it resumes the thread (#1784)', async ({
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
  const needsYou = page.getByTestId('needs-you');
  const cards = needsYou.getByTestId('chief-question-card');
  await expect(cards).toHaveCount(2);
  await expect(needsYou.getByTestId('needs-you-count')).toHaveText('2');
  const first = cards.first();
  await expect(first.getByTestId('chief-question-status')).toHaveText('待你决定');
  await expect(first.getByTestId('chief-question-option-0-0')).toHaveText('1Claude subscription （推荐）');
  await expect(first.getByTestId('chief-question-option-0-1')).toContainText('wokey');
  await expect(first.getByTestId('chief-question-other-0')).toHaveText('3用我自己的话回答');
  await first.getByTestId('chief-question-option-0-0').click();
  await first.getByRole('button', { name: '提交回答' }).click();
  await expect.poll(() => answered.length).toBe(1);
  expect(answered[0]).toEqual({
    requestId: 'ask-0000000a',
    body: { answers: [{ header: 'Model · #74', choices: ['Claude subscription'] }] },
  });
  await expect(cards).toHaveCount(1);
  await expect(needsYou.getByTestId('needs-you-count')).toHaveText('1');
  await expect(cards.first()).toContainText('Who merges it?');
});

test('own words: the free-text row takes a typed answer', async ({ page }) => {
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
  const card = page.getByTestId('needs-you').getByTestId('chief-question-card');
  await card.getByTestId('chief-question-other-0').click();
  await card.getByTestId('chief-question-input-0').fill('Use the metered key this once');
  await card.getByRole('button', { name: '提交回答' }).click();
  await expect
    .poll(() => answered)
    .toEqual([{ answers: [{ header: 'Model · #74', choices: ['Use the metered key this once'] }] }]);
});
