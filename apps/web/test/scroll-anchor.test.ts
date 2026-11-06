import { describe, expect, it } from 'vitest';
import { isTranscriptSettled, openingAnchor } from '../src/detail/scroll-anchor.js';
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

describe('isTranscriptSettled', () => {
  const base = {
    live: true,
    todoPending: false,
    buildId: 'b1',
    buildPending: false,
    stepsPending: false,
    messagesPending: false,
  };

  it('is not settled while messages are still loading after the build arrived', () => {
    expect(isTranscriptSettled({ ...base, messagesPending: true })).toBe(false);
  });

  it('waits for the build and steps too', () => {
    expect(isTranscriptSettled({ ...base, buildPending: true })).toBe(false);
    expect(isTranscriptSettled({ ...base, stepsPending: true })).toBe(false);
  });

  it('is settled once every query answered, or when there is no build', () => {
    expect(isTranscriptSettled(base)).toBe(true);
    expect(isTranscriptSettled({ ...base, buildId: null, messagesPending: true })).toBe(true);
  });

  it('never waits outside live mode, and waits for the todo in live mode', () => {
    expect(isTranscriptSettled({ ...base, live: false, messagesPending: true })).toBe(true);
    expect(isTranscriptSettled({ ...base, todoPending: true })).toBe(false);
  });
});
