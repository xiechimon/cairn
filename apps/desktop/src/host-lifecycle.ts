import { LOCAL_CONNECTION_ID } from './connections.js';

export type HostIpcAction = 'status' | 'add-remote' | 'remove-remote' | 'switch' | 'set-resident';

export function canInvokeHostIpc(
  activeKind: 'local' | 'remote',
  action: HostIpcAction,
  targetId?: string,
): boolean {
  if (activeKind === 'local') return true;
  if (action === 'status') return true;
  if (action === 'switch') return targetId === LOCAL_CONNECTION_ID;
  return false;
}

export async function probeRemoteReachable(url: string, timeoutMs = 5_000): Promise<void> {
  try {
    await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Cannot connect to ${url}`);
  }
}
