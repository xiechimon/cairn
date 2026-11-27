import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createPhoneAdbBootstrap } from '../src/computer/phone-bootstrap.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function artifact(zipText: string, adbText: string) {
  return {
    url: 'https://example.test/platform-tools.zip',
    zipSha256: sha256(zipText),
    adbSha256: sha256(adbText),
  };
}

function extraction(zipText: string, adbText: string) {
  return async (zipPath: string, destination: string) => {
    const { readFileSync } = await import('node:fs');
    if (readFileSync(zipPath, 'utf8') !== zipText) throw new Error('zip bytes changed');
    mkdirSync(join(destination, 'platform-tools'), { recursive: true });
    writeFileSync(join(destination, 'platform-tools', 'adb'), adbText);
  };
}

function compatibleRun() {
  return async (_file: string, args: readonly string[]) => ({
    code: 0,
    stdout: Buffer.from(
      args[0] === 'version'
        ? 'Android Debug Bridge version 1.0.41\nVersion 37.0.3-test\n'
        : 'network:\n  pair [--qr | HOST[:PORT] [PAIRING_CODE]]\n',
    ),
    stderr: Buffer.alloc(0),
  });
}

describe('phone adb bootstrap', () => {
  test('uses an existing compatible adb without downloading', async () => {
    const home = tempDir('phone-bootstrap-');
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const adb = join(bin, 'adb');
    writeFileSync(adb, '');
    chmodSync(adb, 0o755);
    const fetchImpl = vi.fn<typeof fetch>();
    const bootstrap = createPhoneAdbBootstrap({
      home,
      env: { PATH: bin },
      findAdbImpl: () => adb,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: artifact('zip', 'adb'),
      extractZip: extraction('zip', 'adb'),
    });
    await expect(bootstrap.ensure()).resolves.toBe(adb);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('downloads, verifies, extracts and reuses managed adb when existing adb cannot pair', async () => {
    const home = tempDir('phone-bootstrap-');
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const adb = join(bin, 'adb');
    writeFileSync(adb, '');
    const zipText = 'fake zip bytes';
    const adbText = 'fake adb binary';
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(zipText));
    const runFile = async (_file: string, args: readonly string[]) => ({
      code: args[0] === 'version' ? 1 : 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from('unknown command'),
    });
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'darwin',
      env: { PATH: bin },
      findAdbImpl: () => adb,
      fetchImpl,
      runFile,
      artifact: artifact(zipText, adbText),
      extractZip: extraction(zipText, adbText),
    });
    const managed = join(home, 'phone', 'platform-tools', 'adb');
    await expect(bootstrap.ensure()).resolves.toBe(managed);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(bootstrap.ensure()).resolves.toBe(managed);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('concurrent preparation shares one download', async () => {
    const home = tempDir('phone-bootstrap-');
    const zipText = 'zip once';
    const adbText = 'adb once';
    let release!: (value: Response) => void;
    const fetched = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(() => fetched);
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'darwin',
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: artifact(zipText, adbText),
      extractZip: extraction(zipText, adbText),
    });
    const first = bootstrap.ensure();
    const second = bootstrap.ensure();
    release(new Response(zipText));
    await expect(first).resolves.toBe(join(home, 'phone', 'platform-tools', 'adb'));
    await expect(second).resolves.toBe(join(home, 'phone', 'platform-tools', 'adb'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('a corrupt download is never extracted or executable and a retry can succeed', async () => {
    const home = tempDir('phone-bootstrap-');
    const zipText = 'good zip';
    const adbText = 'good adb';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bad zip'))
      .mockResolvedValueOnce(new Response(zipText));
    const extracted = vi.fn(extraction(zipText, adbText));
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'darwin',
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: artifact(zipText, adbText),
      extractZip: extracted,
    });
    await expect(bootstrap.ensure()).rejects.toThrow('phone support preparation failed');
    expect(extracted).not.toHaveBeenCalled();
    await expect(bootstrap.ensure()).resolves.toBe(join(home, 'phone', 'platform-tools', 'adb'));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('an extracted adb whose hash differs is never installed', async () => {
    const home = tempDir('phone-bootstrap-');
    const zipText = 'zip signed';
    const adbText = 'expected adb';
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(zipText));
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'darwin',
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: artifact(zipText, adbText),
      extractZip: extraction(zipText, 'wrong adb'),
    });
    await expect(bootstrap.ensure()).rejects.toThrow('phone support preparation failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(join(home, 'phone', 'platform-tools', 'adb'))).toBe(false);
  });

  test('an already-cancelled pairing does not start the platform-tools download', async () => {
    const home = tempDir('phone-bootstrap-');
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'darwin',
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: artifact('zip abort', 'adb abort'),
      extractZip: extraction('zip abort', 'adb abort'),
    });
    await expect(bootstrap.ensure(controller.signal)).rejects.toThrow(
      'phone support preparation failed',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a tampered managed cache is rejected by the adb binary hash, not a missing marker', async () => {
    const home = tempDir('phone-bootstrap-');
    const zipText = 'zip cache';
    const adbText = 'adb cache';
    const art = artifact(zipText, adbText);
    const managed = join(home, 'phone', 'platform-tools');
    mkdirSync(managed, { recursive: true });
    writeFileSync(join(managed, 'adb'), adbText);
    writeFileSync(join(managed, '.cairn-phone-adb.json'), JSON.stringify(art));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(zipText));
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'darwin',
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: art,
      extractZip: extraction(zipText, adbText),
    });
    await expect(bootstrap.ensure()).resolves.toBe(join(managed, 'adb'));
    expect(fetchImpl).not.toHaveBeenCalled();
    writeFileSync(join(managed, 'adb'), 'tampered');
    await expect(bootstrap.ensure()).resolves.toBe(join(managed, 'adb'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(managed, 'adb'), 'utf8')).toBe(adbText);
  });

  test('detectExisting returns compatible system adb or valid managed cache without downloading, and null otherwise', async () => {
    const home = tempDir('phone-bootstrap-detect-');
    const zipText = 'zip detect';
    const adbText = 'adb detect';
    const art = artifact(zipText, adbText);
    const fetchImpl = vi.fn<typeof fetch>();
    const absent = createPhoneAdbBootstrap({
      home,
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: art,
      extractZip: extraction(zipText, adbText),
    });
    await expect(absent.detectExisting()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    const managed = join(home, 'phone', 'platform-tools');
    mkdirSync(managed, { recursive: true });
    writeFileSync(join(managed, 'adb'), adbText);
    writeFileSync(join(managed, '.cairn-phone-adb.json'), JSON.stringify(art));
    await expect(absent.detectExisting()).resolves.toBe(join(managed, 'adb'));
    writeFileSync(join(managed, 'adb'), 'tampered');
    await expect(absent.detectExisting()).resolves.toBeNull();

    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const sysAdb = join(bin, 'adb');
    writeFileSync(sysAdb, '');
    chmodSync(sysAdb, 0o755);
    const withSystem = createPhoneAdbBootstrap({
      home,
      env: { PATH: bin },
      findAdbImpl: () => sysAdb,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: art,
      extractZip: extraction(zipText, adbText),
    });
    await expect(withSystem.detectExisting()).resolves.toBe(sysAdb);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('aborting signal mid-extraction rejects and leaves no installed adb', async () => {
    const home = tempDir('phone-bootstrap-extract-abort-');
    const zipText = 'zip extract abort';
    const adbText = 'adb extract abort';
    const controller = new AbortController();
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'darwin',
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl: async () => new Response(zipText),
      runFile: compatibleRun(),
      artifact: artifact(zipText, adbText),
      extractZip: async (_zipPath, _destination, signal) => {
        expect(signal).toBeDefined();
        controller.abort();
        if (signal?.aborted) throw new Error('extraction aborted');
      },
    });
    await expect(bootstrap.ensure(controller.signal)).rejects.toThrow(
      'phone support preparation failed',
    );
    expect(existsSync(join(home, 'phone', 'platform-tools', 'adb'))).toBe(false);
  });

  test('refuses managed adb download on non-darwin hosts without fetching', async () => {
    const home = tempDir('phone-bootstrap-linux-');
    const fetchImpl = vi.fn<typeof fetch>();
    const bootstrap = createPhoneAdbBootstrap({
      home,
      platform: 'linux',
      env: { PATH: '' },
      findAdbImpl: () => null,
      fetchImpl,
      runFile: compatibleRun(),
      artifact: artifact('zip linux', 'adb linux'),
      extractZip: extraction('zip linux', 'adb linux'),
    });
    await expect(bootstrap.ensure()).rejects.toThrow('phone support preparation failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
