import { type ChildProcess, spawn } from 'node:child_process';
import { HttpError } from '../lib/errors.js';

const WATCHDOG_MS = 10 * 60 * 1000;

let inFlight: ChildProcess | null = null;

export function killInFlightPick(): void {
  if (inFlight !== null) {
    inFlight.kill('SIGKILL');
    inFlight = null;
  }
}

function probeGuiSession(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn('launchctl', ['managername']);
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(out.trim() === 'Aqua'));
  });
}

export async function pickFolder(): Promise<string | null> {
  if (!(await probeGuiSession())) {
    throw new HttpError(
      422,
      'folder picker unavailable: requires macOS with a GUI session',
      'unavailable',
    );
  }
  if (inFlight !== null) {
    throw new HttpError(409, 'a folder pick is already in flight', 'busy');
  }
  const script = [
    'try',
    'return "PATH:" & (POSIX path of (choose folder with prompt "cairn · 选择项目文件夹"))',
    'on error errStr number errNum',
    'return "ERR:" & errNum',
    'end try',
  ];
  const child = spawn(
    'osascript',
    script.flatMap((line) => ['-e', line]),
  );
  inFlight = child;
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
    child.kill('SIGKILL');
  }, WATCHDOG_MS);
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        child.on('error', reject);
        child.on('close', () => resolve({ stdout, stderr }));
      },
    );
    if (watchdogFired) {
      throw new HttpError(422, 'folder pick timed out (watchdog)', 'unavailable');
    }
    const out = stdout.replace(/\n$/, '');
    if (out.startsWith('PATH:')) return out.slice('PATH:'.length);
    if (out === 'ERR:-128') return null;
    throw new HttpError(
      422,
      `folder pick failed: ${stderr.trim() || out || 'unknown osascript outcome'}`,
      'unavailable',
    );
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, `folder picker unavailable: ${(err as Error).message}`, 'unavailable');
  } finally {
    clearTimeout(watchdog);
    inFlight = null;
  }
}
