export function admitTestRun(): Promise<{
  slot: number;
  owner: number;
  release(): void;
} | null>;
