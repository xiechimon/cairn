import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const QUESTION = [
  '对外发送：gmail · GMAIL_SEND_EMAIL',
  '收件人：lena.hoffmann@example.com',
  '主题：Re: Quote for the migration',
  '正文：',
  '> Hi Lena,',
  '> the quote is 4200 EUR, valid until Friday.',
  '> Best, Ian',
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

test('an outbound approval card shows the recipient and the whole draft with send and decline', async ({
  page,
}) => {
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'Reply to Lena about the quote', createdAt: 10 },
      CARD,
    ],
    todos: [],
  });
  await page.goto('/app');
  const question = page.getByTestId('chief-stream').getByTestId('chief-question');
  const text = question.getByTestId('chief-question-text');
  await expect(text).toContainText('lena.hoffmann@example.com');
  await expect(text).toContainText('the quote is 4200 EUR, valid until Friday.');
  await expect(question.getByTestId('chief-question-option-0-0')).toContainText('发送');
  await expect(question.getByTestId('chief-question-option-0-1')).toContainText('不发');
  if (process.env.OUTBOUND_SHOT) await page.screenshot({ path: process.env.OUTBOUND_SHOT });
});
