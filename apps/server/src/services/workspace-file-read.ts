import { randomUUID } from 'node:crypto';
import type { MachineWorkspaceFileReply, WorkspaceFileResult } from '@cairn/shared';
import type { MachineWakeHub } from './machine-wake-hub.js';

export type FileReadOutcome = WorkspaceFileResult | { status: 'offline' };

interface PendingRead {
  machineId: string;
  connectionId: string;
  finish(result: FileReadOutcome): void;
}

const reads = new WeakMap<MachineWakeHub, Map<string, PendingRead>>();
const READ_TIMEOUT_MS = 6_000;

export function requestWorkspaceFile(
  hub: MachineWakeHub,
  source: { teamId: string; machineId: string; workspace: string },
  path: string,
  signal: AbortSignal,
): Promise<FileReadOutcome> {
  const { machineId, teamId, workspace } = source;
  const connectionId = hub.connectionId(machineId);
  if (connectionId === undefined) return Promise.resolve({ status: 'offline' });
  if (signal.aborted) return Promise.resolve({ status: 'unavailable' });
  let pending = reads.get(hub);
  if (pending === undefined) {
    pending = new Map();
    reads.set(hub, pending);
  }
  const active = pending;
  if (
    active.size >= 64 ||
    [...active.values()].filter((read) => read.machineId === machineId).length >= 4
  ) {
    return Promise.resolve({ status: 'unavailable' });
  }
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const finish = (result: FileReadOutcome) => {
      if (!active.delete(requestId)) return;
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish({ status: 'unavailable' });
    const timer = setTimeout(abort, READ_TIMEOUT_MS);
    const unsubscribe = hub.onDisconnect((id) => {
      if (id === machineId) finish({ status: 'offline' });
    });
    signal.addEventListener('abort', abort, { once: true });
    active.set(requestId, { machineId, connectionId, finish });
    if (
      !hub.pushWorkspaceFileRead(teamId, machineId, connectionId, {
        type: 'workspace.file.read',
        requestId,
        workspace,
        path,
      })
    )
      finish({ status: 'offline' });
  });
}

export function acceptWorkspaceFile(
  hub: MachineWakeHub,
  machineId: string,
  requestId: string,
  { connectionId, result }: MachineWorkspaceFileReply,
): boolean {
  const pending = reads.get(hub)?.get(requestId);
  if (
    pending?.machineId !== machineId ||
    pending.connectionId !== connectionId ||
    hub.connectionId(machineId) !== connectionId
  )
    return false;
  pending.finish(result);
  return true;
}
