import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as waitTimeout } from 'node:timers/promises';
import { describe, expect, test } from 'vitest';
import {
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
    expect(lines).toContain('(deny network-outbound (remote ip "localhost:8123"))');
  });

  test('limits signals and process inspection to processes inside the same sandbox', () => {
    const lines = seatbeltProfile(layout().policy).split('\n');
    const index = (line: string) => lines.indexOf(line);
    for (const operation of ['signal', 'process-info*']) {
      expect(index(`(deny ${operation})`), operation).toBeGreaterThan(-1);
      expect(index(`(deny ${operation})`), operation).toBeLessThan(
        index(`(allow ${operation} (target same-sandbox))`),
      );
    }
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
  const finderName = `osascript -e 'tell application "Finder" to get name'`;

  test('without confinement a session can drive another app through Apple Events', () => {
    const fixture = layout();
    const result = runConfined(null, finderName, fixture.worktree);
    expect(result.stdout).toContain('Finder');
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

  const outsideSentinel = 'outside-process-secret';

  function outsideProcess(): ChildProcess {
    return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      env: { ...process.env, CAIRN_PROBE_SENTINEL: outsideSentinel },
      stdio: 'ignore',
    });
  }

  function inspectAndSignal(pid: number): string {
    return `ps -E -ww -o command= -p ${pid}; kill -0 ${pid} && echo signal-delivered`;
  }

  test('without confinement a session can signal and read the environment of another process', () => {
    const fixture = layout();
    const outside = outsideProcess();
    try {
      const result = runConfined(null, inspectAndSignal(outside.pid as number), fixture.worktree);
      expect(result.stdout).toContain(outsideSentinel);
      expect(result.stdout).toContain('signal-delivered');
    } finally {
      outside.kill('SIGKILL');
    }
  });

  test('a confined session cannot signal or inspect processes outside its sandbox but manages its own', async () => {
    const fixture = layout();
    const outside = outsideProcess();
    try {
      const pid = outside.pid as number;
      const probe = runConfined(
        fixture.policy,
        `${inspectAndSignal(pid)}; kill -TERM ${pid}`,
        fixture.worktree,
      );
      expect(probe.stdout).not.toContain(outsideSentinel);
      expect(probe.stdout).not.toContain('signal-delivered');
      await waitTimeout(500);
      expect(outside.exitCode).toBeNull();
      expect(outside.signalCode).toBeNull();
      const own = runConfined(
        fixture.policy,
        [
          'sleep 30 & child=$!',
          'ps -o pid= -p $child >/dev/null && echo own-listed',
          'ps -o command= -p $$ | grep -q sh && echo self-listed',
          'kill -0 $child && echo own-signalled',
          'kill -TERM $child; wait $child; test $? -eq 143 && echo own-stopped',
        ].join('; '),
        fixture.worktree,
      );
      for (const marker of ['own-listed', 'self-listed', 'own-signalled', 'own-stopped'])
        expect(own.stdout, `${marker} in ${JSON.stringify(own.stdout + own.stderr)}`).toContain(
          marker,
        );
    } finally {
      outside.kill('SIGKILL');
    }
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

describe.runIf(process.platform === 'darwin')('seatbelt startup probe', () => {
  test('the real probe passes on this Mac', async () => {
    await expect(runSeatbeltProbe(testTempDir('seatbelt-probe-'))).resolves.toBeUndefined();
  });
});
