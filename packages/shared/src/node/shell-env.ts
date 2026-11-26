import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, posix } from 'node:path';
import { trimEndChars } from '../linear-text.js';

export const SHELL_ENV_RESOLVED_VAR = 'CAIRN_SHELL_ENV_RESOLVED';
export const LOGIN_SHELL_TIMEOUT_MS = 5_000;
export const SLOW_LOGIN_SHELL_TIMEOUT_MS = 20_000;
export const LAUNCHCTL_TIMEOUT_MS = 2_000;
export const PROCESS_TERMINATE_GRACE_MS = 1_000;
export const WARM_REFRESH_WAIT_MS = 1_500;

export const LOGIN_SHELL_ENV_NAMES = [
  'PATH',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSH_AUTH_SOCK',
  'HOMEBREW_PREFIX',
  'HOMEBREW_CELLAR',
  'HOMEBREW_REPOSITORY',
  'XDG_CONFIG_HOME',
  'XDG_CURRENT_DESKTOP',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_DESKTOP',
  'XDG_SESSION_TYPE',
  'WAYLAND_DISPLAY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  '__MISE_DIFF',
  'MISE_DATA_DIR',
  'MISE_CONFIG_DIR',
  'MISE_CACHE_DIR',
  'FNM_DIR',
  'FNM_MULTISHELL_PATH',
  'NVM_DIR',
  'VOLTA_HOME',
  'PNPM_HOME',
  'JAVA_HOME',
  'GOPATH',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'PYENV_ROOT',
  'RBENV_ROOT',
  'ASDF_DIR',
  'ASDF_DATA_DIR',
  'SDKMAN_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
] as const;

export const WINDOWS_PROFILE_ENV_NAMES = [
  'PATH',
  'FNM_DIR',
  'FNM_MULTISHELL_PATH',
  'PNPM_HOME',
  'VOLTA_HOME',
] as const;

const LOCALE_ENV_NAMES = ['LANG', 'LC_ALL', 'LC_CTYPE'] as const;
const ANDROID_SDK_ENV_NAMES = ['ANDROID_HOME', 'ANDROID_SDK_ROOT'] as const;
const FALLBACK_LC_CTYPE = 'en_US.UTF-8';
const WINDOWS_SHELL_CANDIDATES = ['pwsh.exe', 'powershell.exe'] as const;

const SHELL_PREFERRED_ENV_NAMES = [
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_DESKTOP',
  'XDG_SESSION_TYPE',
  '__MISE_DIFF',
] as const;

const FILL_IF_MISSING_ENV_NAMES = [
  'DISPLAY',
  'HOMEBREW_PREFIX',
  'HOMEBREW_CELLAR',
  'HOMEBREW_REPOSITORY',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  'WAYLAND_DISPLAY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'MISE_DATA_DIR',
  'MISE_CONFIG_DIR',
  'MISE_CACHE_DIR',
  'FNM_DIR',
  'FNM_MULTISHELL_PATH',
  'NVM_DIR',
  'VOLTA_HOME',
  'PNPM_HOME',
  'JAVA_HOME',
  'GOPATH',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'PYENV_ROOT',
  'RBENV_ROOT',
  'ASDF_DIR',
  'ASDF_DATA_DIR',
  'SDKMAN_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
] as const;

const CACHED_ENV_NAMES = [
  'PATH',
  '__MISE_DIFF',
  'HOMEBREW_PREFIX',
  'HOMEBREW_CELLAR',
  'HOMEBREW_REPOSITORY',
  'JAVA_HOME',
  'PNPM_HOME',
  'FNM_DIR',
  'FNM_MULTISHELL_PATH',
  'NVM_DIR',
  'VOLTA_HOME',
  'MISE_DATA_DIR',
  'MISE_CONFIG_DIR',
  'MISE_CACHE_DIR',
  'GOPATH',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'PYENV_ROOT',
  'RBENV_ROOT',
  'ASDF_DIR',
  'ASDF_DATA_DIR',
  'SDKMAN_DIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSH_AUTH_SOCK',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
] as const;

