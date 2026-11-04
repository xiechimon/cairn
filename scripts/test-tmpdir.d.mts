export interface TestTempRun {
  runId: string;
  env: { CAIRN_TEST_RUN_ID: string };
  allocate(prefix?: string): string;
  release(path: string): boolean;
  cleanup(): void;
}
export function createTestTempRun(options?: { runId?: string }): TestTempRun;
export const testTempRunId: string;
export const makeTestTempDir: TestTempRun['allocate'];
export const releaseTestTempDir: TestTempRun['release'];
export const cleanupTestTempDirs: TestTempRun['cleanup'];
