import type { MachineRepoArchiveCommand } from '@cairn/shared';
import { HttpError } from '../lib/errors.js';
import type { MachineDeps } from './machine-deps.js';

export type RepoArchiveResult = { tarGz: Buffer } | { reason: string };

interface PendingArchive {
  machineId: string;
  maxBytes: number;
  settle(result: RepoArchiveResult): void;
}

const ARCHIVE_TIMEOUT_MS = 90_000;
const pending = new Map<string, PendingArchive>();

export function requestRepoArchive(
  deps: Pick<MachineDeps, 'machineHub'>,
  machineId: string,
  command: MachineRepoArchiveCommand,
  signal: AbortSignal | undefined,
): Promise<RepoArchiveResult> {
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

function requested(machineId: string, stepId: string): PendingArchive {
  const request = pending.get(stepId);
  if (request?.machineId !== machineId) {
    throw new HttpError(404, `no repository snapshot requested for step ${stepId}`);
  }
  return request;
}

export function authorizeRepoArchiveUpload(machineId: string, stepId: string): void {
  requested(machineId, stepId);
}

export function receiveRepoArchive(machineId: string, stepId: string, base64: string): void {
  const request = requested(machineId, stepId);
  const tarGz = Buffer.from(base64, 'base64');
  request.settle(
    tarGz.length > request.maxBytes
      ? { reason: `the snapshot is larger than ${request.maxBytes} bytes` }
      : { tarGz },
  );
}

export function receiveRepoArchiveFailure(machineId: string, stepId: string, reason: string): void {
  requested(machineId, stepId).settle({ reason: reason.slice(0, 300) || 'git archive failed' });
}
