import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { bootServer } from './helpers.js';

const vitestBin = fileURLToPath(
  new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url),
);
const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const testDir = fileURLToPath(new URL('.', import.meta.url));

function runChildFixture(opts: {
  runId: string;
  fixtureFile: string;
  source: string;
  env?: Record<string, string>;
}): ReturnType<typeof spawnSync> {
  writeFileSync(opts.fixtureFile, opts.source);
  return spawnSync(
    process.execPath,
    [vitestBin, 'run', '--no-file-parallelism', opts.fixtureFile],
    {
      encoding: 'utf8',
      env: { ...process.env, CAIRN_TEST_RUN_ID: opts.runId, ...opts.env },
      cwd: serverRoot,
      timeout: 60_000,
    },
  );
}

describe('bootServer fixture lifecycle', () => {
  test('bootServer then dispose leaves none of its four owned dirs on disk', () => {
    const s = bootServer();
    const dirs = [s.reposDir, s.attachmentsDir, s.skillsDir, dirname(s.skillSourcesPath)];
    for (const dir of dirs) expect(existsSync(dir)).toBe(true);
    s.dispose();
    for (const dir of dirs) expect(existsSync(dir)).toBe(false);
  });

  test('dispose twice does not throw', () => {
    const s = bootServer();
    s.dispose();
    expect(() => s.dispose()).not.toThrow();
  });

  test('caller-supplied reposDir survives dispose', () => {
    const caller = mkdtempSync(join(tmpdir(), 'caller-repos-'));
    try {
      const s = bootServer({ reposDir: caller });
      s.dispose();
      expect(existsSync(caller)).toBe(true);
    } finally {
      rmSync(caller, { recursive: true, force: true });
    }
  });

  test('bootServer that throws during startup leaves no owned dirs', () => {
    const runId = randomUUID();
    const fixtureFile = join(testDir, `_startup-fail-${runId}.test.ts`);
    try {
      const result = runChildFixture({
        runId,
        fixtureFile,
        source: `import { expect, test, vi } from 'vitest';
import * as appMod from '../src/app.js';
import { bootServer } from './helpers.js';

test('startup failure cleans owned dirs', () => {
  vi.spyOn(appMod, 'createApp').mockImplementationOnce(() => {
    throw new Error('startup failed');
  });
  expect(() => bootServer()).toThrow(/startup failed/);
});
`,
      });
      expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
      const leftover = readdirSync(tmpdir()).filter((name) =>
        name.includes(`cairn-test-${runId}-`),
      );
      expect(leftover).toEqual([]);
    } finally {
      rmSync(fixtureFile, { force: true });
    }
  }, 60_000);

  test('a test that never calls dispose has its dirs released by the fallback', () => {
    const runId = randomUUID();
    const fixtureFile = join(testDir, `_leak-case-${runId}.test.ts`);
    const ownedPath = join(testDir, `_leak-owned-${runId}.json`);
    try {
      const result = runChildFixture({
        runId,
        fixtureFile,
        env: { CAIRN_LIFECYCLE_OWNED_PATH: ownedPath },
        source: `import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'vitest';
import { bootServer } from './helpers.js';

test('leaks without dispose', () => {
  const s = bootServer();
  writeFileSync(
    process.env.CAIRN_LIFECYCLE_OWNED_PATH!,
    JSON.stringify([s.reposDir, s.attachmentsDir, s.skillsDir, dirname(s.skillSourcesPath)]),
  );
});
`,
      });
      expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
      expect(existsSync(ownedPath)).toBe(true);
      const owned = JSON.parse(readFileSync(ownedPath, 'utf8')) as string[];
      expect(owned.length).toBe(4);
      for (const dir of owned) {
        expect(dir.includes(`cairn-test-${runId}-`)).toBe(true);
        expect(existsSync(dir)).toBe(false);
      }
      const leftover = readdirSync(tmpdir()).filter((name) =>
        name.includes(`cairn-test-${runId}-`),
      );
      expect(leftover).toEqual([]);
    } finally {
      rmSync(fixtureFile, { force: true });
      rmSync(ownedPath, { force: true });
    }
  }, 60_000);
});
