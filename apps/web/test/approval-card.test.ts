import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { ApprovalAnswered } from '../src/chief/question-answered-line.js';
import { DecisionDock } from '../src/chief/decision-dock.js';
import type { ChiefQuestionItem } from '../src/chief/question-item.js';
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

function mailItem(
  question = MAIL_CARD,
  status: ChiefQuestionItem['status'] = 'pending',
  answers: ChiefQuestionItem['answers'] = null,
): ChiefQuestionItem {
  return {
    kind: 'question',
    id: 'approval-p1',
    requestId: 'approval-p1',
    status,
    questions: [{ header: '审批', question, options: [{ label: '发送' }, { label: '不发' }] }],
    answers,
  };
}

function inI18n(child: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, { initialLocale: 'zh', children: child }),
  );
}

const render = (item: ChiefQuestionItem) =>
  inI18n(createElement(DecisionDock, { item, onAnswer: () => {}, onCancel: () => {} }));

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');

function elements(html: string, testId: string): { tag: string; text: string }[] {
  const pattern = new RegExp(`<(\\w+)([^>]*data-testid="${testId}"[^>]*)>([\\s\\S]*?)</\\1>`, 'g');
  return [...html.matchAll(pattern)].map((match) => ({
    tag: `<${match[1]}${match[2] ?? ''}>`,
    text: textOf(match[3] ?? ''),
  }));
}

const texts = (html: string, testId: string) => elements(html, testId).map((node) => node.text);

describe('an outbound approval card', () => {
  test('says the action in one sentence with the account and subject under it', () => {
    const doc = render(mailItem());
    expect(texts(doc, 'approval-card-title')).toEqual(['发送邮件给 lena.hoffmann@example.com']);
    expect(texts(doc, 'approval-card-context')).toEqual([
      '从 ian@example.com 发出 · 主题「Re: Quote for the migration」',
    ]);
  });

  test('quotes the body that will go out', () => {
    const doc = render(mailItem());
    const [quote] = elements(doc, 'approval-card-quote');
    expect(quote?.tag.startsWith('<blockquote')).toBe(true);
    expect(quote?.text).toContain('the quote is 4200 EUR');
    expect(quote?.text).not.toContain('>');
  });

  test('keeps raw arguments closed and puts the risk next to decline then send', () => {
    const doc = render(mailItem());
    expect(textOf(doc)).not.toContain('mail_01JX8K2QF7ZC4V9N3T6W');
    expect(texts(doc, 'approval-details-toggle')).toEqual(['原始参数']);
    expect(texts(doc, 'approval-card-note')).toEqual(['只会按上面的内容发出，发出后无法收回。']);
    const send = doc.indexOf('data-testid="chief-question-option-0-0"');
    const decline = doc.indexOf('data-testid="chief-question-option-0-1"');
    expect(decline).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(decline);
    expect(elements(doc, 'chief-question-option-0-0')[0]?.tag).not.toContain('disabled=""');
  });

  test('folds a long body and says how many lines it holds', () => {
    const body = Array.from({ length: 12 }, (_, i) => `> line ${i + 1} of the quote`).join('\n');
    const doc = render(mailItem(MAIL_CARD.replace(/正文：\n(> .*\n)+/, `正文：\n${body}\n`)));
    expect(texts(doc, 'approval-field-more')).toEqual(['展开全文 · 共 12 行']);
  });

  test('collapses into one history line once answered', () => {
    const doc = inI18n(
      createElement(ApprovalAnswered, {
        item: mailItem(MAIL_CARD, 'answered', [{ header: '审批', choices: ['发送'] }]),
      }),
    );
    expect(texts(doc, 'approval-history-text')).toEqual([
      '已批准 · 发送邮件给 lena.hoffmann@example.com',
    ]);
    expect(doc).not.toContain('data-testid="chief-question-option-0-0"');
    expect(doc).not.toContain('data-testid="approval-card-quote"');
  });

  test('a declined answer reads as declined', () => {
    const doc = inI18n(
      createElement(ApprovalAnswered, {
        item: mailItem(MAIL_CARD, 'answered', [{ header: '审批', choices: ['不发'] }]),
      }),
    );
    expect(texts(doc, 'approval-history-text')).toEqual([
      '已拒绝 · 发送邮件给 lena.hoffmann@example.com',
    ]);
  });
});

describe('an unsandboxed host shell escalation approval card', () => {
  const SHELL_CARD =
    'Coordinator 想在 Owner Mac 上不经沙箱运行这条命令：qlmanage -t -s 800 -o /tmp/out /tmp/a.pdf';

  function shellItem(
    status: ChiefQuestionItem['status'] = 'pending',
    answers: ChiefQuestionItem['answers'] = null,
    cancelReason?: string,
  ): ChiefQuestionItem {
    return {
      kind: 'question',
      id: 'approval-s1',
      requestId: 'approval-s1',
      status,
      questions: [
        {
          header: '审批',
          question: SHELL_CARD,
          options: [{ label: '批准执行' }, { label: '不执行' }],
        },
      ],
      answers,
      ...(cancelReason !== undefined ? { cancelReason } : {}),
    };
  }

  test('renders exact monospace command, single-shot note, and Allow / Deny actions', () => {
    const doc = render(shellItem());
    expect(texts(doc, 'approval-card-title')).toEqual(['在 Owner Mac 上不经沙箱运行一条命令']);
    expect(texts(doc, 'approval-card-note')).toEqual(['不经沙箱运行，仅对这一条命令生效']);
    const [quote] = elements(doc, 'approval-card-quote');
    expect(quote?.text).toBe('qlmanage -t -s 800 -o /tmp/out /tmp/a.pdf');
    expect(texts(doc, 'chief-question-option-0-0')).toEqual(['批准执行']);
    expect(texts(doc, 'chief-question-option-0-1')).toEqual(['不执行']);
  });

  test('renders expired cancelled approval card as expired', () => {
    const doc = inI18n(
      createElement(ApprovalAnswered, {
        item: shellItem('cancelled', null, '审批已过期，没有执行。'),
      }),
    );
    expect(texts(doc, 'approval-history-text')).toEqual([
      '已过期 · 在 Owner Mac 上不经沙箱运行一条命令',
    ]);
  });
});
