import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createAcpBackend } from '../src/backend/acp.js';
import { buildClaudeSdkOptions } from '../src/backend/claude-code.js';
import { createSessionConfiner } from '../src/backend/confine-session.js';
import { testTempDir } from './test-temp-dir.js';

function fixture() {
  const root = realpathSync(testTempDir('confine-session-'));
  const home = join(root, 'user');
  const serverHome = join(root, 'support', 'home');
  const runnerHome = join(root, 'support', 'runner');
  const worktree = join(runnerHome, 'workspaces', 'a');
  const skills = join(runnerHome, 'skills');
  const tempParent = join(root, 'tmp-user');
  const temp = join(tempParent, 'T');
  for (const path of [home, serverHome, worktree, skills, temp, join(runnerHome, 'claude')])
    mkdirSync(path, { recursive: true });
  writeFileSync(join(serverHome, 'token'), 'owner-secret');
  writeFileSync(join(runnerHome, 'machine.json'), 'machine-secret');
  writeFileSync(join(skills, 'skill.md'), 'skill-body');
  const confine = createSessionConfiner({
    daemonHome: runnerHome,
    extraDeniedRoots: [serverHome],
    readable: [skills],
    handoffDirectories: [],
    serverUrl: 'http://127.0.0.1:1',
    platform: 'darwin',
    home,
    environment: { TMPDIR: temp, CLAUDE_CONFIG_DIR: join(runnerHome, 'claude') },
  });
  return {
    root,
    serverHome,
    runnerHome,
    worktree,
    skills,
    confine: confine as NonNullable<typeof confine>,
  };
}

