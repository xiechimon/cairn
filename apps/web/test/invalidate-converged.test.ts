import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { invalidateEventQueries, STREAM_REFRESH_QUIET_MS } from '../src/api/invalidate.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const event = { type: 'step', teamId: 'team-1', conversationId: 'build-a', status: 'stopped', legacy: false } as const;

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  qc.clear();
  vi.useRealTimers();
});

test('an empty mount read is cancelled and replaced rather than swallowing the event', async () => {
  const queryKey = ['plans', 'build-a'];
  const first = deferred<string[]>();
  const cancelled = vi.fn();
  const queryFn = vi.fn<({ signal }: { signal: AbortSignal }) => Promise<string[]>>()
    .mockImplementationOnce(({ signal }) => {
      signal.addEventListener('abort', cancelled);
      return first.promise;
    })
    .mockResolvedValue(['saved plan']);
  const observer = new QueryObserver(qc, { queryKey, queryFn });
  const stop = observer.subscribe(() => {});
  const refresh = invalidateEventQueries(qc, event);
  first.resolve([]);
  await refresh;

  expect(cancelled).toHaveBeenCalledOnce();
  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(observer.getCurrentResult().data).toEqual(['saved plan']);
  stop();
});

test('a failed mount read gets a new attempt when a related event arrives', async () => {
  const queryKey = ['plans', 'build-a'];
  const queryFn = vi.fn<() => Promise<string[]>>()
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue(['saved plan']);
  const observer = new QueryObserver(qc, { queryKey, queryFn });
  const stop = observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
  await invalidateEventQueries(qc, event);

  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(observer.getCurrentResult().data).toEqual(['saved plan']);
  stop();
});

test('uncertain search hints wait for a quiet period and the running read, then refresh once', async () => {
  vi.useFakeTimers();
  const queryKey = ['search', 'pr:any'];
  const first = deferred<string[]>();
  const cancelled = vi.fn();
  const queryFn = vi.fn<({ signal }: { signal: AbortSignal }) => Promise<string[]>>()
    .mockImplementationOnce(({ signal }) => {
      signal.addEventListener('abort', cancelled);
      return first.promise;
    })
    .mockResolvedValue(['new result']);
  const observer = new QueryObserver(qc, { queryKey, queryFn, staleTime: Infinity });
  const stop = observer.subscribe(() => {});
  const hint = {
    type: 'build', teamId: 'team-1', projectId: 'project-a',
    doc: { id: 'build-a', todoId: 'todo-a', withPlan: false, prevPhase: null, triggerSource: 'user', planDocId: null, errorMessage: null, prUrl: null, prNumber: null, diffHash: null, createdAt: 1 },
  } as const;
  await invalidateEventQueries(qc, hint);
  expect(qc.getQueryState(queryKey)?.isInvalidated).toBe(true);
  await vi.advanceTimersByTimeAsync(STREAM_REFRESH_QUIET_MS - 1);
  await invalidateEventQueries(qc, hint);
  await vi.advanceTimersByTimeAsync(STREAM_REFRESH_QUIET_MS);
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(cancelled).not.toHaveBeenCalled();

  first.resolve(['earlier result']);
  await vi.advanceTimersByTimeAsync(STREAM_REFRESH_QUIET_MS * 2);
  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(cancelled).not.toHaveBeenCalled();
  expect(observer.getCurrentResult().data).toEqual(['new result']);
  stop();
});