const PATCH_ENV_NAMES = Array.from(
  new Set([...LOGIN_SHELL_ENV_NAMES, ...WINDOWS_PROFILE_ENV_NAMES]),
);
const SHELL_ENV_NAME_PATTERN = /^[A-Z0-9_]+$/;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEBUG_TRAP_SHELLS = new Set(['bash', 'zsh', 'sh', 'ksh', 'ksh93']);
const POSIX_CAPTURE_SYNTAX = { assignment: '__CAIRN_PRINTENV=$(', orElse: ' || ' };
const PRINTENV_CAPTURE_SYNTAX = new Map(
  [...DEBUG_TRAP_SHELLS, 'dash', 'ash'].map((shell) => [shell, POSIX_CAPTURE_SYNTAX] as const),
).set('fish', { assignment: 'set -l __CAIRN_PRINTENV (', orElse: '; or ' });
const PRINTENV_LOOKUP_COMMAND = `/bin/sh -c 'command -v printenv || { [ -n "$1" ] && PATH="$1" command -v printenv; } || printf %s /usr/bin/printenv' cairn`;

export type ShellEnvironmentPatch = Record<string, string>;

export type ShellEnvironmentProbeKind =
  | 'login-shell'
  | 'launchctl-path'
  | 'powershell-profile'
  | 'powershell-no-profile';

export interface ShellCommandRequest {
  probe: ShellEnvironmentProbeKind;
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  terminateGraceMs: number;
  cwd?: string;
}

export type ShellCommandResult =
  | { ok: true; stdout: string }
  | { ok: false; timedOut: boolean; reason: string };

export type ShellCommandRunner = (request: ShellCommandRequest) => Promise<ShellCommandResult>;

export interface ShellDiscoveryResult {
  patch: ShellEnvironmentPatch;
  prepared: boolean;
  fromUserShell: boolean;
  fromCache: boolean;
  refreshPromise?: Promise<ShellDiscoveryResult>;
}

export interface DiscoverShellEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  cachePath?: string;
  userShell?: string;
  timeoutMs?: number;
  slowTimeoutMs?: number;
  launchctlTimeoutMs?: number;
  terminateGraceMs?: number;
  warmRefreshWaitMs?: number;
  runCommand?: ShellCommandRunner;
  onWarn?: (message: string) => void;
  onRefresh?: (result: ShellDiscoveryResult) => void;
}

export interface ApplyLoginShellEnvOptions extends DiscoverShellEnvironmentOptions {
  onlyWhenNonTty?: boolean;
  isTty?: boolean;
}

function trimNonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function nonEmptyPath(value: string | null | undefined): string | undefined {
  return value !== undefined && value !== null && value.length > 0 ? value : undefined;
}

function readEnvPath(env: NodeJS.ProcessEnv): string | undefined {
  return nonEmptyPath(env.PATH ?? env.Path ?? env.path);
}

function existingDirectory(path: string | undefined): string | undefined {
  if (path === undefined || path === '') return undefined;
  try {
    return statSync(path).isDirectory() ? path : undefined;
  } catch {
    return undefined;
  }
}

