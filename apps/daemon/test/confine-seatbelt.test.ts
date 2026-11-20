import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
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
