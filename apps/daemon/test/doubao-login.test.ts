import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineDoubaoLoginEventBody } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createDoubaoLoginRunner } from '../src/backend/doubao-login.js';
import { createDoubaoManaged } from '../src/backend/doubao-managed.js';

const PNG_1X1_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const PNG_1X1_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

function makeStubCommand(scriptBody: string): string {
  const dir = makeTestTempDir('doubao-login-test-');
  tempDirs.push(dir);
  const binPath = join(dir, 'doubao');
  writeFileSync(binPath, `#!/usr/bin/env node\n${scriptBody}\n`);
  chmodSync(binPath, 0o755);
  return binPath;
}

describe('doubao runner QR login lifecycle', () => {
  test('streams QR_IMAGE PNG through scanned/verifying/succeeded and re-probes capabilities', async () => {
    const dir = makeTestTempDir('doubao-qr-png-');
    tempDirs.push(dir);
    const pngPath = join(dir, 'qrcode.png');
    writeFileSync(pngPath, PNG_1X1_A);

    const bin = makeStubCommand(`
      const fs = require('node:fs');
      if (process.env.DOUBAO_CLI_NO_UPDATE_CHECK !== '1') process.exit(9);
      console.log('QR_IMAGE=' + ${JSON.stringify(pngPath)});
      setTimeout(() => console.log('已扫描二维码，正在等待手机确认...'), 20);
      setTimeout(() => console.log('手机已确认，正在检查账号是否可用…'), 40);
      setTimeout(() => { console.log('登录成功，账号已通过验证'); process.exit(0); }, 60);
    `);
    const events: MachineDoubaoLoginEventBody[] = [];
    let probed = false;
    const runner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      env: { ...process.env, HOME: '/Users/real-home-preserved' },
      ensureBinary: async () => ({ command: bin }),
      refreshProbe: async () => {
        probed = true;
        return {
          installed: true,
          authenticated: true,
          platformSupported: true,
          probedAt: 1234,
          models: [{ id: '4', name: 'Doubao 2.1 Turbo' }],
        };
      },
      onEvent: (ev) => {
        events.push(ev);
      },
    });

    await runner.start('login-1');
    expect(probed).toBe(true);
    expect(events.map((e) => e.status)).toEqual([
      'installing',
      'starting',
      'qr',
      'scanned',
      'verifying',
      'succeeded',
    ]);
    const qrEv = events.find((e) => e.status === 'qr');
    expect(qrEv?.qrPngBase64).toBe(PNG_1X1_A.toString('base64'));
    const doneEv = events.find((e) => e.status === 'succeeded');
    expect(doneEv?.doubao?.authenticated).toBe(true);
    expect(doneEv?.doubao?.models?.[0]?.id).toBe('4');
  });

  test('handles expired, refused refresh, logoutFirst, keychain_locked, unsupported_account, cancel, timeout, and rejects invalid PNG', async () => {
    const expiredBin = makeStubCommand(`
      console.error('登录二维码已过期，请运行 doubao login 获取新二维码');
      process.exit(1);
    `);
    const expEvents: MachineDoubaoLoginEventBody[] = [];
    await createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: expiredBin }),
      refreshProbe: async () => ({ installed: true, authenticated: false }),
      onEvent: (ev) => {
        expEvents.push(ev);
      },
    }).start('login-exp');
    expect(expEvents.at(-1)?.status).toBe('expired');
    expect(expEvents.at(-1)?.reason).toBe('expired');

    const dir = makeTestTempDir('doubao-qr-refresh-');
    tempDirs.push(dir);
    const png1 = join(dir, 'qr1.png');
    const png2 = join(dir, 'qr2.png');
    const orderLog = join(dir, 'order.log');
    writeFileSync(png1, PNG_1X1_A);
    writeFileSync(png2, PNG_1X1_B);
    const refreshBin = makeStubCommand(`
      const fs = require('node:fs');
      fs.appendFileSync(${JSON.stringify(orderLog)}, process.argv[2] + '\\n');
      if (process.argv[2] === 'logout') process.exit(0);
      console.log('QR_IMAGE=' + ${JSON.stringify(png1)});
      setTimeout(() => {
        console.log('用户已在手机上拒绝本次登录，请扫描下方的新二维码');
        console.log('QR_IMAGE=' + ${JSON.stringify(png2)});
      }, 20);
      setTimeout(() => process.exit(0), 50);
    `);
    let logoutStarted = 0;
    const refEvents: MachineDoubaoLoginEventBody[] = [];
    await createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: refreshBin }),
      refreshProbe: async () => ({ installed: true, authenticated: true }),
      onLogoutStart: () => {
        logoutStarted += 1;
      },
      onEvent: (ev) => {
        refEvents.push(ev);
      },
    }).start('login-ref', { logoutFirst: true });
    expect(logoutStarted).toBe(1);
    expect(readFileSync(orderLog, 'utf8').trim().split('\n')).toEqual(['logout', 'login']);
    const refQrs = refEvents.filter((e) => e.status === 'qr');
    expect(refQrs).toHaveLength(2);
    expect(refQrs[0]?.qrPngBase64).toBe(PNG_1X1_A.toString('base64'));
    expect(refQrs[1]?.qrPngBase64).toBe(PNG_1X1_B.toString('base64'));
    expect(refQrs[0]?.qrPngBase64).not.toBe(refQrs[1]?.qrPngBase64);
    expect(refEvents.at(-1)?.status).toBe('succeeded');

    const failLogoutMarker = join(dir, 'should-not-login');
    const failLogoutBin = makeStubCommand(`
      const fs = require('node:fs');
      if (process.argv[2] === 'logout') process.exit(2);
      fs.writeFileSync(${JSON.stringify(failLogoutMarker)}, 'called');
      process.exit(0);
    `);
    const failLogoutEvents: MachineDoubaoLoginEventBody[] = [];
    await createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: failLogoutBin }),
      refreshProbe: async () => ({ installed: true, authenticated: true }),
      onEvent: (ev) => {
        failLogoutEvents.push(ev);
      },
    }).start('login-logout-fail', { logoutFirst: true });
    expect(existsSync(failLogoutMarker)).toBe(false);
    expect(failLogoutEvents.at(-1)?.status).toBe('failed');

    const kcBin = makeStubCommand(`
      console.error('[SessionStorage] Keychain insertion failed, os_status=-25308');
      process.exit(1);
    `);
    const kcEvents: MachineDoubaoLoginEventBody[] = [];
    await createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: kcBin }),
      refreshProbe: async () => ({ installed: true, authenticated: false }),
      onEvent: (ev) => {
        kcEvents.push(ev);
      },
    }).start('login-kc');
    expect(kcEvents.at(-1)?.status).toBe('failed');
    expect(kcEvents.at(-1)?.reason).toBe('keychain_locked');

    const unsupBin = makeStubCommand(`
      console.error('该账号需要额外验证，当前 CLI 暂不支持，无法完成登录');
      process.exit(1);
    `);
    const unsupEvents: MachineDoubaoLoginEventBody[] = [];
    await createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: unsupBin }),
      refreshProbe: async () => ({ installed: true, authenticated: false }),
      onEvent: (ev) => {
        unsupEvents.push(ev);
      },
    }).start('login-unsup');
    expect(unsupEvents.at(-1)?.reason).toBe('unsupported_account');

    const badPng = join(dir, 'bad.png');
    writeFileSync(badPng, 'NOT_A_PNG');
    const badPngBin = makeStubCommand(`
      console.log('QR_IMAGE=' + ${JSON.stringify(badPng)});
      setTimeout(() => process.exit(0), 200);
    `);
    const badEvents: MachineDoubaoLoginEventBody[] = [];
    await createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: badPngBin }),
      refreshProbe: async () => ({ installed: true, authenticated: true }),
      onEvent: (ev) => {
        badEvents.push(ev);
      },
    }).start('login-badpng');
    expect(badEvents.at(-1)?.status).toBe('failed');

    const slowBin = makeStubCommand(`
      setTimeout(() => console.log('已扫描二维码'), 80);
      setTimeout(() => process.exit(0), 5000);
    `);
    const cancelEvents: MachineDoubaoLoginEventBody[] = [];
    const cancelRunner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: slowBin }),
      refreshProbe: async () => ({ installed: true, authenticated: false }),
      onEvent: (ev) => {
        cancelEvents.push(ev);
      },
    });
    const pCancel = cancelRunner.start('login-cancel');
    await new Promise((r) => setTimeout(r, 30));
    cancelRunner.cancel('login-cancel');
    await pCancel;
    await new Promise((r) => setTimeout(r, 90));
    expect(cancelEvents.at(-1)?.status).toBe('cancelled');
    expect(cancelEvents.some((e) => e.status === 'scanned')).toBe(false);

    const toEvents: MachineDoubaoLoginEventBody[] = [];
    await createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      loginTimeoutMs: 80,
      ensureBinary: async () => ({ command: slowBin }),
      refreshProbe: async () => ({ installed: true, authenticated: false }),
      onEvent: (ev) => {
        toEvents.push(ev);
      },
    }).start('login-timeout');
    expect(toEvents.at(-1)?.status).toBe('expired');

    const spawnErrEvents: MachineDoubaoLoginEventBody[] = [];
    const spawnErrRunner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: join(dir, 'does-not-exist') }),
      refreshProbe: async () => ({ installed: false, authenticated: false }),
      onEvent: (ev) => {
        spawnErrEvents.push(ev);
      },
    });
    await spawnErrRunner.start('login-enoent');
    expect(spawnErrEvents.at(-1)?.status).toBe('failed');
    expect(spawnErrRunner.activeLoginId()).toBeNull();

    const probeErrEvents: MachineDoubaoLoginEventBody[] = [];
    const okExitBin = makeStubCommand(`process.exit(0);`);
    const probeErrRunner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: okExitBin }),
      refreshProbe: async () => {
        throw new Error('probe crashed');
      },
      onEvent: (ev) => {
        probeErrEvents.push(ev);
      },
    });
    await probeErrRunner.start('login-probe-err');
    expect(probeErrEvents.at(-1)?.status).toBe('failed');
    expect(probeErrRunner.activeLoginId()).toBeNull();
  });

  test('sends SIGKILL to SIGTERM-ignoring child and sequences prior exit before respawning', async () => {
    const dir = makeTestTempDir('doubao-sigkill-');
    tempDirs.push(dir);
    const pidFile = join(dir, 'first.pid');
    const lockFile = join(dir, 'child.lock');
    const overlapFile = join(dir, 'overlap.txt');
    const stubBin = makeStubCommand(`
      const fs = require('node:fs');
      const pidFile = ${JSON.stringify(pidFile)};
      const lockFile = ${JSON.stringify(lockFile)};
      const overlapFile = ${JSON.stringify(overlapFile)};
      if (!fs.existsSync(pidFile)) {
        fs.writeFileSync(pidFile, String(process.pid));
        fs.writeFileSync(lockFile, String(process.pid));
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
      } else {
        const prevPid = Number(fs.readFileSync(pidFile, 'utf8'));
        let stillAlive = false;
        try {
          process.kill(prevPid, 0);
          stillAlive = true;
        } catch {}
        fs.writeFileSync(overlapFile, String(stillAlive));
        process.exit(0);
      }
    `);

    const events: MachineDoubaoLoginEventBody[] = [];
    const runner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: stubBin }),
      refreshProbe: async () => ({ installed: true, authenticated: true }),
      onEvent: (ev) => {
        events.push(ev);
      },
    });

    const p1 = runner.start('sigkill-1');
    const waitStart = Date.now();
    while (!existsSync(lockFile) && Date.now() - waitStart < 2000) {
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(existsSync(lockFile)).toBe(true);
    const firstPid = Number(readFileSync(pidFile, 'utf8'));

    runner.cancel('sigkill-1');
    const p2 = runner.start('sigkill-2');
    await Promise.all([p1, p2]);

    let firstAliveAfter = false;
    try {
      process.kill(firstPid, 0);
      firstAliveAfter = true;
    } catch {}
    expect(firstAliveAfter).toBe(false);
    expect(readFileSync(overlapFile, 'utf8')).toBe('false');
    expect(events.some((e) => e.loginId === 'sigkill-2' && e.status === 'succeeded')).toBe(true);

    const hangLock = join(dir, 'hang2.lock');
    const hangPid = join(dir, 'hang2.pid');
    const hangBin = makeStubCommand(`
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(hangPid)}, String(process.pid));
      fs.writeFileSync(${JSON.stringify(hangLock)}, '1');
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `);
    let aliveAtCancelEmit: boolean | null = null;
    const orderRunner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: async () => ({ command: hangBin }),
      refreshProbe: async () => ({ installed: true, authenticated: false }),
      onEvent: (ev) => {
        if (ev.status === 'cancelled') {
          const pid = Number(readFileSync(hangPid, 'utf8'));
          try {
            process.kill(pid, 0);
            aliveAtCancelEmit = true;
          } catch {
            aliveAtCancelEmit = false;
          }
        }
      },
    });
    const hangPromise = orderRunner.start('sigkill-order');
    while (!existsSync(hangLock)) await new Promise((r) => setTimeout(r, 10));
    orderRunner.cancel('sigkill-order');
    await hangPromise;
    expect(aliveAtCancelEmit).toBe(false);
  });

  test('aborts in-flight ensureBinary(signal) on cancel and surfaces exhausted emit errors cleanly', async () => {
    let seenAborted = false;
    let spawnCalled = false;
    const cancelDuringEnsureEvents: MachineDoubaoLoginEventBody[] = [];
    const runner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: (signal) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              seenAborted = true;
              resolve(null);
            },
            { once: true },
          );
        }),
      refreshProbe: async () => {
        spawnCalled = true;
        return { installed: false, authenticated: false };
      },
      onEvent: (ev) => {
        cancelDuringEnsureEvents.push(ev);
      },
    });

    const p = runner.start('abort-ensure-1');
    await new Promise((r) => setTimeout(r, 20));
    runner.cancel('abort-ensure-1');
    await p;
    expect(seenAborted).toBe(true);
    expect(spawnCalled).toBe(false);
    expect(cancelDuringEnsureEvents.at(-1)?.status).toBe('cancelled');

    const managedDir = makeTestTempDir('doubao-managed-abort-');
    tempDirs.push(managedDir);
    const pkgRoot = 'doubao-cli-2.38.4-darwin-arm64';
    const srcPkgDir = join(managedDir, 'src', pkgRoot);
    mkdirSync(join(srcPkgDir, 'resources', 'js_app'), { recursive: true });
    const binScript = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.38.4"; exit 0; fi
