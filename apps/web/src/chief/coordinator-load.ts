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
