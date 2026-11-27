import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  GITHUB_PUSH_MAX_REPOS,
  type GithubPushLoginState,
  type GithubPushRepoEntry,
  type GithubPushReport,
  type GithubPushRepoState,
} from '@cairn/shared';

export const GITHUB_PUSH_CACHE_TTL_MS = 5 * 60_000;
export const GITHUB_PUSH_UNKNOWN_TTL_MS = 60_000;
export const GITHUB_PUSH_PROBE_TIMEOUT_MS = 10_000;
const HEARTBEAT_REFRESH_THRESHOLD_MS = 4 * 60_000;
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const REPO_PROBE_CONCURRENCY = 4;
const VIEWER_PERMISSION_QUERY =
  'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){viewerPermission}}';

export interface GhExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  killed: boolean;
  enoent: boolean;
}

export type ExecGh = (args: readonly string[], signal?: AbortSignal) => Promise<GhExecResult>;

const defaultExecGh: ExecGh = (args, signal) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      [...args],
      {
        timeout: GITHUB_PUSH_PROBE_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        ...(signal ? { signal } : {}),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, stdout, stderr, code: 0, killed: false, enoent: false });
          return;
        }
        const err = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
        const enoent = err.code === 'ENOENT';
        const code = typeof err.code === 'number' ? err.code : null;
        const killed = Boolean(err.killed) || error.name === 'AbortError';
        resolve({ ok: false, stdout: stdout ?? '', stderr: stderr ?? '', code, killed, enoent });
      },
    );
  });