if [ "$1" = "login" ]; then echo "登录成功"; exit 0; fi
exit 0
`;
    writeFileSync(join(srcPkgDir, 'doubao'), binScript, { mode: 0o755 });
    writeFileSync(join(srcPkgDir, 'resources', 'js_app', 'cli-manifest.json'), '{}');
    writeFileSync(
      join(srcPkgDir, 'manifest.json'),
      JSON.stringify({
        schema_version: 1,
        version: '2.38.4',
        target: 'darwin-arm64',
        entrypoint: 'doubao',
        files: [
          { path: 'doubao', sha256: createHash('sha256').update(binScript).digest('hex') },
          { path: 'resources/js_app/cli-manifest.json' },
        ],
      }),
    );
    const validTgz = join(managedDir, 'valid-2.38.4.tar.gz');
    execFileSync('tar', ['-czf', validTgz, '-C', join(managedDir, 'src'), pkgRoot]);
    const validBytes = readFileSync(validTgz);
    const validSha = createHash('sha256').update(validBytes).digest('hex');

    let fetchCalls = 0;
    let releaseSecondFetch!: () => void;
    const secondReady = new Promise<void>((r) => {
      releaseSecondFetch = r;
    });
    const managed = createDoubaoManaged({
      root: join(managedDir, 'tools'),
      platform: 'darwin',
      arch: 'arm64',
      realHome: managedDir,
      env: { HOME: managedDir, PATH: '' },
      release: {
        version: '2.38.4',
        url: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao_cli/2.38.4/doubao-cli-2.38.4-darwin-arm64-signed-signed.tar.gz',
        sha256: validSha,
        root: pkgRoot,
        executableName: 'doubao',
        format: 'tar.gz',
      },
      fetchImpl: async (_url, init) => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return new Promise<Response>((_res, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          });
        }
        await secondReady;
        return new Response(validBytes);
      },
    });
    const eventsAfterRestart: MachineDoubaoLoginEventBody[] = [];
    const managedRunner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      ensureBinary: (signal) => managed.ensure(signal),
      refreshProbe: async () => ({
        installed: true,
        authenticated: true,
        platformSupported: true,
        version: '2.38.4',
      }),
      onEvent: (ev) => {
        eventsAfterRestart.push(ev);
      },
    });
    const firstTry = managedRunner.start('m-abort-1');
    while (fetchCalls < 1) await new Promise((r) => setTimeout(r, 10));
    managedRunner.cancel('m-abort-1');
    await firstTry;
    const secondTry = managedRunner.start('m-abort-2');
    await new Promise((r) => setTimeout(r, 25));
    expect(fetchCalls).toBe(2);
    releaseSecondFetch();
    await secondTry;
    expect(
      eventsAfterRestart.some((e) => e.loginId === 'm-abort-2' && e.status === 'succeeded'),
    ).toBe(true);

    const okBin = makeStubCommand(`process.exit(0);`);
    const emitErrors: Array<{ status: string }> = [];
    const retryRunner = createDoubaoLoginRunner({
      platform: 'darwin',
      arch: 'arm64',
      retryDelaysMs: [1, 1],
      ensureBinary: async () => ({ command: okBin }),
      refreshProbe: async () => ({ installed: true, authenticated: true }),
      onEvent: () => {
        throw new Error('transient outage');
      },
      onEmitError: (_err, ev) => {
        emitErrors.push({ status: ev.status });
      },
    });
    await expect(retryRunner.start('emit-err-1')).resolves.toBeUndefined();
    expect(emitErrors.length).toBeGreaterThan(0);
    expect(emitErrors.at(-1)?.status).toBe('succeeded');
    expect(retryRunner.activeLoginId()).toBeNull();
  });
});
