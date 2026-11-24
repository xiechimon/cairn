import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundGitCredentials } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { ensureDaemonShellEnv } from '../src/shell-env.js';
import { prependFailedSetupHookContext } from '../src/step-prompt.js';
import {
  HOOK_OUTPUT_CHAR_LIMIT,
  runWorkspaceHook,
  WorkspaceHookError,
} from '../src/workspace-hooks.js';
import { stubOutInheritedGitConfig } from './git-config-env.js';
import { testTempDir } from './test-temp-dir.js';

const CREDS: BoundGitCredentials = {
  username: 'x-access-token',
  password: 'step-token-secret',
  url: 'https://github.com/o/r.git',
};

function tmpRoot(): string {
  return testTempDir('cairn-hook-');
}

function writeHook(dir: string, name: string, body: string, opts: { exec?: boolean } = {}): string {
  const agentsDir = join(dir, '.agents');
  mkdirSync(agentsDir, { recursive: true });
  const path = join(agentsDir, name);
  writeFileSync(path, body);
  if (opts.exec !== false) chmodSync(path, 0o755);
  return path;
}

function writeHookNonExec(dir: string, name: string, body: string): string {
  return writeHook(dir, name, body, { exec: false });
}

function isGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(') ') + 2).startsWith('Z');
  } catch {
    return false;
  }
}

async function assertDead(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (isGone(pid)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`pid ${pid} still alive after group kill`);
}