function normalizeRepos(repos: readonly string[]): string[] {
  const deduped = new Map<string, string>();
  for (const raw of repos) {
    const trimmed = raw.trim();
    if (!REPO_PATTERN.test(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (!deduped.has(key)) deduped.set(key, trimmed);
  }
  return [...deduped.values()].sort().slice(0, GITHUB_PUSH_MAX_REPOS);
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function looksUnauthenticated(stderr: string): boolean {
  return /\b401\b|bad credentials|not logged into any github hosts|not logged in|gh auth login/i.test(
    stderr,
  );
}

interface AuthProbe {
  login: GithubPushLoginState;
  fingerprint: string | null;
}

async function checkAuth(execGh: ExecGh, signal?: AbortSignal): Promise<AuthProbe> {
  const res = await execGh(['auth', 'status', '--hostname', 'github.com'], signal);
  if (res.ok) {
    return { login: 'ok', fingerprint: sha256Hex(`${res.stdout}\n${res.stderr}`) };
  }
  if (res.killed || signal?.aborted === true) {
    return { login: 'unknown', fingerprint: null };
  }
  if (res.enoent || res.code !== null || looksUnauthenticated(res.stderr)) {
    return { login: 'unauthenticated', fingerprint: null };
  }
  return { login: 'unknown', fingerprint: null };
}

function parseRepoState(res: GhExecResult): GithubPushRepoState {
  if (res.killed) return 'unknown';
  if (res.enoent || looksUnauthenticated(res.stderr)) return 'unauthenticated';
  const trimmed = res.stdout.trim();
  if (trimmed !== '') {
    try {
      const parsed = JSON.parse(trimmed) as {
        data?: { repository?: { viewerPermission?: unknown } | null };
        errors?: Array<{ type?: unknown; message?: unknown }>;
      };
      const repo = parsed?.data?.repository;
      if (repo !== undefined) {
        if (repo === null) {
          const denied =
            res.ok ||
            (parsed.errors ?? []).some(
              (err) =>
                err.type === 'NOT_FOUND' ||
                err.type === 'FORBIDDEN' ||
                (typeof err.message === 'string' &&
                  /could not resolve to a repository/i.test(err.message)),
            );
          return denied ? 'no-write' : 'unknown';
        }
        const permission = typeof repo.viewerPermission === 'string' ? repo.viewerPermission : '';
        switch (permission) {
          case 'ADMIN':
          case 'MAINTAIN':
          case 'WRITE':
            return 'write';
          case 'READ':
          case 'TRIAGE':
          case 'MODERATE':
          case 'TRIAGE_PLUS':
            return 'no-write';
          default:
            return 'unknown';
        }
      }
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

async function probeRepo(
  execGh: ExecGh,
  repo: string,
  signal?: AbortSignal,
): Promise<GithubPushRepoState> {
  const slash = repo.indexOf('/');
  if (slash <= 0 || slash === repo.length - 1) return 'unknown';
  const owner = repo.slice(0, slash);
  const name = repo.slice(slash + 1);
  const res = await execGh(
    [
      'api',
      'graphql',
      '-f',
      `query=${VIEWER_PERMISSION_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
    ],
    signal,
  );
  return parseRepoState(res);
}

interface CachedRepo {
  entry: GithubPushRepoEntry;
}

export interface GithubPushProbeOpts {
  execGh?: ExecGh;
  now?: () => number;
  onChange?: () => void;
  ttlMs?: number;
  unknownTtlMs?: number;
  signal?: AbortSignal;
}

export class GithubPushProbe {
  private readonly execGh: ExecGh;
  private readonly now: () => number;
  private readonly onChange: (() => void) | undefined;
  private readonly ttlMs: number;
  private readonly unknownTtlMs: number;
  private readonly signal: AbortSignal | undefined;

  private repos: string[] = [];
  private hasRepoList = false;
  private lastFingerprint: string | null = null;
  private cache = new Map<string, CachedRepo>();
  private report: GithubPushReport | undefined;
  private lastEmittedAt = 0;
  private inFlight: Promise<boolean> | null = null;
  private dirty = false;

  constructor(opts: GithubPushProbeOpts = {}) {
    this.execGh = opts.execGh ?? defaultExecGh;
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.ttlMs = opts.ttlMs ?? GITHUB_PUSH_CACHE_TTL_MS;
    this.unknownTtlMs = opts.unknownTtlMs ?? GITHUB_PUSH_UNKNOWN_TTL_MS;
    this.signal = opts.signal;
  }

  current(): GithubPushReport | undefined {
    return this.report;
  }

  setRepos(repos: readonly string[]): void {
    const next = normalizeRepos(repos);
    const nextSet = new Set(next.map((repo) => repo.toLowerCase()));
    const prevSet = new Set(this.repos.map((repo) => repo.toLowerCase()));
    const listChanged =
      !this.hasRepoList ||
      next.length !== this.repos.length ||
      next.some((repo, idx) => repo !== this.repos[idx]);
    const added = next.some((repo) => !prevSet.has(repo.toLowerCase()));

    this.repos = next;
    this.hasRepoList = true;
    for (const key of [...this.cache.keys()]) {
      if (!nextSet.has(key)) this.cache.delete(key);
    }
    if (this.report !== undefined && listChanged) {
      this.report = {
        ...this.report,
        repos: this.buildRepoEntries(this.report.login, this.report.checkedAt),
      };
    }

    if (added || this.report === undefined) {
      void this.refresh().catch(() => {});
    }
  }

  refresh(): Promise<boolean> {
    if (this.isAborted()) return Promise.resolve(false);
    if (this.inFlight !== null) {
      this.dirty = true;
      return this.inFlight;
    }
    const run = this.runLoop().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  async settled(): Promise<void> {
    while (this.inFlight !== null) {
      await this.inFlight.catch(() => {});
    }
  }

  private isAborted(): boolean {
    return this.signal?.aborted === true;
  }

  private async runLoop(): Promise<boolean> {
    let anyChanged = false;
    do {
      this.dirty = false;
      const changed = await this.refreshOnce();
      if (changed) anyChanged = true;
    } while (this.dirty && !this.isAborted());
    return anyChanged;
  }

  private buildRepoEntries(login: GithubPushLoginState, checkedAt: number): GithubPushRepoEntry[] {
    return this.repos.map((repo) => {
      if (login !== 'ok') {
        return {
          repo,
          state: login === 'unauthenticated' ? 'unauthenticated' : 'unknown',
          checkedAt,
        };
      }
      return (
        this.cache.get(repo.toLowerCase())?.entry ?? {
          repo,
          state: 'unknown',
          checkedAt,
        }
      );
    });
  }

  private isFresh(entry: GithubPushRepoEntry, now: number): boolean {
    const ttl = entry.state === 'unknown' ? this.unknownTtlMs : this.ttlMs;
    return now - entry.checkedAt < ttl;
  }

  private async refreshOnce(): Promise<boolean> {
    if (this.isAborted()) return false;
    const auth = await checkAuth(this.execGh, this.signal);
    if (this.isAborted()) return false;

    const now = this.now();
    if (auth.login !== 'ok') {
      if (this.lastFingerprint !== null) {
        this.lastFingerprint = null;
        this.cache.clear();
      }
    } else if (this.lastFingerprint !== auth.fingerprint) {
      this.lastFingerprint = auth.fingerprint;
      this.cache.clear();
    }

    if (auth.login === 'ok') {
      const targetRepos = [...this.repos];
      const toProbe = targetRepos.filter((repo) => {
        const cached = this.cache.get(repo.toLowerCase())?.entry;
        return cached === undefined || !this.isFresh(cached, now);
      });
      if (toProbe.length > 0) {
        let index = 0;
        const worker = async () => {
          while (index < toProbe.length && !this.isAborted()) {
            const repo = toProbe[index++];
            if (repo === undefined) return;
            const state = await probeRepo(this.execGh, repo, this.signal);
            if (this.isAborted()) return;
            const checkedAt = this.now();
            this.cache.set(repo.toLowerCase(), {
              entry: { repo, state, checkedAt },
            });
          }
        };
        const workers = Array.from(
          { length: Math.min(REPO_PROBE_CONCURRENCY, toProbe.length) },
          () => worker(),
        );
        await Promise.all(workers);
      }
    }

    if (this.isAborted()) return false;
    const reportCheckedAt = this.now();
    const nextReport: GithubPushReport = {
      login: auth.login,
      checkedAt: reportCheckedAt,
      repos: this.buildRepoEntries(auth.login, reportCheckedAt),
    };
    const previous = this.report;
    this.report = nextReport;

    const statusChanged =
      previous === undefined ||
      previous.login !== nextReport.login ||
      previous.repos.length !== nextReport.repos.length ||
      nextReport.repos.some((entry, idx) => {
        const prev = previous.repos[idx];
        return prev === undefined || prev.repo !== entry.repo || prev.state !== entry.state;
      });
    const freshnessBump =
      nextReport.repos.length > 0 &&
      reportCheckedAt - this.lastEmittedAt >= HEARTBEAT_REFRESH_THRESHOLD_MS;

    if (statusChanged || freshnessBump) {
      this.lastEmittedAt = reportCheckedAt;
      this.onChange?.();
      return true;
    }
    return false;
  }
}
