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
import { expect, test, vi } from 'vitest';
import {
  assertConfinementCleanup,
  confinementGate,
  launchConfined,
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

for (const input of [
  '',
  '{"nonce":"stale","environment":{}}\n',
  '{"nonce":"current","environment":{}}',
  'invalid JSON\n',
  '{"nonce":"current","environment":{},"extra":true}\n',
  '{"nonce":"current","environment":{"BAD":0}}\n',
  `${JSON.stringify({ nonce: 'current', environment: { BAD: '\0' } })}\n`,
  `${'x'.repeat(65537)}\n`,
]) {
  test(`gate refuses malformed acknowledgement ${JSON.stringify(input.slice(0, 50))}`, () => {
    const result = spawnSync(
      process.execPath,
      ['-e', confinementGate, 'current', '/bin/echo', 'EXECUTED'],
      { input, encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('ready:current\n');
  });
}

test('gate preserves subsequent harness input after an exact acknowledgement', () => {
  const result = spawnSync(process.execPath, ['-e', confinementGate, 'current', '/bin/cat'], {
    input: `${JSON.stringify({ nonce: 'current', environment: {} })}\npayload\n`,
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('ready:current\npayload\n');
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
    environment: { CONFINE_SENTINEL: 'credential-sentinel' },
    signal,
  });
}

test.runIf(live)(
  'real systemd: gate, stdio, terminal wait and removed cgroup cleanup',
  async () => {
    const handle = await liveLaunch(['/bin/sh', '-c', 'printf "%s\\n" "$CONFINE_SENTINEL"; cat']);
    const metadata = spawnSync(
      'systemctl',
      ['--user', 'show', handle.unit, '-p', 'ExecStart,BindsTo,KillMode,ExitType,Delegate'],
      {
        encoding: 'utf8',
      },
    );
    expect(metadata.stdout).not.toContain('credential-sentinel');
    expect(metadata.stdout).toContain(`BindsTo=${process.env.CAIRN_CONFINE_TEST_OWNER}`);
    expect(metadata.stdout).toContain('KillMode=control-group');
    expect(metadata.stdout).toContain('ExitType=cgroup');
    expect(metadata.stdout).toContain('Delegate=no');
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
    expect(output).toBe('credential-sentinel\nharness-input\n');
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
    handle.process.stdin.end();
    await expect
      .poll(() => readFileSync(join(directory, 'cgroup.procs'), 'utf8').trim())
      .toBe(String(escaped.pid));
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

test.runIf(live)('real systemd: cancel after spawn but before capturing the cgroup', async () => {
  const abort = new AbortController();
  const subscribe = abort.signal.addEventListener.bind(abort.signal);
  const listener = vi.spyOn(abort.signal, 'addEventListener').mockImplementation((...args) => {
    subscribe(...args);
    abort.abort();
  });
  try {
    await expect(liveLaunch(['/bin/false'], abort.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    );
  } finally {
    listener.mockRestore();
  }
});

test.runIf(live)(
  'real systemd: stop racing successful unit collection still proves cleanup',
  async () => {
    const handle = await liveLaunch(['/bin/cat']);
    const directory = testTempDir('confine-stop-race-');
    writeFileSync(
      join(directory, 'systemctl'),
      `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
if (args[1] === 'stop') {
  const until = Date.now() + 5000;
  let collected = false;
  while (Date.now() < until) {
    const result = spawnSync('/usr/bin/systemctl', ['--user', 'show', args[2], '-p', 'LoadState', '--value'], {encoding:'utf8',timeout:1000});
    if (result.stdout.trim() === 'not-found') { collected = true; break; }
  }
  if (!collected) process.exit(127);
}
process.exit(spawnSync('/usr/bin/systemctl', args, {stdio:'inherit'}).status ?? 127);
`,
      { mode: 0o755 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${directory}:${previousPath}`;
    try {
      const stopping = handle.stop();
      handle.process.stdin.end();
      await stopping;
      await handle.completed;
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  },
);
