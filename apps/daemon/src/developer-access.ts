import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { realDirectory } from './agent-config.js';

const HOST_SIGN_IN_TOOLS = ['git', 'gh'] as const;
export const HOST_TOOLS_DIR_VAR = 'CAIRN_HOST_TOOLS';
const RESTORED_FOR_HOST_TOOLS = [
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'ZDOTDIR',
] as const;
const POSIX_PROFILE = `if [ -n "$${HOST_TOOLS_DIR_VAR}" ]; then PATH="$${HOST_TOOLS_DIR_VAR}:$PATH"; export PATH; fi\n`;
const FISH_PROFILE = `if set -q ${HOST_TOOLS_DIR_VAR}\n    set -gx PATH $${HOST_TOOLS_DIR_VAR} $PATH\nend\n`;
const LOGIN_PROFILES = [
  ['.profile', POSIX_PROFILE],
  ['.zprofile', POSIX_PROFILE],
  ['.config/fish/config.fish', FISH_PROFILE],
] as const;
const PROFILES_BASH_READS_FIRST = ['.bash_profile', '.bash_login'] as const;

function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function executableOnPath(name: string, searchPath: string): string | undefined {
  return searchPath
    .split(delimiter)
    .filter((directory) => isAbsolute(directory))
    .map((directory) => join(directory, name))
    .find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
}

function replaceFile(path: string, content: string, mode: number): void {
  const staging = `${path}.${randomUUID()}`;
  writeFileSync(staging, content, { mode, flag: 'wx' });
  renameSync(staging, path);
}

function startupFilesUnder(isolatedHome: string, env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    ...(env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: join(isolatedHome, '.config') } : {}),
    ...(env.ZDOTDIR ? { ZDOTDIR: isolatedHome } : {}),
  };
}

function ghConfigUnder(isolatedHome: string, env: NodeJS.ProcessEnv): Record<string, string> {
  return env.GH_CONFIG_DIR ? { GH_CONFIG_DIR: join(isolatedHome, '.config', 'gh') } : {};
}

function writeLoginProfile(home: string, relative: string, content: string): void {
  const path = join(realDirectory(home, dirname(relative)), basename(relative));
  if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    rmSync(path, { recursive: true, force: true });
  }
  replaceFile(path, content, 0o600);
}

function hostToolScript(
  executable: string,
  stepValues: NodeJS.ProcessEnv,
  hostValues: NodeJS.ProcessEnv,
): string {
  const restores = RESTORED_FOR_HOST_TOOLS.flatMap((name) => {
    const stepValue = stepValues[name] ?? '';
    const hostValue = hostValues[name] ?? '';
    if (stepValue === hostValue) return [];
    const restore = hostValue ? `export ${name}=${shellQuoted(hostValue)}` : `unset ${name}`;
    return [`if [ "\${${name}-}" = ${shellQuoted(stepValue)} ]; then ${restore}; fi`];
  });
  return ['#!/bin/sh', ...restores, `exec ${shellQuoted(executable)} "$@"`, ''].join('\n');
}

export function developerAccessEnv(input: {
  isolatedHome: string;
  toolsDir: string | undefined;
  searchPath: string;
  realHome: string;
  hostEnv: NodeJS.ProcessEnv;
  stepEnv: NodeJS.ProcessEnv;
  readonlyGit: boolean;
}): Record<string, string> {
  const { realHome, hostEnv, toolsDir, searchPath } = input;
  if (process.platform === 'win32') return { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const corepack = {
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_HOME:
      hostEnv.COREPACK_HOME ||
      join(hostEnv.XDG_CACHE_HOME || join(realHome, '.cache'), 'node', 'corepack'),
  };
  const inherited = { ...hostEnv, ...input.stepEnv };
  const startupFiles = startupFilesUnder(input.isolatedHome, inherited);
  if (input.readonlyGit) {
    return { ...corepack, ...startupFiles, ...ghConfigUnder(input.isolatedHome, inherited) };
  }
  if (toolsDir === undefined || !existsSync(input.isolatedHome)) return corepack;
  mkdirSync(toolsDir, { recursive: true, mode: 0o700 });
  const stepValues = { ...inherited, ...startupFiles, HOME: input.isolatedHome };
  const hostValues = { ...hostEnv, HOME: realHome };
  for (const name of HOST_SIGN_IN_TOOLS) {
    const executable = executableOnPath(name, searchPath);
    if (executable === undefined) continue;
    const script = hostToolScript(executable, stepValues, hostValues);
    replaceFile(join(toolsDir, name), script, 0o700);
  }
  for (const name of PROFILES_BASH_READS_FIRST) {
    rmSync(join(input.isolatedHome, name), { recursive: true, force: true });
  }
  for (const [relative, content] of LOGIN_PROFILES) {
    writeLoginProfile(input.isolatedHome, relative, content);
  }
  return {
    ...corepack,
    ...startupFiles,
    [HOST_TOOLS_DIR_VAR]: toolsDir,
    PATH: `${toolsDir}${delimiter}${searchPath}`,
  };
}
