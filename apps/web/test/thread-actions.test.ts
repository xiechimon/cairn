import { describe, expect, it } from 'vitest';
import { threadActionOf } from '../src/board/thread-actions.js';
import type { TodoRecord } from '../src/fixtures/records.js';

const todo = (patch: Partial<TodoRecord>): TodoRecord => ({ phase: 'todo', ...patch }) as TodoRecord;

describe('the side chat action card', () => {
  it('offers the next step for each phase that waits on a person', () => {
    expect(threadActionOf(todo({ phase: 'todo' }), false)).toBe('start');
    expect(threadActionOf(todo({ phase: 'confirm' }), false)).toBe('approve');
    expect(threadActionOf(todo({ phase: 'failed' }), false)).toBe('retry');
  });

  it('leaves finishing a reviewed thread to the more menu', () => {
    expect(threadActionOf(todo({ phase: 'review' }), false)).toBeNull();
  });

  it('shows nothing while the thread works or is finished', () => {
    for (const phase of ['queued', 'planning', 'building', 'done', 'closed'] as const) {
      expect(threadActionOf(todo({ phase }), false), phase).toBeNull();
    }
    expect(threadActionOf(todo({ phase: 'review' }), true)).toBeNull();
  });

  it('leaves a question from the thread to the composer', () => {
    expect(threadActionOf(todo({ phase: 'needs_input' }), false)).toBeNull();
  });

  it('asks to unarchive before anything else', () => {
    expect(threadActionOf(todo({ phase: 'failed', archivedAt: 1 }), false)).toBe('unarchive');
    expect(threadActionOf(todo({ phase: 'building', archivedAt: 1 }), true)).toBe('unarchive');
  });
});
