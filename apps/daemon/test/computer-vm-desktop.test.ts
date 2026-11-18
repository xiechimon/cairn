import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { VM_DOWNLOAD_BYTES } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import type { ComputerProcessEvent } from '../src/computer/provider.js';
import {
  COMPUTER_IMAGE_ENV,
  computerVmName,
  NO_CLOAK_LICENSE,
  VmDesktops,
  vmMemoryFlag,
} from '../src/computer/vm-desktop.js';

const GIB = 1024 ** 3;

describe('VM memory', () => {
  test.each([
    [8, '3g'],
    [16, '4g'],
    [24, '6g'],
    [32, '8g'],
    [64, '8g'],
  ])('a %i GiB host gives the VM %s', (host, flag) => {
    expect(vmMemoryFlag(host * GIB)).toBe(flag);
  });

  test('a quarter of the host is rounded down to whole GiB', () => {
    expect(vmMemoryFlag(18 * GIB)).toBe('4g');
  });
});

import { COMPUTER_IMAGE_MANIFEST } from '../src/computer/vm-runtime.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const FAKE_CONTAINER = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = process.env.FAKE_CONTAINER_DIR;
const statePath = path.join(dir, 'state.json');
const read = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const write = (state) => fs.writeFileSync(statePath, JSON.stringify(state));
const flag = (name) => fs.existsSync(path.join(dir, name));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const state = read();
const [command, ...rest] = args;
if (command === 'image' && rest[0] === 'pull') process.exit(flag('pull-fail') ? 1 : 0);
if (command === 'list') {
  process.stdout.write(JSON.stringify(Object.entries(state.vms).map(([id, vm]) => ({
    configuration: { id, labels: vm.labels, image: { reference: vm.image } },
    status: { state: vm.state, networks: vm.state === 'running' ? [{ ipv4Address: vm.address + '/24' }] : [] },
  }))));
  process.exit(0);
}
if (command === 'volume') {
  const [action, name] = rest;
  if (action === 'inspect') process.exit(state.volumes.includes(name) ? 0 : 1);
  if (action === 'create') { state.volumes.push(name); write(state); }
  if (action === 'delete') { state.volumes = state.volumes.filter((volume) => volume !== name); write(state); }
  process.exit(0);
}
if (command === 'run') {
  if (flag('run-fails')) process.exit(1);
  const name = rest[rest.indexOf('--name') + 1];
  const label = rest[rest.indexOf('--label') + 1].split('=');
  state.vms[name] = { state: flag('guard-fails') ? 'stopped' : 'running', address: '127.0.0.1', ready: !flag('never-ready'), labels: { [label[0]]: label[1] }, image: rest.at(-1), installed: [] };
  write(state);
  process.exit(0);
}
if (command === 'start') {
  const vm = state.vms[rest[0]];
  if (!vm) process.exit(1);
  vm.state = 'running'; vm.ready = true; write(state);
  process.exit(0);
}
if (command === 'stop') {
  const vm = state.vms[rest[0]];
  if (vm) { vm.state = 'stopped'; vm.ready = false; write(state); }
  process.exit(0);
}
if (command === 'delete') {
  delete state.vms[rest.at(-1)]; write(state);
  process.exit(0);
}
if (command === 'exec') {
  const env = { PATH: process.env.PATH };
  let cwd = process.env.FAKE_HOME;
  let index = 0;
  while (rest[index].startsWith('--')) {
    const option = rest[index];
    if (option === '--interactive' || option === '--tty') { index += 1; continue; }
    const value = rest[index + 1];
    if (option === '--env') {
      const equals = value.indexOf('=');
      if (equals < 0) env[value] = process.env[value];
      else env[value.slice(0, equals)] = value.slice(equals + 1);
    }
    if (option === '--workdir') cwd = value.replace('/home/agent', process.env.FAKE_HOME);
    index += 2;
  }
  const name = rest[index];
  let argv = rest.slice(index + 1).map((arg) => arg.replaceAll('/home/agent', process.env.FAKE_HOME));
  const vm = state.vms[name];
  if (!vm || vm.state !== 'running') process.exit(1);
  if (argv[0] === 'test' && argv[2] === '/run/cairn/ready') process.exit(vm.ready ? 0 : 1);
  if (argv[0] === 'cairn-browser') {
    if (argv[1] === 'key') fs.writeFileSync(path.join(dir, 'key'), fs.readFileSync(0));
    if (argv[1] === 'prepare') {
      const code = fs.existsSync(path.join(dir, 'prepare-code')) ? Number(fs.readFileSync(path.join(dir, 'prepare-code'), 'utf8')) : 0;
      if (code !== 0) process.stderr.write('CloakBrowser binary acquisition failed\\n');
      process.exit(code);
    }
    process.exit(0);
  }
  if (argv[0] === 'timeout') argv = argv.slice(3);
  if (argv[0] === 'sh' && argv[2].includes('apt-get')) {
    const packages = argv.slice(4);
    process.stdout.write('Reading package lists...\\n');
    if (flag('apt-code')) {
      process.stderr.write('E: Unable to locate package ' + packages[0] + '\\n');
      process.exit(Number(fs.readFileSync(path.join(dir, 'apt-code'), 'utf8')));
    }
    vm.installed = [...(vm.installed ?? []), ...packages];
    write(state);
    for (const name of packages) process.stdout.write('Setting up ' + name + ' ...\\n');
    process.exit(0);
  }
  env.HOME = process.env.FAKE_HOME;
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
process.exit(0);
`;

function setup(options: { unsupported?: string; resolveError?: Error } = {}) {
  const dir = makeTestTempDir('vm-desktop-');
  cleanups.push(() => releaseTestTempDir(dir));
  const fake = join(dir, 'fake');
  const home = join(dir, 'home');
  mkdirSync(fake);
  mkdirSync(home);
  writeFileSync(join(fake, 'state.json'), JSON.stringify({ vms: {}, volumes: [] }));
  const binary = join(dir, 'container');
  writeFileSync(binary, FAKE_CONTAINER);
  chmodSync(binary, 0o755);
  process.env.FAKE_CONTAINER_DIR = fake;
  process.env.FAKE_HOME = home;
  cleanups.push(() => {
    delete process.env.FAKE_CONTAINER_DIR;
    delete process.env.FAKE_HOME;
  });
  const runtime = {
    resolved: 0,
    async resolve() {
      runtime.resolved += 1;
      if (options.resolveError) throw options.resolveError;
      return binary;
    },
    unsupported: () => options.unsupported,
    forget() {},
    isDownloaded: true,
    downloaded: () => runtime.isDownloaded,
    async install(onBytes: (bytes: number) => void) {
      onBytes(100_000_000);
      return runtime.resolve();
    },
    markDownloaded() {
      runtime.isDownloaded = true;
    },
  };
  const open = { ports: true };
  const logs: string[] = [];
  let clock = 0;
  const make = (extra: Partial<ConstructorParameters<typeof VmDesktops>[0]> = {}) =>
    new VmDesktops({
      root: join(dir, 'vm'),
      runtime,
      probe: async () => open.ports,
      readyMs: 1_000,
      now: () => clock,
      totalMemory: () => 16 * GIB,
      log: (message: string) => logs.push(message),
      ...extra,
    });
  const calls = (): string[][] =>
    existsSync(join(fake, 'calls.jsonl'))
      ? readFileSync(join(fake, 'calls.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as string[])
      : [];
  const state = () =>
    JSON.parse(readFileSync(join(fake, 'state.json'), 'utf8')) as {
      vms: Record<
        string,
        { state: string; labels: Record<string, string>; image?: string; installed?: string[] }
      >;
      volumes: string[];
    };
  return {
    dir,
    fake,
    home,
    binary,
    runtime,
    open,
    make,
    logs,
    calls,
    state,
    flag: (name: string, content = '') => writeFileSync(join(fake, name), content),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function collect(events: AsyncIterable<ComputerProcessEvent>) {
  const seen: ComputerProcessEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

const request = (argv: string[], extra: Record<string, unknown> = {}) => ({
  argv,
  timeoutMs: 10_000,
  signal: new AbortController().signal,
  ...extra,
});

const NAME = computerVmName('chief:a');

const installOptions = (output: string[] = []) => ({
  timeoutMs: 60_000,
  signal: new AbortController().signal,
  output: (_stream: 'stdout' | 'stderr', text: string) => {
    output.push(text);
  },
});

describe('VmDesktops', () => {
  test('download reports progress, pulls the pinned image and ends ready; a failed pull can be retried', async () => {
    const env = setup();
    env.runtime.isDownloaded = false;
    const desktops = env.make();
    expect(desktops.vmDownload()).toEqual({
      state: 'absent',
      doneBytes: 0,
      totalBytes: VM_DOWNLOAD_BYTES,
    });
    writeFileSync(join(env.fake, 'pull-fail'), '');
    await expect(desktops.manage('chief:a', 'install')).rejects.toThrow('could not be downloaded');
    expect(desktops.vmDownload()?.state).toBe('failed');
    expect(env.runtime.isDownloaded).toBe(false);
    rmSync(join(env.fake, 'pull-fail'));
    const done = desktops.manage('chief:a', 'install');
    expect(desktops.vmDownload()?.state).toBe('downloading');
    expect(await done).toBe('installed');
    expect(desktops.vmDownload()).toEqual({
      state: 'ready',
      doneBytes: VM_DOWNLOAD_BYTES,
      totalBytes: VM_DOWNLOAD_BYTES,
    });
    const pulls = env.calls().filter((argv) => argv[0] === 'image');
    expect(pulls.at(-2)?.at(-1)).toBe('ghcr.io/apple/containerization/vminit:0.54.0');
    expect(pulls.at(-1)).toEqual([
      'image',
      'pull',
      '--progress',
      'none',
      '--platform',
      'linux/arm64',
      COMPUTER_IMAGE_MANIFEST.image,
    ]);
    expect(env.calls().some((argv) => argv[0] === 'run')).toBe(false);
  });

  test('an unsupported Mac reports the reason, offers nothing and runs no command', async () => {
    const env = setup({ unsupported: 'The agent computer needs macOS 26 or later' });
    const desktops = env.make();
    expect(desktops.missingPrograms()).toEqual(['The agent computer needs macOS 26 or later']);
    expect(desktops.offersBrowser()).toBe(false);
    expect(desktops.offersStealthBrowser()).toBe(false);
    await expect(desktops.ensure('chief:a')).rejects.toThrow('macOS 26');
    expect(env.runtime.resolved).toBe(0);
    expect(await desktops.presence()).toEqual([]);
  });

  test('a runtime failure is refused with its reason and retried on the next call', async () => {
    const env = setup({ resolveError: new Error('The container runtime download failed (404)') });
    const desktops = env.make();
    await expect(desktops.ensure('chief:a')).rejects.toThrow('download failed (404)');
    await expect(desktops.ensure('chief:a')).rejects.toThrow('download failed (404)');
    expect(env.runtime.resolved).toBe(2);
  });

  test('a first call creates the volume and a hardened VM, then reuses it', async () => {
    const env = setup();
    const desktops = env.make();
    expect(await desktops.ensure('chief:a')).toBe('127.0.0.1');
    const runs = env.calls().filter((argv) => argv[0] === 'run');
    expect(runs).toHaveLength(1);
    const run = runs[0] as string[];
    expect(run.slice(0, 4)).toEqual(['run', '--detach', '--name', NAME]);
    expect(run).toContain(`cairn.scope=${createHash('sha256').update('chief:a').digest('hex')}`);
    const pairs = run.flatMap((arg, index) =>
      arg.startsWith('--cap') ? [`${arg} ${run[index + 1]}`] : [],
    );
    expect(pairs).toEqual([
      '--cap-drop ALL',
      '--cap-add CAP_NET_ADMIN',
      '--cap-add CAP_SETUID',
      '--cap-add CAP_SETGID',
      '--cap-add CAP_CHOWN',
    ]);
    expect(run[run.indexOf('--memory') + 1]).toBe(vmMemoryFlag(16 * GIB));
    expect(env.logs).toEqual(['computer VM memory 4g (host 16 GiB)']);
    expect(run[run.indexOf('--cpus') + 1]).toBe('2');
    expect(run).toContain('/run/cairn');
    expect(run).toContain(`${NAME}:/home/agent`);
    expect(run.at(-1)).toBe(COMPUTER_IMAGE_MANIFEST.image);
    expect(env.state().volumes).toEqual([NAME]);
    expect(desktops.socketPath('chief:a', 'control')).toBe('127.0.0.1:5900');
    expect(desktops.socketPath('chief:a', 'view')).toBe('127.0.0.1:5901');
    await desktops.ensure('chief:a');
    expect(env.calls().filter((argv) => argv[0] === 'run')).toHaveLength(1);
    expect(await desktops.presence()).toEqual([
      { scopeKey: 'chief:a', providerRef: NAME, state: 'running' },
    ]);
  });

  test('the image reference can be overridden for local builds', async () => {
    const env = setup();
    await env.make({ env: { [COMPUTER_IMAGE_ENV]: 'cairn-computer:dev' } }).ensure('chief:a');
    expect(
      env
        .calls()
        .find((argv) => argv[0] === 'run')
        ?.at(-1),
    ).toBe('cairn-computer:dev');
  });

  test('a stopped VM is started again with its volume, not recreated', async () => {
    const env = setup();
    await env.make().ensure('chief:a');
    const state = env.state();
    (state.vms[NAME] as { state: string }).state = 'stopped';
    writeFileSync(join(env.fake, 'state.json'), JSON.stringify(state));
    await env.make().ensure('chief:a');
    expect(env.calls().filter((argv) => argv[0] === 'run')).toHaveLength(1);
    expect(env.calls()).toContainEqual(['start', NAME]);
    expect(env.calls().some((argv) => argv[0] === 'volume' && argv[1] === 'create')).toBe(true);
    expect(env.calls().filter((argv) => argv[0] === 'volume' && argv[1] === 'create')).toHaveLength(
      1,
    );
  });

  test('a VM whose guard fails to load is removed, refused and recreated on the next call', async () => {
    const env = setup();
    env.flag('guard-fails');
    const desktops = env.make();
    await expect(desktops.ensure('chief:a')).rejects.toThrow('did not become ready');
    expect(env.state().vms[NAME]).toBeUndefined();
    expect(env.state().volumes).toEqual([NAME]);
    expect(await desktops.presence()).toEqual([
      { scopeKey: 'chief:a', providerRef: NAME, state: 'failed' },
    ]);
    rmSync(join(env.fake, 'guard-fails'));
    await desktops.ensure('chief:a');
    expect(env.calls().filter((argv) => argv[0] === 'run')).toHaveLength(2);
  });

  test('a VM that never becomes ready is removed after the deadline', async () => {
    const env = setup();
    env.flag('never-ready');
    const desktops = env.make({ now: () => Date.now(), readyMs: 300 });
    await expect(desktops.ensure('chief:a')).rejects.toThrow('did not become ready');
    expect(env.calls()).toContainEqual(['delete', '--force', NAME]);
  });

  test('an image that cannot start is refused', async () => {
    const env = setup();
    env.flag('run-fails');
    await expect(env.make().ensure('chief:a')).rejects.toThrow('image could not be started');
  });

  test('a command runs as the agent user in its home and names environment values only', async () => {
    const env = setup();
    mkdirSync(join(env.home, 'work'));
    const provider = env.make().forScope('chief:a');
    const events = await collect(
      await provider.execute(
        request(['sh', '-c', 'printf "%s|%s|%s" "$PWD" "$TOKEN" "$DISPLAY"; exit 3'], {
          cwd: 'work',
          env: { TOKEN: 'secret-value' },
        }),
      ),
    );
    expect(
      events
        .filter((event) => event.kind === 'stdout')
        .map((event) => 'text' in event && event.text)
        .join(''),
    ).toBe(`${join(realpathSync(env.home), 'work')}|secret-value|:1`);
    expect(events.at(-1)).toMatchObject({ kind: 'exit', code: 3 });
    const exec = env.calls().find((argv) => argv[0] === 'exec' && argv.includes('sh')) as string[];
    expect(exec.join(' ')).toContain('--uid 1000 --gid 1000 --workdir /home/agent/work');
    expect(exec).toContain('TOKEN');
    expect(exec.join(' ')).not.toContain('secret-value');
    expect(exec.slice(exec.indexOf(NAME) + 1, exec.indexOf(NAME) + 4)).toEqual([
      'timeout',
      '--kill-after=1',
      '10',
    ]);
  });

  test('a cwd outside the home folder is refused before anything runs', async () => {
    const env = setup();
    const provider = env.make().forScope('chief:a');
    await expect(provider.execute(request(['true'], { cwd: '../etc' }))).rejects.toThrow(
      'inside the home folder',
    );
  });

  test('files are written, read and listed inside the home folder only', async () => {
    const env = setup();
    const provider = env.make().forScope('chief:a');
    await provider.writeFile('notes/a.txt', 'hello 你好');
    expect(readFileSync(join(env.home, 'notes', 'a.txt'), 'utf8')).toBe('hello 你好');
    expect(await provider.readFile('notes/a.txt')).toBe('hello 你好');
    expect(await provider.listFiles('notes')).toEqual([
      { path: 'notes/a.txt', kind: 'file', size: Buffer.byteLength('hello 你好') },
    ]);
    await expect(provider.readFile('../outside')).rejects.toThrow('inside the home folder');
    symlinkSync(env.dir, join(env.home, 'escape'));
    await expect(provider.readFile('escape/fake/state.json')).rejects.toThrow(
      'outside the home folder',
    );
    writeFileSync(join(env.home, 'binary'), Buffer.from([0xff, 0xfe]));
    await expect(provider.readFile('binary')).rejects.toThrow('not valid UTF-8');
  });

  test('a Chromium call needs no license and never touches the stealth browser', async () => {
    const env = setup();
    const provider = env.make().forScope('chief:a');
    await collect(await provider.execute(request(['true', '--session', 'chief_a', 'snapshot'])));
    expect(env.calls().some((argv) => argv.includes('cairn-browser'))).toBe(false);
  });

  test('a stealth call without a license is refused and never falls back', async () => {
    const env = setup();
    const provider = env.make().forScope('chief:a');
    await expect(
      provider.execute(request(['agent-browser', '--session', 'chief_a-stealth', 'snapshot'])),
    ).rejects.toThrow(NO_CLOAK_LICENSE);
    expect(env.calls().some((argv) => argv.includes('agent-browser'))).toBe(false);
  });

  test('a stealth license goes in on stdin once per VM life and prepares Cloak with host locale and timezone', async () => {
    const env = setup();
    const desktops = env.make({ env: { TZ: 'Asia/Shanghai', LANG: 'zh_CN.UTF-8' } });
    const provider = desktops.forScope('chief:a', { browserLicense: 'cloak-test-key' });
    const stealth = ['agent-browser', '--session', 'chief_a-stealth', 'snapshot'];
    await expect(provider.execute(request(stealth))).resolves.toBeDefined();
    await expect(provider.execute(request(stealth))).resolves.toBeDefined();
    expect(readFileSync(join(env.fake, 'key'), 'utf8')).toBe('cloak-test-key\n');
    const browserCalls = env
      .calls()
      .filter((argv) => argv.includes('cairn-browser'))
      .map((argv) => argv.slice(argv.indexOf('cairn-browser') + 1).join(' '));
    expect(browserCalls).toEqual(['key', 'prepare zh-CN Asia/Shanghai', 'agent', 'agent']);
    expect(env.calls().flat().join(' ')).not.toContain('cloak-test-key');
  });

  test.each([
    ['3', 'CloakBrowser license denied or unavailable'],
    ['4', 'CloakBrowser binary acquisition failed'],
  ])('a prepare exit %s refuses the stealth call', async (code, message) => {
    const env = setup();
    env.flag('prepare-code', code);
    const provider = env.make().forScope('chief:a', { browserLicense: 'cloak-test-key' });
    await expect(
      provider.execute(request(['agent-browser', '--session', 'chief_a-stealth', 'open'])),
    ).rejects.toThrow(message);
  });

  test('only a handoff hold relaunches Cloak for the owner, after a stealth call, and blocks the agent browser', async () => {
    const env = setup();
    const desktops = env.make();
    const ownerCalls = () =>
      env.calls().filter((argv) => argv.includes('cairn-browser') && argv.includes('owner'));
    (await desktops.hold('chief:a', 'handoff'))();
    expect(ownerCalls()).toEqual([]);
    const provider = desktops.forScope('chief:a', { browserLicense: 'cloak-test-key' });
    const stealth = ['agent-browser', '--session', 'chief_a-stealth', 'snapshot'];
    await provider.execute(request(stealth));
    const hover = await desktops.hold('chief:a', 'control');
    await provider.execute(request(stealth));
    hover();
    expect(ownerCalls()).toEqual([]);
    const release = await desktops.hold('chief:a', 'handoff');
    expect(ownerCalls().map((argv) => argv.at(-1))).toEqual(['chief_a-stealth']);
    await expect(provider.execute(request(stealth))).rejects.toThrow('taken over');
    await expect(
      provider.execute(request(['agent-browser', '--session', 'chief_a', 'snapshot'])),
    ).rejects.toThrow('taken over');
    await collect(await provider.execute(request(['true'])));
    release();
    await provider.execute(request(stealth));
    const last = env
      .calls()
      .filter((argv) => argv.includes('cairn-browser'))
      .at(-1) as string[];
    expect(last.at(-1)).toBe('agent');
  });

  test('an idle VM quits its browsers gracefully, stops and keeps its volume', async () => {
    const env = setup();
    const desktops = env.make({ idleStopMs: 1_000 });
    await desktops.ensure('chief:a');
    const busy = await desktops.hold('chief:a');
    env.advance(5_000);
    await desktops.sweep();
    expect(env.state().vms[NAME]?.state).toBe('running');
    busy();
    env.advance(5_000);
    await desktops.sweep();
    expect(env.state().vms[NAME]?.state).toBe('stopped');
    const quit = env.calls().find((argv) => argv.includes('quit')) as string[];
    expect(quit.at(-1)).toBe('chief_a-stealth');
    expect(env.calls().findIndex((argv) => argv.includes('quit'))).toBeLessThan(
      env.calls().findIndex((argv) => argv[0] === 'stop'),
    );
    expect(env.state().volumes).toEqual([NAME]);
    expect(await desktops.presence()).toEqual([
      { scopeKey: 'chief:a', providerRef: NAME, state: 'stopped' },
    ]);
  });

  test('killAll stops only the VMs this daemon started', async () => {
    const env = setup();
    const state = env.state();
    state.vms['cairn-computer-other'] = { state: 'running', labels: {} };
    writeFileSync(join(env.fake, 'state.json'), JSON.stringify(state));
    const desktops = env.make();
    await desktops.ensure('chief:a');
    await desktops.killAll();
    expect(env.calls().filter((argv) => argv[0] === 'stop')).toEqual([['stop', NAME]]);
    expect(env.state().vms['cairn-computer-other']?.state).toBe('running');
  });

  test('the owner terminal is an interactive agent shell inside the VM', async () => {
    const env = setup();
    expect(await env.make().terminalCommand('chief:a')).toEqual([
      env.binary,
      'exec',
      '--interactive',
      '--tty',
      '--uid',
      '1000',
      '--gid',
      '1000',
      '--workdir',
      '/home/agent',
      '--env',
      'HOME=/home/agent',
      '--env',
      'USER=agent',
      '--env',
      'DISPLAY=:1',
      '--env',
      'LANG=C.UTF-8',
      NAME,
      'bash',
      '-l',
    ]);
  });

  test('approved packages install as root through apt and are recorded outside the guest', async () => {
    const env = setup();
    const desktops = env.make();
    const output: string[] = [];
    expect(
      await desktops.installPackages('chief:a', ['ffmpeg', 'libpq-dev'], installOptions(output)),
    ).toBe(0);
    const apt = env.calls().find((argv) => argv.join(' ').includes('apt-get')) as string[];
    expect(apt.slice(apt.indexOf('--uid'), apt.indexOf('--uid') + 4)).toEqual([
      '--uid',
      '0',
      '--gid',
      '0',
    ]);
    const script = apt[apt.indexOf('-c') + 1] as string;
    expect(script).toContain('apt-get -o APT::Sandbox::User=root update');
    expect(script).toContain(
      'apt-get -o APT::Sandbox::User=root install -y --no-install-recommends -- "$@"',
    );
    expect(script).toContain('chmod a-s');
    expect(apt.slice(-2)).toEqual(['ffmpeg', 'libpq-dev']);
    expect(output.join('')).toContain('Setting up ffmpeg');
    expect(env.state().vms[NAME]?.installed).toEqual(['ffmpeg', 'libpq-dev']);
    expect(
      JSON.parse(readFileSync(join(env.dir, 'vm', 'packages', `${NAME}.json`), 'utf8')),
    ).toEqual(['ffmpeg', 'libpq-dev']);
  });

  test.each([
    ['a path', '/tmp/evil.deb'],
    ['a URL', 'https://example.com/x.deb'],
    ['an option', '-oAPT::Get::AllowUnauthenticated=1'],
    ['an upper-case name', 'FFmpeg'],
  ])('%s is refused before anything runs', async (_label, name) => {
    const env = setup();
    await expect(
      env.make().installPackages('chief:a', ['ffmpeg', name], installOptions()),
    ).rejects.toThrow('Debian package name');
    expect(env.calls()).toEqual([]);
  });

  test('a failed install returns apt exit code and records nothing', async () => {
    const env = setup();
    env.flag('apt-code', '100');
    const output: string[] = [];
    expect(
      await env.make().installPackages('chief:a', ['nosuchpackage'], installOptions(output)),
    ).toBe(100);
    expect(output.join('')).toContain('Unable to locate package nosuchpackage');
    expect(existsSync(join(env.dir, 'vm', 'packages', `${NAME}.json`))).toBe(false);
  });

  test('stop keeps the volume, reports a stopped VM and the next use starts it again', async () => {
    const env = setup();
    const desktops = env.make();
    await desktops.ensure('chief:a');
    expect(await desktops.manage('chief:a', 'stop')).toBe('stopped');
    expect(env.state().vms[NAME]?.state).toBe('stopped');
    expect(env.state().volumes).toEqual([NAME]);
    expect(await desktops.presence()).toEqual([
      { scopeKey: 'chief:a', providerRef: NAME, state: 'stopped' },
    ]);
    expect(await desktops.manage('chief:a', 'stop')).toBe('already_stopped');
    await desktops.ensure('chief:a');
    expect(env.state().vms[NAME]?.state).toBe('running');
    expect(env.calls().filter((argv) => argv[0] === 'run')).toHaveLength(1);
  });

  test('update says current when the VM runs the pinned image', async () => {
    const env = setup();
    const desktops = env.make({ image: 'ghcr.io/example/computer@sha256:'.padEnd(97, 'a') });
    await desktops.ensure('chief:a');
    expect(await desktops.manage('chief:a', 'update')).toBe('current');
    expect(env.calls().some((argv) => argv[0] === 'delete')).toBe(false);
  });

  test('update recreates the VM from a changed image, keeps the volume and reinstalls packages', async () => {
    const env = setup();
    const old = 'ghcr.io/example/computer@sha256:'.padEnd(97, 'a');
    const pinned = 'ghcr.io/example/computer@sha256:'.padEnd(97, 'b');
    const before = env.make({ image: old });
    await before.installPackages('chief:a', ['ffmpeg'], installOptions());
    const desktops = env.make({ image: pinned });
    expect(await desktops.manage('chief:a', 'update')).toBe('updated');
    expect(env.state().vms[NAME]?.image).toBe(pinned);
    expect(env.state().vms[NAME]?.installed).toEqual(['ffmpeg']);
    expect(env.state().volumes).toEqual([NAME]);
    expect(env.calls()).toContainEqual(['delete', '--force', NAME]);
    expect(env.logs.some((line) => line.includes('reinstalled ffmpeg'))).toBe(true);
  });

  test('a stopped VM on an older pinned image is recreated on the new image at the next use, keeping the volume and packages', async () => {
    const env = setup();
    const old = 'ghcr.io/example/computer@sha256:'.padEnd(97, 'a');
    const pinned = 'ghcr.io/example/computer@sha256:'.padEnd(97, 'b');
    const before = env.make({ image: old });
    await before.installPackages('chief:a', ['ffmpeg'], installOptions());
    await before.manage('chief:a', 'stop');
    await env.make({ image: pinned }).ensure('chief:a');
    expect(env.state().vms[NAME]?.image).toBe(pinned);
    expect(env.state().vms[NAME]?.installed).toEqual(['ffmpeg']);
    expect(env.state().volumes).toEqual([NAME]);
    expect(env.calls().some((argv) => argv[0] === 'volume' && argv[1] === 'delete')).toBe(false);
  });

  test('a computer held by this daemon is not recreated mid-use when the pin differs', async () => {
    const env = setup();
    const old = 'ghcr.io/example/computer@sha256:'.padEnd(97, 'a');
    const desktops = env.make({ image: old });
    await desktops.ensure('chief:a');
    const pinned = 'ghcr.io/example/computer@sha256:'.padEnd(97, 'b');
    const state = env.state();
    (state.vms[NAME] as { image: string }).image = pinned;
    writeFileSync(join(env.fake, 'state.json'), JSON.stringify(state));
    await desktops.ensure('chief:a');
    expect(env.calls().some((argv) => argv[0] === 'delete')).toBe(false);
  });

  test('recover recreates a broken VM with its volume and reinstalls approved packages as root', async () => {
    const env = setup();
    const desktops = env.make();
    await desktops.installPackages('chief:a', ['ffmpeg'], installOptions());
    const runsBefore = env.calls().filter((argv) => argv[0] === 'run').length;
    expect(await desktops.manage('chief:a', 'recover')).toBe('recovered');
    expect(env.calls().filter((argv) => argv[0] === 'run')).toHaveLength(runsBefore + 1);
    expect(env.state().vms[NAME]?.state).toBe('running');
    expect(env.state().vms[NAME]?.installed).toEqual(['ffmpeg']);
    const reinstall = env
      .calls()
      .filter((argv) => argv.join(' ').includes('apt-get'))
      .at(-1) as string[];
    expect(reinstall[reinstall.indexOf('--uid') + 1]).toBe('0');
    expect(env.state().volumes).toEqual([NAME]);
    expect(env.calls().filter((argv) => argv[0] === 'volume' && argv[1] === 'delete')).toEqual([]);
  });

  test('reset deletes the VM, its home volume and the package record, then starts fresh', async () => {
    const env = setup();
    const desktops = env.make();
    await desktops.installPackages('chief:a', ['ffmpeg'], installOptions());
    expect(await desktops.manage('chief:a', 'reset')).toBe('reset');
    expect(env.calls()).toContainEqual(['volume', 'delete', NAME]);
    expect(env.calls().filter((argv) => argv[0] === 'volume' && argv[1] === 'create')).toHaveLength(
      2,
    );
    expect(env.state().vms[NAME]?.state).toBe('running');
    expect(env.state().vms[NAME]?.installed).toEqual([]);
    expect(existsSync(join(env.dir, 'vm', 'packages', `${NAME}.json`))).toBe(false);
  });
});
