import { expect, type Page, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

type Option = { label: string; description?: string };

function card(requestId: string, header: string, question: string, options: Option[], multiSelect = false) {
  return {
    id: `row-${requestId}`,
    role: 'assistant',
    createdAt: 20,
    content: JSON.stringify({
      kind: 'ask_user_question',
      requestId,
      status: 'pending',
      questions: [{ header, question, options, ...(multiSelect ? { multiSelect: true } : {}) }],
      answers: null,
    }),
  };
}

const KINDS = [
  {
    name: 'a multiple-choice question',
    row: card('ask-choice', 'Model', 'Which model should run the relay fix?', [
      { label: 'Claude subscription' },
      { label: 'deepseek-v4.1-flash' },
    ]),
    answer: async (page: Page) => {
      await page.getByTestId('chief-stream').getByTestId('chief-question-option-0-0').click();
    },
  },
  {
    name: 'a multi-select question',
    row: card(
      'ask-multi',
      'Checks',
      'Which checks should gate the merge?',
      [{ label: 'Unit tests' }, { label: 'E2E' }, { label: 'Lint' }],
      true,
    ),
    answer: async (page: Page) => {
      const stream = page.getByTestId('chief-stream');
      await stream.getByTestId('chief-question-option-0-0').click();
      await stream.getByTestId('chief-question-option-0-2').click();
      await stream.getByTestId('chief-question-submit').click();
    },
  },
  {
    name: 'an approval',
    row: card('approval-p1', '审批', 'Coordinator 想在 Mac 上不经沙箱运行这条命令：ls -la', [
      { label: '批准执行' },
      { label: '不执行' },
    ]),
    answer: async (page: Page) => {
      await page.getByTestId('chief-stream').getByTestId('chief-question-option-0-0').click();
    },
  },
] as const;

const composer = (page: Page) =>
  page.getByTestId('home-c').getByTestId('chief-composer-input').filter({ visible: true });

test.use({ viewport: { width: 1440, height: 900 } });

for (const kind of KINDS) {
  test(`${kind.name} is a card in the conversation where it was asked, with no collapse; a message sent meanwhile lands below it and the card still answers`, async ({
    page,
  }) => {
    const answered: string[] = [];
    await mockLive(
      page,
      {
        threads: [THREAD],
        messages: [{ id: 'u0', role: 'user', content: 'Ship the relay fix', createdAt: 10 }, kind.row],
        todos: [],
      },
      (path, route, json) => {
        if (route.request().method() !== 'POST' || !/\/questions\/[^/]+\/answer$/.test(path))
          return undefined;
        answered.push(path);
        return json({ ok: true });
      },
    );
    await page.goto('/app');
    const stream = page.getByTestId('chief-stream');
    const pending = stream.getByTestId('chief-question');
    await expect(pending).toBeVisible();
    await expect(page.getByTestId('chief-composer-block').getByTestId('chief-question')).toHaveCount(0);
    await expect(page.getByTestId('chief-question-minimize')).toHaveCount(0);

    await composer(page).fill('meanwhile, check the deploy');
    await composer(page).press('Enter');
    const sent = stream.locator('[data-slot="message-bubble"]').filter({ hasText: 'meanwhile, check the deploy' });
    await expect(sent).toBeVisible();
    await expect
      .poll(async () => {
        const cardBox = await pending.boundingBox();
        const sentBox = await sent.boundingBox();
        return cardBox !== null && sentBox !== null && sentBox.y >= cardBox.y + cardBox.height - 1;
      }, { message: 'the new message lands below the card' })
      .toBe(true);
    await expect(pending).toBeVisible();

    await kind.answer(page);
    await expect.poll(() => answered.length).toBe(1);
    expect(answered[0]).toContain(`/questions/${JSON.parse(kind.row.content).requestId}/answer`);
  });
}

test('a choice card keeps its own text row for a written answer', async ({ page }) => {
  const answers: unknown[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [KINDS[0].row],
      todos: [],
    },
    (path, route, json) => {
      if (route.request().method() !== 'POST' || !/\/questions\/[^/]+\/answer$/.test(path))
        return undefined;
      answers.push(route.request().postDataJSON());
      return json({ ok: true });
    },
  );
  await page.goto('/app');
  const pending = page.getByTestId('chief-stream').getByTestId('chief-question');
  const other = pending.getByTestId('chief-question-other-0');
  await expect(other).toHaveAttribute('placeholder', '输入你自己的回答…');
  await expect(pending.getByTestId('chief-question-skip')).toBeVisible();
  await other.fill('glm-5');
  await other.press('Enter');
  await expect.poll(() => JSON.stringify(answers)).toContain('"choices":["glm-5"]');
});

