import type { ComputerCommand } from '@cairn/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
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
  computerId: 'comp-1',
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

test('a departing private scope removes REST computer caches without removing public queries', () => {
  const qc = new QueryClient();
  const disconnect = startTeamStream('first-team', qc);
  disposers.push(disconnect);
  qc.setQueryData(['computers', 'first-team', 0], [{ id: 'comp-1' }]);
  qc.setQueryData(['computer-commands', 'first-team', 0, 'comp-1'], [command]);
  qc.setQueryData(['projects', 'first-team'], [{ id: 'public-project' }]);
  disconnect();
  expect(qc.getQueryData(['computers', 'first-team', 0])).toBeUndefined();
  expect(qc.getQueryData(['computer-commands', 'first-team', 0, 'comp-1'])).toBeUndefined();
  expect(qc.getQueryData(['projects', 'first-team'])).toEqual([{ id: 'public-project' }]);
});

test.each([['same-team', 1], ['other-team', 0]] as const)('a mounted observer moves to %s generation %s before old cleanup', (nextTeam, nextGeneration) => {
  const qc = new QueryClient();
  const oldScope = ['computers', 'same-team', 0];
  const newScope = ['computers', nextTeam, nextGeneration];
  qc.setQueryData(oldScope, [{ id: 'old-private' }]);
  const observer = new QueryObserver(qc, { queryKey: oldScope, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  disposers.push(unsubscribe);
  expect(observer.getCurrentResult().data).toEqual([{ id: 'old-private' }]);
  const disconnect = startTeamStream('same-team', qc, 0);
  disposers.push(disconnect);
  observer.setOptions({ queryKey: newScope, enabled: false });
  expect(observer.getCurrentResult().data).toBeUndefined();
  qc.setQueryData(newScope, [{ id: 'new-private' }]);
  qc.setQueryData(['computer-commands', nextTeam, nextGeneration, 'comp-new'], [{ ...command, output: 'new-private' }]);
  disconnect();
  expect(qc.getQueryData(oldScope)).toBeUndefined();
  expect(observer.getCurrentResult().data).toEqual([{ id: 'new-private' }]);
  expect(qc.getQueryData(['computer-commands', nextTeam, nextGeneration, 'comp-new'])).toEqual([{ ...command, output: 'new-private' }]);
});

test('late private REST responses cannot repopulate a departed scope or overwrite its replacement', async () => {
  const qc = new QueryClient();
  const oldKey = ['computer-commands', 'same-team', 0, 'comp-1'];
  const newKey = ['computer-commands', 'same-team', 1, 'comp-1'];
  let finish: (value: ComputerCommand[]) => void = () => {};
  const response = new Promise<ComputerCommand[]>((resolve) => { finish = resolve; });
  const pending = qc.fetchQuery({ queryKey: oldKey, queryFn: () => response }).catch(() => undefined);
  const disconnect = startTeamStream('same-team', qc, 0);
  disposers.push(disconnect);
  qc.setQueryData(newKey, [{ ...command, output: 'new-owner-output' }]);
  disconnect();
  finish([command]);
  await pending;
  expect(qc.getQueryData(oldKey)).toBeUndefined();
  expect(qc.getQueryData(newKey)).toEqual([{ ...command, output: 'new-owner-output' }]);
});

test('a reconnect drops cached live results before loading current history', () => {
  const { source } = start('first-team');
  source.emit({ type: 'computer.command', command });
  source.onopen?.();
  const history = [{ ...command, output: 'current server output' }];
  expect(mergeComputerFeed(history, computerFeedStore.snapshot())).toEqual(history);
});

test('an output frame and completion refresh the computer list for a call already on screen', () => {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const disconnect = startTeamStream('team-1', qc);
  disposers.push(disconnect);
  const source = FakeEventSource.instances.at(-1)!;
  source.onopen?.();
  const running = { ...command, status: 'running' as const, exitCode: null };
  source.emit({ type: 'computer.command', command: running });
  source.emit({ type: 'computer.command', command: running });
  source.emit({ type: 'computer.command', command });
  const keys = invalidate.mock.calls.flatMap((call) => {
    const filters = call[0] as { queryKey?: readonly string[] } | undefined;
    return filters?.queryKey?.[0] === 'computers' ? [filters.queryKey] : [];
  });
  expect(keys).toEqual([
    ['computers', 'team-1'],
    ['computers', 'team-1'],
    ['computers', 'team-1'],
  ]);
});

test('a missing stream event drops cached live results during reconciliation', () => {
  const { source } = start('first-team');
  source.emit({ type: 'computer.command', command, seq: 1 });
  source.emit({ type: 'ping', seq: 3 });
  expect(computerFeedStore.snapshot()).toEqual([]);
});
