import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
        serverUrl: 'http://127.0.0.1:1',
        platform: 'linux',
      }),
    ).toBeNull();
  });

  test('wraps the ACP adapter launch for codex and gemini', async () => {
    const { confine, worktree } = fixture();
    const launches: string[][] = [];
    const backend = createAcpBackend({
      harness: 'codex',
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

  test('the pi profile exposes only its own state and keeps the same denied roots', () => {
    const { confine, worktree, runnerHome, serverHome } = fixture();
    const agentDir = join(runnerHome, 'agent-runtime');
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
});
