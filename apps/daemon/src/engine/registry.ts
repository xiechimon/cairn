import type { AgentSessionHandle } from '@cairn/shared';
import type { EnginePty } from './engine-pty.js';

const enginePtys = new WeakMap<AgentSessionHandle, EnginePty>();

export function registerEnginePty(handle: AgentSessionHandle, pty: EnginePty): void {
  enginePtys.set(handle, pty);
}

export function enginePtyOf(handle: AgentSessionHandle | null | undefined): EnginePty | undefined {
  return handle === null || handle === undefined ? undefined : enginePtys.get(handle);
}
