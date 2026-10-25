export interface Scheduler {
  start(): void;
  stop(): void;
  tick(nowMs?: number): void;
}
