import { type ChiefThread, orchestrateThreadTitle } from '@cairn/shared';

export type CoordinatorLoad = 'loading' | 'error' | 'ready';

interface QueryState {
  isLoading: boolean;
  isError: boolean;
  data: unknown;
}

export function coordinatorLoad(input: {
  chief: QueryState;
  coordinator: QueryState;
  messages: QueryState;
  hasThread: boolean;
}): CoordinatorLoad {
  const needed = input.hasThread
    ? [input.chief, input.coordinator, input.messages]
    : [input.chief, input.coordinator];
  if (needed.some((q) => q.isError && q.data === undefined)) return 'error';
  if (needed.some((q) => q.isLoading)) return 'loading';
  return 'ready';
}

type ProjectBoundThread = ChiefThread & { projectId?: string | null };

function isOrchestrationThread(thread: ChiefThread): boolean {
  const seq = thread.title.match(/\d+/)?.[0];
  return seq !== undefined && thread.title === orchestrateThreadTitle(Number(seq));
}

export function globalCoordinatorThread(
  threads: readonly ProjectBoundThread[],
): ChiefThread | null {
  const conversations = threads.filter(
    (thread) => !isOrchestrationThread(thread) && thread.projectId == null,
  );
  const pool = conversations.length > 0 ? conversations : threads;
  return pool.reduce<ChiefThread | null>(
    (oldest, thread) => (oldest === null || thread.createdAt < oldest.createdAt ? thread : oldest),
    null,
  );
}
