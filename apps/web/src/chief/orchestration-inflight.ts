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

export interface OrchestrationWait {
  label: string;
  vars: Record<string, string>;
}

export function orchestrationWait(thread: ChiefThread): OrchestrationWait | null {
  const queue = thread.turnQueue;
  if (queue == null) return null;
  if (queue.blocked?.kind === 'machine-offline') {
    return queue.waitingFor != null
      ? { label: '等 {machine} 上线', vars: { machine: queue.waitingFor.name } }
      : { label: '等机器上线', vars: {} };
  }
  if (queue.blocked?.kind === 'capability-missing') {
    return { label: '缺 {missing}', vars: { missing: queue.blocked.missing.join('、') } };
  }
  return { label: '排队中', vars: {} };
}

export interface CardOrchestration {
  threadId: string;
  wait: OrchestrationWait | null;
  error?: string;
}

export function cardOrchestration(
  threads: readonly OrchestratedThread[] | undefined,
  todo: OrchestrationTarget,
): CardOrchestration | null {
  const inflight = inflightOrchestrationFor(threads, todo);
  if (inflight !== null) return { threadId: inflight.id, wait: orchestrationWait(inflight) };
  const title = orchestrateThreadTitle(todo.seqNum);
  const reported = (threads ?? []).filter(reportsOrchestration);
  if (reported.length > 0) {
    const failed = newest(
      reported.filter(
        (thread) =>
          thread.orchestration?.todoId === todo.id && thread.orchestration.state === 'failed',
      ),
    );
    if (failed === null) return null;
    return {
      threadId: failed.id,
      wait: null,
      error: failed.orchestration?.error ?? failed.lastTurnError ?? '',
    };
  }
  const latest = newest((threads ?? []).filter((thread) => thread.title === title));
  if (latest === null || !latest.lastTurnError) return null;
  return { threadId: latest.id, wait: null, error: latest.lastTurnError };
}
