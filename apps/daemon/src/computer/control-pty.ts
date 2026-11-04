import { type ChildProcess, spawn } from 'node:child_process';
import { Duplex, PassThrough } from 'node:stream';
import type { ComputerScreenConnection } from './screen-channel.js';

const CONTROL_PTY = [
  'import os, pty, select, signal, sys',
  'pid, fd = pty.fork()',
  'if pid == 0:',
  '    os.execvp(sys.argv[1], [sys.argv[1]])',
  'os.write(2, f"{pid}\\n".encode())',
  'def stop(_signum, _frame):',
  '    try:',
  '        os.kill(pid, signal.SIGKILL)',
  '    except OSError:',
  '        pass',
  '    raise SystemExit(0)',
  'signal.signal(signal.SIGTERM, stop)',
  'try:',
  '    while True:',
  '        ready, _, _ = select.select([fd, 0], [], [], 0.2)',
  '        if fd in ready:',
  '            data = os.read(fd, 4096)',
  '            if not data:',
  '                break',
  '            os.write(1, data)',
  '        if 0 in ready:',
  '            data = os.read(0, 4096)',
  '            if not data:',
  '                break',
  '            os.write(fd, data)',
  'finally:',
  '    try:',
  '        os.kill(pid, signal.SIGKILL)',
  '    except OSError:',
  '        pass',
].join('\n');

export interface UserControlPty extends ComputerScreenConnection {
  shellPid: Promise<number>;
}

export function openUserControlPty(signal: AbortSignal): UserControlPty {
  if (signal.aborted) throw new Error('computer control closed');
  const child = spawn('python3', ['-S', '-c', CONTROL_PTY, 'bash'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const shellPid = new Promise<number>((resolve, reject) => {
    let text = '';
    const onData = (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const line = text.split('\n', 1)[0] ?? '';
      if (!text.includes('\n')) return;
      child.stderr?.off('data', onData);
      const pid = Number(line);
      if (!Number.isInteger(pid) || pid <= 1)
        reject(new Error('computer control pty did not start'));
      else resolve(pid);
    };
    child.stderr?.on('data', onData);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('computer control pty closed')));
  });
  const readable = new PassThrough();
  child.stdout?.on('data', (chunk: Buffer) => readable.write(chunk));
  child.stdout?.on('end', () => readable.end());
  const stream = new Duplex({
    write(chunk, encoding, callback) {
      if (!child.stdin) {
        callback(new Error('computer control pty has no input'));
        return;
      }
      child.stdin.write(chunk, encoding, callback);
    },
    read() {
      const chunk = readable.read() as Buffer | null;
      if (chunk) this.push(chunk);
    },
  });
  readable.on('data', (chunk: Buffer) => {
    stream.push(chunk);
  });
  stream.on('error', () => {});
  readable.on('error', () => {});
  child.stdin?.on('error', () => {});
  child.stdout?.on('error', () => {});
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', close);
    stopControlProcess(child);
    try {
      stream.destroy();
    } catch {}
  };
  signal.addEventListener('abort', close, { once: true });
  child.once('exit', () => {
    if (!closed) close();
  });
  return { stream, shellPid, close };
}

function stopControlProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {}
}
