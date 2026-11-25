export function isVitestRunner(argv?: string[]): boolean;

export function isPlaywrightRunner(argv?: string[]): boolean;

export function heavyRunAuthorized(env?: { [key: string]: string | undefined }): boolean;

export function assertLocalTestRunAllowed(
  tool: 'vitest' | 'playwright',
  argv?: string[],
  env?: { [key: string]: string | undefined },
): void;

export function selectedTestFiles(argv?: string[]): string[];

export function lightTestRun(argv?: string[]): string | null;

export function admitTestRun(options?: { light?: string | null }): Promise<{
  slot: number;
  owner: number;
  release(): void;
} | null>;

export function testRunPort(base: string | number): Promise<number>;

export function testRunWorkers(): Promise<number | undefined>;
