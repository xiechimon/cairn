import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ESCAPE_BINARIES,
  runSeatbeltProbe,
  type SeatbeltPolicy,
  seatbeltCommand,
  seatbeltProfile,
} from '../src/backend/confine-seatbelt.js';
import { testTempDir } from './test-temp-dir.js';

interface Layout {
  root: string;
  policy: SeatbeltPolicy;
  token: string;
  machine: string;
  database: string;
  sibling: string;
  worktree: string;
  escape: string;
}

function layout(serverPort?: number): Layout {
  const root = realpathSync(testTempDir('seatbelt-'));
  const home = join(root, 'user');
  const serverHome = join(root, 'support', 'home');
  const runnerHome = join(root, 'support', 'runner');
  const worktree = join(runnerHome, 'workspaces', 'a');
  const sibling = join(runnerHome, 'workspaces', 'b');
  const gitDirectory = join(runnerHome, 'workspaces', 'repo.git');
  const state = join(runnerHome, 'claude');
  const taskTemp = join(root, 'temp');
  for (const path of [
    home,
    join(serverHome, 'server'),
    worktree,
    sibling,
    join(gitDirectory, 'hooks'),
    state,
    taskTemp,
    join(home, '.cache'),
    join(home, '.ssh'),
  ])
    mkdirSync(path, { recursive: true });
  const token = join(serverHome, 'token');
  const machine = join(runnerHome, 'machine.json');
  const database = join(serverHome, 'server', 'server.db');
  for (const path of [token, machine, database, join(sibling, 'file'), join(home, '.ssh', 'key')])
    writeFileSync(path, 'secret');
  writeFileSync(join(gitDirectory, 'config'), 'protected');
  return {
    root,
    token,
    machine,
    database,
    sibling,
    worktree,
    escape: join(root, 'escape'),
    policy: {
      home,
      daemonHome: runnerHome,
      deniedRoots: [serverHome, runnerHome],
      workspace: worktree,
      gitDirectories: [gitDirectory],
      taskTemp,
      state: [state],
      caches: [join(home, '.cache')],
      ...(serverPort !== undefined ? { serverPort } : {}),
    },
  };
}

function runConfined(policy: SeatbeltPolicy | null, script: string, cwd: string) {
  const argv = ['-c', script, 'probe'];
  const launch =
    policy === null ? { command: '/bin/sh', args: argv } : seatbeltCommand(policy, '/bin/sh', argv);
  return spawnSync(launch.command, launch.args, { cwd, encoding: 'utf8' });
}

