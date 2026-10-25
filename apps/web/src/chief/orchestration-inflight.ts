import { type ChiefThread, orchestrateThreadTitle } from '@cairn/shared';

export function threadTurnInFlight(thread: ChiefThread): boolean {
  return thread.turnQueue != null || thread.activeRun != null;
}

export function inflightOrchestrationFor(
  threads: readonly ChiefThread[] | undefined,
  seqNum: number,
): ChiefThread | null {
  if (threads === undefined) return null;
  const title = orchestrateThreadTitle(seqNum);
  let best: ChiefThread | null = null;
  for (const thread of threads) {
    if (thread.title !== title || !threadTurnInFlight(thread)) continue;
    if (best === null || thread.createdAt > best.createdAt) best = thread;
  }
  return best;
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
  threads: readonly ChiefThread[] | undefined,
  seqNum: number,
): CardOrchestration | null {
  const inflight = inflightOrchestrationFor(threads, seqNum);
  if (inflight !== null) return { threadId: inflight.id, wait: orchestrationWait(inflight) };
  const title = orchestrateThreadTitle(seqNum);
  const thread = threads
    ?.filter((item) => item.title === title)
    .reduce<ChiefThread | null>(
      (best, item) => (best === null || item.createdAt > best.createdAt ? item : best),
      null,
    );
  if (thread == null) return null;
  return thread.lastTurnError
    ? { threadId: thread.id, wait: null, error: thread.lastTurnError }
    : null;
}
