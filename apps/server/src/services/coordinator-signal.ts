export type CoordinatorSignal = 'steer' | 'stop';

let signalThread: (threadId: string, kind: CoordinatorSignal) => void = () => {};

export function setCoordinatorSignal(
  signal: (threadId: string, kind: CoordinatorSignal) => void,
): void {
  signalThread = signal;
}

export function signalCoordinator(threadId: string, kind: CoordinatorSignal): void {
  signalThread(threadId, kind);
}
