export interface Scheduler {
  start(): void;
  stop(): void;
  tick(nowMs?: number): Promise<void>;
}
