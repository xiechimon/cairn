import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createUnixServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createHostShellConfinement } from '../src/backend/host-shell-confinement.js';
import { executableOnPath } from '../src/computer/contained-spawn.js';
import { HostComputerProvider, hostCommandEnvironment } from '../src/computer/host.js';
import { ComputerRefusal } from '../src/computer/provider.js';
import { testTempDir } from './test-temp-dir.js';

function layout() {
  const root = realpathSync(testTempDir('host-shell-'));
  const home = join(root, 'home');
  const serverHome = join(root, 'cairn-home');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(serverHome, 'server'), { recursive: true });
  writeFileSync(join(serverHome, 'access-token'), 'secret');
  writeFileSync(join(serverHome, 'server', 'server.db'), 'secret');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(join(home, '.ssh', 'id_ed25519'), 'secret');
  mkdirSync(join(home, 'work'), { recursive: true });
  return { root, home, serverHome };
}

function provider(home: string, deniedRoots: string[]) {
  return new HostComputerProvider({
    home,
    env: { PATH: process.env.PATH, HOME: home },
    confinement: createHostShellConfinement({ home, deniedRoots }),
  });
}

describe('host shell file verbs', () => {
  test('read, write and list refuse paths inside the server home', async () => {
    const { home, serverHome } = layout();
    const host = provider(home, [serverHome]);
    await expect(host.readFile(join(serverHome, 'access-token'))).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
    await expect(host.writeFile(join(serverHome, 'new'), 'x')).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
    await expect(host.listFiles(serverHome)).rejects.toBeInstanceOf(ComputerRefusal);
    await expect(host.readFile(join(home, '.ssh', 'id_ed25519'))).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
  });

  test('execute refuses a cwd inside the server home but works elsewhere', async () => {
    const { home, serverHome } = layout();
    const host = provider(home, [serverHome]);
    await expect(
      host.execute({
        argv: ['pwd'],
        cwd: serverHome,
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ComputerRefusal);
    const events = await host.execute({
      argv: ['bash', '-c', 'pwd'],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    });
    for await (const event of events) void event;
  });

  test('a symlink into a denied root is still refused', async () => {
    const { home, serverHome } = layout();
    const host = provider(home, [serverHome]);
    await expect(host.writeFile(join(serverHome, 'nested', 'x'), 'y')).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
  });
});

describe('host shell command environment', () => {
  test('the owner channel, tokens and arbitrary CAIRN_* values never reach the shell', () => {
    const env = hostCommandEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/o',
      CAIRN_OWNER_CHANNEL: 'ipc',
      CAIRN_TOKEN: 'owner-token',
      CAIRN_API_KEY: 'cairn_deadbeef',
      CAIRN_MACHINE_TOKEN: 'machine-token',
      CAIRN_OWN_COMPUTER: '1',
      CAIRN_CONFINE_DENIED_ROOTS: '/secret',
      SSH_AUTH_SOCK: '/run/agent',
      SSH_AGENT_PID: '4242',
      DBUS_SESSION_BUS_ADDRESS: 'unix:abstract=/tmp/dbus-fake',
      ssh_auth_sock: '/run/lowercase-agent',
    });
    expect(env.PATH).toBe('/usr/bin');
    for (const name of Object.keys(env)) {
      expect(name.startsWith('CAIRN_')).toBe(false);
      expect(
        ['SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'DBUS_SESSION_BUS_ADDRESS'].includes(name.toUpperCase()),
      ).toBe(false);
    }
  });

  test('request-supplied socket variables are stripped too', () => {
    const env = hostCommandEnvironment(
      { PATH: '/usr/bin', HOME: '/home/o' },
      {
        SSH_AUTH_SOCK: '/run/agent',
        SSH_AGENT_PID: '4242',
        DBUS_SESSION_BUS_ADDRESS: 'unix:abstract=/tmp/dbus-fake',
        ssh_auth_sock: '/run/lowercase-agent',
      },
    );
    for (const name of Object.keys(env)) {
      expect(
        ['SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'DBUS_SESSION_BUS_ADDRESS'].includes(name.toUpperCase()),
      ).toBe(false);
    }
  });
});

describe('createHostShellConfinement', () => {
  test('denied() covers the server home, .ssh, denied files and the agent-desktop dir', () => {
    const { home, serverHome, root } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      agentDesktop: join(root, 'agent-desktop', 'agent-desktop'),
      platform: 'darwin',
    });
    expect(conf.denied(join(serverHome, 'access-token'))).toBe(true);
    expect(conf.denied(join(serverHome, 'server', 'server.db'))).toBe(true);
    expect(conf.denied(join(home, '.ssh', 'id_ed25519'))).toBe(true);
    expect(conf.denied(join(home, '.netrc'))).toBe(true);
    expect(conf.denied(join(home, '.orbstack', 'run', 'docker.sock'))).toBe(true);
    expect(conf.denied(join(home, '.colima', 'default', 'docker.sock'))).toBe(true);
    expect(conf.denied(join(home, '.tmux', 'default'))).toBe(true);
    expect(conf.denied(join(root, 'agent-desktop', 'agent-desktop'))).toBe(true);
    expect(conf.denied(join(home, 'work', 'out.txt'))).toBe(false);
  });

  test('on linux denied() covers the container sockets and the xdg runtime dir', () => {
    const { home, serverHome } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'linux',
      xdgRuntimeDir: '/run/user/501',
    });
    expect(conf.denied('/var/run/docker.sock')).toBe(true);
    expect(conf.denied('/run/podman/podman.sock')).toBe(true);
    expect(conf.denied('/run/user/501/podman/podman.sock')).toBe(true);
    expect(conf.denied('/run/user/501/docker.sock')).toBe(true);
    expect(conf.denied('/run/user/501/docker/cli.sock')).toBe(true);
    expect(conf.denied('/run/user/501/containerd/containerd.sock')).toBe(true);
    expect(conf.denied('/run/user/501/buildkit/buildkitd.sock')).toBe(true);
    expect(conf.denied('/run/user/501/bus')).toBe(true);
    expect(conf.denied('/run/user/501/ssh-agent.socket')).toBe(true);
    expect(conf.denied('/run/user/501/systemd/private')).toBe(true);
    expect(conf.denied('/run/user/501/keyring/ssh')).toBe(true);
    expect(conf.denied('/run/user/501/gnupg/S.gpg-agent.ssh')).toBe(true);
    expect(conf.denied('/run/user/501/at-spi/bus')).toBe(true);
    expect(conf.denied(join(home, '.local', 'share', 'docker', 'docker.sock'))).toBe(true);
    expect(conf.denied('/etc/hostname')).toBe(false);
  });

  test('on darwin denied() folds case on case-insensitive filesystems', () => {
    const { home, serverHome } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'darwin',
    });
    expect(conf.denied(join(serverHome.toUpperCase(), 'access-token'))).toBe(true);
    expect(conf.denied(join(home, '.SSH', 'id_ed25519'))).toBe(true);
    expect(conf.denied(join(home, 'WORK', 'out.txt'))).toBe(false);
  });

  test('on darwin the wrapped command is sandbox-exec with a seatbelt profile', () => {
    const { home, serverHome, root } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      serverPort: 8123,
      agentDesktop: join(root, 'agent-desktop', 'agent-desktop'),
      platform: 'darwin',
    });
    if (!existsSync('/usr/bin/sandbox-exec')) {
      expect(() => conf.wrap('true', [])).toThrow(ComputerRefusal);
      return;
    }
    const launch = conf.wrap('bash', ['-c', 'echo hi']);
    expect(launch.command).toBe('/usr/bin/sandbox-exec');
    expect(launch.args.slice(-3)).toEqual(['bash', '-c', 'echo hi']);
    const profile = launch.args[1] as string;
    expect(profile).toContain(`(subpath "${serverHome}")`);
    expect(profile).toContain('(deny network-outbound (remote tcp "localhost:8123"))');
    expect(profile).toContain('(deny network-outbound (remote tcp "*:8123"))');
    expect(profile).toContain('(deny network-inbound (local tcp "*:8123"))');
    expect(profile).toContain('(deny network-bind (local tcp "*:8123"))');
    expect(profile).toContain(`(deny process-exec (subpath "${join(root, 'agent-desktop')}")`);
    expect(profile).toContain('(deny network-outbound (remote unix-socket');
    expect(profile).toContain('(deny network-bind (local unix-socket');
    expect(profile).toContain('(deny file-write* (regex');
    expect(profile).toContain('com\\.apple\\.launchd');
    expect(profile).toContain('(tmp|var/tmp|var/run|var/folders/');
    expect(profile).toContain(
      '(deny network-outbound (remote unix-socket (literal "/var/run/docker.sock")))',
    );
    expect(profile).toContain(
      '(deny network-bind (local unix-socket (literal "/var/run/docker.sock")))',
    );
    expect(profile).toContain(
      '(deny mach-lookup (global-name-prefix "com.apple.windowserver") (global-name-prefix "com.apple.hiservices") (global-name-prefix "com.apple.pasteboard"))',
    );
  });

  test('on linux the wrapped command is bubblewrap over the host tree', () => {
    const { home, serverHome } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'linux',
      path: process.env.PATH,
    });
    if (executableOnPath('bwrap', process.env.PATH) === undefined) {
      expect(() => conf.wrap('true', [])).toThrow(ComputerRefusal);
      return;
    }
    const launch = conf.wrap('bash', ['-c', 'echo hi']);
    expect(launch.command.endsWith('/bwrap') || launch.command === 'bwrap').toBe(true);
    for (const [flag, mount] of [
      ['--tmpfs', '/tmp'],
      ['--tmpfs', '/var/tmp'],
      ['--tmpfs', serverHome],
    ]) {
      const at = launch.args.findIndex(
        (arg, index) => arg === flag && launch.args[index + 1] === mount,
      );
      expect(at, `${flag} ${mount}`).toBeGreaterThan(-1);
    }
    expect(launch.args.slice(-3)).toEqual(['bash', '-c', 'echo hi']);
  });

  test('on linux without bwrap every command is refused', () => {
    const { home, serverHome } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'linux',
      path: '/nonexistent',
    });
    expect(() => conf.wrap('true', [])).toThrow(/bubblewrap/);
  });

  test('unsupported platforms refuse instead of running unconfined', () => {
    const { home, serverHome } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'win32',
    });
    expect(() => conf.wrap('true', [])).toThrow(ComputerRefusal);
  });
});

