import {
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { sweepStalePrivateTemps, writePrivateFile } from '../src/private-fs.js';
import { testTempDir } from './test-temp-dir.js';

const fsHooks = vi.hoisted(() => ({
  writeOverride: null as ((fd: number, data: ArrayBufferView) => number) | null,
  renameOverride: null as ((oldPath: string, newPath: string) => void) | null,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync(oldPath: string, newPath: string) {
      if (fsHooks.renameOverride !== null) {
        fsHooks.renameOverride(oldPath, newPath);
        return;
      }
      actual.renameSync(oldPath, newPath);
    },
    writeSync(
      fd: number,
      data: ArrayBufferView | string,
      offsetOrPosition?: number | null,
      length?: number | null,
      position?: number | null,
    ) {
      if (fsHooks.writeOverride !== null && ArrayBuffer.isView(data)) {
        return fsHooks.writeOverride(fd, data);
      }
      return actual.writeSync(
        fd,
        data as NodeJS.ArrayBufferView,
        offsetOrPosition as number,
        length as number,
        position as number,
      );
    },
  };
});

afterEach(() => {
  fsHooks.writeOverride = null;
  fsHooks.renameOverride = null;
});

describe('writePrivateFile', () => {
  test('writes UTF-8 content atomically with 0o600 permissions while preserving prior contents mid-write', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const dir = testTempDir('cairn-private-fs-');
    const target = join(dir, 'step.json');
    writePrivateFile(target, '{"state":"claimed"}\n');
    const staleReusedPidTemp = join(dir, `.step.json.${process.pid}.0.tmp`);
    writeFileSync(staleReusedPidTemp, 'stale reused pid file');

    let observedMidWriteTarget: string | null = null;
    fsHooks.writeOverride = (fd, data) => {
      if (observedMidWriteTarget === null) {
        observedMidWriteTarget = actual.readFileSync(target, 'utf8');
      }
      return actual.writeSync(fd, data as NodeJS.ArrayBufferView);
    };

    writePrivateFile(target, '{"state":"done","note":"完成"}\n');

    expect(observedMidWriteTarget).toBe('{"state":"claimed"}\n');
    expect(actual.readFileSync(target, 'utf8')).toBe('{"state":"done","note":"完成"}\n');
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual([`.step.json.${process.pid}.0.tmp`, 'step.json']);
  });

  test('completes short writes across multiple writeSync calls', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const dir = testTempDir('cairn-private-fs-');
    const target = join(dir, 'step.json');
    const payload = '{"state":"running","note":"分段写入测试"}\n';
    let calls = 0;

    fsHooks.writeOverride = (fd, data) => {
      calls += 1;
      const view = new Uint8Array(data.buffer, data.byteOffset, Math.min(3, data.byteLength));
      return actual.writeSync(fd, view);
    };

    writePrivateFile(target, payload);

    expect(calls).toBeGreaterThan(1);
    expect(readFileSync(target, 'utf8')).toBe(payload);
    expect(readdirSync(dir)).toEqual(['step.json']);
  });

  test('preserves the existing file and cleans up the temp file on mid-write ENOSPC', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const dir = testTempDir('cairn-private-fs-');
    const target = join(dir, 'step.json');
    writePrivateFile(target, '{"state":"claimed"}\n');

    let calls = 0;
    fsHooks.writeOverride = (fd, data) => {
      calls += 1;
      if (calls === 1) {
        const view = new Uint8Array(data.buffer, data.byteOffset, Math.min(2, data.byteLength));
        return actual.writeSync(fd, view);
      }
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    };

    expect(() => writePrivateFile(target, '{"state":"corrupted"}\n')).toThrow(/ENOSPC/);
    expect(readFileSync(target, 'utf8')).toBe('{"state":"claimed"}\n');
    expect(readdirSync(dir)).toEqual(['step.json']);
  });

  test('preserves the existing file when serialization throws before rename', () => {
    const dir = testTempDir('cairn-private-fs-');
    const target = join(dir, 'step.json');
    writePrivateFile(target, '{"state":"claimed"}\n');

    expect(() => writePrivateFile(target, null as unknown as string)).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('{"state":"claimed"}\n');
    expect(readdirSync(dir)).toEqual(['step.json']);
  });

  test('removes the temporary file when rename fails after writing temp contents', () => {
    const dir = testTempDir('cairn-private-fs-');
    const target = join(dir, 'step.json');
    writePrivateFile(target, '{"state":"claimed"}\n');
    let observedTempName: string | null = null;
    let observedTempContents: string | null = null;

    fsHooks.renameOverride = (oldPath) => {
      const files = readdirSync(dir);
      observedTempName =
        files.find((name) => name.startsWith('.step.json.') && name.endsWith('.tmp')) ?? null;
      observedTempContents = readFileSync(oldPath, 'utf8');
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    };

    expect(() => writePrivateFile(target, '{"state":"next"}\n')).toThrow(/EACCES/);
    expect(observedTempName).not.toBeNull();
    expect(observedTempContents).toBe('{"state":"next"}\n');
    expect(readFileSync(target, 'utf8')).toBe('{"state":"claimed"}\n');
    expect(readdirSync(dir)).toEqual(['step.json']);
  });

  test('sweeps dead-writer and expired temp files while sparing fresh live-writer temps', () => {
    const dir = testTempDir('cairn-private-fs-');
    const target = join(dir, 'step.json');
    const deadTemp = join(dir, '.step.json.999999.0.tmp');
    const liveTemp = join(dir, `.step.json.${process.pid}.1.tmp`);
    const expiredTemp = join(dir, `.step.json.${process.pid}.2.tmp`);
    writeFileSync(target, '{"keep":true}\n');
    writeFileSync(deadTemp, 'partial crash');
    writeFileSync(liveTemp, 'in-flight');
    writeFileSync(expiredTemp, 'stale');
    const now = Date.now();
    utimesSync(expiredTemp, new Date(now - 20_000), new Date(now - 20_000));

    const removed = sweepStalePrivateTemps(dir, {
      now,
      ttlMs: 5_000,
      isPidAlive: (pid) => pid === process.pid,
    });

    expect(removed.sort()).toEqual(
      [`.step.json.${process.pid}.2.tmp`, '.step.json.999999.0.tmp'].sort(),
    );
    expect(readdirSync(dir).sort()).toEqual([`.step.json.${process.pid}.1.tmp`, 'step.json']);
  });

  test('refuses to overwrite a symbolic link target and leaves no temp files', () => {
    const dir = testTempDir('cairn-private-fs-');
    const realTarget = join(dir, 'real-target.json');
    const linkPath = join(dir, 'machine.json');
    writeFileSync(realTarget, '{"keep":true}\n', { mode: 0o644 });
    symlinkSync(realTarget, linkPath);

    expect(() => writePrivateFile(linkPath, '{"overwrite":true}\n')).toThrow(
      /ELOOP|symbolic link/i,
    );
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(realTarget, 'utf8')).toBe('{"keep":true}\n');
    expect(readdirSync(dir).sort()).toEqual(['machine.json', 'real-target.json']);
  });
});
