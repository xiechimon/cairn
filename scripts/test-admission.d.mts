export function isVitestRunner(argv?: string[]): boolean;

export function selectedTestFiles(argv?: string[]): string[];

export function lightTestRun(argv?: string[]): string | null;

export function admitTestRun(options?: { light?: string | null }): Promise<{
  slot: number;
  owner: number;
  release(): void;
} | null>;

export function testRunPort(base: string | number): Promise<number>;

export function testRunWorkers(): Promise<number | undefined>;