describe.runIf(process.platform === 'darwin')('host shell seatbelt probe', () => {
  test('without confinement the shell reads the owner token', () => {
    const { serverHome } = layout();
    const outcome = spawnSync('cat', [join(serverHome, 'access-token')], { encoding: 'utf8' });
    expect(outcome.stdout).toBe('secret');
  });

  test('a confined command cannot read the server home, exec agent-desktop or reach the server port', async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(request.url ?? '');
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const { home, serverHome, root } = layout();
    const socketDir = join(root, 'd');
    mkdirSync(socketDir, { recursive: true });
    const unixSocket = join(socketDir, 's');
    const unixServer = createUnixServer();
    await new Promise<void>((resolve, reject) => {
      unixServer.once('error', reject);
      unixServer.listen(unixSocket, resolve);
    });
    try {
      const agentDesktop = join(root, 'agent-desktop', 'agent-desktop');
      mkdirSync(join(root, 'agent-desktop'), { recursive: true });
      writeFileSync(agentDesktop, '#!/bin/sh\necho ran\n');
      spawnSync('chmod', ['+x', agentDesktop]);
      const conf = createHostShellConfinement({
        home,
        deniedRoots: [serverHome, socketDir],
        serverPort: port,
        agentDesktop,
      });
      const failures = [
        `/bin/cat '${join(serverHome, 'access-token')}'`,
        `/bin/cat '${join(serverHome, 'server', 'server.db')}'`,
        `/bin/cat '${join(home, '.ssh', 'id_ed25519')}'`,
        `/bin/cat '${agentDesktop}'`,
        `cp '${agentDesktop}' '${join(home, 'work', 'copy')}' && '${join(home, 'work', 'copy')}'`,
        `'${agentDesktop}'`,
        `/usr/bin/nc -z -w 2 127.0.0.1 ${port}`,
        `/usr/bin/nc -l -w 1 127.0.0.1 ${port}`,
        `curl -s -m 3 http://127.0.0.1:${port}/api/auth/bootstrap`,
        `/usr/sbin/screencapture -x '${join(home, 'work', 'shot.png')}'`,
        `'${process.execPath}' -e 'require("net").connect("${unixSocket}").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))'`,
      ];
      for (const script of failures) {
        const launch = conf.wrap('/bin/sh', ['-c', script]);
        const outcome = spawnSync(launch.command, launch.args, {
          cwd: home,
          encoding: 'utf8',
          timeout: 8000,
        });
        expect(outcome.status, script).not.toBe(0);
        expect(outcome.stdout, script).not.toContain('secret');
      }
      expect(received).toEqual([]);
      const work = conf.wrap('/bin/sh', ['-c', `echo built > '${join(home, 'work', 'out')}'`]);
      expect(spawnSync(work.command, work.args, { cwd: home }).status).toBe(0);
    } finally {
      unixServer.close();
      server.close();
    }
  }, 30000);
});
