import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  assertConfinementCleanup,
  confinementGate,
  launchConfined,
  ownedConfinementArgs,
} from '../src/backend/confine.js';

import { testTempDir } from './test-temp-dir.js';

for (const [terminal, events, code, source, accepted] of [
  [true, 'populated 0\nfrozen 0\n', '', 'fd', true],
  [true, '', 'ENOENT', 'path', true],
  [true, '', 'ENODEV', 'fd', true],
  [false, '', 'ENOENT', 'path', false],
  [false, '', 'ENODEV', 'fd', false],
  [false, 'populated 0\n', '', 'fd', false],
  [true, '', 'EACCES', 'fd', false],
  [true, '', 'ETIMEDOUT', 'fd', false],
  [true, 'populated 1\n', '', 'fd', false],
  [true, 'frozen 0\n', '', 'fd', false],
  [true, '', 'ENOENT', 'fd', false],
  [true, '', 'ENODEV', 'path', false],
] as const) {
  test(`cleanup terminal=${terminal} events=${events.trim()} error=${code}`, () => {
    const check = () =>
      assertConfinementCleanup(
        terminal,
        () => {
          if (code) throw Object.assign(new Error(code), { code });
          return events;
        },
        source,
      );
    if (accepted) expect(check).not.toThrow();
    else expect(check).toThrow();
  });
}

for (const ack of ['', 'stale\n', 'current extra\n', 'current']) {
  test(`gate refuses EOF or malformed acknowledgement ${JSON.stringify(ack)}`, () => {
    const result = spawnSync(
      '/bin/sh',
      ['-c', confinementGate, 'gate', 'current', '/bin/echo', 'EXECUTED'],
      { input: ack, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('ready:current\n');
  });
}

test('gate preserves subsequent harness input after an exact acknowledgement', () => {
  const result = spawnSync('/bin/sh', ['-c', confinementGate, 'gate', 'current', '/bin/cat'], {
    input: 'current\npayload\n',
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('ready:current\npayload\n');
});

test('manager owns bwrap before the gate and follows the daemon lifetime', () => {
  const args = ownedConfinementArgs('task.service', 'daemon.service', ['--unshare-pid'], 'nonce', [
    '/bin/true',
  ]);
  expect(args).toContain('--property=BindsTo=daemon.service');
  expect(args).toContain('--property=After=daemon.service');
  expect(args).toContain('--property=KillMode=control-group');
  expect(args).toContain('--property=ExitType=cgroup');
  expect(args).toContain('--property=Delegate=no');
  expect(args.indexOf('bwrap')).toBeLessThan(args.indexOf(confinementGate));
  expect(() => ownedConfinementArgs('task.service', 'bad\nunit', [], 'nonce', [])).toThrow();
});

const live = process.env.CAIRN_CONFINE_SYSTEMD_PROBES === '1';

function taskGroup(unit: string): string {
  return spawnSync('systemctl', ['--user', 'show', unit, '-p', 'ControlGroup', '--value'], {
    encoding: 'utf8',
  }).stdout.trim();
}

async function liveLaunch(command: string[], signal?: AbortSignal) {
  const root = testTempDir('confine-owner-');
  for (const path of ['home', 'daemon', 'work', 'temp']) mkdirSync(join(root, path));
  return launchConfined({
    policy: {
      home: join(root, 'home'),
      daemonHome: join(root, 'daemon'),
      workspace: join(root, 'work'),
      taskTemp: join(root, 'temp'),
      state: [],
      caches: [],
      gitDirectories: [],
    },
    owner: process.env.CAIRN_CONFINE_TEST_OWNER ?? '',
    command,
    environment: {},
    signal,
  });
}

test.runIf(live)(
  'real systemd: gate, stdio, terminal wait and removed cgroup cleanup',
  async () => {
    const handle = await liveLaunch(['/bin/cat']);
    const group = taskGroup(handle.unit);
    const path = `/sys/fs/cgroup${group}/cgroup.events`;
    const fd = openSync(path, 'r');
    let output = '';
    handle.process.stdout.on('data', (chunk) => {
      output += chunk;
    });
    handle.process.stdout.resume();
    handle.process.stdin.end('harness-input\n');
    await handle.completed;
    expect(output).toBe('harness-input\n');
    try {
      expect(() => readFileSync(path)).toThrow(expect.objectContaining({ code: 'ENOENT' }));
      expect(() => readSync(fd, Buffer.alloc(4096), 0, 4096, 0)).toThrow(
        expect.objectContaining({ code: 'ENODEV' }),
      );
      console.log(
        'negative control: old populated=0-only criterion cannot read removed cgroup: ENOENT path, ENODEV held FD',
      );
    } finally {
      closeSync(fd);
    }
    console.log('real systemd: terminal --wait + held cgroup FD cleanup accepted');
  },
);

test.runIf(live)('real systemd: a process escaping into the unit blocks removal', async () => {
  const handle = await liveLaunch(['/bin/cat']);
  const group = taskGroup(handle.unit);
  const directory = `/sys/fs/cgroup${group}`;
  const escaped = spawn('/bin/sleep', ['60']);
  try {
    expect(escaped.pid).toBeTypeOf('number');
    writeFileSync(join(directory, 'cgroup.procs'), String(escaped.pid));
    expect(readFileSync(join(directory, 'cgroup.procs'), 'utf8')).toContain(String(escaped.pid));
    expect(() => rmdirSync(directory)).toThrow(expect.objectContaining({ code: 'EBUSY' }));
    expect(() =>
      assertConfinementCleanup(true, () => readFileSync(join(directory, 'cgroup.events'), 'utf8')),
    ).toThrow('not empty');
    console.log('real systemd: escaped process => populated=1, rmdir=EBUSY, cleanup refused');
    await handle.stop();
    await handle.completed;
  } finally {
    await handle.stop();
    if (escaped.exitCode === null) escaped.kill();
  }
});

test.runIf(live)('real systemd: abort after acknowledgement stops the whole unit', async () => {
  const abort = new AbortController();
  const handle = await liveLaunch(['/bin/sleep', '60'], abort.signal);
  abort.abort();
  await handle.completed;
});

test.runIf(live)('real systemd: abort before startup creates no harness', async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(liveLaunch(['/bin/false'], abort.signal)).rejects.toThrow();
});