describe('session confiner', () => {
  test('is absent off macOS', () => {
    expect(
      createSessionConfiner({
        daemonHome: '/x',
        extraDeniedRoots: [],
        readable: [],
        handoffDirectories: [],
        serverUrl: 'http://127.0.0.1:1',
        platform: 'linux',
      }),
    ).toBeNull();
  });

  test('an isolated Antigravity HOME opens only that HOME and the linked sign-in file', () => {
    const { confine, worktree, runnerHome, root } = fixture();
    const home = join(root, 'user');
    const agentHome = join(runnerHome, 'homes', 'antigravity');
    const token = join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
    mkdirSync(agentHome, { recursive: true });
    mkdirSync(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
    writeFileSync(token, 't');
    const profileFor = (env: Record<string, string>) =>
      (
        confine({ cwd: worktree, env }, 'antigravity', { command: '/bin/true', args: [] })
          .args[1] as string
      )
        .split('\n')
        .find((line) => line.startsWith('(allow file-read* file-write*')) ?? '';

    const isolated = profileFor({ HOME: agentHome });
    expect(isolated).toContain(`(subpath "${realpathSync(agentHome)}")`);
    expect(isolated).toContain(`(subpath "${realpathSync(token)}")`);
    expect(isolated).not.toContain(`(subpath "${join(home, '.gemini')}")`);

    const apiKey = profileFor({ HOME: agentHome, GEMINI_API_KEY: 'AIza-step' });
    expect(apiKey).toContain(`(subpath "${realpathSync(agentHome)}")`);
    expect(apiKey).not.toContain(realpathSync(token));

    const own = profileFor({ HOME: home });
    expect(own).toContain(`(subpath "${join(home, '.gemini')}")`);
    expect(own).not.toContain(`(subpath "${realpathSync(agentHome)}")`);
  });

  test('grants only Claude Code its uid-scoped temporary directory, not the shared temp root', () => {
    const { confine, worktree } = fixture();
    const sharedTemp = realpathSync('/tmp');
    const claudeTemp = join(sharedTemp, `claude-${userInfo().uid}`);
    for (const harness of ['claude-code', 'gemini', 'pi', 'devin', 'antigravity'] as const) {
      const launch = confine({ cwd: worktree }, harness, { command: '/bin/true', args: [] });
      const writable = launch.args[1]
        ?.split('\n')
        .find((line) => line.startsWith('(allow file-write*'));
      expect(writable?.includes(`(subpath "${claudeTemp}")`)).toBe(harness === 'claude-code');
      expect(writable).not.toContain(`(subpath "${sharedTemp}")`);
      expect(writable).not.toContain(
        `(subpath "${join(sharedTemp, `claude-${userInfo().uid + 1}`)}")`,
      );
    }
  });

  test('a linked worktree re-exposes only a real worktree git dir that points back', () => {
    const { confine, worktree, root } = fixture();
    const repo = join(root, 'repo');
    const gitdir = join(repo, '.git', 'worktrees', 'a');
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, 'gitdir'), `${join(worktree, '.git')}\n`);
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`);
    const launch = confine({ cwd: worktree }, 'claude-code', {
      command: '/bin/true',
      args: [],
    });
    expect(launch.args[1]).toContain(`(subpath "${realpathSync(join(repo, '.git'))}")`);
  });

  test('a worktree git dir inside the daemon home stays exposed', () => {
    const { confine, runnerHome } = fixture();
    const repo = join(runnerHome, 'workspaces', 'p1', 'repo');
    const worktree = join(runnerHome, 'workspaces', 'p1', 'wt');
    const gitdir = join(repo, '.git', 'worktrees', 'a');
    mkdirSync(gitdir, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(gitdir, 'gitdir'), `${join(worktree, '.git')}\n`);
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`);
    const launch = confine({ cwd: worktree }, 'claude-code', {
      command: '/bin/true',
      args: [],
    });
    expect(launch.args[1]).toContain(`(subpath "${realpathSync(join(repo, '.git'))}")`);
  });

  test('a symlinked .git fails closed instead of re-exposing its target', () => {
    const { confine, runnerHome, root } = fixture();
    const target = join(runnerHome, 'tools', 'antigravity');
    mkdirSync(target, { recursive: true });
    const ws = join(root, 'ws-link');
    mkdirSync(ws, { recursive: true });
    symlinkSync(target, join(ws, '.git'));
    expect(() => confine({ cwd: ws }, 'claude-code', { command: '/bin/true', args: [] })).toThrow(
      'Unsafe confinement',
    );
  });

  test('a crafted .git pointer cannot re-expose denied or arbitrary directories', () => {
    const { confine, runnerHome, root } = fixture();
    const target = join(runnerHome, 'tools', 'antigravity');
    mkdirSync(target, { recursive: true });

    const cases: Array<{ name: string; setup: (dir: string) => void; exposed: string }> = [
      {
        name: 'gitdir pointer to a non-worktree path',
        setup: (dir) => writeFileSync(join(dir, '.git'), `gitdir: ${target}\n`),
        exposed: join(runnerHome, 'tools'),
      },
      {
        name: 'worktree-shaped gitdir with no back-pointer',
        setup: (dir) => {
          const fake = join(root, 'other', '.git', 'worktrees', 'a');
          mkdirSync(fake, { recursive: true });
          writeFileSync(join(dir, '.git'), `gitdir: ${fake}\n`);
        },
        exposed: join(root, 'other'),
      },
    ];

    for (const [index, entry] of cases.entries()) {
      const ws = join(root, `ws-${index}`);
      mkdirSync(ws, { recursive: true });
      entry.setup(ws);
      const launch = confine({ cwd: ws }, 'claude-code', { command: '/bin/true', args: [] });
      const profile = launch.args[1] as string;
      expect(profile, entry.name).not.toContain(`(subpath "${entry.exposed}`);
    }
  });

  test('wraps the ACP adapter launch', async () => {
    const { confine, worktree } = fixture();
    const launches: string[][] = [];
    const backend = createAcpBackend({
      harness: 'claude-code',
      command: '/bin/true',
      confine,
      spawnProcess: (command, args) => {
        launches.push([command, ...args]);
        throw new Error('stop after recording');
      },
    });
    await expect(
      backend.createSession({
        provider: { providerId: 'x' } as never,
        modelId: 'm',
        cwd: worktree,
      }),
    ).rejects.toThrow('stop after recording');
    expect(launches[0]?.[0]).toBe('/usr/bin/sandbox-exec');
    expect(launches[0]?.[1]).toBe('-p');
    expect(launches[0]?.at(-1)).toBe('/bin/true');
  });
});