describe('workspace hook primitive (#1149)', () => {
  test('failure mode 1: hook file missing → null (silent skip, zero processes, zero logs)', async () => {
    const root = tmpRoot();
    const log: string[] = [];
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 10_000,
      log: (l) => log.push(l),
    });
    expect(note).toBeNull();
    expect(log).toEqual([]);
  });

  test('failure mode 2: exit 0 → ok note, stdout captured', async () => {
    const root = tmpRoot();
    writeHook(root, 'setup', '#!/bin/sh\necho hello-setup-marker\n');
    const log: string[] = [];
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 30_000,
      log: (l) => log.push(l),
    });
    expect(note).not.toBeNull();
    expect(note!.name).toBe('setup');
    expect(note!.status).toBe('ok');
    expect(note!.exitCode).toBe(0);
    expect(note!.output).toContain('hello-setup-marker');
    expect(log.some((l) => l.startsWith('setup hook: running'))).toBe(true);
    expect(log.some((l) => l.includes('ok (') && l.startsWith('setup hook:'))).toBe(true);
  });

  test('failure mode 3: exit 1 → throws WorkspaceHookError, message carries the exit code and stderr tail', async () => {
    const root = tmpRoot();
    writeHook(root, 'setup', '#!/bin/sh\necho some-stdout\necho boom-setup-stderr >&2\nexit 1\n');
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 30_000,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('.agents/setup');
    expect(err!.message).toContain('exited 1');
    expect(err!.message).toContain('boom-setup-stderr');
    expect(err!.note.status).toBe('failed');
    expect(err!.note.exitCode).toBe(1);
    expect(err!.note.output).toContain('boom-setup-stderr');
  });

  test('failure mode 4: timeout → the whole process group is killed (hung grandchildren all die) + timeout-shaped error', async () => {
    const root = tmpRoot();
    const pidFile = join(root, 'grandchild-pid.txt');
    writeHook(root, 'setup', `#!/bin/sh\nsleep 5 &\necho $! > ${pidFile}\nwait\n`);
    const started = Date.now();
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 1_000,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('timed out');
    expect(Date.now() - started).toBeLessThan(3_000);
    const grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    expect(grandchild).toBeGreaterThan(0);
    await assertDead(grandchild);
  }, 15_000);

  test('failure mode 5: non-executable file → clear error (no silent skip)', async () => {
    const root = tmpRoot();
    writeHookNonExec(root, 'setup', '#!/bin/sh\necho nope\n');
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 10_000,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('not executable');
    expect(err!.message).toContain('chmod +x');
  });

  test('failure mode 5b: .agents/setup is a directory → clear error', async () => {
    const root = tmpRoot();
    mkdirSync(join(root, '.agents', 'setup'), { recursive: true });
    const err = (await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 10_000,
      log: () => {},
    }).catch((e: unknown) => e)) as WorkspaceHookError;
    expect(err).toBeInstanceOf(WorkspaceHookError);
    expect(err!.message).toContain('not a regular file');
  });

  test('failure mode 6: output truncated at the limit (memory gate)', async () => {
    const root = tmpRoot();
    writeHook(root, 'setup', '#!/bin/sh\nhead -c 200000 /dev/zero | tr "\\0" "A"\n');
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: null,
      timeoutMs: 30_000,
      log: () => {},
    });
    expect(note).not.toBeNull();
    expect(note!.output.length).toBeLessThanOrEqual(HOOK_OUTPUT_CHAR_LIMIT);
    expect(note!.output.length).toBeGreaterThan(HOOK_OUTPUT_CHAR_LIMIT - 100);
    expect(note!.output).not.toContain('truncated');
  }, 30_000);

  test('failure mode 7: credentials non-null → GIT_CONFIG_* enters the hook env; null → no injection', async () => {
    const root = tmpRoot();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell-script content embedded in a JS string; ${GIT_CONFIG_COUNT} is sh parameter expansion, not JS template
    writeHook(root, 'setup', '#!/bin/sh\necho "cred=${GIT_CONFIG_COUNT:-unset}"\n');
    stubOutInheritedGitConfig();
    let withCreds: Awaited<ReturnType<typeof runWorkspaceHook>>;
    let without: Awaited<ReturnType<typeof runWorkspaceHook>>;
    try {
      withCreds = await runWorkspaceHook({
        cwd: root,
        name: 'setup',
        credentials: CREDS,
        timeoutMs: 30_000,
        log: () => {},
      });
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell-script content embedded in a JS string; ${GIT_CONFIG_COUNT} is sh parameter expansion, not JS template
      writeHook(root, 'setup', '#!/bin/sh\necho "cred=${GIT_CONFIG_COUNT:-unset}"\n');
      without = await runWorkspaceHook({
        cwd: root,
        name: 'setup',
        credentials: null,
        timeoutMs: 30_000,
        log: () => {},
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(withCreds!.output).toContain('cred=2');
    expect(without!.output).toContain('cred=unset');
  });

  test('failure mode 7b: the daemon’s own GIT_CONFIG_* does not reach hook children, only the step credential entries do', async () => {
    const root = tmpRoot();
    writeHook(
      root,
      'setup',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell-script content embedded in a JS string; ${GIT_CONFIG_COUNT} is sh parameter expansion, not JS template
      '#!/bin/sh\necho "cred=${GIT_CONFIG_COUNT:-unset}"\necho "probe=$(git config --get cairn.probe)"\n',
    );
    stubOutInheritedGitConfig();
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'cairn.probe');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'kept');
    let note: Awaited<ReturnType<typeof runWorkspaceHook>>;
    try {
      note = await runWorkspaceHook({
        cwd: root,
        name: 'setup',
        credentials: CREDS,
        timeoutMs: 30_000,
        log: () => {},
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(note!.output).toContain('cred=2');
    expect(note!.output).toContain('probe=\n');
    expect(note!.output).not.toContain('probe=kept');
  });

  test('the resume name runs the same (the primitive is name-agnostic)', async () => {
    const root = tmpRoot();
    writeHook(root, 'resume', '#!/bin/sh\necho resume-ran\n');
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'resume',
      credentials: null,
      timeoutMs: 30_000,
      log: () => {},
    });
    expect(note!.name).toBe('resume');
    expect(note!.output).toContain('resume-ran');
  });

  test.runIf(process.platform !== 'win32')(
    'login shell hydration exposes version-manager tools to .agents/setup when launchd PATH lacks them',
    async () => {
      const root = tmpRoot();
      const toolBin = join(root, 'fnm-bin');
      mkdirSync(toolBin, { recursive: true });
      const fakeTool = join(toolBin, 'cairn-fake-pnpm');
      writeFileSync(fakeTool, '#!/bin/sh\necho fake-pnpm-ready\n');
      chmodSync(fakeTool, 0o755);
      const fakeShell = join(root, 'fake-login-shell');
      writeFileSync(
        fakeShell,
        `#!/bin/sh
if [ "$1" = "-ilc" ]; then
  export PATH="${toolBin}:$PATH"
  /bin/sh -c "$2"
  exit $?
fi
exit 2
`,
      );
      chmodSync(fakeShell, 0o755);
      writeHook(root, 'setup', '#!/bin/sh\ncairn-fake-pnpm\n');
      const savedPath = process.env.PATH;
      const savedShell = process.env.SHELL;
      const savedResolved = process.env.CAIRN_SHELL_ENV_RESOLVED;
      const savedHome = process.env.HOME;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = fakeShell;
      process.env.HOME = root;
      delete process.env.CAIRN_SHELL_ENV_RESOLVED;
      try {
        const before = (await runWorkspaceHook({
          cwd: root,
          name: 'setup',
          credentials: null,
          timeoutMs: 15_000,
          log: () => {},
        }).catch((error: unknown) => error)) as WorkspaceHookError;
        expect(before).toBeInstanceOf(WorkspaceHookError);
        expect(before.note.exitCode).toBe(127);

        const applied = await ensureDaemonShellEnv({
          isTty: false,
          cachePath: join(root, 'shell-cache.json'),
          userShell: fakeShell,
        });
        expect(applied).toBe(true);

        const after = await runWorkspaceHook({
          cwd: root,
          name: 'setup',
          credentials: null,
          timeoutMs: 15_000,
          log: () => {},
        });
        expect(after?.status).toBe('ok');
        expect(after?.exitCode).toBe(0);
        expect(after?.output).toContain('fake-pnpm-ready');
      } finally {
        if (savedPath === undefined) delete process.env.PATH;
        else process.env.PATH = savedPath;
        if (savedShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = savedShell;
        if (savedResolved === undefined) delete process.env.CAIRN_SHELL_ENV_RESOLVED;
        else process.env.CAIRN_SHELL_ENV_RESOLVED = savedResolved;
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
      }
    },
  );

  test('failed setup hook output reaches the agent prompt as first context with install guidance', () => {
    const wrapped = prependFailedSetupHookContext(
      'Fix the failing test.',
      [
        {
          name: 'setup',
          status: 'failed',
          exitCode: 127,
          output: '.agents/setup: line 6: pnpm: command not found\ntoken=secret-val',
          totalChars: 60,
          ms: 120,
        },
      ],
      (text) => text.replace('secret-val', '[REDACTED]'),
    );
    expect(wrapped.indexOf('[Workspace setup hook failed before the session started]')).toBe(0);
    expect(wrapped).toContain('command "pnpm" was not found on PATH');
    expect(wrapped).toContain('corepack enable');
    expect(wrapped).toContain('npm i -g pnpm');
    expect(wrapped).toContain('token=[REDACTED]');
    expect(wrapped).not.toContain('secret-val');
    expect(wrapped.endsWith('Fix the failing test.')).toBe(true);
  });
});
