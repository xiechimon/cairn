import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const allocations = new Set();

export function createTestTempRun({ runId = randomUUID() } = {}) {
  if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId)) {
    throw new TypeError('runId must be a UUID');
  }
  const owned = new Set();
  const release = (path) => {
    if (!owned.has(path)) return false;
    rmSync(path, { recursive: true, force: true });
    owned.delete(path);
    allocations.delete(path);
    return true;
  };
  return {
    runId,
    env: { CAIRN_TEST_RUN_ID: runId },
    allocate(prefix = 'fixture-') {
      if (typeof prefix !== 'string' || !/^[a-zA-Z0-9_-]*$/.test(prefix)) {
        throw new TypeError('prefix must contain only letters, digits, underscores or hyphens');
      }
      const path = mkdtempSync(join(tmpdir(), `cairn-test-${runId}-${prefix}`));
      owned.add(path);
      allocations.add(path);
      return path;
    },
    release,
    cleanup() {
      const errors = [];
      for (const path of owned) {
        try {
          release(path);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Temporary directory cleanup failed');
    },
  };
}

const defaultRun = createTestTempRun({ runId: process.env.CAIRN_TEST_RUN_ID || randomUUID() });
process.env.CAIRN_TEST_RUN_ID = defaultRun.runId;

export const testTempRunId = defaultRun.runId;
export const makeTestTempDir = defaultRun.allocate;
export const releaseTestTempDir = defaultRun.release;
export const cleanupTestTempDirs = defaultRun.cleanup;

process.once('exit', () => {
  for (const path of allocations) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
});
