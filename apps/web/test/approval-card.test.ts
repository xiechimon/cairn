import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { type ChiefQuestionItem, QuestionChips } from '../src/chief/question-chips.js';
import { I18nProvider } from '../src/i18n/provider.js';

const MAIL_CARD = [
  '对外发送：cairn-mail send',
  '收件人：lena.hoffmann@example.com',
  '主题：Re: Quote for the migration',
  '正文：',
  '> Hi Lena,',
  '> ',
  '> the quote is 4200 EUR for the migration, valid until Friday.',
  '> ',
  '> Best,',
  '> Ian',
  '参数：',
  '> inReplyTo：mail_01JX8K2QF7ZC4V9N3T6W',
  '参数：',
  '> from：ian@example.com',
  '',
  '只会按上面的内容发出，发出后无法收回。',
].join('\n');

function mailItem(question = MAIL_CARD): ChiefQuestionItem {
  return {
    kind: 'question',
    id: 'approval-p1',
    requestId: 'approval-p1',
    status: 'pending',
    questions: [{ header: '审批', question, options: [{ label: '发送' }, { label: '不发' }] }],
    answers: null,
  };
}

function render(item: ChiefQuestionItem): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(QuestionChips, { item, onAnswer: () => {}, onCancel: () => {} }),
    }),
  );
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');

function elements(html: string, testId: string): { tag: string; text: string }[] {
  const pattern = new RegExp(`<(\\w+)([^>]*data-testid="${testId}"[^>]*)>([\\s\\S]*?)</\\1>`, 'g');
  return [...html.matchAll(pattern)].map((match) => ({
    tag: match[2] ?? '',
    text: textOf(match[3] ?? ''),
  }));
}

const texts = (html: string, testId: string) => elements(html, testId).map((node) => node.text);

describe('an outbound approval card', () => {
  test('names the action and lists recipient, subject and body under their labels', () => {
    const doc = render(mailItem());
    expect(texts(doc, 'approval-card-title')).toEqual(['发送邮件']);
    expect(texts(doc, 'approval-field-label')).toEqual(['收件人', '主题', '正文']);
    const values = texts(doc, 'approval-field-value');
    expect(values[0]).toBe('lena.hoffmann@example.com');
    expect(values[2]).toContain('the quote is 4200 EUR');
    expect(values[2]).not.toContain('>');
  });

  test('keeps internal ids out of sight until details are opened', () => {
    const doc = render(mailItem());
    const [toggle] = elements(doc, 'approval-details-toggle');
    expect(toggle?.text).toBe('详情');
    expect(toggle?.tag).toContain('aria-expanded="false"');
    expect(textOf(doc)).not.toContain('mail_01JX8K2QF7ZC4V9N3T6W');
    expect(textOf(doc)).not.toContain('inReplyTo');
  });

  test('ends with the warning and enabled send and decline buttons', () => {
    const doc = render(mailItem());
    expect(texts(doc, 'approval-card-note')).toEqual(['只会按上面的内容发出，发出后无法收回。']);
    const [send] = elements(doc, 'chief-question-option-0-0');
    const [decline] = elements(doc, 'chief-question-option-0-1');
    expect(send?.text).toBe('发送');
    expect(decline?.text).toBe('不发');
    expect(send?.tag).not.toContain('disabled=""');
    expect(decline?.tag).not.toContain('disabled=""');
  });

  test('folds a long body behind show all', () => {
    const body = Array.from({ length: 12 }, (_, i) => `> line ${i + 1} of the quote`).join('\n');
    const doc = render(mailItem(MAIL_CARD.replace(/正文：\n(> .*\n)+/, `正文：\n${body}\n`)));
    expect(texts(doc, 'approval-field-more')).toEqual(['展开全文']);
  });
});
