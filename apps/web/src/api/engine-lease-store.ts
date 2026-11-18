import { useSyncExternalStore } from 'react';

const heldSteps = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function noteEngineLease(stepId: unknown, held: unknown): void {
  if (typeof stepId !== 'string' || typeof held !== 'boolean') return;
  if (heldSteps.get(stepId) === held) return;
  heldSteps.set(stepId, held);
  for (const listener of listeners) listener();
}

export function engineLeaseHeld(stepId: string): boolean {
  return heldSteps.get(stepId) === true;
}

export function useEngineLeaseHeld(stepId: string | null): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (stepId === null ? false : engineLeaseHeld(stepId)),
  );
}
