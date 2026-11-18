import { type ChildProcess, spawn } from 'node:child_process';
import { Duplex, PassThrough } from 'node:stream';

const ENGINE_PTY = [
  'import os, pty, select, signal, struct, fcntl, termios, sys',
  'pid, fd = pty.fork()',
  'if pid == 0:',
  '    os.execvp(sys.argv[2], sys.argv[2:])',
  'rows, cols = int(sys.argv[1].split("x")[0]), int(sys.argv[1].split("x")[1])',
  'fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))',
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
  '            data = os.read(fd, 65536)',
  '            if not data:',
  '                break',
  '            os.write(1, data)',
  '        if 0 in ready:',
  '            data = os.read(0, 65536)',
  '            if not data:',
  '                break',
  '            os.write(fd, data)',
  'finally:',
  '    try:',
  '        os.kill(pid, signal.SIGKILL)',
  '    except OSError:',
  '        pass',
].join('\n');

export interface EnginePtyProcess {
  readonly stream: Duplex;
  readonly pid: Promise<number>;
  close(): void;
}

export interface EnginePtySpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  fdToken?: string;
}

export function openEnginePtyProcess(
  command: readonly string[],
  opts: EnginePtySpawnOptions = {},
): EnginePtyProcess {
  if (command.length === 0) throw new Error('engine pty requires a command');
  const size = `${opts.rows ?? 50}x${opts.cols ?? 160}`;
  const child = spawn('python3', ['-S', '-c', ENGINE_PTY, size, ...command], {
    stdio: opts.fdToken !== undefined ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  });
  const tokenChannel = opts.fdToken !== undefined ? child.stdio[3] : null;
  if (tokenChannel !== null && tokenChannel !== undefined && 'end' in tokenChannel) {
    tokenChannel.on('error', () => {});
    tokenChannel.end(opts.fdToken);
  }
  const pid = new Promise<number>((resolve, reject) => {
    let text = '';
    const onData = (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const line = text.split('\n', 1)[0] ?? '';
      if (!text.includes('\n')) return;
      child.stderr?.off('data', onData);
      const value = Number(line);
      if (!Number.isInteger(value) || value <= 1) reject(new Error('engine pty did not start'));
      else resolve(value);
    };
    child.stderr?.on('data', onData);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('engine pty closed')));
  });
  const readable = new PassThrough();
  child.stdout?.on('data', (chunk: Buffer) => readable.write(chunk));
  child.stdout?.on('end', () => readable.end());
  const stream = new Duplex({
    write(chunk, encoding, callback) {
      if (!child.stdin) {
        callback(new Error('engine pty has no input'));
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
    stopProcess(child);
    try {
      stream.destroy();
    } catch {}
  };
  child.once('exit', () => {
    if (!closed) close();
  });
  return { stream, pid, close };
}

function stopProcess(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {}
}
