import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export function parseGithubCreateRateLimit(
  res: { status: number; headers: { get(name: string): string | null } },
  body: string,
  now = Date.now(),
): number | null {
  if (
    res.status !== 429 &&
    !(
      res.status === 403 &&
      (res.headers.get('retry-after') !== null ||
        res.headers.get('x-ratelimit-remaining') === '0' ||
        /secondary rate limit|abuse detection|rate limit exceeded/i.test(body))
    )
  )
    return null;
  const retry = res.headers.get('retry-after');
  const retryMs =
    retry === null ? 0 : /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now;
  const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 - now;
  return Math.max(
    1000,
    Number.isFinite(retryMs) ? retryMs : 0,
    Number.isFinite(reset) ? reset : 0,
    retry === null && reset <= 0 ? 60000 : 0,
  );
}

export interface GithubCreateOptions {
  directory?: string;
  lockTimeoutMs?: number;
  minIntervalMs?: number;
  hourlyCap?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  onDelay?: (reason: string, ms: number) => void;
}

export class GithubCreateGateNotWritableError extends Error {
  readonly directory: string;
  readonly code: string;

  constructor(directory: string, code: string) {
    super(
      `github create gate directory not writable: ${directory}; grant the process write access (chmod u+w) or remove the directory so the gate recreates it`,
    );
    this.name = 'GithubCreateGateNotWritableError';
    this.directory = directory;
    this.code = code;
  }
}

function asGateNotWritable(directory: string, error: unknown): unknown {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EROFS') return error;
  return new GithubCreateGateNotWritableError(directory, code);
}

export async function acquireGithubCreateSlot(options: GithubCreateOptions = {}): Promise<number> {
  const directory =
    options.directory ?? join(process.env.CAIRN_HOME ?? join(homedir(), '.cairn'), 'github-create');
  const interval =
    options.minIntervalMs ?? Number(process.env.CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS ?? 3000);
  const cap = options.hourlyCap ?? Number(process.env.CAIRN_GITHUB_CREATE_HOURLY_CAP ?? 300);
  if (!Number.isFinite(interval) || interval < 0 || !Number.isSafeInteger(cap) || cap < 1)
    throw new Error('Invalid GitHub create throttle configuration');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? setTimeout;
  const log =
    options.onDelay ??
    ((reason: string, ms: number) => console.warn(`GitHub create delayed: ${reason}, ${ms}ms`));
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw asGateNotWritable(directory, error);
  }
  const lock = join(directory, 'lock');
  const state = join(directory, 'state.json');
  let lockWaitStarted = now();
  for (;;) {
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw asGateNotWritable(directory, error);
      if (now() - lockWaitStarted >= (options.lockTimeoutMs ?? 30000))
        throw new Error('GitHub create lock timed out; inspect the lock directory before retrying');
      await sleep(50);
      continue;
    }
    let wait = 0;
    let reason = 'spacing';
    try {
      let timestamps: number[] = [];
      try {
        const parsed: unknown = JSON.parse(await readFile(state, 'utf8'));
        if (
          !Array.isArray(parsed) ||
          !parsed.every((value) => typeof value === 'number' && Number.isFinite(value))
        )
          throw new Error('Invalid GitHub create state');
        timestamps = parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const time = now();
      timestamps = timestamps.filter((value) => value > time - 3600000).sort((a, b) => a - b);
      wait = Math.max(0, (timestamps.at(-1) ?? time - interval) + interval - time);
      if (timestamps.length >= cap) {
        wait = Math.max(wait, (timestamps[timestamps.length - cap] ?? time) + 3600000 - time);
        reason = 'hourly cap';
      }
      if (wait === 0) {
        timestamps.push(time);
        await writeFile(join(directory, `${process.pid}.tmp`), JSON.stringify(timestamps), {
          mode: 0o600,
        });
        await rename(join(directory, `${process.pid}.tmp`), state);
        return time;
      }
    } finally {
      await rmdir(lock);
    }
    log(reason, wait);
    await sleep(Math.min(wait, 2147483647));
    lockWaitStarted = now();
  }
}