describe.runIf(process.platform === 'darwin')('claude spawn seam on macOS', () => {
  test('can create Claude background output while sibling temporary paths remain unwritable', () => {
    const { confine, worktree, runnerHome, root } = fixture();
    const claudeTemp = join(realpathSync('/tmp'), `claude-${userInfo().uid}`);
    const sibling = `${claudeTemp}-cairn-denied-${process.pid}`;
    const script = `
      const fs = require('node:fs');
      const directory = ${JSON.stringify(join(claudeTemp, basename(root)))};
      fs.mkdirSync(directory);
      try {
        fs.writeFileSync(directory + '/output', 'background-ok');
        process.stdout.write(fs.readFileSync(directory + '/output', 'utf8'));
        for (const path of ${JSON.stringify([sibling, join(runnerHome, 'denied')])}) {
          try { fs.mkdirSync(path); process.exitCode = 1; }
          catch (error) { if (error.code !== 'EPERM') throw error; }
        }
      } finally { fs.rmSync(directory, { recursive: true }); }
    `;
    const launch = confine({ cwd: worktree }, 'claude-code', {
      command: process.execPath,
      args: ['-e', script],
    });
    expect(execFileSync(launch.command, launch.args, { encoding: 'utf8' })).toBe('background-ok');
    const otherHarness = confine({ cwd: worktree }, 'gemini', {
      command: process.execPath,
      args: ['-e', script],
    });
    expect(() =>
      execFileSync(otherHarness.command, otherHarness.args, { stdio: 'pipe' }),
    ).toThrow();
  });

  test('a session started through the seam cannot read the tokens and can read skills', async () => {
    const { confine, worktree, serverHome, runnerHome, skills } = fixture();
    const options = buildClaudeSdkOptions({
      cwd: worktree,
      modelId: 'm',
      resumeId: null,
      sessionId: 's',
      disallowedTools: [],
      inOrb: false,
      lockedDown: false,
      mcpServers: {},
      confine: (launch) => confine({ cwd: worktree }, 'claude-code', launch),
      abortController: new AbortController(),
    });
    const spawnSession = options.spawnClaudeCodeProcess;
    expect(spawnSession).toBeDefined();
    const run = (script: string) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = (spawnSession as NonNullable<typeof spawnSession>)({
          command: '/bin/sh',
          args: ['-c', script],
          cwd: worktree,
          env: {},
          signal: new AbortController().signal,
        });
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.once('exit', (code) => setTimeout(() => resolve({ code, out }), 50));
      });
    for (const command of [
      `cat '${join(serverHome, 'token')}'`,
      `cat '${join(runnerHome, 'machine.json')}'`,
    ]) {
      const result = await run(command);
      expect(result.code, command).not.toBe(0);
      expect(result.out).not.toContain('secret');
    }
    expect((await run(`cat '${join(skills, 'skill.md')}'`)).out).toContain('skill-body');
    expect((await run(`echo ok > '${join(worktree, 'f')}' && echo done`)).out).toContain('done');
  });

  test('a sandboxed session can write the report handoff directory and the system temp directory', () => {
    const { root, runnerHome, worktree } = fixture();
    const reportsDir = join(runnerHome, 'reports');
    const systemTemp = join(root, 'system-user', 'T');
    mkdirSync(systemTemp, { recursive: true });
    const confine = createSessionConfiner({
      daemonHome: runnerHome,
      extraDeniedRoots: [],
      readable: [],
      handoffDirectories: [reportsDir],
      serverUrl: 'http://127.0.0.1:1',
      platform: 'darwin',
      home: join(root, 'user'),
      systemTempDirectory: systemTemp,
      environment: { TMPDIR: join(root, 'tmp-user', 'T') },
    }) as NonNullable<ReturnType<typeof createSessionConfiner>>;
    const reportFile = join(reportsDir, 'report.md');
    const tempFile = join(systemTemp, 'shell.log');
    const launch = confine({ cwd: worktree, env: {} }, 'claude-code', {
      command: '/bin/sh',
      args: ['-c', `echo a > '${reportFile}' && echo a > '${tempFile}'`],
    });
    expect(() => execFileSync(launch.command, launch.args, { stdio: 'pipe' })).not.toThrow();
  });

  test('the pi profile exposes only its own state and keeps the same denied roots', () => {
    const { confine, worktree, runnerHome, serverHome } = fixture();
    const agentDir = join(runnerHome, 'homes', 'pi');
    const privateDirectory = join(runnerHome, 'chat-sessions', 'host-x');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(privateDirectory, { recursive: true });
    const launch = confine({ cwd: worktree, env: {} }, 'pi', { command: '/bin/true', args: [] }, [
      agentDir,
      privateDirectory,
    ]);
    const profile = launch.args[1] as string;
    expect(profile).toContain(`(subpath "${realpathSync(agentDir)}")`);
    expect(profile).toContain(`(subpath "${realpathSync(privateDirectory)}")`);
    expect(profile).toContain(`(subpath "${realpathSync(serverHome)}")`);
    expect(profile).toContain(`(subpath "${realpathSync(runnerHome)}")`);
    expect(profile).not.toContain(`(subpath "${realpathSync(join(runnerHome, 'chat-sessions'))}")`);
    expect(profile).toContain('(allow file-read-metadata (literal');
  });

  test.runIf(process.platform === 'darwin')(
    'antigravity grants read-only Library/Keychains only without an API key and keeps Keychains denied for all other harnesses',
    () => {
      const { root, runnerHome, worktree, serverHome } = fixture();
      const home = join(root, 'user');
      const keychains = join(home, 'Library', 'Keychains');
      mkdirSync(keychains, { recursive: true });
      writeFileSync(join(keychains, 'login.keychain-db'), 'kc-secret');
      const confine = createSessionConfiner({
        daemonHome: runnerHome,
        extraDeniedRoots: [serverHome],
        readable: [],
        handoffDirectories: [],
        serverUrl: 'http://127.0.0.1:1',
        platform: 'darwin',
        home,
        environment: { TMPDIR: join(root, 'tmp-user', 'T') },
      }) as NonNullable<ReturnType<typeof createSessionConfiner>>;

      const agLaunch = confine({ cwd: worktree, env: {} }, 'antigravity', {
        command: '/bin/sh',
        args: ['-c', `cat '${join(keychains, 'login.keychain-db')}'`],
      });
      expect(execFileSync(agLaunch.command, agLaunch.args, { encoding: 'utf8' })).toBe('kc-secret');

      const agWrite = confine({ cwd: worktree, env: {} }, 'antigravity', {
        command: '/bin/sh',
        args: ['-c', `echo write > '${join(keychains, 'tamper')}'`],
      });
      expect(() => execFileSync(agWrite.command, agWrite.args, { stdio: 'pipe' })).toThrow();

      const agIsolated = confine(
        { cwd: worktree, env: { GEMINI_API_KEY: 'AIza-step' } },
        'antigravity',
        {
          command: '/bin/sh',
          args: ['-c', `cat '${join(keychains, 'login.keychain-db')}'`],
        },
      );
      expect(() => execFileSync(agIsolated.command, agIsolated.args, { stdio: 'pipe' })).toThrow();

      for (const other of ['claude-code', 'devin', 'gemini', 'pi'] as const) {
        const denied = confine({ cwd: worktree, env: {} }, other, {
          command: '/bin/sh',
          args: ['-c', `cat '${join(keychains, 'login.keychain-db')}'`],
        });
        expect(() => execFileSync(denied.command, denied.args, { stdio: 'pipe' })).toThrow();
      }
    },
  );
});
