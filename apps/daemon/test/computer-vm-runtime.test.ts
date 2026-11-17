import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { ComputerRefusal } from '../src/computer/provider.js';
import {
  COMPUTER_IMAGE_MANIFEST,
  VmRuntime,
  type VmRuntimeManifest,
  versionAtLeast,
} from '../src/computer/vm-runtime.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const SIGNER = 'Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)';
const GOOD_SIGNATURE = `Package "container.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Notarization: trusted by the Apple notary service
   Certificate Chain:
    1. ${SIGNER}
    2. Developer ID Certification Authority
`;

function fakeContainer(path: string, state: string, version: string): void {
  writeFileSync(
    path,
    `#!/bin/sh
echo "$0 $*" >> '${state}/log'
if [ "$1" = --version ]; then echo "container CLI version ${version} (build: release)"; exit 0; fi
if [ "$1 $2" = "system status" ]; then
  [ -f '${state}/running' ] || exit 1
  printf '{"status":"running","server":{"version":"%s"}}' "$(cat '${state}/running')"
  exit 0
fi
if [ "$1 $2" = "system start" ]; then
  [ -f '${state}/start-fails' ] && exit 1
  echo ${version} > '${state}/running'
  exit 0
fi
exit 0
`,
  );
  chmodSync(path, 0o755);
}

function setup(options: { payload?: Buffer } = {}) {
  const dir = makeTestTempDir('vm-runtime-');
  cleanups.push(() => releaseTestTempDir(dir));
  const state = join(dir, 'state');
  const bin = join(dir, 'bin');
  mkdirSync(state);
  mkdirSync(bin);
  const payload = options.payload ?? Buffer.from('fake container package bytes');
  const template = join(dir, 'container-template');
  fakeContainer(template, state, '1.7.1');
  writeFileSync(join(state, 'signature'), GOOD_SIGNATURE);
  const pkgutil = join(dir, 'pkgutil');
  writeFileSync(
    pkgutil,
    `#!/bin/sh
echo "pkgutil $*" >> '${state}/log'
case $1 in
  --check-signature) cat '${state}/signature'; exit 0 ;;
  --expand-full)
    [ -f '${state}/expand-fails' ] && exit 1
    mkdir -p "$3/Payload/bin" && cp '${template}' "$3/Payload/bin/container" ;;
esac
`,
  );
  chmodSync(pkgutil, 0o755);
  const served = { body: payload, status: 200, requests: 0 };
  const server: Server = createServer((_request, response) => {
    served.requests += 1;
    response.writeHead(served.status);
    response.end(served.body);
  });
  cleanups.push(() => server.close());
  const root = join(dir, 'vm');
  const log = () =>
    existsSync(join(state, 'log'))
      ? readFileSync(join(state, 'log'), 'utf8').trim().split('\n')
      : [];
  return {
    dir,
    state,
    bin,
    root,
    pkgutil,
    served,
    log,
    async manifest(): Promise<VmRuntimeManifest> {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      return {
        version: '1.7.1',
        minimumVersion: '1.7.0',
        url: `http://127.0.0.1:${port}/container-1.7.1-installer-signed.pkg`,
        size: payload.length,
        sha256: createHash('sha256').update(payload).digest('hex'),
        signer: SIGNER,
      };
    },
    runtime(
      manifest: VmRuntimeManifest,
      extra: Partial<ConstructorParameters<typeof VmRuntime>[0]> = {},
    ) {
      return new VmRuntime({
        root,
        manifest,
        env: { PATH: bin },
        platform: 'darwin',
        arch: 'arm64',
        darwinRelease: '25.0.0',
        systemBinary: join(dir, 'usr-local-bin-container'),
        pkgutil,
        ...extra,
      });
    },
  };
}

