import type { MachineRepoArchiveCommand } from '@cairn/shared';
import { HttpError } from '../lib/errors.js';
import type { MachineDeps } from './machine-deps.js';
import type { MachineWakeHub } from './machine-wake-hub.js';

export type RepoArchiveResult = { tarGz: Buffer } | { reason: string };

interface PendingArchive {
  machineId: string;
  maxBytes: number;
  settle(result: RepoArchiveResult): void;
}

const ARCHIVE_TIMEOUT_MS = 90_000;
const pendingByHub = new WeakMap<MachineWakeHub, Map<string, PendingArchive>>();

function pendingOf(hub: MachineWakeHub): Map<string, PendingArchive> {
  let map = pendingByHub.get(hub);
  if (map === undefined) {
    map = new Map<string, PendingArchive>();
    pendingByHub.set(hub, map);
  }
  return map;
}

export function requestRepoArchive(
  deps: Pick<MachineDeps, 'machineHub'>,
  machineId: string,
  command: MachineRepoArchiveCommand,
  signal: AbortSignal | undefined,
): Promise<RepoArchiveResult> {
  const pending = pendingOf(deps.machineHub);
  if (pending.has(command.stepId)) {
    return Promise.resolve({ reason: 'a repository snapshot is already being prepared' });
  }
  return new Promise<RepoArchiveResult>((resolve) => {
    const finish = (result: RepoArchiveResult) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      pending.delete(command.stepId);
      resolve(result);
    };
    const onAbort = () => finish({ reason: 'the repository snapshot was cancelled' });
    const timer = setTimeout(
      () => finish({ reason: 'the Runner did not return the repository snapshot in time' }),
      ARCHIVE_TIMEOUT_MS,
    );
    pending.set(command.stepId, { machineId, maxBytes: command.maxBytes, settle: finish });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!deps.machineHub.pushRepoArchive(machineId, command)) {
      finish({ reason: 'the Runner that holds the repository is offline' });
    }
  });
}

function requested(hub: MachineWakeHub, machineId: string, stepId: string): PendingArchive {
  const request = pendingOf(hub).get(stepId);
  if (request?.machineId !== machineId) {
    throw new HttpError(404, `no repository snapshot requested for step ${stepId}`);
  }
  return request;
}

export function authorizeRepoArchiveUpload(
  hub: MachineWakeHub,
  machineId: string,
  stepId: string,
): void {
  requested(hub, machineId, stepId);
}

export function receiveRepoArchive(
  hub: MachineWakeHub,
  machineId: string,
  stepId: string,
  base64: string,
): void {
  const request = requested(hub, machineId, stepId);
  const tarGz = Buffer.from(base64, 'base64');
  request.settle(
    tarGz.length > request.maxBytes
      ? { reason: `the snapshot is larger than ${request.maxBytes} bytes` }
      : { tarGz },
  );
}

export function receiveRepoArchiveFailure(
  hub: MachineWakeHub,
  machineId: string,
  stepId: string,
  reason: string,
): void {
  requested(hub, machineId, stepId).settle({
    reason: reason.slice(0, 300) || 'git archive failed',
  });
}