test('a question with no options is an ordinary Coordinator message, answered by the next message sent from the composer', async ({
  page,
}) => {
  const answered: string[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        { id: 'u0', role: 'user', content: 'Cut the release', createdAt: 10 },
        card('ask-text', 'Branch', 'Which branch should the release cut from?', []),
      ],
      todos: [],
    },
    (path, route, json) => {
      if (route.request().method() !== 'POST' || !/\/questions\/[^/]+\/answer$/.test(path))
        return undefined;
      answered.push(path);
      return json({ ok: true });
    },
  );
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const asked = stream.getByTestId('chief-reply').filter({ hasText: 'Which branch should the release cut from?' });
  await expect(asked).toBeVisible();
  await expect(stream.getByTestId('chief-question')).toHaveCount(0);
  await expect(page.getByTestId('composer-answer-bar')).toHaveCount(0);

  await composer(page).fill('release/2026-11');
  await composer(page).press('Enter');
  const sent = stream.locator('[data-slot="message-bubble"]').filter({ hasText: 'release/2026-11' });
  await expect(sent).toBeVisible();
  expect(answered).toEqual([]);
});

test('owner and Coordinator bubbles show only the time and copy on hover', async ({ page }) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'u1', role: 'user', content: 'CI 为什么挂了？', createdAt: 10 },
      { id: 'r1', role: 'assistant', content: '失败在 pnpm install 这一步。', createdAt: 20 },
    ],
    todos: [],
    tasks: [],
  });
  await page.goto('/app');
  const stream = page.getByTestId('chief-stream');
  const lists: string[][] = [];
  const spacing: { gap: number; timeOutside: boolean; middle: number }[] = [];
  for (const text of ['CI 为什么挂了', '失败在 pnpm install']) {
    const bubble = stream.locator('[data-slot="message-bubble"]').filter({ hasText: text });
    const meta = bubble
      .locator('xpath=ancestor::*[@data-slot="message"][1]')
      .locator('[data-slot="message-meta"]');
    await bubble.hover();
    await expect(meta).toHaveCSS('opacity', '1');
    const bubbleBox = (await bubble.boundingBox())!;
    const copyBox = (await meta.getByTestId('message-copy').boundingBox())!;
    const timeBox = (await meta.locator('time').boundingBox())!;
    const owner = copyBox.x < bubbleBox.x;
    spacing.push({
      gap: Math.round(
        owner ? bubbleBox.x - (copyBox.x + copyBox.width) : copyBox.x - (bubbleBox.x + bubbleBox.width),
      ),
      timeOutside: owner ? timeBox.x + timeBox.width <= copyBox.x : timeBox.x >= copyBox.x + copyBox.width,
      middle: Math.round(timeBox.y + timeBox.height / 2 - (copyBox.y + copyBox.height / 2)),
    });
    lists.push(
      await meta
        .getByRole('button')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? '')),
    );
  }
  expect(lists[0], 'owner hover tools').toEqual(['复制']);
  expect(lists[1], 'reply hover tools match the owner').toEqual(lists[0]);
  expect(spacing[0]?.timeOutside, 'owner: copy sits next to the bubble, the time outside it').toBe(true);
  expect(spacing[1], 'reply mirrors the owner row: same gap to the bubble, copy beside it, time outside').toEqual(
    spacing[0],
  );
  await expect(page.getByTestId('message-more')).toHaveCount(0);
  await expect(page.getByText('恢复到此处')).toHaveCount(0);
});