describe('VmRuntime', () => {
  test('the pinned manifest names the signed 1.7.1 package', () => {
    expect(COMPUTER_IMAGE_MANIFEST.runtime).toMatchObject({
      version: '1.7.1',
      size: 169630704,
      sha256: 'b6739caf3d47ca53a78f1a7edf32521420a75c7941838c3cefa75f30b80f5a97',
      signer: SIGNER,
    });
    expect(versionAtLeast('1.7.1', '1.7.0')).toBe(true);
    expect(versionAtLeast('1.6.9', '1.7.0')).toBe(false);
    expect(versionAtLeast('1.10.0', '1.7.0')).toBe(true);
  });

  test('an unsupported host is refused before any command runs', async () => {
    const env = setup();
    const manifest = await env.manifest();
    for (const [extra, reason] of [
      [{ platform: 'linux' as const }, 'Apple silicon'],
      [{ arch: 'x64' }, 'Apple silicon'],
      [{ darwinRelease: '24.6.0' }, 'macOS 26'],
    ] as const) {
      const runtime = env.runtime(manifest, extra);
      expect(runtime.unsupported()).toContain(reason);
      await expect(runtime.resolve()).rejects.toThrow(reason);
    }
    expect(env.log()).toEqual([]);
    expect(env.served.requests).toBe(0);
  });

  test('a running container system on PATH is reused without starting or downloading', async () => {
    const env = setup();
    fakeContainer(join(env.bin, 'container'), env.state, '1.7.1');
    writeFileSync(join(env.state, 'running'), '1.7.1');
    const runtime = env.runtime(await env.manifest());
    expect(await runtime.resolve()).toBe(join(env.bin, 'container'));
    expect(runtime.state).toBe('ready');
    expect(env.log().some((line) => line.includes('system start'))).toBe(false);
    expect(env.served.requests).toBe(0);
  });

  test('a running system older than the minimum is refused, never replaced', async () => {
    const env = setup();
    fakeContainer(join(env.bin, 'container'), env.state, '1.6.0');
    writeFileSync(join(env.state, 'running'), '1.6.0');
    const runtime = env.runtime(await env.manifest());
    await expect(runtime.resolve()).rejects.toThrow('running container system is 1.6.0');
    expect(runtime.state).toBe('failed');
    expect(env.log().some((line) => line.includes('system start'))).toBe(false);
  });

  test('an installed container is started with kernel install', async () => {
    const env = setup();
    const system = join(env.dir, 'usr-local-bin-container');
    fakeContainer(system, env.state, '1.7.1');
    const runtime = env.runtime(await env.manifest());
    expect(await runtime.resolve()).toBe(system);
    expect(env.log()).toContain(`${system} system start --enable-kernel-install`);
    expect(env.served.requests).toBe(0);
  });

  test('without a runtime the pinned package is downloaded, verified, expanded and started', async () => {
    const env = setup();
    const runtime = env.runtime(await env.manifest());
    const own = join(env.root, 'runtime', '1.7.1', 'Payload', 'bin', 'container');
    expect(await runtime.resolve()).toBe(own);
    expect(runtime.state).toBe('ready');
    const log = env.log();
    expect(log.some((line) => line.startsWith('pkgutil --check-signature'))).toBe(true);
    expect(log.some((line) => line.startsWith('pkgutil --expand-full'))).toBe(true);
    expect(log).toContain(
      `${own} system start --install-root ${join(env.root, 'runtime', '1.7.1', 'Payload')} --app-root ${join(env.root, 'app')} --log-root ${join(env.root, 'log')} --enable-kernel-install`,
    );
    expect(readdirSync(join(env.root, 'download'))).toEqual([]);
    expect(readdirSync(join(env.root, 'runtime'))).toEqual(['1.7.1']);
  });

  test('concurrent first calls share one download', async () => {
    const env = setup();
    const runtime = env.runtime(await env.manifest());
    const [first, second] = await Promise.all([runtime.resolve(), runtime.resolve()]);
    expect(first).toBe(second);
    expect(env.served.requests).toBe(1);
  });

  test('an expanded runtime is started again without a download', async () => {
    const env = setup();
    const manifest = await env.manifest();
    await env.runtime(manifest).resolve();
    rmSync(join(env.state, 'running'));
    const again = env.runtime(manifest);
    expect(await again.resolve()).toBe(
      join(env.root, 'runtime', '1.7.1', 'Payload', 'bin', 'container'),
    );
    expect(env.served.requests).toBe(1);
  });

  test('a wrong checksum removes the partial download and the next call retries', async () => {
    const env = setup();
    const manifest = await env.manifest();
    const good = env.served.body;
    env.served.body = Buffer.alloc(good.length, 1);
    const runtime = env.runtime(manifest);
    const failure = await runtime.resolve().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ComputerRefusal);
    expect((failure as Error).message).toContain('wrong checksum');
    expect(runtime.state).toBe('failed');
    expect(readdirSync(join(env.root, 'download'))).toEqual([]);
    expect(env.log().some((line) => line.startsWith('pkgutil'))).toBe(false);
    env.served.body = good;
    expect(await runtime.resolve()).toContain(join('runtime', '1.7.1'));
    expect(env.served.requests).toBe(2);
  });

  test('a download of the wrong size or a failed response is refused', async () => {
    const env = setup();
    const manifest = await env.manifest();
    env.served.body = Buffer.concat([env.served.body, Buffer.from('extra')]);
    await expect(env.runtime(manifest).resolve()).rejects.toThrow('larger than pinned');
    env.served.status = 404;
    await expect(env.runtime(manifest).resolve()).rejects.toThrow('download failed (404)');
    expect(readdirSync(join(env.root, 'download'))).toEqual([]);
  });

  test('a package not signed and notarized by Apple Containerization is refused and removed', async () => {
    for (const signature of [
      GOOD_SIGNATURE.replace(SIGNER, 'Developer ID Installer: Someone Else (ABCDE12345)'),
      GOOD_SIGNATURE.replace('Notarization: trusted by the Apple notary service', ''),
    ]) {
      const env = setup();
      writeFileSync(join(env.state, 'signature'), signature);
      await expect(env.runtime(await env.manifest()).resolve()).rejects.toThrow(
        'not signed by Apple',
      );
      expect(env.log().some((line) => line.startsWith('pkgutil --expand-full'))).toBe(false);
      expect(readdirSync(join(env.root, 'download'))).toEqual([]);
      expect(existsSync(join(env.root, 'runtime', '1.7.1'))).toBe(false);
    }
  });

  test('a failed expansion leaves no runtime and no scratch directory', async () => {
    const env = setup();
    writeFileSync(join(env.state, 'expand-fails'), '');
    await expect(env.runtime(await env.manifest()).resolve()).rejects.toThrow(
      'could not be expanded',
    );
    expect(readdirSync(join(env.root, 'runtime'))).toEqual([]);
  });

  test('a system that fails to start is refused', async () => {
    const env = setup();
    writeFileSync(join(env.state, 'start-fails'), '');
    const runtime = env.runtime(await env.manifest());
    await expect(runtime.resolve()).rejects.toThrow('could not be started');
    expect(runtime.state).toBe('failed');
  });
});
