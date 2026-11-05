import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const allocations = new Map();

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
      const path = mkdtempSync(
        join(process.env.CAIRN_TEST_TEMP_ROOT ?? tmpdir(), `cairn-test-${runId}-${prefix}`),
      );
      try {
        if (process.env.CAIRN_TEST_TEMP_STRICT === '1' && process.env.CAIRN_TEST_TEMP_REPORT) {
          appendFileSync(
            process.env.CAIRN_TEST_TEMP_REPORT,
            `${JSON.stringify({ kind: 'allocation', path, runId })}\n`,
          );
        }
      } catch (error) {
        rmSync(path, { recursive: true, force: true });
        throw error;
      }
      owned.add(path);
      allocations.set(path, runId);
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
  for (const [path, runId] of allocations) {
    try {
      if (process.env.CAIRN_TEST_TEMP_STRICT === '1' && existsSync(path)) {
        console.error(`test-tmpdir: survivor ${path}`);
        if (process.exitCode === undefined || Number(process.exitCode) === 0) process.exitCode = 1;
        if (process.env.CAIRN_TEST_TEMP_REPORT) {
          appendFileSync(
            process.env.CAIRN_TEST_TEMP_REPORT,
            `${JSON.stringify({ kind: 'leak', path, runId })}\n`,
          );
        }
      }
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
});
