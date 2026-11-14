import { type SpawnOptions, spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

const SUBREAPER_LAUNCH = [
  'import ctypes, os, sys',
  'ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0)',
  'try:',
  '    os.execvp(sys.argv[1], sys.argv[1:])',
  'except OSError as error:',
  '    sys.stderr.write(f"{error.strerror}\\n")',
  '    raise SystemExit(1)',
].join('\n');

export function python3Executable(pathValue: string | undefined): string | undefined {
  return executableOnPath('python3', pathValue);
}

export function executableOnPath(name: string, pathValue: string | undefined): string | undefined {
  if (!pathValue) return undefined;
  for (const directory of pathValue.split(':')) {
    if (!directory) continue;
    const candidate = `${directory}/${name}`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

export function containedCommandArgv(
  command: string,
  args: readonly string[],
  launcher: string | undefined,
): { file: string; args: string[] } {
  if (!launcher) return { file: command, args: [...args] };
  return { file: launcher, args: ['-S', '-c', SUBREAPER_LAUNCH, command, ...args] };
}

export function spawnContainedCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ReturnType<typeof spawn> {
  const launcher = process.platform === 'linux' ? python3Executable(process.env.PATH) : undefined;
  const argv = containedCommandArgv(command, args, launcher);
  return spawn(argv.file, argv.args, options);
}
