import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const QUESTION = [
  '对外发送：cairn-mail send',
  '收件人：lena.hoffmann@example.com',
  '主题：Re: Quote for the migration',
  '正文：',
  '> Hi Lena,',
  '> the quote is 4200 EUR, valid until Friday.',
  '> Best, Ian',
  '参数：',
  '> inReplyTo：mail_01JX8K2QF7ZC4V9N3T6W',
  '参数：',
  '> from：ian@example.com',
  '',
  '只会按上面的内容发出，发出后无法收回。',
].join('\n');

const CARD = {
  id: 'approval-p1',
  role: 'assistant',
  createdAt: 20,
  content: JSON.stringify({
    kind: 'ask_user_question',
    requestId: 'approval-p1',
    status: 'pending',
    questions: [
      { header: '审批', question: QUESTION, options: [{ label: '发送' }, { label: '不发' }] },
    ],
    answers: null,
    askedFor: ['action-proposal:p1'],
  }),
};

test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

test('an outbound approval card says the action in one sentence, quotes the body and sends on click', async ({
  page,
}) => {
  const answers: unknown[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        { id: 'm1', role: 'user', content: 'Reply to Lena about the quote', createdAt: 10 },
        CARD,
      ],
      todos: [],
    },
    (path, route, json) => {
      if (!path.endsWith('/questions/approval-p1/answer')) return undefined;
      answers.push(route.request().postDataJSON());
      return json({ ok: true });
    },
  );
  await page.goto('/app');
  const card = page.getByTestId('chief-composer-block').getByTestId('approval-card');
  await expect(card.getByTestId('approval-card-title')).toHaveText(
    '发送邮件给 lena.hoffmann@example.com',
  );
  await expect(card.getByTestId('approval-card-context')).toHaveText(
    '从 ian@example.com 发出 · 主题「Re: Quote for the migration」',
  );
  await expect(card.getByTestId('approval-card-quote')).toContainText(
    'the quote is 4200 EUR, valid until Friday.',
  );
  await expect(card).not.toContainText('inReplyTo');
  await card.getByTestId('approval-details-toggle').click();
  await expect(card.getByTestId('approval-details')).toContainText('mail_01JX8K2QF7ZC4V9N3T6W');
  await expect(card.getByTestId('approval-card-note')).toHaveText(
    '只会按上面的内容发出，发出后无法收回。',
  );
  const send = card.getByTestId('chief-question-option-0-0');
  const decline = card.getByTestId('chief-question-option-0-1');
  await expect(decline).toHaveText('不发');
  const [sendBox, declineBox] = await Promise.all([send.boundingBox(), decline.boundingBox()]);
  expect((sendBox?.x ?? 0) > (declineBox?.x ?? 0)).toBe(true);
  await send.click();
  await expect.poll(() => answers).toEqual([{ answers: [{ header: '审批', choices: ['发送'] }] }]);
});
