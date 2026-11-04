import type { ComputerCommand } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { computerFeedStore, mergeComputerFeed } from '../src/api/computer-feed.js';
import { startTeamStream } from '../src/api/sse.js';

class FakeEventSource {
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const command: ComputerCommand = {
  callId: '1'.repeat(64),
  stepId: 'step-1',
  tool: 'shell',
  command: 'echo first-team-only',
  cwd: '.',
  status: 'done',
  exitCode: 0,
  output: 'old output',
  at: 1,
};

const disposers: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.instances = [];
  computerFeedStore.clear();
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function start(teamId: string) {
  const disconnect = startTeamStream(teamId, new QueryClient());
  disposers.push(disconnect);
  const source = FakeEventSource.instances.at(-1)!;
  source.onopen?.();
  return { source, disconnect };
}

test('a new team stream never inherits commands from a previous scope', () => {
  computerFeedStore.push(command);
  const { source } = start('second-team');
  expect(source.url).toContain('/second-team/stream');
  expect(computerFeedStore.snapshot()).toEqual([]);
});

test('stream cleanup clears commands before an auth gate or team change', () => {
  const { source, disconnect } = start('first-team');
  source.emit({ type: 'computer.command', command });
  expect(computerFeedStore.snapshot()).toHaveLength(1);
  disconnect();
  expect(source.readyState).toBe(FakeEventSource.CLOSED);
  expect(computerFeedStore.snapshot()).toEqual([]);
});

test('a reconnect drops cached live results before loading current history', () => {
  const { source } = start('first-team');
  source.emit({ type: 'computer.command', command });
  source.onopen?.();
  const history = [{ ...command, output: 'current server output' }];
  expect(mergeComputerFeed(history, computerFeedStore.snapshot())).toEqual(history);
});

test('a missing stream event drops cached live results during reconciliation', () => {
  const { source } = start('first-team');
  source.emit({ type: 'computer.command', command, seq: 1 });
  source.emit({ type: 'ping', seq: 3 });
  expect(computerFeedStore.snapshot()).toEqual([]);
});
