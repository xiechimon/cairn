import { spawn } from 'node:child_process';
import { adoptCredentialProfile } from '@cairn/shared/credential-profile';

const [, , binary, ...args] = process.argv;
const home = process.cwd();
if (binary === undefined || !process.connected || process.env.HOME !== home) process.exit(1);
const cleanup = adoptCredentialProfile(home, process.ppid);
const child = spawn(binary, args, {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: ['pipe', 'pipe', 'ignore'],
});
let parentGone = false;
let exited = false;
let force: ReturnType<typeof setTimeout> | undefined;

function stop(): void {
  if (exited) {
    if (parentGone) cleanup();
    return;
  }
  if (force !== undefined) return;
  child.kill();
  force = setTimeout(() => child.kill('SIGKILL'), 250);
}

function finish(code: number): void {
  if (exited) return;
  exited = true;
  clearTimeout(force);
  if (parentGone || !process.connected) cleanup();
  process.exitCode = code;
  process.stdin.destroy();
  if (process.connected) process.send?.('credential-cli-exited');
}

process.on('disconnect', () => {
  parentGone = true;
  stop();
});
process.on('SIGTERM', stop);
child.stdin.on('error', stop);
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout, { end: false });
process.stdout.on('error', stop);
child.on('error', () => finish(1));
child.on('close', (code) => finish(code ?? 1));
