import { describe, expect, it } from 'vitest';
import { coordinatorLoad } from '../src/chief/use-project-coordinator.js';

const ok = (data: unknown = {}) => ({ isLoading: false, isError: false, data });
const failed = { isLoading: false, isError: true, data: undefined };
const pending = { isLoading: true, isError: false, data: undefined };

describe('coordinatorLoad', () => {
  it('a project with no conversation yet is ready, not an error', () => {
    expect(
      coordinatorLoad({ chief: ok(), coordinator: ok({ thread: null }), messages: pending, hasThread: false }),
    ).toBe('ready');
  });

  it('a failed conversation lookup is an error, not an empty project', () => {
    expect(
      coordinatorLoad({ chief: ok(), coordinator: failed, messages: pending, hasThread: false }),
    ).toBe('error');
  });

  it('failed messages of an existing conversation are an error', () => {
    expect(
      coordinatorLoad({ chief: ok(), coordinator: ok(), messages: failed, hasThread: true }),
    ).toBe('error');
  });

  it('a refetch error over cached data keeps showing the cached conversation', () => {
    expect(
      coordinatorLoad({
        chief: ok(),
        coordinator: { isLoading: false, isError: true, data: { thread: null } },
        messages: pending,
        hasThread: false,
      }),
    ).toBe('ready');
  });

  it('still loading while the lookup or the messages are pending', () => {
    expect(coordinatorLoad({ chief: ok(), coordinator: pending, messages: pending, hasThread: false })).toBe('loading');
    expect(coordinatorLoad({ chief: ok(), coordinator: ok(), messages: pending, hasThread: true })).toBe('loading');
  });
});