function safeHomedir(): string {
  try {
    return homedir();
  } catch {
    return '';
  }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function readUserLoginShell(): string | undefined {
  try {
    return trimNonEmpty(userInfo().shell);
  } catch {
    return undefined;
  }
}

export function listLoginShellCandidates(
  platform: NodeJS.Platform,
  shell: string | undefined,
  userShell: string | undefined = readUserLoginShell(),
): readonly string[] {
  if (platform !== 'darwin' && platform !== 'linux') return [];
  const fallbacks = platform === 'darwin' ? ['/bin/zsh', '/bin/sh'] : ['/bin/bash', '/bin/sh'];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const candidate of [trimNonEmpty(shell), trimNonEmpty(userShell), ...fallbacks]) {
    if (candidate === undefined || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

function envCaptureStart(name: string): string {
  return `__CAIRN_ENV_${name}_START__`;
}

function envCaptureEnd(name: string): string {
  return `__CAIRN_ENV_${name}_END__`;
}

export function buildEnvironmentCaptureCommand(
  shell: string,
  names: readonly string[],
  inheritedPathValue: string | undefined = readEnvPath(process.env),
): string {
  const executableName = basename(shell).toLowerCase();
  const isNushell = executableName.startsWith('nu');
  const syntax = PRINTENV_CAPTURE_SYNTAX.get(executableName);
  const supportsFallback = syntax !== undefined;
  const inheritedPath = (inheritedPathValue ?? '')
    .split(':')
    .filter(Boolean)
    .map((entry) => posix.resolve(entry))
    .join(':');
  const lookupPrintenv = `${PRINTENV_LOOKUP_COMMAND} '${inheritedPath.replaceAll("'", "'\\''")}'`;
  const { assignment, orElse } = syntax ?? POSIX_CAPTURE_SYNTAX;
  const resolvePrintenv = `${assignment}${lookupPrintenv}); `;

  const capture = names
    .map((name) => {
      if (!SHELL_ENV_NAME_PATTERN.test(name)) {
        throw new Error(`Unsupported environment variable name: ${name}`);
      }
      if (isNushell) {
        const defaultValue =
          name === 'PATH'
            ? "if ($env.PATH? | describe | str starts-with 'list') { " +
              "$env.PATH | each {|p| if ($p | str starts-with '~') { " +
              '$p | path expand --no-symlink } else { $p } } | str join (char esep) ' +
              "} else { $env.PATH? | default '' }"
            : `$env.${name}? | default ''`;
        const value =
          `if $env.${name}? == null { '' } else if ` +
          `$env.ENV_CONVERSIONS?.${name}?.to_string? != null { ` +
          `$env.${name} | do $env.ENV_CONVERSIONS.${name}.to_string $env.${name} ` +
          `} else { ${defaultValue} }`;
        return [
          `print '${envCaptureStart(name)}'`,
          `print (${value})`,
          `print '${envCaptureEnd(name)}'`,
        ].join('; ');
      }
      return [
        `printf '%s\\n' '${envCaptureStart(name)}'`,
        supportsFallback
          ? `printenv ${name}${orElse}"$__CAIRN_PRINTENV" ${name}${orElse}true`
          : `printenv ${name} || true`,
        `printf '%s\\n' '${envCaptureEnd(name)}'`,
      ].join('; ');
    })
    .join('; ');

  const command = supportsFallback ? resolvePrintenv + capture : capture;
  return DEBUG_TRAP_SHELLS.has(executableName)
    ? `(trap - DEBUG) 2>/dev/null && trap - DEBUG; ${command}`
    : command;
}

export function windowsEnvironmentValueCommand(name: string): string {
  if (name === 'PATH') {
    return (
      '$value = (@(' +
      "[Environment]::GetEnvironmentVariable('PATH','Process')," +
      "[Environment]::GetEnvironmentVariable('PATH','Machine')," +
      "[Environment]::GetEnvironmentVariable('PATH','User')" +
      ") | Where-Object { $_ }) -join ';'"
    );
  }
  return `$value = [Environment]::GetEnvironmentVariable('${name}')`;
}

export function buildWindowsEnvironmentCaptureCommand(names: readonly string[]): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}',
    ...names.flatMap((name) => {
      if (!SHELL_ENV_NAME_PATTERN.test(name)) {
        throw new Error(`Unsupported environment variable name: ${name}`);
      }
      return [
        `Write-Output '${envCaptureStart(name)}'`,
        windowsEnvironmentValueCommand(name),
        'if ($null -ne $value -and $value.Length -gt 0) { Write-Output $value }',
        `Write-Output '${envCaptureEnd(name)}'`,
      ];
    }),
  ].join('; ');
}

export function extractEnvironmentValues(
  output: string,
  names: readonly string[],
): ShellEnvironmentPatch {
  const environment: ShellEnvironmentPatch = {};
  for (const name of names) {
    const startMarker = envCaptureStart(name);
    const endMarker = envCaptureEnd(name);
    const start = output.indexOf(startMarker);
    if (start === -1) continue;
    const valueStart = start + startMarker.length;
    const end = output.indexOf(endMarker, valueStart);
    if (end === -1) continue;
    const value = output
      .slice(valueStart, end)
      .replace(/^\r?\n/, '')
      .replace(/\r?\n$/, '');
    if (value.length > 0) environment[name] = value;
  }
  return environment;
}

function pathDelimiterForPlatform(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':';
}

