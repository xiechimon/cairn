import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyLoginShellEnv,
  buildEnvironmentCaptureCommand,
  buildWindowsEnvironmentCaptureCommand,
  discoverShellEnvironment,
  extractEnvironmentValues,
  listLoginShellCandidates,
  mergePathValues,
  SHELL_ENV_RESOLVED_VAR,
  type ShellCommandRequest,
  type ShellCommandResult,
  setWindowsPath,
  windowsEnvironmentValueCommand,
} from './shell-env.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-shell-env-'));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(path: string, content: string): string {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`pid ${pid} still alive after process-group kill`);
}

function markerOutput(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => `__CAIRN_ENV_${name}_START__\n${value}\n__CAIRN_ENV_${name}_END__`)
    .join('\n');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('listLoginShellCandidates', () => {
  it('deduplicates $SHELL, user shell, and platform fallbacks in priority order', () => {
    expect(listLoginShellCandidates('darwin', '/opt/homebrew/bin/fish', '/bin/zsh')).toEqual([
      '/opt/homebrew/bin/fish',
      '/bin/zsh',
      '/bin/sh',
    ]);
    expect(listLoginShellCandidates('linux', '/usr/bin/zsh', '/usr/bin/zsh')).toEqual([
      '/usr/bin/zsh',
      '/bin/bash',
      '/bin/sh',
    ]);
    expect(listLoginShellCandidates('win32', undefined, undefined)).toEqual([]);
  });
});

describe('buildEnvironmentCaptureCommand and extractEnvironmentValues', () => {
  it('builds shell-appropriate marker commands for zsh, fish, nu, and PowerShell', () => {
    const zshCmd = buildEnvironmentCaptureCommand(
      '/bin/zsh',
      ['PATH', 'HOMEBREW_PREFIX'],
      '/usr/bin:/bin',
    );
    expect(zshCmd).toContain('trap - DEBUG');
    expect(zshCmd).toContain('__CAIRN_ENV_PATH_START__');
    expect(zshCmd).toContain('__CAIRN_ENV_HOMEBREW_PREFIX_END__');

    const fishCmd = buildEnvironmentCaptureCommand(
      '/opt/homebrew/bin/fish',
      ['PATH'],
      '/usr/bin:/bin',
    );
    expect(fishCmd).toContain('set -l __CAIRN_PRINTENV (');
    expect(fishCmd).toContain('; or ');

    const nuCmd = buildEnvironmentCaptureCommand('/usr/bin/nu', ['PATH'], '/usr/bin:/bin');
    expect(nuCmd).toContain('path expand --no-symlink');

    expect(windowsEnvironmentValueCommand('PATH')).toContain("'Machine'");
    expect(buildWindowsEnvironmentCaptureCommand(['PATH', 'FNM_DIR'])).toContain(
      '__CAIRN_ENV_FNM_DIR_START__',
    );
    expect(() => buildEnvironmentCaptureCommand('/bin/zsh', ['bad-name'])).toThrow();
  });

  it('extracts marker-delimited values past banner noise and preserves multiline values', () => {
    const noisy = `\u001b[32mWelcome!\u001b[0m\n${markerOutput({
      PATH: '/fnm/bin:/opt/homebrew/bin:/usr/bin',
      HOMEBREW_PREFIX: '/opt/homebrew',
      LANG: 'en_US.UTF-8',
    })}\nbye\n`;
    expect(extractEnvironmentValues(noisy, ['PATH', 'HOMEBREW_PREFIX', 'LANG', 'UNSET'])).toEqual({
      PATH: '/fnm/bin:/opt/homebrew/bin:/usr/bin',
      HOMEBREW_PREFIX: '/opt/homebrew',
      LANG: 'en_US.UTF-8',
    });
  });

  it('merges PATH values without replacing inherited entries and deduplicates per platform', () => {
    expect(
      mergePathValues('/fnm/bin:/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin:/custom', 'darwin'),
    ).toBe('/fnm/bin:/opt/homebrew/bin:/usr/bin:/bin:/custom');
    expect(
      mergePathValues('C:\\fnm;C:\\Windows\\System32', 'c:\\windows\\system32;C:\\Tools', 'win32'),
    ).toBe('C:\\fnm;C:\\Windows\\System32;C:\\Tools');
    const winEnv: NodeJS.ProcessEnv = { Path: 'C:\\Old', path: 'C:\\Other' };
    setWindowsPath(winEnv, 'C:\\New');
    expect(Object.keys(winEnv)).toEqual(['PATH']);
    expect(winEnv.PATH).toBe('C:\\New');
  });
});

