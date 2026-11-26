import { randomUUID } from 'node:crypto';
import type {
  MachineAntigravityUsageProbeClaim,
  MachineAntigravityUsageProbeResult,
} from '@cairn/shared';
import type { MachineWakeHub } from './machine-wake-hub.js';

type ProbeResult = MachineAntigravityUsageProbeResult;
type DispatchResult =
  | Extract<ProbeResult, { status: 'failed' }>
  | (Extract<ProbeResult, { status: 'ok' }> & { machineId: string });
type Assignment = { machineId: string; connectionId: string };
type PendingProbe = {
  candidates: Map<string, string>;
  assignment: Assignment | null;
  readClaim: (() => MachineAntigravityUsageProbeClaim) | null;
  isAuthorized: (machineId: string) => boolean;
  startDeadline: () => void;
  finish: (result: DispatchResult) => void;
};
type ProbeQueue = { pending: Map<string, PendingProbe>; scheduled: boolean };

const queues = new WeakMap<MachineWakeHub, ProbeQueue>();
const PROBE_TIMEOUT_MS = 35_000;

function scheduleProbeDispatch(hub: MachineWakeHub, queue: ProbeQueue): void {
  if (queue.scheduled || queue.pending.size === 0) return;
  queue.scheduled = true;
  queueMicrotask(() => {
    const { pending } = queue;
    const busy = new Set(
      [...pending.values()].flatMap(({ assignment }) =>
        assignment === null ? [] : [assignment.machineId],
      ),
    );
    queue.scheduled = false;
    for (const [requestId, probe] of pending) {
      if (probe.assignment !== null) continue;
      let waitingForRunner = false;
      let authorizationLost = false;
      for (const [machineId, connectionId] of probe.candidates) {
        if (hub.connectionId(machineId) !== connectionId) continue;
        if (!probe.isAuthorized(machineId)) {
          authorizationLost = true;
          continue;
        }
        if (busy.has(machineId)) {
          waitingForRunner = true;
          continue;
        }
        probe.assignment = { machineId, connectionId };
        if (hub.pushAntigravityUsageProbe(machineId, requestId)) {
          if (pending.has(requestId)) {
            busy.add(machineId);
            probe.startDeadline();
          }
          break;
        }
        if (!pending.has(requestId)) break;
        probe.assignment = null;
        probe.candidates.delete(machineId);
      }
      if (probe.assignment === null && !waitingForRunner) {
        probe.finish({ status: 'failed', failure: authorizationLost ? 'auth' : 'not-found' });
      }
    }
  });
}

export function dispatchAntigravityUsageProbe(
  hub: MachineWakeHub,
  machineIds: readonly string[],
  readClaim: () => MachineAntigravityUsageProbeClaim,
  isAuthorized: (machineId: string) => boolean,
  signal?: AbortSignal,
): Promise<DispatchResult> {
  if (signal?.aborted) return Promise.resolve({ status: 'failed', failure: 'timeout' });
  const candidates = new Map<string, string>();
  for (const machineId of machineIds) {
    const connectionId = hub.connectionId(machineId);
    if (connectionId !== undefined) candidates.set(machineId, connectionId);
  }
  if (candidates.size === 0) return Promise.resolve({ status: 'failed', failure: 'not-found' });
  const queue = queues.get(hub) ?? { pending: new Map<string, PendingProbe>(), scheduled: false };
  queues.set(hub, queue);

  return new Promise((resolve) => {
    const requestId = randomUUID();
    const finish = (result: DispatchResult) => {
      if (!queue.pending.delete(requestId)) return;
      clearTimeout(deadline);
      offDisconnect();
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
      scheduleProbeDispatch(hub, queue);
    };
    const onAbort = () => finish({ status: 'failed', failure: 'timeout' });
    let deadline = setTimeout(onAbort, PROBE_TIMEOUT_MS);
    const probe: PendingProbe = {
      assignment: null,
      candidates,
      readClaim,
      isAuthorized,
      startDeadline: () => {
        clearTimeout(deadline);
        deadline = setTimeout(onAbort, PROBE_TIMEOUT_MS);
      },
      finish,
    };
    const offDisconnect = hub.onDisconnect((machineId) => {
      if (machineId === probe.assignment?.machineId) {
        finish({ status: 'failed', failure: 'not-found' });
      } else if (probe.assignment === null && candidates.has(machineId)) {
        scheduleProbeDispatch(hub, queue);
      }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.pending.set(requestId, probe);
    scheduleProbeDispatch(hub, queue);
  });
}

function assignedProbe(
  hub: MachineWakeHub,
  requestId: string,
  machineId: string,
  connectionId: string,
): PendingProbe | undefined {
  const probe = queues.get(hub)?.pending.get(requestId);
  return probe?.assignment?.machineId === machineId &&
    probe.assignment.connectionId === connectionId &&
    hub.connectionId(machineId) === connectionId
    ? probe
    : undefined;
}

export function claimAntigravityUsageProbe(
  hub: MachineWakeHub,
  requestId: string,
  machineId: string,
  connectionId: string,
): MachineAntigravityUsageProbeClaim | undefined {
  const probe = assignedProbe(hub, requestId, machineId, connectionId);
  if (!probe?.readClaim) return undefined;
  const readClaim = probe.readClaim;
  probe.readClaim = null;
  if (probe.isAuthorized(machineId)) return readClaim();
  probe.finish({ status: 'failed', failure: 'auth' });
  return undefined;
}

export function finishAntigravityUsageProbe(
  hub: MachineWakeHub,
  requestId: string,
  machineId: string,
  connectionId: string,
  result: ProbeResult,
): 'accepted' | 'not-found' | 'revoked' {
  const probe = assignedProbe(hub, requestId, machineId, connectionId);
  if (!probe || probe.readClaim !== null) return 'not-found';
  if (!probe.isAuthorized(machineId)) {
    probe.finish({ status: 'failed', failure: 'auth' });
    return 'revoked';
  }
  probe.finish(result.status === 'ok' ? { ...result, machineId } : result);
  return 'accepted';
}