function sanitizePathEntry(entry: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? entry.trim().replaceAll('"', '') : entry;
}

export function mergePathValues(
  preferredPath: string | undefined,
  inheritedPath: string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  const sep = pathDelimiterForPlatform(platform);
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of [preferredPath, inheritedPath]) {
    if (rawValue === undefined || rawValue === '') continue;
    for (const entry of rawValue.split(sep)) {
      const sanitized = sanitizePathEntry(entry, platform);
      if (sanitized.length === 0) continue;
      const comparisonKey = platform === 'win32' ? sanitized.toLowerCase() : sanitized;
      if (seen.has(comparisonKey)) continue;
      seen.add(comparisonKey);
      merged.push(sanitized);
    }
  }
  return merged.length > 0 ? merged.join(sep) : undefined;
}

function mergePaths(
  platform: NodeJS.Platform,
  values: readonly (string | undefined)[],
): string | undefined {
  return values.reduce<string | undefined>(
    (merged, value) => mergePathValues(merged, value, platform),
    undefined,
  );
}

export function setWindowsPath(env: NodeJS.ProcessEnv, value: string | null): void {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') delete env[key];
  }
  if (value !== null) env.PATH = value;
}

export function applyShellEnvironment(
  env: NodeJS.ProcessEnv,
  patch: ShellEnvironmentPatch,
  platform: NodeJS.Platform = process.platform,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'PATH' && platform === 'win32') setWindowsPath(env, value);
    else env[key] = value;
  }
}

export function knownWindowsCliDirs(env: NodeJS.ProcessEnv): readonly string[] {
  const appData = trimNonEmpty(env.APPDATA);
  const localAppData = trimNonEmpty(env.LOCALAPPDATA);
  const userProfile = trimNonEmpty(env.USERPROFILE);
  return [
    ...(appData !== undefined ? [`${appData}\\npm`] : []),
    ...(localAppData !== undefined
      ? [
          `${localAppData}\\Programs\\nodejs`,
          `${localAppData}\\Volta\\bin`,
          `${localAppData}\\pnpm`,
        ]
      : []),
    ...(userProfile !== undefined
      ? [`${userProfile}\\.local\\bin`, `${userProfile}\\.bun\\bin`, `${userProfile}\\scoop\\shims`]
      : []),
  ];
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      process.kill(pid, signal);
    } catch {}
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

