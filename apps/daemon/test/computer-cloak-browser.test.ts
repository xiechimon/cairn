import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { CloakBrowser, type CloakSdk, writeCloakLauncher } from '../src/computer/cloak-browser.js';
import { HostComputerProvider } from '../src/computer/host.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});
const key = 'fake-test-license-not-an-entitlement';
function setup() {
  const root = makeTestTempDir('cloak-');
  roots.push(root);
  const file = join(root, 'license.key');
  writeFileSync(file, key);
  const sdk: CloakSdk = {
    binaryInfo: vi.fn(() => ({ installed: true, binaryPath: '/fake/cloak', version: '156' })),
    ensureBinary: vi.fn(async () => '/fake/downloaded-cloak'),
    getDefaultStealthArgs: vi.fn(() => [
      '--no-sandbox',
      '--fingerprint=12345',
      '--fingerprint-platform=windows',
    ]),
    licenseErrorFrom: vi.fn(() => null),
  };
  const env = { HOME: root, CLOAKBROWSER_LICENSE_FILE: file };
  return { root, file, sdk, env, engine: new CloakBrowser(env, sdk) };
}

test('shutdown cancels a pending browser environment before any driver spawns', async () => {
  const { root } = setup();
  let entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const host = new HostComputerProvider({
    home: root,
    browserEnvironment: () => {
      entered();
      return new Promise<Record<string, string>>(() => {});
    },
  });
  const controller = new AbortController();
  const execution = host.execute({
    argv: ['agent-browser', 'snapshot'],
    timeoutMs: 1_000,
    signal: controller.signal,
  });
  try {
    await started;
    await host.killAll();
    expect(
      await Promise.race([execution.then(() => 'cancelled'), sleep(50).then(() => 'waiting')]),
    ).toBe('cancelled');
    const events = [];
    for await (const event of await execution) events.push(event);
    expect(events.at(-1)).toMatchObject({ code: 130, delivery: 'not_delivered' });
  } finally {
    controller.abort();
    await execution;
  }
});

test('missing and empty file refuse before SDK acquisition even with an environment key', async () => {
  const { root, sdk } = setup();
  const engine = new CloakBrowser(
    { HOME: root, CLOAKBROWSER_LICENSE_FILE: join(root, 'absent'), CLOAKBROWSER_LICENSE_KEY: key },
    sdk,
  );
  await expect(engine.prepare()).rejects.toThrow('license file');
  expect(sdk.ensureBinary).not.toHaveBeenCalled();
  expect(engine.ready).toBe(false);
});

test('cached build wins without daily update, missing cache uses the explicit file key', async () => {
  const { engine, sdk } = setup();
  await engine.prepare();
  expect(engine.ready).toBe(true);
  expect(sdk.ensureBinary).not.toHaveBeenCalled();
  vi.mocked(sdk.binaryInfo).mockReturnValue({ installed: false, binaryPath: null, version: null });
  const other = setup();
  const fresh = new CloakBrowser(other.env, sdk);
  await fresh.prepare();
  expect(sdk.ensureBinary).toHaveBeenCalledWith(key);
  expect((await fresh.launch(join(other.root, 'profile'))).executable).toBe(
    '/fake/downloaded-cloak',
  );
});

test('download and license errors are sanitized and never leave readiness true', async () => {
  const { engine, sdk } = setup();
  vi.mocked(sdk.binaryInfo).mockReturnValue({ installed: false, binaryPath: null, version: null });
  vi.mocked(sdk.ensureBinary).mockRejectedValue(new Error(`download failed ${key}`));
  await expect(engine.prepare()).rejects.toThrow('acquisition failed');
  expect(engine.ready).toBe(false);
  vi.mocked(sdk.licenseErrorFrom).mockReturnValue(new Error(`denied ${key}`));
  await expect(engine.prepare()).rejects.toThrow('license denied');
  await expect(engine.prepare()).rejects.not.toThrow(key);
});

test('identity is strict, credential free and stable across concurrent resolver instances', async () => {
  const { root, engine, sdk, env } = setup();
  const other = new CloakBrowser(env, sdk);
  await Promise.all([engine.prepare(), other.prepare()]);
  const profile = join(root, 'profile');
  const [a, b] = await Promise.all([engine.launch(profile), other.launch(profile)]);
  expect(a.args).toEqual(b.args);
  expect(a.args).toContain('--fingerprint=12345');
  expect(a.args.filter((arg) => arg === '--restore-last-session')).toHaveLength(1);
  expect(a.args).toContain('--fingerprint-platform=windows');
  expect(a.env.CLOAKBROWSER_LICENSE_KEY).toBe(key);
  const persisted = readFileSync(join(profile, '.cairn-cloak-identity.json'), 'utf8');
  expect(persisted).not.toContain(key);
  expect(JSON.parse(persisted)).toMatchObject({ seed: 12345, locale: 'en-US', timezone: 'UTC' });
  writeFileSync(join(profile, '.cairn-cloak-identity.json'), '{"seed":12}');
  await expect(engine.launch(profile)).rejects.toThrow('identity');
});

