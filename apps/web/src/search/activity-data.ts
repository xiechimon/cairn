interface DependencyState {
  status: 'pending' | 'error' | 'success';
  data?: unknown;
}

interface RetryableDependency extends DependencyState {
  refetch: () => Promise<unknown>;
}

export function activityDataState(
  live: boolean,
  teams: DependencyState,
  teamId: string | undefined,
  dependencies: readonly DependencyState[],
): 'ready' | 'loading' | 'error' {
  if (!live) return 'ready';
  if (teams.status === 'error') return 'error';
  if (teams.status === 'pending') return 'loading';
  if (teamId === undefined) return 'error';
  if (dependencies.some((query) => query.status === 'error')) return 'error';
  return dependencies.some((query) => query.status === 'pending') ? 'loading' : 'ready';
}

export async function retryActivityData(
  teams: RetryableDependency,
  teamId: string | undefined,
  dependencies: readonly RetryableDependency[],
): Promise<void> {
  if (teams.status !== 'success' || teamId === undefined) {
    await teams.refetch();
    return;
  }
  await Promise.all(dependencies.map((query) => query.refetch()));
}
