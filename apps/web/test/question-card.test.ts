import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { QuestionReceipt } from '../src/chief/question-answered-line.js';
import { QuestionCard } from '../src/chief/question-card.js';
import type { ChiefQuestionItem } from '../src/chief/question-item.js';
import { I18nProvider } from '../src/i18n/provider.js';
import { stripHtmlTags } from './strip-html-tags.js';

function page(children: ReactNode): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, {
      children: createElement(I18nProvider, { initialLocale: 'zh', children }),
    }),
  );
}

const text = (html: string) => stripHtmlTags(html);

function ask(over: Partial<ChiefQuestionItem['questions'][number]> = {}): ChiefQuestionItem {
  return {
    kind: 'question',
    id: 'q1',
    requestId: 'q1',
    status: 'pending',
    questions: [
      {
        header: 'Order',
        question: 'Which order should the export columns use?',
        options: [
          { label: 'Board order', description: 'Same as the columns on screen' },
          { label: 'Alphabetical', description: 'Easier to scan', recommended: true },
        ],
        ...over,
      },
    ],
    answers: null,
  };
}

const card = (item: ChiefQuestionItem) =>
  page(
    createElement(QuestionCard, {
      item,
      onAnswer: () => {},
      onCancel: () => {},
    }),
  );

describe('a question card in the conversation', () => {
  test('shows every option with its description, the recommended one first and tagged, none picked', () => {
    const html = card(ask());
    const first = html.lastIndexOf('<', html.indexOf('data-testid="chief-question-option-0-0"'));
    expect(text(html.slice(first))).toMatch(/^1Alphabetical推荐Easier to scan2Board orderSame as the columns on screen/);
    expect(html.match(/data-testid="chief-question-recommended"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-pressed="true"');
  });

  test('multi-select rows are checkboxes with a count, Skip and a disabled submit', () => {
    const html = card(ask({ multiSelect: true }));
    expect(html.match(/data-slot="dock-check"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-pressed="true"');
    expect(text(html)).toContain('已选 0 个');
    expect(html).toContain('data-testid="chief-question-skip"');
    expect(html).toMatch(/data-testid="chief-question-submit"[^>]*disabled=""|disabled=""[^>]*data-testid="chief-question-submit"/);
  });

  test('offers an Other input and Skip, and no collapse button', () => {
    const html = card(ask());
    expect(html).toContain('data-testid="chief-question-other-0"');
    expect(html).toContain('data-testid="chief-question-skip"');
    expect(html).not.toContain('chief-question-minimize');
  });
});

describe('an answered question leaves one receipt', () => {
  test('the question and its answer, multi answers joined', () => {
    const html = page(
      createElement(QuestionReceipt, {
        item: { ...ask(), status: 'answered', answers: [{ header: 'Order', choices: ['Alphabetical', 'by date'] }] },
      }),
    );
    expect(text(html)).toBe('Which order should the export columns use?Alphabetical、by date');
  });

  test('a skipped question says so', () => {
    const html = page(createElement(QuestionReceipt, { item: { ...ask(), status: 'cancelled' } }));
    expect(text(html)).toContain('已跳过');
  });
});
