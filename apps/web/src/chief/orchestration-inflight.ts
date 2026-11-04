import { type ChiefThread, orchestrateThreadTitle } from '@cairn/shared';

export function threadTurnInFlight(thread: ChiefThread): boolean {
  return thread.turnQueue != null || thread.activeRun != null;
}

export interface ThreadOrchestration {
  todoId: string;
  state: 'queued' | 'running' | 'failed';
  error: string | null;
}

type OrchestratedThread = ChiefThread & { orchestration?: ThreadOrchestration | null };

interface OrchestrationTarget {
  id: string;
  seqNum: number;
}

function reportsOrchestration(thread: OrchestratedThread): boolean {
  return thread.orchestration !== undefined;
}

function newest(threads: readonly OrchestratedThread[]): OrchestratedThread | null {
  return threads.reduce<OrchestratedThread | null>(
    (best, item) => (best === null || item.createdAt > best.createdAt ? item : best),
    null,
  );
}

export function inflightOrchestrationFor(
  threads: readonly OrchestratedThread[] | undefined,
  todo: OrchestrationTarget,
): ChiefThread | null {
  if (threads === undefined) return null;
  const title = orchestrateThreadTitle(todo.seqNum);
  return newest(
    threads.filter((thread) =>
      reportsOrchestration(thread)
        ? thread.orchestration?.todoId === todo.id && thread.orchestration.state !== 'failed'
        : thread.title === title && threadTurnInFlight(thread),
    ),
  );
}
