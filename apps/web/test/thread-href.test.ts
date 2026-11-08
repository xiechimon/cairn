import { describe, expect, test } from 'vitest';
import { threadHref, threadHrefFrom, VIEW_PARAM } from '../src/board/thread-copy.js';

describe('the changes view is a one-shot choice, not a property of the thread URL', () => {
  test('opening another thread from a changes view lands on the chat', () => {
    const href = threadHref('todo-2', `thread=todo-1&${VIEW_PARAM}=changes&pane=tasks`);
    const params = new URL(href, 'http://x').searchParams;
    expect(params.get('thread')).toBe('todo-2');
    expect(params.get(VIEW_PARAM)).toBeNull();
    expect(params.get('pane')).toBe('tasks');
  });

  test('threadHrefFrom keeps only the scenario', () => {
    const href = threadHrefFrom('todo-2', `scenario=x&${VIEW_PARAM}=changes`);
    expect(href).toBe('/app?scenario=x&thread=todo-2');
  });
});
