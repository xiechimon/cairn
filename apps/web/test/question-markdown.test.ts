import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { QuestionAsked } from '../src/chief/question-answered-line.js';
import { type ChiefQuestionItem, QuestionChips } from '../src/chief/question-chips.js';
import { I18nProvider } from '../src/i18n/provider.js';

const MARKDOWN_QUESTION =
  '[Fix the flaky test](todo:8gDHUh7VXyUcxh_ZgX29a) can read the repository, but editing `/tmp/dogfood-scratch-repo/test/cli.test.js` fails with EPERM. Can you make it writable?';

function questionItem(status: ChiefQuestionItem['status']): ChiefQuestionItem {
  return {
    kind: 'question',
    id: 'ask-1',
    requestId: 'ask-1',
    status,
    questions: [{ header: 'Workspace access', question: MARKDOWN_QUESTION, options: [] }],
    answers: null,
  };
}

function page(children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, {
      children: createElement(I18nProvider, { initialLocale: 'zh', children }),
    }),
  );
}

function plain(markup: string): string {
  return markup.replace(/<[^>]+>/g, '');
}

describe('question markdown rendering (dogfood)', () => {
  test('pending question chips render todo mentions and code, not raw markdown', () => {
    const html = page(
      createElement(QuestionChips, {
        item: questionItem('pending'),
        onAnswer: () => {},
        onCancel: () => {},
      }),
    );
    expect(plain(html)).not.toContain('](todo:');
    expect(html).toContain('data-slot="task-mention"');
    expect(html).toContain('<code');
    expect(plain(html)).not.toContain('`');
  });

  test('asked question bubble renders todo mentions and code, not raw markdown', () => {
    const html = page(createElement(QuestionAsked, { item: questionItem('pending') }));
    expect(plain(html)).not.toContain('](todo:');
    expect(html).toContain('data-slot="task-mention"');
    expect(html).toContain('<code');
    expect(plain(html)).not.toContain('`');
  });

  test('an in-app link in question text navigates instead of printing raw markdown', () => {
    const item = questionItem('pending');
    item.questions = [
      {
        header: '',
        question: 'you can download it in the [machine panel](/app?pane=machines).',
        options: [],
      },
    ];
    const html = page(createElement(QuestionAsked, { item }));
    expect(plain(html)).not.toContain(']( /app');
    expect(plain(html)).not.toContain('](/app');
    expect(html).toContain('href="/app?pane=machines"');
    expect(html).toContain('machine panel');
  });
});