describe('seatbelt profile', () => {
  test('orders denied roots before narrow re-allows and protected files last', () => {
    const { policy, worktree } = layout(8123);
    const lines = seatbeltProfile(policy).split('\n');
    const index = (needle: string) => lines.findIndex((line) => line.includes(needle));
    expect(index('(deny file-read* file-write*')).toBeLessThan(
      index(`(allow file-read* file-write* (subpath "${worktree}")`),
    );
    expect(index('(allow file-read* file-write*')).toBeLessThan(index('/repo.git/config'));
    expect(lines).toContain('(deny network-outbound (remote tcp "localhost:8123"))');
    expect(lines).toContain('(deny network-inbound (local tcp "*:8123"))');
    expect(lines).toContain('(deny network-bind (local tcp "*:8123"))');
    const socketLines = lines.filter((line) =>
      line.startsWith('(deny network-outbound (remote unix-socket'),
    );
    expect(socketLines.length).toBeGreaterThan(1);
    expect(
      socketLines.every((line) => (line.match(/\((subpath|literal|regex)/g) ?? []).length === 1),
    ).toBe(true);
    expect(socketLines).toContain(
      '(deny network-outbound (remote unix-socket (literal "/var/run/docker.sock")))',
    );
    expect(lines).toContain(
      '(deny mach-lookup (global-name-prefix "com.apple.windowserver") (global-name-prefix "com.apple.hiservices") (global-name-prefix "com.apple.pasteboard"))',
    );
    expect(lines).toContain('(deny mach-bootstrap)');
    expect(
      lines.some((line) => line.includes('(deny process-exec (literal "/bin/launchctl")')),
    ).toBe(true);
    expect(lines).toContain(
      '(deny mach-lookup (global-name-prefix "com.apple.securityd") (global-name-prefix "com.apple.SecurityServer") (global-name-prefix "com.apple.secd") (global-name-prefix "com.apple.trustd"))',
    );
    const keyed = seatbeltProfile({ ...policy, allowKeychainServices: true });
    expect(keyed).not.toContain('com.apple.secd');
  });

  test.runIf(process.platform === 'darwin')(
    'every denied escape binary exists on this platform',
    () => {
      for (const binary of ESCAPE_BINARIES) {
        expect(existsSync(binary), binary).toBe(true);
      }
    },
  );

  test('denies the server port for every host and re-denies credentials under a readable carve-out', () => {
    const { policy } = layout();
    const remote = seatbeltProfile({
      ...policy,
      serverPort: 443,
    });
    expect(remote).toContain('(deny network-outbound (remote tcp "localhost:443"))');
    expect(remote).toContain('(deny network-outbound (remote tcp "*:443"))');
    const home = policy.home;
    const readableDir = join(home, '.config', 'git');
    const credentials = join(readableDir, 'credentials');
    mkdirSync(readableDir, { recursive: true });
    const carved = seatbeltProfile({
      ...policy,
      readable: [readableDir],
      postReadableDenies: [credentials],
    });
    const lines = carved.split('\n');
    const allowIndex = lines.findIndex((line) => line.includes(`(subpath "${readableDir}")`));
    const denyIndex = lines.findIndex((line) => line.includes(`(subpath "${credentials}")`));
    expect(allowIndex).toBeGreaterThanOrEqual(0);
    expect(denyIndex).toBeGreaterThan(allowIndex);
    expect(carved).toContain(`(deny file-read* file-write* (subpath "${credentials}")`);
    expect(carved).toContain(
      `(remote unix-socket (literal "${join(home, 'Library', 'Group Containers', '2BUA8C4S2C.com.1password', 't', 'agent.sock')}"))`,
    );
  });

  test('denied paths resolve symlinks instead of failing the whole profile', () => {
    const { policy, root } = layout();
    const home = policy.home;
    const target = join(root, 'dotfiles', 'zshrc');
    mkdirSync(join(root, 'dotfiles'), { recursive: true });
    writeFileSync(target, 'export SECRET=1\n');
    symlinkSync(target, join(home, '.zshrc'));
    const profile = seatbeltProfile(policy);
    expect(profile).toContain(`(literal "${join(home, '.zshrc')}")`);
    expect(profile).toContain(`(literal "${target}")`);
  });

  test('a denied path resolving inside a readable dir is re-denied after the allow', () => {
    const { policy, root } = layout();
    const home = policy.home;
    const sshTarget = join(home, '.config', 'git', 'ssh');
    mkdirSync(sshTarget, { recursive: true });
    rmSync(join(home, '.ssh'), { force: true, recursive: true });
    symlinkSync(join('.config', 'git', 'ssh'), join(home, '.ssh'));
    const readableDir = join(home, '.config', 'git');
    const profile = seatbeltProfile({ ...policy, readable: [readableDir] });
    const lines = profile.split('\n');
    const allowIndex = lines.findIndex((line) => line.includes(`(subpath "${readableDir}")`));
    const postDenyIndex = lines.indexOf(`(deny file-read* file-write* (subpath "${sshTarget}"))`);
    expect(allowIndex).toBeGreaterThanOrEqual(0);
    expect(postDenyIndex, profile).toBeGreaterThan(allowIndex);
    expect(root).toBeTruthy();
  });

  test('a readable dir equal to a denied path is refused unless explicitly allowed', () => {
    const { policy, root } = layout();
    const home = policy.home;
    const sshDir = join(home, '.ssh');
    mkdirSync(sshDir, { recursive: true });
    expect(() => seatbeltProfile({ ...policy, readable: [sshDir] })).toThrow(
      'Unsafe confinement readable overlap',
    );
    const elsewhere = join(root, 'dotfiles');
    mkdirSync(elsewhere, { recursive: true });
    rmSync(sshDir, { recursive: true, force: true });
    symlinkSync(elsewhere, sshDir);
    expect(() => seatbeltProfile({ ...policy, readable: [sshDir] })).toThrow(
      'Unsafe confinement readable overlap',
    );
    const carved = seatbeltProfile({
      ...policy,
      readable: [sshDir],
      readableDeniedAllowed: [sshDir, elsewhere],
    });
    expect(carved).toContain(`(subpath "${elsewhere}")`);
  });

  test('a readable symlink to a safe target emits the resolved variant too', () => {
    const { policy, root } = layout();
    const home = policy.home;
    const target = join(root, 'dotfiles', 'git');
    mkdirSync(target, { recursive: true });
    mkdirSync(join(home, '.config'), { recursive: true });
    const link = join(home, '.config', 'git');
    rmSync(link, { recursive: true, force: true });
    symlinkSync(target, link);
    const profile = seatbeltProfile({ ...policy, readable: [link] });
    expect(profile).toContain(`(subpath "${link}")`);
    expect(profile).toContain(`(subpath "${target}")`);
  });

  test('post-readable denies reach the resolved parent under a symlinked root', () => {
    const { policy, root } = layout();
    const home = policy.home;
    const configTarget = join(root, 'cfgdir');
    mkdirSync(join(configTarget, 'git'), { recursive: true });
    symlinkSync(configTarget, join(home, '.config'));
    const credentials = join(home, '.config', 'git', 'credentials');
    const profile = seatbeltProfile({
      ...policy,
      readable: [join(home, '.config', 'git')],
      postReadableDenies: [credentials],
    });
    expect(profile).toContain(`(subpath "${join(configTarget, 'git')}")`);
    expect(profile).toContain(`(subpath "${join(configTarget, 'git', 'credentials')}")`);
  });

  test('rejects a cache that overlaps a denied root and unsafe paths', () => {
    const { policy } = layout();
    expect(() => seatbeltProfile({ ...policy, caches: [policy.deniedRoots[0] as string] })).toThrow(
      'Unsafe confinement cache overlap',
    );
    expect(() => seatbeltProfile({ ...policy, serverPort: 70000 })).toThrow('Invalid server port');
  });

  test('rejects a non-state writable equal to or inside a denied path', () => {
    const { policy, root } = layout();
    const deniedRoot = policy.deniedRoots[0] as string;
    expect(() => seatbeltProfile({ ...policy, gitDirectories: [deniedRoot] })).toThrow(
      'Unsafe confinement overlap',
    );
    const deniedInner = join(deniedRoot, 'inner');
    mkdirSync(deniedInner, { recursive: true });
    expect(() => seatbeltProfile({ ...policy, gitDirectories: [deniedInner] })).toThrow(
      'Unsafe confinement overlap',
    );
    const deniedHomeDir = join(policy.home, '.ssh');
    expect(() => seatbeltProfile({ ...policy, gitDirectories: [deniedHomeDir] })).toThrow(
      'Unsafe confinement overlap',
    );
    const insideDaemon = join(policy.daemonHome as string, 'repos', 'main.git');
    mkdirSync(insideDaemon, { recursive: true });
    expect(() => seatbeltProfile({ ...policy, gitDirectories: [insideDaemon] })).not.toThrow();
    const state = join(root, 'claude.json');
    writeFileSync(state, '{}');
    expect(() => seatbeltProfile({ ...policy, state: [state] })).not.toThrow();
  });

  test('denies writes to git redirect metadata in the exposed git dir', () => {
    const { policy } = layout();
    const git = policy.gitDirectories[0] as string;
    const profile = seatbeltProfile(policy);
    for (const name of ['commondir', 'gitdir', 'rebase-merge', 'rebase-apply', 'sequencer']) {
      expect(profile, name).toContain(`(subpath "${join(git, name)}")`);
    }
    expect(profile).toContain(`${git.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&')}/(worktrees|modules)`);
    expect(profile).toContain(
      `${git.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&')}/(worktrees|modules)(/[^/]+)?$`,
    );
  });
});

describe.runIf(process.platform === 'darwin')('seatbelt session probe', () => {
  const finderName = `osascript -e 'tell application "Finder" to get name of every window'`;

  test('without confinement a session can drive another app through Apple Events', () => {
    const fixture = layout();
    const result = runConfined(null, finderName, fixture.worktree);
    expect(result.status).toBe(0);
  });

  test('a confined session cannot start or script an unsandboxed app', () => {
    const fixture = layout();
    const launch = seatbeltCommand(fixture.policy, '/bin/sh', ['-c', finderName]);
    const events = spawnSync(launch.command, launch.args, {
      cwd: fixture.worktree,
      encoding: 'utf8',
      timeout: 4000,
    });
    expect(events.stdout).not.toContain('Finder');
    expect(events.status).not.toBe(0);
    const open = runConfined(fixture.policy, 'open -a TextEdit', fixture.worktree);
    expect(open.status).not.toBe(0);
  }, 20000);

  test('a confined session cannot restage git worktree or module trees by renaming the container names', () => {
    const fixture = layout();
    const git = fixture.policy.gitDirectories[0] as string;
    mkdirSync(join(git, 'worktrees', 'wt1'), { recursive: true });
    writeFileSync(join(git, 'worktrees', 'wt1', 'commondir'), '../..');
    mkdirSync(join(fixture.worktree, 'staged', 'wt1'), { recursive: true });
    writeFileSync(join(fixture.worktree, 'staged', 'wt1', 'commondir'), 'planted');
    const open = runConfined(
      fixture.policy,
      [
        `mv '${git}/worktrees' '${git}/orig' && exit 9`,
        `mv '${fixture.worktree}/staged' '${git}/worktrees' && exit 8`,
        `ln -s '${fixture.worktree}' '${git}/modules' && exit 7`,
        `mkdir '${git}/modules' && exit 6`,
        `test "$(cat '${git}/worktrees/wt1/commondir')" = '../..'`,
      ].join('; '),
      fixture.worktree,
    );
    expect(open.status).toBe(0);
  }, 20000);

  test('a denied path resolved into a readable dir stays unreadable inside the profile', () => {
    const fixture = layout();
    const home = fixture.policy.home;
    const sshTarget = join(home, '.config', 'git', 'ssh');
    mkdirSync(sshTarget, { recursive: true });
    writeFileSync(join(sshTarget, 'id_rsa'), 'secret');
    rmSync(join(home, '.ssh'), { force: true, recursive: true });
    symlinkSync(join('.config', 'git', 'ssh'), join(home, '.ssh'));
    const policy = { ...fixture.policy, readable: [join(home, '.config', 'git')] };
    for (const command of [
      `cat '${join(home, '.ssh', 'id_rsa')}'`,
      `cat '${join(sshTarget, 'id_rsa')}'`,
      `ls '${join(sshTarget)}'`,
    ]) {
      const outcome = runConfined(policy, command, fixture.worktree);
      expect(outcome.status, command).not.toBe(0);
      expect(outcome.stdout, command).not.toContain('secret');
    }
    const listing = runConfined(policy, `ls '${join(home, '.config', 'git')}'`, fixture.worktree);
    expect(listing.status).toBe(0);
  });

  test('without confinement a session reads the owner token and edits the database', () => {
    const fixture = layout();
    const result = runConfined(
      null,
      `cat '${fixture.token}' && echo x >> '${fixture.database}' && echo ok`,
      fixture.worktree,
    );
    expect(result.stdout).toContain('secret');
    expect(result.status).toBe(0);
  });

  test('a confined session cannot read or write Cairn state and can work in its worktree', async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(request.url ?? '');
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const fixture = layout(port);
      const bypassScript = join(fixture.worktree, 's.sh');
      const failures = [
        `cat '${fixture.token}'`,
        `cat '${fixture.machine}'`,
        `sqlite3 '${fixture.database}' 'create table t(a)'`,
        `ls '${fixture.sibling}'`,
        `cat '${join(fixture.policy.home, '.ssh', 'key')}'`,
        `echo x > '${fixture.escape}'`,
        `curl -s -m 3 http://127.0.0.1:${port}/api/leak`,
        `echo x > '${join(fixture.policy.gitDirectories[0] as string, 'config')}'`,
      ];
      for (const command of failures) {
        const outcome = runConfined(fixture.policy, command, fixture.worktree);
        expect(outcome.status, command).not.toBe(0);
        expect(outcome.stdout, command).not.toContain('secret');
      }
      const bypass = runConfined(
        fixture.policy,
        `printf '#!/bin/sh\\ncat ${fixture.token}\\n' > '${bypassScript}' && chmod +x '${bypassScript}' && '${bypassScript}'`,
        fixture.worktree,
      );
      expect(bypass.status).not.toBe(0);
      expect(bypass.stdout).not.toContain('secret');
      expect(received).toEqual([]);
      const work = runConfined(
        fixture.policy,
        `echo built > '${join(fixture.worktree, 'out.txt')}' && echo y > '${join(fixture.policy.taskTemp, 't')}'`,
        fixture.worktree,
      );
      expect(work.status).toBe(0);
      expect(readFileSync(join(fixture.worktree, 'out.txt'), 'utf8')).toBe('built\n');
    } finally {
      server.close();
    }
  });
});