function defaultRunCommand(request: ShellCommandRequest): Promise<ShellCommandResult> {
  return new Promise<ShellCommandResult>((resolve) => {
    let settled = false;
    let byteCount = 0;
    const chunks: Buffer[] = [];
    let forceKillTimer: NodeJS.Timeout | undefined;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      resolve({
        ok: false,
        timedOut: false,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const finish = (result: ShellCommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      resolve(result);
    };

    const terminate = (result: ShellCommandResult): void => {
      killProcessGroup(child.pid, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        killProcessGroup(child.pid, 'SIGKILL');
      }, request.terminateGraceMs);
      forceKillTimer.unref();
      child.stdout?.destroy();
      child.unref();
      finish(result);
    };

    const timeoutTimer = setTimeout(() => {
      terminate({
        ok: false,
        timedOut: true,
        reason: `timed out after ${request.timeoutMs}ms`,
      });
    }, request.timeoutMs);
    timeoutTimer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      byteCount += chunk.length;
      if (byteCount > MAX_OUTPUT_BYTES) {
        terminate({ ok: false, timedOut: false, reason: 'output exceeded limit' });
        return;
      }
      chunks.push(chunk);
    });

    child.once('error', (error: Error) => {
      finish({ ok: false, timedOut: false, reason: error.message });
    });

    child.once('close', (code: number | null) => {
      if (settled) return;
      if (code !== 0) {
        finish({ ok: false, timedOut: false, reason: `exited ${code ?? 'unknown'}` });
        return;
      }
      finish({ ok: true, stdout: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

function loginShellSpawnArgs(shell: string, command: string): string[] {
  const name = basename(shell).toLowerCase();
  if (name === 'csh' || name === 'tcsh') return ['-ic', command];
  return ['-ilc', command];
}

function probeBaseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const probe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) probe[key] = value;
  }
  probe.DISABLE_AUTO_UPDATE = 'true';
  probe.ZSH_TMUX_AUTOSTARTED = 'true';
  probe.ZSH_TMUX_AUTOSTART = 'false';
  return probe;
}

function stripAppImagePaths(target: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  if (platform !== 'linux' || target.PATH === undefined) return;
  if (target.APPIMAGE === undefined && target.APPDIR === undefined) return;
  const appDir = target.APPDIR === undefined ? undefined : trimEndChars(target.APPDIR, '/');
  const kept = target.PATH.split(':').filter(
    (entry) =>
      !(appDir && (entry === appDir || entry.startsWith(`${appDir}/`))) &&
      !/^\/tmp\/\.mount_[^/]+(?:\/|$)/u.test(entry),
  );
  if (kept.length > 0) target.PATH = kept.join(':');
  else delete target.PATH;
}

function linuxRuntimeDirCandidates(env: NodeJS.ProcessEnv, uid: number | undefined): string[] {
  const candidates: string[] = [];
  const fromEnv = trimNonEmpty(env.XDG_RUNTIME_DIR);
  if (fromEnv !== undefined) candidates.push(trimEndChars(fromEnv, '/'));
  if (uid !== undefined) candidates.push(`/run/user/${uid}`);
  return candidates.filter((candidate) => candidate.length > 0);
}

interface InternalDiscovery {
  prepared: boolean;
  fromUserShell: boolean;
}

async function probePosixEnvironment(
  target: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  options: {
    userShell: string | undefined;
    timeoutMs: number;
    slowTimeoutMs: number | undefined;
    launchctlTimeoutMs: number;
    terminateGraceMs: number;
    runCommand: ShellCommandRunner;
    onWarn?: (message: string) => void;
  },
): Promise<InternalDiscovery> {
  const userShells = [trimNonEmpty(target.SHELL), trimNonEmpty(options.userShell)].filter(
    (shell): shell is string => shell !== undefined,
  );
  const candidates = listLoginShellCandidates(platform, target.SHELL, options.userShell);
  const shellEnv: ShellEnvironmentPatch = {};
  const probeEnv = probeBaseEnv(target);
  const cwd = existingDirectory(target.HOME) ?? existingDirectory(safeHomedir());

  let answeredBy: string | undefined;
  let waitedForSlowShell = false;

  const readShell = async (shell: string, timeoutMs: number): Promise<ShellCommandResult> => {
    const command = buildEnvironmentCaptureCommand(
      shell,
      LOGIN_SHELL_ENV_NAMES,
      readEnvPath(target),
    );
    return options.runCommand({
      probe: 'login-shell',
      command: shell,
      args: loginShellSpawnArgs(shell, command),
      env: probeEnv,
      timeoutMs,
      terminateGraceMs: options.terminateGraceMs,
      cwd,
    });
  };

  for (const shell of candidates) {
    if (
      options.runCommand === defaultRunCommand &&
      shell.startsWith('/') &&
      !isExecutableFile(shell)
    ) {
      continue;
    }
    let result = await readShell(shell, options.timeoutMs);
    if (
      !result.ok &&
      result.timedOut &&
      !waitedForSlowShell &&
      options.slowTimeoutMs !== undefined
    ) {
      waitedForSlowShell = true;
      options.onWarn?.(
        `login shell ${shell} timed out after ${options.timeoutMs}ms; retrying once with ${options.slowTimeoutMs}ms`,
      );
      result = await readShell(shell, options.slowTimeoutMs);
    }
    if (!result.ok) {
      options.onWarn?.(`login shell ${shell} probe failed: ${result.reason}`);
      continue;
    }
    Object.assign(shellEnv, extractEnvironmentValues(result.stdout, LOGIN_SHELL_ENV_NAMES));
    if (shellEnv.PATH !== undefined) {
      answeredBy = shell;
      break;
    }
  }

  let launchctlPath: string | undefined;
  if (platform === 'darwin' && shellEnv.PATH === undefined) {
    const launchctl = await options.runCommand({
      probe: 'launchctl-path',
      command: '/bin/launchctl',
      args: ['getenv', 'PATH'],
      env: probeEnv,
      timeoutMs: options.launchctlTimeoutMs,
      terminateGraceMs: options.terminateGraceMs,
    });
    if (launchctl.ok) launchctlPath = trimNonEmpty(launchctl.stdout);
    else options.onWarn?.(`launchctl getenv PATH failed: ${launchctl.reason}`);
  }

  const mergedPath = mergePaths(platform, [
    nonEmptyPath(shellEnv.PATH) ?? launchctlPath,
    readEnvPath(target),
  ]);
  if (mergedPath !== undefined) target.PATH = mergedPath;

  if (!target.SSH_AUTH_SOCK && shellEnv.SSH_AUTH_SOCK) {
    target.SSH_AUTH_SOCK = shellEnv.SSH_AUTH_SOCK;
  }

  for (const name of SHELL_PREFERRED_ENV_NAMES) {
    if (shellEnv[name] !== undefined) target[name] = shellEnv[name];
  }

  for (const name of FILL_IF_MISSING_ENV_NAMES) {
    if (!target[name] && shellEnv[name] !== undefined) target[name] = shellEnv[name];
  }

  if (ANDROID_SDK_ENV_NAMES.every((name) => trimNonEmpty(target[name]) === undefined)) {
    for (const name of ANDROID_SDK_ENV_NAMES) {
      const value = trimNonEmpty(shellEnv[name]);
      if (value !== undefined) target[name] = value;
    }
  }

  if (LOCALE_ENV_NAMES.every((name) => trimNonEmpty(target[name]) === undefined)) {
    for (const name of LOCALE_ENV_NAMES) {
      const value = trimNonEmpty(shellEnv[name]);
      if (value !== undefined) target[name] = value;
    }
    if (
      platform === 'darwin' &&
      LOCALE_ENV_NAMES.every((name) => trimNonEmpty(target[name]) === undefined)
    ) {
      target.LC_CTYPE = FALLBACK_LC_CTYPE;
    }
  }

  if (platform === 'linux' && trimNonEmpty(target.DBUS_SESSION_BUS_ADDRESS) === undefined) {
    for (const runtimeDir of linuxRuntimeDirCandidates(target, process.getuid?.())) {
      const busPath = `${runtimeDir}/bus`;
      if (existsSync(busPath)) {
        target.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`;
        break;
      }
    }
  }

  const prepared = trimNonEmpty(shellEnv.PATH) !== undefined || launchctlPath !== undefined;
  return {
    prepared,
    fromUserShell:
      trimNonEmpty(shellEnv.PATH) !== undefined &&
      answeredBy !== undefined &&
      userShells.includes(answeredBy),
  };
}

async function probeWindowsShell(
  names: readonly string[],
  loadProfile: boolean,
  env: NodeJS.ProcessEnv,
  options: {
    timeoutMs: number;
    terminateGraceMs: number;
    runCommand: ShellCommandRunner;
    onWarn?: (message: string) => void;
  },
): Promise<ShellEnvironmentPatch> {
  if (names.length === 0) return {};
  const args = [
    '-NoLogo',
    ...(loadProfile ? [] : ['-NoProfile']),
    '-NonInteractive',
    '-Command',
    buildWindowsEnvironmentCaptureCommand(names),
  ];
  for (const command of WINDOWS_SHELL_CANDIDATES) {
    const result = await options.runCommand({
      probe: loadProfile ? 'powershell-profile' : 'powershell-no-profile',
      command,
      args,
      env,
      timeoutMs: options.timeoutMs,
      terminateGraceMs: options.terminateGraceMs,
    });
    if (!result.ok) {
      options.onWarn?.(
        `${command} (${loadProfile ? 'profile' : 'no-profile'}) failed: ${result.reason}`,
      );
      continue;
    }
    const extracted = extractEnvironmentValues(result.stdout, names);
    if (Object.keys(extracted).length > 0) return extracted;
  }
  return {};
}

async function probeWindowsEnvironment(
  target: NodeJS.ProcessEnv,
  options: {
    timeoutMs: number;
    terminateGraceMs: number;
    runCommand: ShellCommandRunner;
    onWarn?: (message: string) => void;
  },
): Promise<InternalDiscovery> {
  const [profile, noProfile] = await Promise.all([
    probeWindowsShell(WINDOWS_PROFILE_ENV_NAMES, true, target, options),
    probeWindowsShell(['PATH'], false, target, options),
  ]);
  const mergedPath = mergePaths('win32', [
    trimNonEmpty(profile.PATH),
    trimNonEmpty(knownWindowsCliDirs(target).join(';')),
    trimNonEmpty(noProfile.PATH),
    readEnvPath(target),
  ]);
  if (mergedPath !== undefined) setWindowsPath(target, mergedPath);
  for (const name of ['FNM_DIR', 'FNM_MULTISHELL_PATH', 'PNPM_HOME', 'VOLTA_HOME'] as const) {
    if (!target[name] && profile[name] !== undefined) target[name] = profile[name];
  }
  const prepared = Boolean(profile.PATH || noProfile.PATH);
  return { prepared, fromUserShell: Boolean(profile.PATH) };
}

interface ShellEnvironmentCacheFile {
  version: 1;
  key: string;
  environment: ShellEnvironmentPatch;
}

function cacheKeyFor(
  platform: NodeJS.Platform,
  homeDirectory: string,
  env: NodeJS.ProcessEnv,
): string {
  return JSON.stringify([platform, homeDirectory, env.SHELL ?? '', env.ZDOTDIR ?? '']);
}

function readCacheFile(cachePath: string, expectedKey: string): ShellEnvironmentPatch | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Partial<ShellEnvironmentCacheFile>;
    if (record.version !== 1 || record.key !== expectedKey) return null;
    if (
      record.environment === null ||
      typeof record.environment !== 'object' ||
      Array.isArray(record.environment)
    ) {
      return null;
    }
    const out: ShellEnvironmentPatch = {};
    for (const [k, v] of Object.entries(record.environment)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

function writeCacheFile(
  cachePath: string,
  key: string,
  fresh: NodeJS.ProcessEnv,
  onWarn?: (message: string) => void,
): void {
  const environment: ShellEnvironmentPatch = {};
  for (const name of CACHED_ENV_NAMES) {
    const value = fresh[name];
    if (typeof value === 'string' && value.length > 0) environment[name] = value;
  }
  const payload: ShellEnvironmentCacheFile = { version: 1, key, environment };
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    renameSync(tmpPath, cachePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    onWarn?.(`could not write shell environment cache: ${reason}`);
  }
}

function patchFromResolved(
  resolved: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): ShellEnvironmentPatch {
  const patch: ShellEnvironmentPatch = {};
  for (const name of PATCH_ENV_NAMES) {
    const value = name === 'PATH' ? readEnvPath(resolved) : resolved[name];
    if (typeof value === 'string' && value.length > 0) patch[name] = value;
  }
  if (platform === 'darwin' && patch.LC_CTYPE === undefined && resolved.LC_CTYPE) {
    patch.LC_CTYPE = resolved.LC_CTYPE;
  }
  return patch;
}

function applyCachedBaseline(
  inherited: NodeJS.ProcessEnv,
  cached: ShellEnvironmentPatch,
  platform: NodeJS.Platform,
): ShellEnvironmentPatch {
  const baseline: NodeJS.ProcessEnv = { ...inherited };
  const filtered: ShellEnvironmentPatch = {};
  for (const name of CACHED_ENV_NAMES) {
    const value = cached[name];
    if (value === undefined) continue;
    if (name !== 'PATH' && name !== '__MISE_DIFF' && inherited[name] !== undefined) continue;
    filtered[name] = value;
  }
  if (filtered.PATH !== undefined) {
    filtered.PATH = mergePaths(platform, [filtered.PATH, readEnvPath(inherited)]) ?? filtered.PATH;
  }
  applyShellEnvironment(baseline, filtered, platform);
  stripAppImagePaths(baseline, platform);
  return patchFromResolved(baseline, platform);
}

/**
 * Discovers the user's shell environment following t3code's architecture:
 * probes login shell candidates (with bounded timeout + one longer slow-shell retry),
 * falls back to `launchctl getenv PATH` on macOS, probes PowerShell profile and
 * no-profile on Windows, merges PATH (never replacing it), copies only an allow-list
 * of variables, and caches the result on disk.
 */
export async function discoverShellEnvironment(
  options: DiscoverShellEnvironmentOptions = {},
): Promise<ShellDiscoveryResult> {
  const inherited: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
  const platform = options.platform ?? process.platform;
  stripAppImagePaths(inherited, platform);

  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    return { patch: {}, prepared: false, fromUserShell: false, fromCache: false };
  }

  const homeDirectory = options.homeDirectory ?? inherited.HOME ?? safeHomedir();
  const key = cacheKeyFor(platform, homeDirectory, inherited);
  const runCommand = options.runCommand ?? defaultRunCommand;
  const timeoutMs = options.timeoutMs ?? LOGIN_SHELL_TIMEOUT_MS;
  const slowTimeoutMs = options.slowTimeoutMs ?? SLOW_LOGIN_SHELL_TIMEOUT_MS;
  const launchctlTimeoutMs = options.launchctlTimeoutMs ?? LAUNCHCTL_TIMEOUT_MS;
  const terminateGraceMs = options.terminateGraceMs ?? PROCESS_TERMINATE_GRACE_MS;

  const cachedEnv = options.cachePath !== undefined ? readCacheFile(options.cachePath, key) : null;
  const cachedPatch =
    cachedEnv !== null ? applyCachedBaseline(inherited, cachedEnv, platform) : null;

  const runFresh = async (): Promise<ShellDiscoveryResult> => {
    const fresh: NodeJS.ProcessEnv = { ...inherited };
    const discovery =
      platform === 'win32'
        ? await probeWindowsEnvironment(fresh, {
            timeoutMs,
            terminateGraceMs,
            runCommand,
            onWarn: options.onWarn,
          })
        : await probePosixEnvironment(fresh, platform, {
            userShell: options.userShell,
            timeoutMs,
            slowTimeoutMs,
            launchctlTimeoutMs,
            terminateGraceMs,
            runCommand,
            onWarn: options.onWarn,
          });
    stripAppImagePaths(fresh, platform);
    const patch = patchFromResolved(fresh, platform);
    if (discovery.prepared && options.cachePath !== undefined) {
      writeCacheFile(options.cachePath, key, fresh, options.onWarn);
    }
    const result: ShellDiscoveryResult = {
      patch: discovery.prepared || cachedPatch === null ? patch : cachedPatch,
      prepared: discovery.prepared,
      fromUserShell: discovery.fromUserShell,
      fromCache: !discovery.prepared && cachedPatch !== null,
    };
    return result;
  };

  if (cachedPatch === null) {
    return runFresh();
  }

  const warmWaitMs = options.warmRefreshWaitMs ?? WARM_REFRESH_WAIT_MS;
  const freshPromise = runFresh();
  const raced = await Promise.race([
    freshPromise,
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), warmWaitMs);
      timer.unref();
    }),
  ]);
  if (raced !== null) {
    return raced;
  }
  const background = freshPromise.then((result) => {
    options.onRefresh?.(result);
    return result;
  });
  void background.catch(() => {});
  return {
    patch: cachedPatch,
    prepared: true,
    fromUserShell: false,
    fromCache: true,
    refreshPromise: background,
  };
}

/**
 * Discovers the user's shell environment once and applies the allow-listed patch into `env`
 * (default `process.env`). Marks `CAIRN_SHELL_ENV_RESOLVED=1` so child processes reuse it.
 */
export async function applyLoginShellEnv(
  options: ApplyLoginShellEnvOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') return false;
  if (env[SHELL_ENV_RESOLVED_VAR] === '1') return false;
  const isTty = options.isTty ?? Boolean(process.stdin.isTTY || process.stdout.isTTY);
  if (options.onlyWhenNonTty === true && isTty) {
    env[SHELL_ENV_RESOLVED_VAR] = '1';
    return false;
  }
  const discovery = await discoverShellEnvironment({
    ...options,
    env,
    platform,
    onRefresh: (refreshed) => {
      applyShellEnvironment(env, refreshed.patch, platform);
      options.onRefresh?.(refreshed);
    },
  });
  applyShellEnvironment(env, discovery.patch, platform);
  env[SHELL_ENV_RESOLVED_VAR] = '1';
  return true;
}
