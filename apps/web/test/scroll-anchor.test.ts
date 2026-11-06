import { describe, expect, it } from 'vitest';
import { openingAnchor } from '../src/detail/scroll-anchor.js';
import type { TranscriptItem } from '../src/fixtures/records.js';

const user: TranscriptItem = { kind: 'user', text: 'fix it' };
const robot: TranscriptItem = { kind: 'robot', markdown: 'done' };

describe('openingAnchor', () => {
  it('has no anchor until the transcript has content', () => {
    expect(openingAnchor(true, [])).toBeNull();
    expect(openingAnchor(false, [])).toBeNull();
  });

  it('opens a running thread at the latest output', () => {
    expect(openingAnchor(true, [user, robot, robot])).toBe('end');
  });

  it('opens a finished thread at the last user message', () => {
    expect(openingAnchor(false, [user, robot, user, robot, robot])).toBe('last-user');
  });

  it('falls back to the end when a finished thread has no user message', () => {
    expect(openingAnchor(false, [robot, robot])).toBe('end');
  });
});