test('corrupt seed and extra credential fields never rotate identity', async () => {
  const { root, engine } = setup();
  await engine.prepare();
  const profile = join(root, 'profile');
  mkdirSync(profile);
  const file = join(profile, '.cairn-cloak-identity.json');
  for (const value of [
    { seed: 0, platform: 'windows', locale: 'en-US', timezone: 'UTC' },
    { seed: 12345, platform: 'windows', locale: 'en-US', timezone: 'UTC', key },
  ]) {
    writeFileSync(file, JSON.stringify(value));
    await expect(engine.launch(profile)).rejects.toThrow('identity');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(value);
  }
});

test('generated Dock launcher runs the fake engine with file-only credentials and rejects a live lock', async () => {
  const { root, sdk, env, engine } = setup();
  const binary = join(root, 'fake engine');
  const receipt = join(root, 'receipt');
  writeFileSync(
    binary,
    `#!/bin/bash\nprintf '%s\\n' "$CLOAKBROWSER_LICENSE_KEY" "$@" > '${receipt}'\n`,
  );
  chmodSync(binary, 0o700);
  vi.mocked(sdk.binaryInfo).mockReturnValue({
    installed: true,
    binaryPath: binary,
    version: '156',
  });
  await engine.prepare();
  const profile = join(root, 'profile');
  await writeCloakLauncher(root, profile, engine);
  const launcher = join(root, 'cloak-browser');
  expect(spawnSync('/bin/bash', ['-n', launcher]).status).toBe(0);
  const childEnv = { PATH: process.env.PATH, CLOAKBROWSER_LICENSE_KEY: 'wrong-inherited-key' };
  expect(spawnSync(launcher, ['https://example.test'], { env: childEnv }).status).toBe(0);
  const output = readFileSync(receipt, 'utf8');
  expect(output.split('\n')[0]).toBe(key);
  expect(output).toContain('--fingerprint=12345');
  expect(output).toContain('--restore-last-session');
  expect(output).toContain(`--user-data-dir=${profile}`);
  expect(output).not.toContain('remote-debugging');
  expect(readFileSync(launcher, 'utf8')).not.toContain(key);
  symlinkSync(`host-${process.pid}`, join(profile, 'SingletonLock'));
  expect(spawnSync(launcher, [], { env: childEnv }).status).toBe(1);
  expect(readFileSync(receipt, 'utf8')).toBe(output);
  expect(env.CLOAKBROWSER_LICENSE_FILE).toBe(join(root, 'license.key'));
});

test('manual launcher ignores the host GLX vendor override inherited from systemd', async () => {
  const { root, sdk, engine } = setup();
  const binary = join(root, 'fake engine');
  const receipt = join(root, 'graphics-vendor');
  writeFileSync(
    binary,
    `#!/bin/bash\nprintf '%s' "\${__GLX_VENDOR_LIBRARY_NAME-unset}" > '${receipt}'\n`,
  );
  chmodSync(binary, 0o700);
  vi.mocked(sdk.binaryInfo).mockReturnValue({ installed: true, binaryPath: binary, version: '1' });
  await engine.prepare();
  await writeCloakLauncher(root, join(root, 'profile'), engine);
  const result = spawnSync(join(root, 'cloak-browser'), [], {
    env: { PATH: process.env.PATH, __GLX_VENDOR_LIBRARY_NAME: 'host-only-graphics-vendor' },
  });
  expect(result.status).toBe(0);
  expect(readFileSync(receipt, 'utf8')).toBe('unset');
});

test('launch cannot download before preparation and a deleted key refuses cached launch', async () => {
  const { root, file, engine, sdk } = setup();
  await expect(engine.launch(join(root, 'profile'))).rejects.toThrow('prepared');
  expect(sdk.ensureBinary).not.toHaveBeenCalled();
  await engine.prepare();
  writeFileSync(file, '');
  await expect(engine.launch(join(root, 'profile'))).rejects.toThrow('license file');
});

test('launcher and Node read one license value: ASCII edges trimmed, any inner line break refused', async () => {
  const { root, file, sdk, engine } = setup();
  const binary = join(root, 'fake engine');
  const receipt = join(root, 'receipt');
  writeFileSync(binary, `#!/bin/bash\nprintf '%s' "$CLOAKBROWSER_LICENSE_KEY" > '${receipt}'\n`);
  chmodSync(binary, 0o700);
  vi.mocked(sdk.binaryInfo).mockReturnValue({ installed: true, binaryPath: binary, version: '1' });
  await engine.prepare();
  const profile = join(root, 'profile');
  await writeCloakLauncher(root, profile, engine);
  const launcher = join(root, 'cloak-browser');
  for (const content of [`${key}\r\n`, `  \t${key} \n\n`, `\n${key}`]) {
    writeFileSync(file, content);
    writeFileSync(receipt, 'unset');
    expect(spawnSync(launcher, [], { env: { PATH: process.env.PATH } }).status).toBe(0);
    expect(readFileSync(receipt, 'utf8')).toBe(key);
    expect((await engine.launch(profile)).env.CLOAKBROWSER_LICENSE_KEY).toBe(key);
  }
  for (const content of [
    `${key}\nsecond-line\n`,
    `first\r\n${key}`,
    `${key}\rsecond`,
    `${key}\0`,
    `first\0${key}`,
    ' \r\n',
  ]) {
    writeFileSync(file, content);
    writeFileSync(receipt, 'unset');
    expect(spawnSync(launcher, [], { env: { PATH: process.env.PATH } }).status).toBe(1);
    expect(readFileSync(receipt, 'utf8')).toBe('unset');
    await expect(engine.launch(profile)).rejects.toThrow('license file');
  }
});
