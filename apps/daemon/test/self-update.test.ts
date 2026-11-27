import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createTarGz(sourceDir: string, outPath: string): { sha256: string; size: number } {
  execFileSync('tar', ['-C', sourceDir, '-czf', outPath, '.']);
  const bytes = readFileSync(outPath);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
  };
}

describe('standalone runner self-update', () => {
  test('classifies desktop-bundled, homebrew, docker, development, read-only vs writable standalone installs', async () => {
    const mod = await import('../src/self-update.js');
    const home = makeTestTempDir('cairn-su-class-');
    tempDirs.push(home);
    const writableDir = join(home, 'managed-bin');
    mkdirSync(writableDir, { recursive: true });
    const writableScript = join(writableDir, 'cli.mjs');
    writeFileSync(writableScript, '#!/usr/bin/env node\n');

    expect(
      mod.classifyRunnerInstall({
        cairnHome: home,
        scriptPath: '/Applications/Cairn.app/Contents/Resources/runner/dist/cli.mjs',
        env: {},
      }),
    ).toEqual({ supported: false, reason: 'desktop-bundled' });

    expect(
      mod.classifyRunnerInstall({
        cairnHome: home,
        scriptPath: '/opt/homebrew/Cellar/cairn/0.1.700/libexec/cli.mjs',
        env: {},
      }),
    ).toEqual({ supported: false, reason: 'homebrew' });

    expect(
      mod.classifyRunnerInstall({
        cairnHome: home,
        scriptPath: writableScript,
        env: { container: 'docker' },
      }),
    ).toEqual({ supported: false, reason: 'docker' });

    expect(
      mod.classifyRunnerInstall({
        cairnHome: home,
        scriptPath: '/repo/apps/daemon/src/cli.ts',
        env: {},
      }),
    ).toEqual({ supported: false, reason: 'development' });

    expect(
      mod.classifyRunnerInstall({
        cairnHome: home,
        scriptPath: writableScript,
        env: {},
        isWritable: () => false,
      }),
    ).toEqual({ supported: false, reason: 'read-only' });

    expect(
      mod.classifyRunnerInstall({
        cairnHome: home,
        scriptPath: writableScript,
        env: {},
        isWritable: () => true,
      }),
    ).toEqual({ supported: true, reason: null });

    const statePath = mod.selfUpdatePaths(home).stateFile;
    mod.writeSelfUpdateState(home, {
      activeVersion: '0.1.720',
      previousVersion: '0.1.710',
      pending: null,
      blocked: {},
      notice: null,
    });
    const synced = mod.syncBaseBinaryOverride(home, '0.1.730');
    expect(synced.activeVersion).toBeNull();
    expect(mod.readSelfUpdateState(home).activeVersion).toBeNull();
    expect(existsSync(statePath)).toBe(true);
  });

  test('validates manifest, SHA-256, path traversal, smoke test, and drains active work while ignoring exhausted uploads', async () => {
    const mod = await import('../src/self-update.js');
    const home = makeTestTempDir('cairn-su-drain-');
    tempDirs.push(home);
    const pkgSrc = makeTestTempDir('cairn-su-pkg-');
    tempDirs.push(pkgSrc);
    mkdirSync(join(pkgSrc, 'dist'), { recursive: true });
    writeFileSync(
      join(pkgSrc, 'dist', 'cli.mjs'),
      'if (process.argv.includes("--version")) { console.log("0.2.3"); process.exit(0); }\n',
    );
    const goodTar = join(home, 'good.tar.gz');
    const goodMeta = createTarGz(pkgSrc, goodTar);
    const badSmokeSrc = makeTestTempDir('cairn-su-badsmoke-');
    tempDirs.push(badSmokeSrc);
    mkdirSync(join(badSmokeSrc, 'dist'), { recursive: true });
    writeFileSync(join(badSmokeSrc, 'dist', 'cli.mjs'), 'process.exit(2);\n');
    const badSmokeTar = join(home, 'badsmoke.tar.gz');
    const badSmokeMeta = createTarGz(badSmokeSrc, badSmokeTar);

    let mode: 'missing-arch' | 'bad-sha' | 'bad-smoke' | 'valid' = 'missing-arch';
    let claimsPaused = false;
    let exitedCode: number | null = null;
    let busyCount = 1;
    let clock = 1_000_000;

    const updater = mod.createRunnerSelfUpdater({
      cairnHome: home,
      currentVersion: '0.1.720',
      scriptPath: join(home, 'base', 'cli.mjs'),
      install: { supported: true, reason: null },
      now: () => clock,
      isIdle: () => busyCount === 0,
      pauseClaims: () => {
        claimsPaused = true;
      },
      resumeClaims: () => {
        claimsPaused = false;
      },
      exitForSwap: (code: number) => {
        exitedCode = code;
      },
      fetchImpl: async (input) => {
        const url = String(input);
        const key = mod.currentRunnerPlatformKey();
        if (url.endsWith('/runner-latest.json')) {
          if (mode === 'missing-arch') {
            return new Response(JSON.stringify({ version: '0.1.725', files: {} }), { status: 200 });
          }
          if (mode === 'bad-sha') {
            return new Response(
              JSON.stringify({
                version: '0.1.725',
                files: {
                  [key]: {
                    name: 'cairn-runner-0.1.725.tar.gz',
                    size: goodMeta.size,
                    sha256: 'f'.repeat(64),
                  },
                },
              }),
              { status: 200 },
            );
          }
          if (mode === 'bad-smoke') {
            return new Response(
              JSON.stringify({
                version: '0.1.725',
                files: {
                  [key]: {
                    name: 'cairn-runner-0.1.725.tar.gz',
                    size: badSmokeMeta.size,
                    sha256: badSmokeMeta.sha256,
                  },
                },
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              version: '0.1.726',
              files: {
                [key]: {
                  name: 'cairn-runner-0.1.726.tar.gz',
                  size: goodMeta.size,
                  sha256: goodMeta.sha256,
                },
              },
            }),
            { status: 200 },
          );
        }
        if (mode === 'bad-smoke') return new Response(readFileSync(badSmokeTar), { status: 200 });
        return new Response(readFileSync(goodTar), { status: 200 });
      },
      env: { CAIRN_UPDATE_FEED_URL: 'https://feed.example.test' },
    });

    await updater.notifyUpdateAvailable('0.1.725');
    expect(updater.report().reason).toBe('no-asset');
    expect(claimsPaused).toBe(false);

    mode = 'bad-sha';
    clock += 31 * 60_000;
    await updater.notifyUpdateAvailable('0.1.725');
    expect(updater.report().reason).toBe('checksum-mismatch');
    expect(claimsPaused).toBe(false);

    mode = 'bad-smoke';
    clock += 31 * 60_000;
    await updater.notifyUpdateAvailable('0.1.725');
    expect(updater.report().reason).toBe('smoke-failed');
    expect(claimsPaused).toBe(false);

    mode = 'valid';
    await updater.notifyUpdateAvailable('0.1.726');
    expect(updater.report().state).toBe('waiting-idle');
    expect(claimsPaused).toBe(true);
    expect(exitedCode).toBeNull();

    busyCount = 0;
    await updater.tickDrain();
    expect(exitedCode).toBe(75);
    expect(mod.readSelfUpdateState(home).pending).toBe('0.1.726');

    expect(
      mod.isRunnerWorkIdle({
        inFlightSteps: 0,
        pendingUploads: [
          { state: 'awaiting-upload', stepId: 'exhausted' },
          { state: 'running', stepId: 'ignore-me' },
        ],
        strandedAttempts: new Map([['exhausted', 41]]),
        maxStrandedAttempts: 40,
        activeAntigravityVerifies: 0,
        activeComputerCalls: 0,
        activeScreens: 0,
      }),
    ).toBe(true);

    expect(
      mod.isRunnerWorkIdle({
        inFlightSteps: 0,
        pendingUploads: [],
        strandedAttempts: new Map(),
        maxStrandedAttempts: 40,
        activeAntigravityVerifies: 0,
        activeComputerCalls: 1,
        activeScreens: 0,
      }),
    ).toBe(false);
  });

  test('thin launcher hot-swaps on exit 75, confirms probation, rolls back crash, and forwards SIGTERM cleanly', async () => {
    const su = await import('../src/self-update.js');
    const boot = await import('../src/self-update-bootstrap.js');
    const home = makeTestTempDir('cairn-su-boot-');
    tempDirs.push(home);
    const paths = su.selfUpdatePaths(home);

    const baseEntry = join(home, 'base-cli.mjs');
    const traceFile = join(home, 'trace.log');
    const makeSlotScript = (
      version: string,
      behavior: 'swap-to-good' | 'confirm' | 'crash' | 'wait-term',
    ) => `
      import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
      import { join } from 'node:path';
      const home = process.env.CAIRN_HOME;
      const attempt = process.env.CAIRN_SELF_UPDATE_ATTEMPT || '';
      appendFileSync(${JSON.stringify(traceFile)}, '${version}:${behavior}:' + attempt + '\\n');
      if ('${behavior}' === 'swap-to-good') {
        const sPath = join(home, 'self-update', 'state.json');
        const st = JSON.parse(readFileSync(sPath, 'utf8'));
        st.pending = '0.1.725';
        writeFileSync(sPath, JSON.stringify(st));
        process.exit(75);
      }
      if ('${behavior}' === 'confirm') {
        const hPath = join(home, 'self-update', 'healthy.json');
        writeFileSync(hPath, JSON.stringify({ attemptId: attempt, version: '${version}', status: 'booted', at: Date.now() }));
        writeFileSync(hPath, JSON.stringify({ attemptId: attempt, version: '${version}', status: 'confirmed', at: Date.now() }));
        if (process.env.CAIRN_TEST_CRASH_ON_CONFIRM === '1') process.exit(0);
        setTimeout(() => process.exit(0), 150);
      }
      if ('${behavior}' === 'crash') {
        process.exit(1);
      }
      if ('${behavior}' === 'wait-term') {
        process.on('SIGTERM', () => {
          appendFileSync(${JSON.stringify(traceFile)}, '${version}:sigterm\\n');
          process.exit(0);
        });
        setInterval(() => {}, 1000);
      }
    `;

    writeFileSync(baseEntry, makeSlotScript('0.1.720', 'swap-to-good'));
    mkdirSync(join(paths.versionsDir, '0.1.725', 'dist'), { recursive: true });
    writeFileSync(
      join(paths.versionsDir, '0.1.725', 'dist', 'cli.mjs'),
      makeSlotScript('0.1.725', 'confirm'),
    );
    su.writeSelfUpdateState(home, {
      activeVersion: null,
      previousVersion: null,
      pending: null,
      blocked: {},
      notice: null,
    });

    const code1 = await boot.runSelfUpdateBootstrap({
      cairnHome: home,
      baseEntryPath: baseEntry,
      baseReleaseVersion: '0.1.720',
      argv: ['start', '--foreground'],
      env: { ...process.env, CAIRN_HOME: home },
    });
    expect(code1).toBe(0);
    expect(su.readSelfUpdateState(home).activeVersion).toBe('0.1.725');
    expect(su.readSelfUpdateState(home).pending).toBeNull();

    // Crash on bad pending 0.1.726 rolls back cleanly to 0.1.725 and blocks 0.1.726
    mkdirSync(join(paths.versionsDir, '0.1.726', 'dist'), { recursive: true });
    writeFileSync(
      join(paths.versionsDir, '0.1.726', 'dist', 'cli.mjs'),
      makeSlotScript('0.1.726', 'crash'),
    );
    writeFileSync(
      join(paths.versionsDir, '0.1.725', 'dist', 'cli.mjs'),
      makeSlotScript('0.1.725', 'confirm'),
    );
    su.writeSelfUpdateState(home, {
      activeVersion: '0.1.725',
      previousVersion: '0.1.720',
      pending: '0.1.726',
      blocked: {},
      notice: null,
    });
    const code2 = await boot.runSelfUpdateBootstrap({
      cairnHome: home,
      baseEntryPath: baseEntry,
      baseReleaseVersion: '0.1.720',
      argv: ['start', '--foreground'],
      env: { ...process.env, CAIRN_HOME: home },
    });
    expect(code2).toBe(0);
    const rolledState = su.readSelfUpdateState(home);
    expect(rolledState.activeVersion).toBe('0.1.725');
    expect(rolledState.pending).toBeNull();
    expect(rolledState.blocked['0.1.726']).toBeDefined();
    expect(rolledState.notice?.failedVersion).toBe('0.1.726');
    expect(rolledState.notice?.restoredVersion).toBe('0.1.725');
    const trace = readFileSync(traceFile, 'utf8');
    expect(trace).toContain('0.1.726:crash:');
    expect(trace).toContain('0.1.725:confirm:');

    let fakeTime = 1_000_000;
    let exitedOnOutage: number | null = null;
    const outageUpdater = su.createRunnerSelfUpdater({
      cairnHome: home,
      currentVersion: '0.1.725',
      scriptPath: join(paths.versionsDir, '0.1.725', 'dist', 'cli.mjs'),
      install: { supported: true, reason: null },
      attemptId: 'att-outage',
      now: () => fakeTime,
      probationMs: 30_000,
      isIdle: () => true,
      pauseClaims: () => {},
      resumeClaims: () => {},
      exitForSwap: (code) => {
        exitedOnOutage = code;
      },
    });
    outageUpdater.markBooted();
    fakeTime += 45_000;
    outageUpdater.recordPresenceResult(false);
    expect(su.readHealthyRecord(home)?.status).toBe('booted');
    expect(exitedOnOutage).toBeNull();
    outageUpdater.recordPresenceResult(true);
    fakeTime += 31_000;
    outageUpdater.recordPresenceResult(true);
    expect(su.readHealthyRecord(home)?.status).toBe('confirmed');

    su.writeSelfUpdateState(home, {
      activeVersion: '0.1.999-missing',
      previousVersion: null,
      pending: null,
      blocked: {},
      notice: null,
    });
    writeFileSync(baseEntry, makeSlotScript('0.1.720', 'confirm'));
    const fallbackCode = await boot.runSelfUpdateBootstrap({
      cairnHome: home,
      baseEntryPath: baseEntry,
      baseReleaseVersion: '0.1.720',
      argv: ['start', '--foreground'],
      env: { ...process.env, CAIRN_HOME: home },
    });
    expect(fallbackCode).toBe(0);
    expect(su.readSelfUpdateState(home).activeVersion).toBeNull();

    su.writeSelfUpdateState(home, {
      activeVersion: null,
      previousVersion: null,
      pending: '0.1.728',
      blocked: {},
      notice: null,
    });
    mkdirSync(join(paths.versionsDir, '0.1.728', 'dist'), { recursive: true });
    writeFileSync(
      join(paths.versionsDir, '0.1.728', 'dist', 'cli.mjs'),
      makeSlotScript('0.1.728', 'wait-term'),
    );
    const termPromise = boot.runSelfUpdateBootstrap({
      cairnHome: home,
      baseEntryPath: baseEntry,
      baseReleaseVersion: '0.1.720',
      argv: ['start', '--foreground'],
      env: { ...process.env, CAIRN_HOME: home },
    });
    await new Promise((r) => setTimeout(r, 250));
    process.emit('SIGTERM');
    expect(await termPromise).toBe(0);
    expect(su.readSelfUpdateState(home).blocked['0.1.728']).toBeUndefined();
  });
});