describe('discoverShellEnvironment', () => {
  it('probes a real login shell, merges PATH, copies only allow-listed variables, and excludes secrets', async () => {
    const dir = makeTempDir();
    const fakeBin = join(dir, 'fnm-bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakeShell = writeExecutable(
      join(dir, 'zsh'),
      `#!/bin/sh
if [ "$1" != "-ilc" ]; then
  echo "expected -ilc" >&2
  exit 2
fi
export PATH="${fakeBin}:$PATH"
export HOMEBREW_PREFIX="/opt/homebrew"
export SSH_AUTH_SOCK="/tmp/shell-ssh.sock"
export XDG_CONFIG_HOME="${dir}/.config"
export ANDROID_HOME="${dir}/android-sdk"
export LANG="en_US.UTF-8"
export FNM_DIR="${dir}/.fnm"
export GH_TOKEN="secret-from-zshrc"
export ANTHROPIC_API_KEY="sk-ant-secret"
printf 'motd banner\\n'
/bin/sh -c "$2"
`,
    );
    const cachePath = join(dir, 'shell-environment-cache.json');
    const warnings: string[] = [];
    const result = await discoverShellEnvironment({
      platform: 'darwin',
      homeDirectory: dir,
      cachePath,
      userShell: fakeShell,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: dir,
        SHELL: fakeShell,
      },
      onWarn: (message) => warnings.push(message),
    });

    expect(warnings).toEqual([]);
    expect(result.prepared).toBe(true);
    expect(result.fromUserShell).toBe(true);
    expect(result.fromCache).toBe(false);
    expect(result.patch.PATH).toBe(`${fakeBin}:/usr/bin:/bin`);
    expect(result.patch.HOMEBREW_PREFIX).toBe('/opt/homebrew');
    expect(result.patch.SSH_AUTH_SOCK).toBe('/tmp/shell-ssh.sock');
    expect(result.patch.XDG_CONFIG_HOME).toBe(`${dir}/.config`);
    expect(result.patch.ANDROID_HOME).toBe(`${dir}/android-sdk`);
    expect(result.patch.LANG).toBe('en_US.UTF-8');
    expect(result.patch.FNM_DIR).toBe(`${dir}/.fnm`);
    expect(result.patch.GH_TOKEN).toBeUndefined();
    expect(result.patch.ANTHROPIC_API_KEY).toBeUndefined();
    expect(existsSync(cachePath)).toBe(true);
    expect(statSync(cachePath).mode & 0o777).toBe(0o600);
  });

  it('retries the first timed-out login shell once with slowTimeoutMs', async () => {
    const calls: { command: string; timeoutMs: number }[] = [];
    const runCommand = async (request: ShellCommandRequest): Promise<ShellCommandResult> => {
      calls.push({ command: request.command, timeoutMs: request.timeoutMs });
      if (calls.length === 1) {
        return { ok: false, timedOut: true, reason: `timed out after ${request.timeoutMs}ms` };
      }
      return {
        ok: true,
        stdout: markerOutput({
          PATH: '/slow-shell/bin:/usr/bin',
          HOMEBREW_PREFIX: '/opt/homebrew',
        }),
      };
    };
    const warnings: string[] = [];
    const result = await discoverShellEnvironment({
      platform: 'darwin',
      homeDirectory: '/Users/alice',
      userShell: '/bin/zsh',
      timeoutMs: 200,
      slowTimeoutMs: 1_500,
      env: { PATH: '/usr/bin:/bin', HOME: '/Users/alice', SHELL: '/bin/zsh' },
      runCommand,
      onWarn: (message) => warnings.push(message),
    });
    expect(calls).toEqual([
      { command: '/bin/zsh', timeoutMs: 200 },
      { command: '/bin/zsh', timeoutMs: 1_500 },
    ]);
    expect(warnings[0]).toContain('retrying once');
    expect(result.prepared).toBe(true);
    expect(result.patch.PATH).toBe('/slow-shell/bin:/usr/bin:/bin');
    expect(result.patch.HOMEBREW_PREFIX).toBe('/opt/homebrew');
  });

  it('falls back to launchctl getenv PATH and LC_CTYPE on macOS when login shells fail', async () => {
    const probes: string[] = [];
    const runCommand = async (request: ShellCommandRequest): Promise<ShellCommandResult> => {
      probes.push(`${request.probe}:${request.command}`);
      if (request.probe === 'launchctl-path') {
        return { ok: true, stdout: '/opt/homebrew/bin:/usr/local/bin\n' };
      }
      return { ok: false, timedOut: false, reason: 'exited 1' };
    };
    const result = await discoverShellEnvironment({
      platform: 'darwin',
      homeDirectory: '/Users/alice',
      userShell: '/bin/zsh',
      env: { PATH: '/usr/bin:/bin', HOME: '/Users/alice', SHELL: '/bin/zsh' },
      runCommand,
    });
    expect(probes).toContain('launchctl-path:/bin/launchctl');
    expect(result.prepared).toBe(true);
    expect(result.fromUserShell).toBe(false);
    expect(result.patch.PATH).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
    expect(result.patch.LC_CTYPE).toBe('en_US.UTF-8');
  });

  it('probes PowerShell profile and no-profile on Windows and merges PATH plus FNM vars', async () => {
    const probes: string[] = [];
    const runCommand = async (request: ShellCommandRequest): Promise<ShellCommandResult> => {
      probes.push(`${request.probe}:${request.command}`);
      if (request.probe === 'powershell-profile' && request.command === 'pwsh.exe') {
        return {
          ok: true,
          stdout: markerOutput({
            PATH: 'C:\\fnm\\node;C:\\Windows\\System32',
            FNM_DIR: 'C:\\Users\\alice\\AppData\\Roaming\\fnm',
            FNM_MULTISHELL_PATH: 'C:\\Users\\alice\\AppData\\Local\\fnm_multishells\\1',
          }),
        };
      }
      if (request.probe === 'powershell-no-profile' && request.command === 'pwsh.exe') {
        return {
          ok: true,
          stdout: markerOutput({ PATH: 'C:\\Program Files\\Git\\cmd;C:\\Windows\\System32' }),
        };
      }
      return { ok: false, timedOut: false, reason: 'not found' };
    };
    const result = await discoverShellEnvironment({
      platform: 'win32',
      homeDirectory: 'C:\\Users\\alice',
      env: {
        Path: 'C:\\Windows\\System32',
        APPDATA: 'C:\\Users\\alice\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\alice',
      },
      runCommand,
    });
    expect(probes).toEqual(['powershell-profile:pwsh.exe', 'powershell-no-profile:pwsh.exe']);
    expect(result.prepared).toBe(true);
    expect(result.fromUserShell).toBe(true);
    expect(result.patch.PATH).toBe(
      [
        'C:\\fnm\\node',
        'C:\\Windows\\System32',
        'C:\\Users\\alice\\AppData\\Roaming\\npm',
        'C:\\Users\\alice\\AppData\\Local\\Programs\\nodejs',
        'C:\\Users\\alice\\AppData\\Local\\Volta\\bin',
        'C:\\Users\\alice\\AppData\\Local\\pnpm',
        'C:\\Users\\alice\\.local\\bin',
        'C:\\Users\\alice\\.bun\\bin',
        'C:\\Users\\alice\\scoop\\shims',
        'C:\\Program Files\\Git\\cmd',
      ].join(';'),
    );
    expect(result.patch.FNM_DIR).toBe('C:\\Users\\alice\\AppData\\Roaming\\fnm');
    expect(result.patch.FNM_MULTISHELL_PATH).toBe(
      'C:\\Users\\alice\\AppData\\Local\\fnm_multishells\\1',
    );
  });

  it('serves the cached shell environment on warm startup when fresh probe is slow and refreshes in background', async () => {
    const dir = makeTempDir();
    const cachePath = join(dir, 'shell-environment-cache.json');
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: dir, SHELL: '/bin/zsh' };

    const cold = await discoverShellEnvironment({
      platform: 'darwin',
      homeDirectory: dir,
      cachePath,
      userShell: '/bin/zsh',
      env,
      runCommand: async () => ({
        ok: true,
        stdout: markerOutput({ PATH: '/cached/bin:/usr/bin', HOMEBREW_PREFIX: '/opt/homebrew' }),
      }),
    });
    expect(cold.fromCache).toBe(false);
    expect(cold.patch.PATH).toBe('/cached/bin:/usr/bin:/bin');

    let finishRefresh!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refreshedPatches: Record<string, string>[] = [];
    const warm = await discoverShellEnvironment({
      platform: 'darwin',
      homeDirectory: dir,
      cachePath,
      userShell: '/bin/zsh',
      env,
      warmRefreshWaitMs: 30,
      runCommand: async () => {
        await gate;
        return {
          ok: true,
          stdout: markerOutput({ PATH: '/fresh/bin:/usr/bin', HOMEBREW_PREFIX: '/opt/homebrew' }),
        };
      },
      onRefresh: (refreshed) => refreshedPatches.push(refreshed.patch),
    });
    expect(warm.fromCache).toBe(true);
    expect(warm.patch.PATH).toBe('/cached/bin:/usr/bin:/bin');
    finishRefresh();
    const refreshed = await warm.refreshPromise;
    expect(refreshed?.patch.PATH).toBe('/fresh/bin:/usr/bin:/bin');
    expect(refreshedPatches[0]?.PATH).toBe('/fresh/bin:/usr/bin:/bin');
  });

  it('kills the hanging shell process group on timeout and falls back cleanly', async () => {
    const dir = makeTempDir();
    const pidFile = join(dir, 'grandchild.pid');
    const hangingShell = writeExecutable(
      join(dir, 'hang-shell'),
      `#!/bin/sh
sleep 30 &
echo $! > "${pidFile}"
wait
`,
    );
    const warnings: string[] = [];
    const started = Date.now();
    const result = await discoverShellEnvironment({
      platform: 'linux',
      homeDirectory: dir,
      userShell: hangingShell,
      timeoutMs: 200,
      slowTimeoutMs: 200,
      terminateGraceMs: 50,
      env: { PATH: '/usr/bin:/bin', HOME: dir, SHELL: hangingShell },
      onWarn: (message) => warnings.push(message),
    });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(warnings.some((line) => line.includes('timed out'))).toBe(true);
    expect(result.patch.PATH).toContain('/usr/bin:/bin');
    const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(grandchildPid).toBeGreaterThan(0);
    await assertDead(grandchildPid);
  }, 15_000);
});

