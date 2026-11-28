import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const SOURCE = new URL('./tray-driver.swift', import.meta.url);
const RESPONSE_TIMEOUT_MS = 15_000;

export function matchingPopover(entries, bounds) {
  return (
    entries.find(
      (entry) =>
        Math.abs(entry.width - bounds.width) <= 2 &&
        Math.abs(entry.x - bounds.x) <= 8 &&
        Math.abs(entry.y - bounds.y) <= 8,
    ) ?? null
  );
}

export async function compileTrayDriver() {
  const source = readFileSync(SOURCE, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const binary = join(tmpdir(), `cairn-tray-driver-${digest}`);
  if (existsSync(binary)) return binary;
  const partial = `${binary}.${process.pid}`;
  try {
    await promisify(execFile)('swiftc', ['-Onone', SOURCE.pathname, '-o', partial], {
      encoding: 'utf8',
      timeout: 180_000,
    });
  } catch (error) {
    throw new Error(`the tray driver did not compile: ${error.stderr || error.message}`);
  }
  renameSync(partial, binary);
  return binary;
}

export class TrayDriverStopped extends Error {}

export class TrayDriver {
  #child;
  #pending = [];
  #failure = null;

  static async start(compiled, log = () => {}) {
    log('tray driver: waiting for its build');
    const binary = await compiled;
    log(`tray driver: ${binary}`);
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const driver = new TrayDriver(child);
    createInterface({ input: child.stdout }).on('line', (line) => driver.settle(line));
    child.on('close', (code, signal) => driver.gone(`exit ${code} ${signal}`));
    child.on('error', (error) => driver.gone(error.message));
    child.stdin.on('error', (error) => driver.gone(error.message));
    return driver;
  }

  gone(reason) {
    this.#failure ??= new TrayDriverStopped(`the tray driver stopped: ${reason}`);
    for (const waiting of this.#pending.splice(0)) {
      clearTimeout(waiting.timer);
      waiting.reject(this.#failure);
    }
  }

  constructor(child) {
    this.#child = child;
  }

  settle(line) {
    const waiting = this.#pending.shift();
    if (waiting === undefined) return;
    clearTimeout(waiting.timer);
    try {
      waiting.resolve(JSON.parse(line));
    } catch {
      waiting.reject(new Error(`the tray driver answered with ${line}`));
    }
  }

  send(step) {
    if (this.#failure !== null) return Promise.reject(this.#failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.gone(`did not answer ${JSON.stringify(step)}`);
        this.#child.kill('SIGKILL');
      }, RESPONSE_TIMEOUT_MS);
      this.#pending.push({ resolve, reject, timer });
      this.#child.stdin.write(`${JSON.stringify(step)}\n`);
    });
  }

  close() {
    this.gone('closed');
    if (!this.#child.killed) this.#child.kill('SIGKILL');
  }
}
