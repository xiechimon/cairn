import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { mapTranscript, toDisplayTodo } from '../src/api/mappers.js';
import { I18nProvider } from '../src/i18n/provider.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '../src/components/ui/message-scroller.js';
import { ChiefStreamRow } from '../src/chief/chief-message-rows.js';
import { NOW, todo } from './helpers.js';

const QUESTION = {
  kind: 'ask_user_question',
  requestId: 'ask-12345678',
  status: 'pending',
  questions: [
    {
      header: 'Format',
      question: 'Which export format?',
      options: [{ label: 'CSV' }, { label: 'JSON', description: 'machine readable' }],
    },
  ],
  answers: null,
};

test('worker question rows reach the task transcript', () => {
  const items = mapTranscript({
    messages: [{ id: 'ask-12345678', role: 'assistant', content: QUESTION, createdAt: NOW }],
    steps: [],
    plans: [],
    build: null,
    todo: todo(1, 'review', true),
    machineName: null,
    userName: 'u',
    liveText: '',
  });
  expect(items).toContainEqual(
    expect.objectContaining({
      kind: 'question',
      requestId: 'ask-12345678',
      status: 'pending',
    }),
  );
});

function wire(awaiting?: boolean) {
  return {
    ...todo(1, 'review', awaiting),
    assignment: null,
    sourceKind: null,
    sourceRef: null,
    createdBy: null,
    ownerId: null,
    sourceBuildId: null,
    output: 'code' as const,
  };
}

test('display todo keeps awaitingReply', () => {
  expect(toDisplayTodo(wire(true)).awaitingReply).toBe(true);
  expect(toDisplayTodo(wire()).awaitingReply).toBeUndefined();
});

test('report rows show the worker line', () => {
  const row = createElement(ChiefStreamRow, {
    item: {
      kind: 'thread-report',
      id: 'r1',
      todoId: 't1',
      phase: 'review',
      seqNum: 3,
      title: 'Export',
      line: 'Waiting on the export format',
    },
  } as never);
  const scroller = createElement(MessageScroller, {
    children: createElement(MessageScrollerViewport, {
      children: createElement(MessageScrollerContent, { children: row }),
    }),
  });
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, {
      children: createElement(I18nProvider, {
        initialLocale: 'en',
        children: createElement(MessageScrollerProvider, { children: scroller }),
      }),
    }),
  );
  expect(html).toContain('Waiting on the export format');
});
