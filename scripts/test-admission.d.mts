export function admitTestRun(): Promise<{
  slot: number;
  owner: number;
  release(): void;
} | null>;

export function testRunPort(base: string | number): Promise<number>;
