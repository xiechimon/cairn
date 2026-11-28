import { spawn } from 'node:child_process';

export const REPLACEMENT_WAIT_SCRIPT = [
  'target=$1; exe=$2; shift 2; ticks=0',
  'while kill -0 "$target" 2>/dev/null; do',
  '  sleep 0.2; ticks=$((ticks + 1))',
  '  [ "$ticks" -lt 200 ] || exit 0',
  'done',
  'exec "$exe" "$@"',
].join('\n');

export interface ReplacementTarget {
  pid: number;
  executablePath: string;
  args: readonly string[];
}

export interface RestartHooks {
  rememberWindow: () => void;
  quit: () => void;
  fallback: () => void;
}

type Start = typeof spawn;

export function startReplacement(
  target: ReplacementTarget,
  start: Start = spawn,
  onFailure: () => void = () => {},
): void {
  const waiter = start(
    '/bin/sh',
    [
      '-c',
      REPLACEMENT_WAIT_SCRIPT,
      'cairn-restart',
      String(target.pid),
      target.executablePath,
      ...target.args,
    ],
    { detached: true, stdio: 'ignore' },
  );
  waiter.on('error', onFailure);
  waiter.unref();
}

export function createHostRestarter(start: Start = spawn) {
  let started = false;
  return (hooks: RestartHooks, target: ReplacementTarget): void => {
    if (started) return;
    started = true;
    hooks.rememberWindow();
    startReplacement(target, start, hooks.fallback);
    hooks.quit();
  };
}