describe('applyLoginShellEnv', () => {
  it('resolves once, marks CAIRN_SHELL_ENV_RESOLVED, and skips when started from a TTY', async () => {
    let calls = 0;
    const runCommand = async (): Promise<ShellCommandResult> => {
      calls += 1;
      return { ok: true, stdout: markerOutput({ PATH: '/tool/bin:/usr/bin' }) };
    };

    const ttyEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: '/tmp', SHELL: '/bin/zsh' };
    expect(
      await applyLoginShellEnv({
        env: ttyEnv,
        platform: 'darwin',
        onlyWhenNonTty: true,
        isTty: true,
        runCommand,
      }),
    ).toBe(false);
    expect(ttyEnv.PATH).toBe('/usr/bin:/bin');
    expect(ttyEnv[SHELL_ENV_RESOLVED_VAR]).toBe('1');
    expect(calls).toBe(0);

    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: '/tmp', SHELL: '/bin/zsh' };
    expect(
      await applyLoginShellEnv({
        env,
        platform: 'darwin',
        onlyWhenNonTty: true,
        isTty: false,
        runCommand,
      }),
    ).toBe(true);
    expect(env.PATH).toBe('/tool/bin:/usr/bin:/bin');
    expect(env[SHELL_ENV_RESOLVED_VAR]).toBe('1');
    expect(
      await applyLoginShellEnv({
        env,
        platform: 'darwin',
        onlyWhenNonTty: true,
        isTty: false,
        runCommand,
      }),
    ).toBe(false);
    expect(calls).toBe(1);
  });
});
