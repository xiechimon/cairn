import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DeltaRelay } from '../src/delta-relay.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function relay(
  send: (text: string) => Promise<unknown> | undefined = async () => {},
  leading = false,
) {
  const sent: string[] = [];
  const errors: unknown[] = [];
  const subject = new DeltaRelay({
    flushMs: 250,
    ...(leading ? { leading: true } : {}),
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

test('leading mode sends first delta immediately, serializes flushNow, and recovers on failure', async () => {
  const gate: { resolveFirst?: () => void } = {};
  let failNext = false;
  const events: string[] = [];
  const subject = new DeltaRelay({
    flushMs: 250,
    leading: true,
    send: (text) => {
      events.push(`send:${text}`);
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error('leading down'));
      }
      if (text === 'a') {
        return new Promise<void>((resolve) => {
          gate.resolveFirst = () => {
            events.push(`done:${text}`);
            resolve();
          };
        });
      }
      events.push(`done:${text}`);
      return Promise.resolve();
    },
    onError: (err) => events.push(`err:${err instanceof Error ? err.message : String(err)}`),
  });

  subject.push('a');
  expect(events).toEqual(['send:a']);

  subject.push('b');
  subject.push('c');
  expect(events).toEqual(['send:a']);

  let flushed = false;
  const flushPromise = subject.flushNow().then(() => {
    flushed = true;
    events.push('flushed');
  });
  await Promise.resolve();
  expect(flushed).toBe(false);

  gate.resolveFirst?.();
  await flushPromise;
  expect(events).toEqual(['send:a', 'done:a', 'send:bc', 'done:bc', 'flushed']);

  await vi.advanceTimersByTimeAsync(250);
  failNext = true;
  subject.push('d');
  await Promise.resolve();
  await Promise.resolve();
  expect(events).toContain('err:leading down');

  await vi.advanceTimersByTimeAsync(250);
  subject.push('e');
  expect(events.at(-2)).toBe('send:e');
});

test('leading mode discard drops timer-queued chunks before in-flight first delta resolves', async () => {
  const gate: { releaseFirst?: () => void } = {};
  const sent: string[] = [];
  const subject = new DeltaRelay({
    flushMs: 250,
    leading: true,
    send: (text) => {
      sent.push(text);
      if (text === 'first') {
        return new Promise<void>((resolve) => {
          gate.releaseFirst = resolve;
        });
      }
      return Promise.resolve();
    },
    onError: () => {},
  });

  subject.push('first');
  expect(sent).toEqual(['first']);

  subject.push('queued-stale');
  await vi.advanceTimersByTimeAsync(250);
  expect(sent).toEqual(['first']);

  subject.discard();
  gate.releaseFirst?.();
  await subject.flushNow();

  expect(sent).toEqual(['first']);

  subject.push('retry-first');
  expect(sent).toEqual(['first', 'retry-first']);
});
