import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const reader = await import('../src/workspace-file-read.js');

const LIMIT = 256 * 1024;

let allocated: string;
let base: string;
let root: string;
let outside: string;
let keyPath: string;

beforeEach(() => {
  allocated = makeTestTempDir('cairn-wsfile-');
  base = realpathSync(allocated);
  root = join(base, 'workspace');
  outside = join(base, 'outside');
  keyPath = join(base, 'state', 'workspace-file.key');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE SECRET');
});

afterEach(() => {
  expect(releaseTestTempDir(allocated)).toBe(true);
});

function create(options: Partial<Parameters<typeof reader.createWorkspaceFileService>[0]> = {}) {
  return reader.createWorkspaceFileService({ keyPath, ...options });
}

async function ready(options: Parameters<typeof create>[0] = {}) {
  const service = create(options);
  expect(await service.probe()).toBe(true);
  return service;
}

function bound(service: ReturnType<typeof create>, dir = root): string {
  const instance = service.bind(dir);
  expect(instance).not.toBeNull();
  return instance as string;
}

describe('workspace file reader', () => {
  test('reads current text through a descriptor-relative walk', async () => {
    mkdirSync(join(root, 'docs', 'deep'), { recursive: true });
    writeFileSync(join(root, 'docs', 'deep', 'report.md'), '# Report\nñ 日本語\n\tTabbed\r\n');
    const service = await ready();
    const instance = bound(service);
    expect(await service.read(instance, 'docs/deep/report.md')).toEqual({
      status: 'ok',
      text: '# Report\nñ 日本語\n\tTabbed\r\n',
    });
    writeFileSync(join(root, 'docs', 'deep', 'report.md'), 'edited');
    expect(await service.read(instance, 'docs/deep/report.md')).toEqual({
      status: 'ok',
      text: 'edited',
    });
  });

  test('keeps a UTF-8 byte order mark', async () => {
    writeFileSync(join(root, 'bom.txt'), Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
    const service = await ready();
    expect(await service.read(bound(service), 'bom.txt')).toEqual({
      status: 'ok',
      text: '\uFEFFa',
    });
  });

  test('instance is opaque, authenticated and bound to the persisted key', async () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    const service = await ready();
    const instance = bound(service);
    expect(instance).toMatch(/^[A-Za-z0-9_-]{32,8192}$/);
    expect(instance).not.toContain(base);
    expect(Buffer.from(instance, 'base64url').toString('latin1')).not.toContain('workspace');

    const flipped = `${instance.slice(0, 40)}${instance[40] === 'A' ? 'B' : 'A'}${instance.slice(41)}`;
    expect(await service.read(flipped, 'a.txt')).toEqual({ status: 'gone' });
    expect(await service.read('A'.repeat(64), 'a.txt')).toEqual({ status: 'gone' });

    const restarted = await ready();
    expect(await restarted.read(instance, 'a.txt')).toEqual({ status: 'ok', text: 'x' });

    const stranger = await ready({ keyPath: join(base, 'other', 'workspace-file.key') });
    expect(await stranger.read(instance, 'a.txt')).toEqual({ status: 'gone' });
  });

  test('key lives in a private file outside the workspace', async () => {
    const service = await ready();
    bound(service);
    expect(existsSync(keyPath)).toBe(true);
    expect(keyPath.startsWith(`${root}/`)).toBe(false);
    expect(statSync(keyPath).mode & 0o077).toBe(0);
    const material = readFileSync(keyPath, 'utf8');
    chmodSync(keyPath, 0o644);
    const again = await ready();
    expect(await again.read(bound(again), 'missing.txt')).toEqual({ status: 'gone' });
    expect(readFileSync(keyPath, 'utf8')).toBe(material);
    expect(statSync(keyPath).mode & 0o077).toBe(0);
  });

  test('an existing key is never replaced: a malformed one blocks use instead of rotating', async () => {
    mkdirSync(join(base, 'state'));
    writeFileSync(keyPath, 'not-a-key');
    const service = await ready();
    expect(service.bind(root)).toBeNull();
    expect(readFileSync(keyPath, 'utf8')).toBe('not-a-key');
    writeFileSync(keyPath, '');
    expect(create().bind(root)).toBeNull();
    expect(readFileSync(keyPath, 'utf8')).toBe('');
  });

  test('concurrent first use publishes exactly one key atomically', async () => {
    const services = Array.from({ length: 8 }, () => create());
    const instances = services.map((service) => service.bind(root));
    expect(new Set(instances).size).toBe(1);
    expect(instances[0]).not.toBeNull();
    const material = readFileSync(keyPath, 'utf8');
    expect(material).toMatch(/^[0-9a-f]{64}\n$/);
    expect(create().bind(root)).toBe(instances[0]);
    expect(readFileSync(keyPath, 'utf8')).toBe(material);
    expect(existsSync(join(base, 'state', 'leftover'))).toBe(false);
    expect(readdirSync(join(base, 'state')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('binding is refused for a missing or non-directory root', async () => {
    const service = await ready();
    expect(service.bind(join(base, 'nowhere'))).toBeNull();
    writeFileSync(join(base, 'plain.txt'), 'x');
    expect(service.bind(join(base, 'plain.txt'))).toBeNull();
    expect(service.bind('relative/dir')).toBeNull();
  });

  test('a symlinked root path is sealed by its canonical directory and refused when swapped', async () => {
    writeFileSync(join(root, 'a.txt'), 'inside');
    const alias = join(base, 'alias');
    symlinkSync(root, alias);
    const service = await ready();
    const instance = bound(service, alias);
    expect(await service.read(instance, 'a.txt')).toEqual({ status: 'ok', text: 'inside' });
    rmSync(alias);
    renameSync(root, join(base, 'moved'));
    symlinkSync(outside, root);
    writeFileSync(join(outside, 'a.txt'), 'OUTSIDE');
    const result = await service.read(instance, 'a.txt');
    expect(result.status).not.toBe('ok');
  });

  test('the same directory always yields a byte-identical instance, across calls and restarts', async () => {
    const service = await ready();
    const first = bound(service);
    expect(bound(service)).toBe(first);
    symlinkSync(root, join(base, 'alias'));
    expect(bound(service, join(base, 'alias'))).toBe(first);
    expect(bound(create())).toBe(first);
    mkdirSync(join(base, 'other-root'));
    expect(bound(service, join(base, 'other-root'))).not.toBe(first);
    expect(bound(create({ keyPath: join(base, 'k2', 'workspace-file.key') }))).not.toBe(first);
  });

  test('a directory that holds the instance key is never bound or read', async () => {
    const holder = create({ keyPath: join(root, 'state', 'workspace-file.key') });
    expect(holder.bind(root)).toBeNull();
    expect(holder.bind(base)).toBeNull();
    expect(create().bind(root)).not.toBeNull();
  });

  test('only a trusted, non-writable Python executable is used', async () => {
    const fake = join(base, 'python3');
    writeFileSync(fake, '#!/bin/sh\nexit 3\n');
    chmodSync(fake, 0o777);
    const open = create({ candidates: [fake] });
    expect(await open.probe()).toBe(false);
    chmodSync(fake, 0o755);
    for (const mode of [0o777, 0o775]) {
      chmodSync(base, mode);
      expect(await create({ candidates: [fake] }).probe()).toBe(false);
    }
    chmodSync(base, 0o755);
    expect(await create({ candidates: ['python3'] }).probe()).toBe(false);
  });

  test('a removed root is gone', async () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    const service = await ready();
    const instance = bound(service);
    rmSync(root, { recursive: true });
    expect(await service.read(instance, 'a.txt')).toEqual({ status: 'gone' });
  });

  test('path reuse does not revive a deleted workspace even with identical contents', async (context) => {
    if (statSync(root, { bigint: true }).birthtimeNs === 0n) context.skip();
    writeFileSync(join(root, 'a.txt'), 'x');
    const service = await ready();
    const instance = bound(service);
    rmSync(root, { recursive: true });
    await sleep(25);
    mkdirSync(root);
    writeFileSync(join(root, 'a.txt'), 'x');
    expect(await service.read(instance, 'a.txt')).toEqual({ status: 'gone' });
    expect(await service.read(bound(service), 'a.txt')).toEqual({ status: 'ok', text: 'x' });
  });

  test('a replaced root directory at the same path is gone', async () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    const service = await ready();
    const instance = bound(service);
    renameSync(root, join(base, 'moved'));
    await sleep(25);
    mkdirSync(root);
    writeFileSync(join(root, 'a.txt'), 'x');
    expect(await service.read(instance, 'a.txt')).toEqual({ status: 'gone' });
  });

  test('a missing file is gone', async () => {
    mkdirSync(join(root, 'docs'));
    const service = await ready();
    const instance = bound(service);
    expect(await service.read(instance, 'docs/nope.md')).toEqual({ status: 'gone' });
    expect(await service.read(instance, 'nodir/nope.md')).toEqual({ status: 'gone' });
  });

  test('a symlink at any depth is refused and no outside bytes are returned', async () => {
    mkdirSync(join(root, 'real', 'inner'), { recursive: true });
    writeFileSync(join(outside, 'inner.txt'), 'OUTSIDE INNER');
    symlinkSync(outside, join(root, 'dirlink'));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'filelink.txt'));
    symlinkSync(join(root, 'real'), join(root, 'insidelink'));
    symlinkSync(outside, join(root, 'real', 'inner', 'deep'));
    writeFileSync(join(root, 'real', 'inner', 'ok.txt'), 'fine');
    const service = await ready();
    const instance = bound(service);
    for (const path of [
      'dirlink/secret.txt',
      'filelink.txt',
      'insidelink/inner/ok.txt',
      'real/inner/deep/secret.txt',
    ]) {
      const result = await service.read(instance, path);
      expect(['gone', 'unsupported']).toContain(result.status);
      expect(JSON.stringify(result)).not.toContain('OUTSIDE');
    }
    expect(await service.read(instance, 'real/inner/ok.txt')).toEqual({
      status: 'ok',
      text: 'fine',
    });
  });

  test('swapping a directory for a symlink while reads run never exposes outside bytes', async () => {
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a', 'note.txt'), 'INSIDE');
    writeFileSync(join(outside, 'note.txt'), 'OUTSIDE SWAPPED');
    symlinkSync(outside, join(root, 'link'));
    const service = await ready();
    const instance = bound(service);
    const swapper = spawn(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs');const r=process.argv[1];
         const a=r+'/a',t=r+'/t',l=r+'/link';
         process.stdout.write('go');
         for(;;){try{fs.renameSync(a,t);fs.renameSync(l,a);fs.renameSync(a,l);fs.renameSync(t,a);}catch{}}`,
        root,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    try {
      await new Promise<void>((resolve) => swapper.stdout.once('data', () => resolve()));
      const seen = new Set<string>();
      for (let i = 0; i < 60; i += 1) {
        const result = await service.read(instance, 'a/note.txt');
        seen.add(result.status);
        if (result.status === 'ok') expect(result.text).toBe('INSIDE');
        expect(JSON.stringify(result)).not.toContain('OUTSIDE');
      }
      expect(seen.size).toBeGreaterThan(0);
    } finally {
      swapper.kill('SIGKILL');
    }
  }, 60_000);

  test('a file with another hard link is refused', async () => {
    linkSync(join(outside, 'secret.txt'), join(root, 'linked.txt'));
    writeFileSync(join(root, 'twin.txt'), 'twin');
    linkSync(join(root, 'twin.txt'), join(root, 'twin-2.txt'));
    writeFileSync(join(root, 'solo.txt'), 'solo');
    const service = await ready();
    const instance = bound(service);
    expect(await service.read(instance, 'linked.txt')).toEqual({ status: 'unsupported' });
    expect(await service.read(instance, 'twin.txt')).toEqual({ status: 'unsupported' });
    expect(await service.read(instance, 'solo.txt')).toEqual({ status: 'ok', text: 'solo' });
  });

  test('size is capped at 256 KiB measured in bytes', async () => {
    writeFileSync(join(root, 'exact.txt'), 'a'.repeat(LIMIT));
    writeFileSync(join(root, 'over.txt'), 'a'.repeat(LIMIT + 1));
    writeFileSync(join(root, 'wide.txt'), 'é'.repeat(LIMIT / 2 + 1));
    const service = await ready();
    const instance = bound(service);
    const exact = await service.read(instance, 'exact.txt');
    expect(exact.status).toBe('ok');
    expect(exact.status === 'ok' ? exact.text.length : 0).toBe(LIMIT);
    expect(await service.read(instance, 'over.txt')).toEqual({ status: 'unsupported' });
    expect(await service.read(instance, 'wide.txt')).toEqual({ status: 'unsupported' });
  });

  test('invalid UTF-8 and binary control characters are refused', async () => {
    writeFileSync(join(root, 'latin.txt'), Buffer.from([0x61, 0xe9, 0x62]));
    writeFileSync(join(root, 'nul.txt'), Buffer.from('a\0b'));
    writeFileSync(join(root, 'esc.txt'), Buffer.from('a\x1b[0mb'));
    writeFileSync(join(root, 'del.txt'), Buffer.from('a\x7fb'));
    writeFileSync(join(root, 'c1.txt'), 'a\u0085b');
    writeFileSync(join(root, 'empty.txt'), '');
    const service = await ready();
    const instance = bound(service);
    for (const name of ['latin.txt', 'nul.txt', 'esc.txt', 'del.txt', 'c1.txt']) {
      expect(await service.read(instance, name)).toEqual({ status: 'unsupported' });
    }
    expect(await service.read(instance, 'empty.txt')).toEqual({ status: 'ok', text: '' });
  });

  test('directories and FIFOs are not regular files and never block', async () => {
    mkdirSync(join(root, 'folder.d'));
    execFileSync('mkfifo', [join(root, 'pipe.txt')]);
    const service = await ready();
    const instance = bound(service);
    expect(await service.read(instance, 'folder.d')).toEqual({ status: 'unsupported' });
    expect(await service.read(instance, 'pipe.txt')).toEqual({ status: 'unsupported' });
  });

  test('paths outside the shared contract are refused before any helper runs', async () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    writeFileSync(join(root, '.env'), 'SECRET=1');
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'config.txt'), 'x');
    let launched = 0;
    const service = await ready({
      spawnHelper: ((...args: Parameters<typeof spawn>) => {
        launched += 1;
        return spawn(...args);
      }) as typeof spawn,
    });
    const afterProbe = launched;
    const instance = bound(service);
    for (const path of [
      '/etc/passwd',
      '../outside/secret.txt',
      'a/../a.txt',
      './a.txt',
      'a//b.txt',
      '.env',
      '.git/config.txt',
      'a\\b.txt',
      '%2e%2e/secret.txt',
      'file:///etc/passwd',
      'a.txt\0',
      '',
      `${'a/'.repeat(600)}b.txt`,
    ]) {
      expect(await service.read(instance, path)).toEqual({ status: 'unsupported' });
    }
    expect(launched).toBe(afterProbe);
  });

  test('the helper runs isolated with argv only and an empty environment', async () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    const calls: { command: string; args: readonly string[]; options: Record<string, unknown> }[] =
      [];
    const service = await ready({
      spawnHelper: ((
        command: string,
        args: readonly string[],
        options: Record<string, unknown>,
      ) => {
        calls.push({ command, args, options });
        return spawn(command, args, options);
      }) as typeof spawn,
    });
    await service.read(bound(service), 'a.txt');
    const read = calls.at(-1);
    expect(read?.command.startsWith('/')).toBe(true);
    expect(read?.args.slice(0, 3)).toEqual(['-I', '-S', '-c']);
    expect(read?.options.shell).not.toBe(true);
    expect(read?.options.env).toEqual({});
    const stdio = read?.options.stdio as unknown[];
    expect(stdio[3]).toEqual(expect.any(Number));
    expect(read?.args.join(' ')).not.toContain(root);
  });

  test('an unavailable helper fails closed and is not advertised', async () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    const changes: boolean[] = [];
    const service = create({
      candidates: [join(base, 'no-such-python'), '/bin/false'],
      onSupportChange: () => changes.push(service.supported()),
    });
    expect(service.supported()).toBe(false);
    expect(await service.probe()).toBe(false);
    expect(service.supported()).toBe(false);
    expect(changes).toEqual([]);
    const instance = service.bind(root);
    expect(instance).not.toBeNull();
    expect(await service.read(instance as string, 'a.txt')).toEqual({ status: 'unsupported' });
  });

  test('support is reported once the probe succeeds', async () => {
    const changes: boolean[] = [];
    const service = create({ onSupportChange: () => changes.push(true) });
    expect(service.supported()).toBe(false);
    expect(await service.probe()).toBe(true);
    expect(service.supported()).toBe(true);
    expect(changes).toEqual([true]);
    await service.probe();
    expect(changes).toEqual([true]);
  });

  test('an aborted read is unavailable and does not leave a helper running', async () => {
    writeFileSync(join(root, 'a.txt'), 'x');
    const service = await ready();
    const instance = bound(service);
    const controller = new AbortController();
    controller.abort();
    expect(await service.read(instance, 'a.txt', controller.signal)).toEqual({
      status: 'unavailable',
    });
  });
});
