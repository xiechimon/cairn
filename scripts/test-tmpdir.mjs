import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const allocations = new Map();
const removal = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 };

export function testTempPrefix(runId) {
  return `ct-${runId.slice(0, 8)}-`;
}

export function testTempRoot() {
  return process.env.CAIRN_TEST_TEMP_ROOT ?? tmpdir();
}

export function createTestTempRun({ runId = randomUUID() } = {}) {
  if (typeof runId !== 'string' || !/^[a-f0-9-]{36}$/.test(runId)) {
    throw new TypeError('runId must be a UUID');
  }
  const owned = new Set();
  const release = (path) => {
    if (!owned.has(path)) return false;
    rmSync(path, removal);
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
      const path = mkdtempSync(join(testTempRoot(), `${testTempPrefix(runId)}${prefix}`));
      try {
        if (process.env.CAIRN_TEST_TEMP_STRICT === '1' && process.env.CAIRN_TEST_TEMP_REPORT) {
          appendFileSync(
            process.env.CAIRN_TEST_TEMP_REPORT,
            `${JSON.stringify({ kind: 'allocation', path, runId })}\n`,
          );
        }
      } catch (error) {
        rmSync(path, removal);
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
      rmSync(path, removal);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
});
