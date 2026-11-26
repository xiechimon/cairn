import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const allocations = new Map();
const removal = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 };

function procProcesses(names) {
  return names
    .filter((name) => /^\d+$/.test(name))
    .map((name) => ({
      pid: Number(name),
      paths() {
        const cwd = readlinkSync(`/proc/${name}/cwd`).replace(/ \(deleted\)$/, '');
        return [cwd, ...readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0')];
      },
    }));
}

function listingRows(command, args) {
  return (spawnSync(command, args, { encoding: 'utf8' }).stdout ?? '').split('\n');
}

function listedProcesses() {
  const found = new Map();
  const add = (pid, ...paths) => {
    const known = found.get(pid) ?? [];
    found.set(pid, known.concat(paths));
  };
  let pid;
  const user = String(process.getuid());
  for (const row of listingRows('/usr/sbin/lsof', [
    ...['-w', '-n', '-P', '-a', '-u', user, '-d', 'cwd', '-Fpn'],
  ])) {
    if (row.startsWith('p')) pid = Number(row.slice(1));
    else if (row.startsWith('n')) add(pid, row.slice(1));
  }
  for (const row of listingRows('/bin/ps', ['-U', user, '-ww', '-o', 'pid=,command='])) {
    const [id, ...commandArguments] = row.trim().split(/\s+/);
    if (id) add(Number(id), ...commandArguments);
  }
  return [...found].map(([id, paths]) => ({ pid: id, paths: () => paths }));
}

function runningProcesses() {
  try {
    return procProcesses(readdirSync('/proc'));
  } catch {
    return process.platform === 'darwin' ? listedProcesses() : [];
  }
}

function reapProcessesUnder(path) {
  if (!existsSync(path)) return;
  const roots = new Set([path, realpathSync(path)]);
  const inside = (candidate) =>
    [...roots].some((root) => candidate === root || candidate.startsWith(`${root}/`));
  for (const candidate of runningProcesses()) {
    if (candidate.pid === process.pid) continue;
    try {
      if (!candidate.paths().some(inside)) continue;
      process.kill(candidate.pid, 'SIGKILL');
    } catch {}
  }
}

function removeTree(path) {
  for (let attempt = 0; ; attempt += 1) {
    reapProcessesUnder(path);
    let failure;
    try {
      rmSync(path, removal);
    } catch (error) {
      failure = error;
    }
    if (!failure && !existsSync(path)) return;
    if (attempt >= 3) {
      throw failure ?? new Error(`Temporary directory ${path} reappeared after removal`);
    }
  }
}

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
    removeTree(path);
    owned.delete(path);
    allocations.delete(path);
    return true;
  };
  return {
    runId,
    env: { CAIRN_TEST_RUN_ID: runId },
    allocate(prefix = 'fixture-', root = testTempRoot()) {
      if (typeof prefix !== 'string' || !/^[a-zA-Z0-9_-]*$/.test(prefix)) {
        throw new TypeError('prefix must contain only letters, digits, underscores or hyphens');
      }
      const path = mkdtempSync(join(root, `${testTempPrefix(runId)}${prefix}`));
      try {
        if (process.env.CAIRN_TEST_TEMP_STRICT === '1' && process.env.CAIRN_TEST_TEMP_REPORT) {
          appendFileSync(
            process.env.CAIRN_TEST_TEMP_REPORT,
            `${JSON.stringify({ kind: 'allocation', path, runId })}\n`,
          );
        }
      } catch (error) {
        removeTree(path);
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
      removeTree(path);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
});
