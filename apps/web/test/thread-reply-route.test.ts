import { describe, expect, it } from 'vitest';
import { replyRouteOf } from '../src/board/use-thread-chat.js';

describe('where a side chat reply goes', () => {
  it('messages the stopped thread so the server restarts it cleanly', () => {
    expect(replyRouteOf('stopped', [{ status: 'stopped' }])).toBe('message');
  });

  it('queues while a planning or queued step waits for a machine, since nothing can take it yet', () => {
    expect(replyRouteOf('planning', [{ status: 'pending' }])).toBe('queue');
    expect(replyRouteOf('queued', [{ status: 'waiting_quota' }])).toBe('queue');
    expect(replyRouteOf('planning', [{ status: 'claimed' }])).toBe('message');
  });

  it('messages the thread in every other case', () => {
    expect(replyRouteOf('todo', [])).toBe('message');
    expect(replyRouteOf('building', [{ status: 'stopped' }])).toBe('message');
    expect(replyRouteOf('confirm', [{ status: 'done' }])).toBe('message');
    expect(replyRouteOf('done', [{ status: 'done' }])).toBe('message');
  });
});