describe.runIf(process.platform === 'darwin')('seatbelt hardening probes', () => {
  test('a confined session cannot read any entry in the expanded deny inventory', () => {
    const fixture = layout();
    const home = fixture.policy.home;
    const entries = [
      join(home, '.config', 'gh', 'hosts.yml'),
      join(home, '.config', 'opencode', 'config.json'),
      join(home, '.npmrc'),
      join(home, '.zshrc'),
      join(home, '.zsh_history'),
      join(home, '.cargo', 'credentials.toml'),
      join(home, '.pypirc'),
      join(home, '.local', 'share', 'devin', 'sessions', 'token'),
      join(home, '.local', 'share', 'fish', 'fish_history'),
      join(home, '.cache', 'huggingface', 'token'),
      join(home, '.m2', 'settings.xml'),
      join(home, 'Library', 'pnpm', 'rc', '.npmrc'),
      join(home, 'Library', 'Keychains', 'login.keychain-db'),
      join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies'),
      join(home, 'Library', 'Application Support', 'Chromium', 'Default', 'Login Data'),
      join(home, 'Library', 'Application Support', 'Firefox', 'profiles.ini'),
      join(home, 'Library', 'Application Support', 'Claude', 'session.json'),
      join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
      join(home, 'Library', 'Application Support', '@cairn', 'desktop', 'Cache', 'data'),
      join(home, 'Library', 'Safari', 'History.db'),
      join(home, 'Library', 'Cookies', 'Cookies.binarycookies'),
      join(home, 'Library', 'Mail', 'envelope'),
      join(home, 'Library', 'Messages', 'chat.db'),
    ];
    for (const path of entries) {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'secret');
    }
    const policy = {
      ...fixture.policy,
      deniedRoots: [...fixture.policy.deniedRoots, join(home, '.config')],
    };
    for (const path of entries) {
      const outcome = runConfined(policy, `cat '${path}'`, fixture.worktree);
      expect(outcome.status, path).not.toBe(0);
      expect(outcome.stdout, path).not.toContain('secret');
      const write = runConfined(policy, `echo x >> '${path}'`, fixture.worktree);
      expect(write.status, `write ${path}`).not.toBe(0);
    }
    const work = runConfined(
      policy,
      `echo ok > '${join(fixture.worktree, 'ok')}'`,
      fixture.worktree,
    );
    expect(work.status).toBe(0);
  });

  test('a confined session cannot signal or inspect outside processes, and its own children still work', () => {
    const fixture = layout();
    const outside = spawn('/bin/sleep', ['30']);
    try {
      const probe = runConfined(
        fixture.policy,
        [
          `kill -0 ${outside.pid} 2>/dev/null && exit 9`,
          'sleep 0.2 & child=$!; wait $child || exit 8',
          'kill -0 $$ || exit 7',
          'echo probe-done',
        ].join('; '),
        fixture.worktree,
      );
      expect(probe.status).toBe(0);
      expect(probe.stdout).toBe('probe-done\n');
      const signal = runConfined(
        fixture.policy,
        `kill -9 ${outside.pid} 2>/dev/null; echo kill-rc=$?`,
        fixture.worktree,
      );
      expect(signal.stdout).toContain('kill-rc=1');
      const info = runConfined(
        fixture.policy,
        `ps -p ${outside.pid} -o pid= 2>/dev/null; echo ps-rc=$?`,
        fixture.worktree,
      );
      expect(info.stdout).toContain('ps-rc=1');
    } finally {
      outside.kill('SIGKILL');
    }
  });

  test('the kern.procargs2 env channel stays open as the documented residual', () => {
    const fixture = layout();
    const python = ['/usr/bin/python3', '/opt/homebrew/bin/python3'].find(
      (path) => spawnSync(path, ['-c', 'pass']).status === 0,
    );
    if (python === undefined) return;
    const outside = spawn('/bin/sleep', ['30']);
    try {
      const script = join(fixture.worktree, 'procargs2.py');
      writeFileSync(
        script,
        [
          'import ctypes, sys',
          "libc = ctypes.CDLL('libSystem.B.dylib')",
          `name = (ctypes.c_int * 3)(1, 49, ${outside.pid})`,
          'size = ctypes.c_size_t(0)',
          'rc = libc.sysctl(name, 3, None, ctypes.byref(size), None, 0)',
          'sys.exit(0 if rc == 0 and size.value > 0 else 1)',
        ].join('\n'),
      );
      const confined = runConfined(fixture.policy, `${python} '${script}'`, fixture.worktree);
      expect(confined.status, confined.stderr).toBe(0);
    } finally {
      outside.kill('SIGKILL');
    }
  });

  test('a symlinked denied dotfile stays denied through both names', () => {
    const fixture = layout();
    const home = fixture.policy.home;
    const target = join(fixture.root, 'dotfiles', 'zshrc');
    mkdirSync(join(fixture.root, 'dotfiles'), { recursive: true });
    writeFileSync(target, 'export SECRET=1\n');
    symlinkSync(target, join(home, '.zshrc'));
    for (const path of [join(home, '.zshrc'), target]) {
      const outcome = runConfined(fixture.policy, `cat '${path}'`, fixture.worktree);
      expect(outcome.status, path).not.toBe(0);
      expect(outcome.stdout, path).not.toContain('SECRET');
    }
  });

  test('keychain reads fail closed while TLS validation still works', () => {
    const fixture = layout();
    const generic = runConfined(
      fixture.policy,
      `security find-generic-password -s cairn-probe-does-not-exist 2>&1 | head -3`,
      fixture.worktree,
    );
    expect(generic.stdout).toMatch(/Operation not permitted|could not be found|not found/i);
    const system = runConfined(
      fixture.policy,
      `security find-generic-password -s probe /Library/Keychains/System.keychain 2>&1 | head -3`,
      fixture.worktree,
    );
    expect(system.stdout).not.toContain('password:');
    const tls = runConfined(
      fixture.policy,
      `curl -sS -o /dev/null -m 8 -w '%{http_code}' https://github.com`,
      fixture.worktree,
    );
    expect(tls.stdout.trim(), tls.stderr).toMatch(/^(2|3|4)\d\d$/);
  }, 20000);
});

describe.runIf(process.platform === 'darwin')('seatbelt startup probe', () => {
  test('the real probe passes on this Mac', async () => {
    await expect(runSeatbeltProbe(testTempDir('seatbelt-probe-'))).resolves.toBeUndefined();
  });

  test('a probe directory containing a single quote still probes correctly', async () => {
    const directory = join(testTempDir('seatbelt-probe-'), "it's-here");
    mkdirSync(directory, { recursive: true });
    await expect(runSeatbeltProbe(directory)).resolves.toBeUndefined();
  });
});
