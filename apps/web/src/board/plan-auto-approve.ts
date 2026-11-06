export type PlanAutoState =
  | { kind: 'counting'; remainingMs: number }
  | { kind: 'held' }
  | { kind: 'off' };

export function planAutoState(
  todo: { planAutoApproveAt?: number | undefined; planAutoHold?: boolean | undefined },
  now: number,
): PlanAutoState {
  if (todo.planAutoHold === true) return { kind: 'held' };
  if (todo.planAutoApproveAt !== undefined) {
    return { kind: 'counting', remainingMs: todo.planAutoApproveAt - now };
  }
  return { kind: 'off' };
}

export function countdownLabel(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
