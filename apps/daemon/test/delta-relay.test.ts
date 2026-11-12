import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DeltaRelay } from '../src/delta-relay.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function relay(send: (text: string) => Promise<unknown> | undefined = async () => {}) {
  const sent: string[] = [];
  const errors: unknown[] = [];
  const subject = new DeltaRelay({
    flushMs: 250,
    send: (text) => {
      sent.push(text);
      return send(text);
    },
    onError: (err) => errors.push(err),
  });
  return { subject, sent, errors };
}

test('pushes within one window are sent together when the window ends', async () => {
  const { subject, sent } = relay();
  subject.push('a');
  await vi.advanceTimersByTimeAsync(200);
  subject.push('b');
  expect(sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(50);
  expect(sent).toEqual(['ab']);
  subject.push('c');
  await vi.advanceTimersByTimeAsync(250);
  expect(sent).toEqual(['ab', 'c']);
});

test('flushNow sends at once and cancels the pending window', async () => {
  const { subject, sent } = relay();
  subject.push('a');
  await subject.flushNow();
  expect(sent).toEqual(['a']);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent).toEqual(['a']);
});

test('an empty buffer sends nothing', async () => {
  const { subject, sent } = relay();
  await subject.flushNow();
  subject.flush();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent).toEqual([]);
});

test('discard drops buffered text and the pending window', async () => {
  const { subject, sent } = relay();
  subject.push('a');
  subject.discard();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent).toEqual([]);
  subject.push('b');
  await vi.advanceTimersByTimeAsync(250);
  expect(sent).toEqual(['b']);
});

test('a failed send is reported and does not stop later sends', async () => {
  let fail = true;
  const { subject, sent, errors } = relay(async () => {
    if (fail) throw new Error('relay down');
  });
  subject.push('a');
  await subject.flushNow();
  expect(errors).toHaveLength(1);
  fail = false;
  subject.push('b');
  await subject.flushNow();
  expect(sent).toEqual(['a', 'b']);
  expect(errors).toHaveLength(1);
});

test('a relay with no sender still clears its buffer', async () => {
  const { subject, sent, errors } = relay(() => undefined);
  subject.push('a');
  await subject.flushNow();
  expect(sent).toEqual(['a']);
  expect(errors).toEqual([]);
});
