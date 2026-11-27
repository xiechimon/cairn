import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createUnixServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  createHostShellConfinement,
  runnerHostShellConfinement,
} from '../src/backend/host-shell-confinement.js';
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

  test('listFiles hides confined directories, files, and symlinks to or from denied paths', async () => {
    const { home, serverHome } = layout();
    const cairnDir = join(home, '.cairn');
    mkdirSync(join(home, '.aws'), { recursive: true });
    writeFileSync(join(home, '.aws', 'credentials'), 'secret');
    mkdirSync(cairnDir, { recursive: true });
    writeFileSync(join(cairnDir, 'access-token'), 'secret');
    writeFileSync(join(home, 'notes.txt'), 'hello');
    const dotfiles = join(home, 'dotfiles');
    mkdirSync(dotfiles, { recursive: true });
    writeFileSync(join(dotfiles, 'netrc'), 'secret-netrc');
    symlinkSync(join(dotfiles, 'netrc'), join(home, '.netrc'));
    symlinkSync(join(home, '.ssh'), join(home, 'work', 'ssh-link'));
    symlinkSync(join(home, '.ssh', 'id_ed25519'), join(home, 'work', 'key-link'));
    writeFileSync(join(home, 'work', 'visible.txt'), 'ok');

    const host = provider(home, [serverHome, cairnDir]);
    const homeEntries = (await host.listFiles('')).map((entry) => entry.path);
    expect(homeEntries).toContain('work');
    expect(homeEntries).toContain('notes.txt');
    expect(homeEntries).toContain('dotfiles');
    expect(homeEntries).not.toContain('.ssh');
    expect(homeEntries).not.toContain('.aws');
    expect(homeEntries).not.toContain('.cairn');
    expect(homeEntries).not.toContain('.netrc');

    const workEntries = (await host.listFiles('work')).map((entry) => entry.path);
    expect(workEntries).toEqual(['work/visible.txt']);
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
  test('denied() covers the server home, .ssh, denied files and the agent binary dirs', () => {
    const { home, serverHome, root } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      agentDesktop: join(root, 'agent-desktop', 'agent-desktop'),
      agentBrowser: join(root, 'agent-browser', 'arm64', 'agent-browser'),
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
    expect(conf.denied(join(root, 'agent-browser', 'arm64', 'agent-browser'))).toBe(true);
    expect(conf.denied(join(root, 'agent-browser', 'x64', 'agent-browser'))).toBe(true);
    expect(conf.denied(join(home, 'work', 'out.txt'))).toBe(false);
  });

  test('runnerHostShellConfinement wires CAIRN_AGENT_BROWSER (even whitespace-padded) into denied() and seatbelt', () => {
    const { home, root } = layout();
    const agentBrowser = join(root, 'agent-browser', 'arm64', 'agent-browser');
    const conf = runnerHostShellConfinement({
      cairnHome: join(root, 'runner-home'),
      serverUrl: 'http://127.0.0.1:8787',
      stagingRoot: join(root, 'staging'),
      capabilityEnv: { CAIRN_AGENT_BROWSER: `  ${agentBrowser}  ` },
    });
    expect(conf.denied(agentBrowser)).toBe(true);
    expect(conf.denied(join(root, 'agent-browser', 'x64', 'agent-browser'))).toBe(true);
    if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
      const profile = conf.wrap('true', []).args[1] as string;
      expect(profile).toContain(`(deny process-exec (subpath "${join(root, 'agent-browser')}"))`);
    }
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
      agentBrowser: join(root, 'agent-browser', 'arm64', 'agent-browser'),
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
    expect(profile).toContain(`(deny process-exec (subpath "${join(root, 'agent-browser')}")`);
    expect(profile).toContain(
      '(deny file-write* (literal "/Applications/Google Chrome.app") (subpath "/Applications/Google Chrome.app"))',
    );
    expect(profile).toContain(
      '(deny file-write-unlink (literal "/Applications/Google Chrome.app"))',
    );
    expect(profile).toContain('(deny network-outbound (remote unix-socket');
    expect(profile).toContain('(deny network-bind (local unix-socket');
    expect(profile).toContain('(deny file-write* (regex');
    expect(profile).toContain('com\\.apple\\.launchd');
    expect(profile).toContain('(tmp|var/tmp|var/run|var/folders/');
    expect(profile).toContain(
      '(deny network-outbound (remote unix-socket (literal "/var/run/docker.sock")))',
    );
    expect(profile).toContain(
      `(remote unix-socket (literal "${join(home, 'Library', 'Group Containers', '2BUA8C4S2C.com.1password', 't', 'agent.sock')}"))`,
    );
    expect(profile).toContain(
      '(deny network-bind (local unix-socket (literal "/var/run/docker.sock")))',
    );
    expect(profile).toContain(
      '(deny mach-lookup (global-name-prefix "com.apple.windowserver") (global-name-prefix "com.apple.hiservices") (global-name-prefix "com.apple.pasteboard"))',
    );
    expect(profile).toContain('(deny mach-bootstrap)');
    expect(profile).toContain('(deny process-exec (literal "/bin/launchctl")');
    expect(profile).toContain('global-name-prefix "com.apple.secd"');
    expect(profile).not.toContain('global-name-prefix "com.apple.trustd"');
    expect(profile).toContain('(deny file-write-unlink');
    expect(profile).not.toContain(`(subpath "${join(home, 'Library', 'LaunchAgents')}")`);
    expect(profile).not.toContain('(subpath "/Library/LaunchAgents")');
    expect(profile).not.toContain(`(subpath "${join(home, 'Library', 'Mail')}")`);
    expect(profile).not.toContain(`(literal "${join(home, '.zshrc')}")`);
  });

  test('on linux denied() covers only credential paths and leaves mail/rc/history/non-credential files allowed', () => {
    const { home, serverHome } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'linux',
      xdgRuntimeDir: '/run/user/501',
    });
    for (const allowed of [
      join(home, '.zshrc'),
      join(home, '.bashrc'),
      join(home, '.zsh_history'),
      join(home, '.bash_history'),
      join(home, '.gitconfig'),
      join(home, '.config', 'autostart', 'a.desktop'),
      join(home, '.local', 'share', 'fish', 'fish_history'),
    ]) {
      expect(conf.denied(allowed), allowed).toBe(false);
    }
    for (const blocked of [
      join(home, '.ssh', 'id_ed25519'),
      join(home, '.gnupg', 'secring.gpg'),
      join(home, '.aws', 'credentials'),
      join(home, '.azure', 'accessTokens.json'),
      join(home, '.config', 'gcloud', 'credentials.db'),
      join(home, '.config', 'gh', 'hosts.yml'),
      join(home, '.npmrc'),
      join(home, '.cargo', 'credentials.toml'),
      join(home, '.cargo', 'credentials'),
      join(home, '.pypirc'),
      join(home, '.docker', 'config.json'),
      join(home, '.netrc'),
      join(home, '.git-credentials'),
      join(home, '.local', 'share', 'keyrings', 'login.keyring'),
      join(home, '.mozilla', 'firefox', 'profiles.ini'),
      join(home, '.config', 'google-chrome', 'Default', 'Login Data'),
      join(home, '.1password', 'agent.sock'),
    ]) {
      expect(conf.denied(blocked), blocked).toBe(true);
    }
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
    const sockets = [
      '/private/var/run/docker.sock',
      '/var/run/docker.sock',
      '/run/podman/podman.sock',
    ];
    const socketsExistedBefore = sockets.map((sock) => existsSync(sock));
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
    const pairAt = (source: string, target: string) =>
      launch.args.findIndex(
        (arg, index) =>
          arg === '--ro-bind' &&
          launch.args[index + 1] === source &&
          launch.args[index + 2] === target,
      );
    const missingCredFile = join(home, '.yarnrc');
    expect(pairAt('/dev/null', missingCredFile)).toBeGreaterThan(-1);
    const gnupg = join(home, '.gnupg');
    expect(
      launch.args.findIndex((arg, index) => arg === '--tmpfs' && launch.args[index + 1] === gnupg),
    ).toBeGreaterThan(-1);
    expect(lstatSync(gnupg).mode & 0o777).toBe(0o700);
    const missingDeniedDir = join(home, '.aws');
    expect(
      launch.args.findIndex(
        (arg, index) => arg === '--tmpfs' && launch.args[index + 1] === missingDeniedDir,
      ),
    ).toBeGreaterThan(-1);
    for (const [index, sock] of sockets.entries()) {
      if (socketsExistedBefore[index] === true) {
        expect(pairAt('/dev/null', realpathSync(sock)), sock).toBeGreaterThan(-1);
      } else {
        expect(pairAt('/dev/null', sock), sock).toBe(-1);
        expect(existsSync(sock), sock).toBe(false);
      }
    }
    const netrc = join(home, '.netrc');
    mkdirSync(netrc, { recursive: true });
    const dirWrap = conf.wrap('true', []);
    expect(
      dirWrap.args.findIndex(
        (arg, index) => arg === '--tmpfs' && dirWrap.args[index + 1] === netrc,
      ),
    ).toBeGreaterThan(-1);
    expect(launch.args.slice(-3)).toEqual(['bash', '-c', 'echo hi']);
    const probe = spawnSync(dirWrap.command, dirWrap.args, { encoding: 'utf8' });
    const diag = spawnSync('ls', ['-la', '/var', '/var/run', '/run'], {
      encoding: 'utf8',
    });
    const mounts = dirWrap.args.join(' ');
    expect(
      probe.status,
      `${probe.stderr}\n--- mounts ---\n${mounts}\n--- fs ---\n${diag.stdout}${diag.stderr}`,
    ).toBe(0);
  });

  test('on linux a dangling symlink at a denied path is unlinked then masked', () => {
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
    const kube = join(home, '.kube');
    symlinkSync(join(home, 'no-such-target'), kube);
    const launch = conf.wrap('true', []);
    expect(
      launch.args.findIndex((arg, index) => arg === '--tmpfs' && launch.args[index + 1] === kube),
    ).toBeGreaterThan(-1);
    expect(() => lstatSync(kube)).toThrow();
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

  test('dangling symlinks targeting denied or write-denied paths are refused', async () => {
    const { home, serverHome } = layout();
    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'darwin',
    });
    const escapeSsh = join(home, 'work', 'escape-ssh');
    symlinkSync(join(home, '.ssh', 'new_key'), escapeSsh);
    expect(conf.denied(escapeSsh)).toBe(true);
    expect(conf.denied(`${escapeSsh}/`)).toBe(true);
    expect(conf.denied(`${escapeSsh}//nested`)).toBe(true);

    const escapeChained = join(home, 'work', 'escape-chained');
    symlinkSync(`${escapeSsh}/`, escapeChained);
    expect(conf.denied(escapeChained)).toBe(true);

    const escapeSshSub = join(home, 'work', 'escape-ssh-dir');
    symlinkSync(join(home, '.ssh', 'missing-dir'), escapeSshSub);
    expect(conf.denied(join(escapeSshSub, 'nested', 'id_ed25519'))).toBe(true);

    const escapeRel = join(home, 'work', 'escape-rel');
    symlinkSync('../.ssh/new_key', escapeRel);
    expect(conf.denied(escapeRel)).toBe(true);

    const escapeServer = join(home, 'work', 'escape-server');
    symlinkSync(join(serverHome, 'missing-token'), escapeServer);
    expect(conf.denied(escapeServer)).toBe(true);

    const loopA = join(home, 'work', 'loop-a');
    const loopB = join(home, 'work', 'loop-b');
    symlinkSync(loopB, loopA);
    symlinkSync(loopA, loopB);
    expect(conf.denied(loopA)).toBe(true);
    expect(conf.denied(`${join(home, 'work', 'ok')}\0`)).toBe(true);

    const dotfiles = join(home, 'dotfiles');
    mkdirSync(dotfiles, { recursive: true });
    writeFileSync(join(dotfiles, 'netrc'), 'secret-netrc');
    symlinkSync(join(dotfiles, 'netrc'), join(home, '.netrc'));
    expect(conf.denied(join(home, '.netrc'))).toBe(true);

    const host = provider(home, [serverHome]);
    await expect(host.readFile(join(home, '.netrc'))).rejects.toBeInstanceOf(ComputerRefusal);
    await expect(host.writeFile(escapeSsh, 'x')).rejects.toBeInstanceOf(ComputerRefusal);
    await expect(host.writeFile(join(escapeSshSub, 'new'), 'x')).rejects.toBeInstanceOf(
      ComputerRefusal,
    );
  });

  test('host-shell-confinement reuses confine.ts canonicalDeny instead of hand-rolling one', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/backend/host-shell-confinement.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/function\s+canonicalDeny\b/);
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
      const agentBrowser = join(root, 'agent-browser', 'arm64', 'agent-browser');
      mkdirSync(join(root, 'agent-browser', 'arm64'), { recursive: true });
      writeFileSync(agentBrowser, '#!/bin/sh\necho ran\n');
      spawnSync('chmod', ['+x', agentBrowser]);
      const conf = createHostShellConfinement({
        home,
        deniedRoots: [serverHome, socketDir],
        serverPort: port,
        agentDesktop,
        agentBrowser,
      });
      const failures = [
        `/bin/cat '${join(serverHome, 'access-token')}'`,
        `/bin/cat '${join(serverHome, 'server', 'server.db')}'`,
        `/bin/cat '${join(home, '.ssh', 'id_ed25519')}'`,
        `/bin/cat '${agentDesktop}'`,
        `cp '${agentDesktop}' '${join(home, 'work', 'copy')}' && '${join(home, 'work', 'copy')}'`,
        `'${agentDesktop}'`,
        `/bin/cat '${agentBrowser}'`,
        `cp '${agentBrowser}' '${join(home, 'work', 'browser-copy')}' && '${join(home, 'work', 'browser-copy')}'`,
        `'${agentBrowser}'`,
        `echo rewritten > '${agentBrowser}'`,
        `mv '${join(root, 'agent-browser')}' '${join(root, 'agent-browser-away')}'`,
        `touch '/Applications/Google Chrome.app/.cairn-write-probe'`,
        `mkdir '/Applications/Google Chrome.app/.cairn-dir-probe'`,
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
      expect(readFileSync(agentBrowser, 'utf8')).toBe('#!/bin/sh\necho ran\n');
      const work = conf.wrap('/bin/sh', ['-c', `echo built > '${join(home, 'work', 'out')}'`]);
      expect(spawnSync(work.command, work.args, { cwd: home }).status).toBe(0);
    } finally {
      unixServer.close();
      server.close();
    }
  }, 30000);

  test('open-confine allows reading Mail/Messages/Safari history/rc/history and non-credential writes while denying credentials', () => {
    const { home, serverHome } = layout();
    const allowedReads = [
      join(home, 'Library', 'Mail', 'V10', 'envelope'),
      join(home, 'Library', 'Messages', 'chat.db'),
      join(home, 'Library', 'Safari', 'History.db'),
      join(home, '.zshrc'),
      join(home, '.bashrc'),
      join(home, '.zsh_history'),
      join(home, '.bash_history'),
    ];
    for (const file of allowedReads) {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'ok-data');
    }
    const deniedCreds = [
      join(home, '.ssh', 'id_ed25519'),
      join(home, '.gnupg', 'secring.gpg'),
      join(home, '.aws', 'credentials'),
      join(home, '.azure', 'accessTokens.json'),
      join(home, '.config', 'gcloud', 'credentials.db'),
      join(home, '.config', 'gh', 'hosts.yml'),
      join(home, '.npmrc'),
      join(home, '.cargo', 'credentials.toml'),
      join(home, '.cargo', 'credentials'),
      join(home, '.pypirc'),
      join(home, '.docker', 'config.json'),
      join(home, '.netrc'),
      join(home, '.git-credentials'),
      join(home, 'Library', 'Keychains', 'login.keychain-db'),
      join(home, 'Library', 'Cookies', 'Cookies.binarycookies'),
      join(
        home,
        'Library',
        'Containers',
        'com.apple.Safari',
        'Data',
        'Library',
        'Cookies',
        'Cookies.binarycookies',
      ),
      join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Login Data'),
      join(serverHome, 'access-token'),
    ];
    for (const file of deniedCreds) {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'secret-cred');
    }
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    mkdirSync(join(home, 'repo', '.git', 'hooks'), { recursive: true });
    const conf = createHostShellConfinement({ home, deniedRoots: [serverHome] });
    if (!existsSync('/usr/bin/sandbox-exec')) return;
    const run = (script: string) => {
      const launch = conf.wrap('/bin/sh', ['-c', script]);
      return spawnSync(launch.command, launch.args, { cwd: home, encoding: 'utf8', timeout: 8000 });
    };
    for (const file of allowedReads) {
      expect(conf.denied(file), file).toBe(false);
      const res = run(`/bin/cat '${file}'`);
      expect(res.status, `read ${file}: ${res.stderr}`).toBe(0);
      expect(res.stdout, file).toBe('ok-data');
    }
    for (const file of deniedCreds) {
      expect(conf.denied(file), file).toBe(true);
      const res = run(`/bin/cat '${file}'`);
      expect(res.status, `denied read ${file}`).not.toBe(0);
      expect(res.stdout, file).not.toContain('secret-cred');
    }
    expect(run(`echo x > '${join(home, 'Library', 'LaunchAgents', 'new.plist')}'`).status).toBe(0);
    expect(run(`echo x > '${join(home, '.gitconfig')}'`).status).toBe(0);
    expect(run(`echo x > '${join(home, 'repo', '.git', 'hooks', 'pre-commit')}'`).status).toBe(0);
    const renameBypass = run(
      `mv '${join(home, '.config')}' '${join(home, '.config.bak')}' && /bin/cat '${join(home, '.config.bak', 'gh', 'hosts.yml')}'`,
    );
    expect(renameBypass.status).not.toBe(0);
    expect(renameBypass.stdout).not.toContain('secret-cred');
  });

  test.runIf(process.platform === 'darwin')(
    'macOS host-shell confinement allows sips, textutil, swift PDFKit, mdls, and plutil while keeping credentials and escape binaries denied',
    () => {
      const { home, serverHome } = layout();
      const conf = createHostShellConfinement({ home, deniedRoots: [serverHome] });
      if (!existsSync('/usr/bin/sandbox-exec')) return;
      const run = (script: string) => {
        const launch = conf.wrap('/bin/sh', ['-c', script]);
        return spawnSync(launch.command, launch.args, {
          cwd: home,
          encoding: 'utf8',
          timeout: 15000,
        });
      };
      const sampleTxt = join(home, 'work', 'note.txt');
      const sampleHtml = join(home, 'work', 'note.html');
      const samplePng = join(home, 'work', 'out.png');
      const samplePdf = join(home, 'work', 'sample.pdf');
      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      writeFileSync(sampleTxt, 'hello cairn\n');
      writeFileSync(samplePng, tinyPng);

      const sipsRes = run(
        `/usr/bin/sips -s format pdf '${samplePng}' --out '${samplePdf}' && /usr/bin/sips -s format png '${samplePdf}' --out '${join(home, 'work', 'from-pdf.png')}'`,
      );
      expect(sipsRes.status, sipsRes.stderr).toBe(0);
      expect(existsSync(join(home, 'work', 'from-pdf.png'))).toBe(true);

      const textutilRes = run(
        `/usr/bin/textutil -convert html '${sampleTxt}' -output '${sampleHtml}'`,
      );
      expect(textutilRes.status, textutilRes.stderr).toBe(0);
      expect(readFileSync(sampleHtml, 'utf8')).toContain('hello cairn');

      const mdlsRes = run(`/usr/bin/mdls '${sampleTxt}'`);
      expect(mdlsRes.status, mdlsRes.stderr).toBe(0);

      const plutilRes = run(
        '/usr/bin/plutil -lint /System/Library/CoreServices/SystemVersion.plist',
      );
      expect(plutilRes.status, plutilRes.stderr).toBe(0);

      if (
        existsSync('/usr/bin/swift') &&
        spawnSync('/usr/bin/swift', ['-e', 'import PDFKit'], { timeout: 10000 }).status === 0
      ) {
        const swiftRes = run(
          `/usr/bin/swift -e 'import PDFKit; let d = PDFDocument(url: URL(fileURLWithPath: "${samplePdf}"))!; print(d.pageCount)'`,
        );
        expect(swiftRes.status, swiftRes.stderr).toBe(0);
        expect(swiftRes.stdout.trim()).toBe('1');
      }

      expect(run(`/bin/cat '${join(home, '.ssh', 'id_ed25519')}'`).status).not.toBe(0);
      expect(run(`/usr/bin/osascript -e 'return 1'`).status).not.toBe(0);
      expect(run('/usr/bin/open -h').status).not.toBe(0);
    },
  );

  test('Linux bwrap pins existing ancestors of denied credentials before leaf masks to block rename bypass', () => {
    const { root, home, serverHome } = layout();
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'bwrap'), '#!/bin/sh\n', { mode: 0o755 });
    mkdirSync(join(home, '.config', 'gh'), { recursive: true });
    writeFileSync(join(home, '.config', 'gh', 'hosts.yml'), 'secret');

    const conf = createHostShellConfinement({
      home,
      deniedRoots: [serverHome],
      platform: 'linux',
      path: binDir,
    });
    const { args } = conf.wrap('/bin/sh', ['-c', 'true']);
    const configDir = join(home, '.config');
    const ghDir = join(home, '.config', 'gh');
    const bindIdx = args.findIndex(
      (arg, i) => arg === '--bind' && args[i + 1] === configDir && args[i + 2] === configDir,
    );
    const tmpfsIdx = args.findIndex((arg, i) => arg === '--tmpfs' && args[i + 1] === ghDir);
    expect(bindIdx).toBeGreaterThan(-1);
    expect(tmpfsIdx).toBeGreaterThan(bindIdx);
  });
});
