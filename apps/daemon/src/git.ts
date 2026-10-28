import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoundGitCredentials, CommitIdentity, GitCredentialSource } from '@cairn/shared';
import { loopbackNoProxy } from './proxy.js';

export interface GitRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const LOOPBACK_URL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export function runGit(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...opts.env };
    const noProxy = LOOPBACK_URL_HOSTS.reduce<string | undefined>(
      (merged, host) => loopbackNoProxy({ NO_PROXY: merged }, `http://${host}`),
      env.NO_PROXY ?? env.no_proxy,
    );
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...env, NO_PROXY: noProxy, no_proxy: noProxy },
      windowsHide: true,
      ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdout.push(c));
    child.stderr.on('data', (c: Buffer) => stderr.push(c));
    child.on('error', reject);
    child.on('close', (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
  });
}

export async function runGitOk(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<string> {
  const r = await runGit(args, opts);
  if (r.code === 0) return r.stdout.trim();
  if (r.code === null) {
    throw new Error(
      `git ${args[0]} failed (signal ${r.signal ?? 'unknown'}): ${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
  throw new Error(`git ${args[0]} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
}

const CREDENTIAL_HELPER =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: sh parameter expansion inside the helper body, not a JS template
  '!f() { p=; h=; while IFS= read -r l; do case "$l" in protocol=*) p=${l#protocol=} ;; host=*) h=${l#host=} ;; esac; done; ' +
  'if test "$1" = get && test "$h" = "$CAIRN_GIT_CRED_HOST" && ' +
  '{ test "$p" = "$CAIRN_GIT_CRED_PROTOCOL" || { test "$p" = https && test "$CAIRN_GIT_CRED_PROTOCOL" = http; }; }; then ' +
  `printf 'username=%s\\npassword=%s\\n' "$CAIRN_GIT_CRED_USERNAME" "$CAIRN_GIT_CRED_PASSWORD"; fi; }; f`;

// Empty credential.helper clears stacked helpers (e.g. osxkeychain) so step cred does not persist.
export function gitCredentialEnv(
  cred: BoundGitCredentials,
  parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const n = inheritedGitConfigCount(parent);
  if (/[\r\n\0]/.test(cred.username + cred.password)) {
    throw new Error('per-step git credential contains a line break; refusing to pass it to git');
  }
  const target = credentialTarget(cred.url);
  return {
    GIT_CONFIG_COUNT: String(target === null ? n + 1 : n + 2),
    [`GIT_CONFIG_KEY_${n}`]: 'credential.helper',
    [`GIT_CONFIG_VALUE_${n}`]: '',
    ...(target === null
      ? {}
      : {
          [`GIT_CONFIG_KEY_${n + 1}`]: 'credential.helper',
          [`GIT_CONFIG_VALUE_${n + 1}`]: CREDENTIAL_HELPER,
          CAIRN_GIT_CRED_PROTOCOL: target.protocol,
          CAIRN_GIT_CRED_HOST: target.host,
          CAIRN_GIT_CRED_USERNAME: cred.username,
          CAIRN_GIT_CRED_PASSWORD: cred.password,
        }),
    GIT_TERMINAL_PROMPT: '0',
  };
}

function credentialTarget(url: string): { protocol: string; host: string } | null {
  const m = /^(https?):\/\/(?:[^@/?#]*@)?([^/?#]+)/.exec(url);
  if (m?.[1] === undefined || m[2] === undefined) return null;
  return { protocol: m[1], host: m[2] };
}

function inheritedGitConfigCount(parent: NodeJS.ProcessEnv): number {
  const raw = parent.GIT_CONFIG_COUNT;
  if (raw === undefined || !/^[ \t\n\v\f\r]*\+?\d+$/.test(raw)) return 0;
  const n = Number(raw);
  for (let i = 0; i < n; i++) {
    if (parent[`GIT_CONFIG_KEY_${i}`] === undefined) return 0;
    if (parent[`GIT_CONFIG_VALUE_${i}`] === undefined) return 0;
  }
  return n;
}

export function machineGitEnv(): NodeJS.ProcessEnv {
  return { GIT_TERMINAL_PROMPT: '0' };
}

export function isGitAuthFailure(message: string): boolean {
  return (
    /authentication failed/i.test(message) ||
    /invalid username or token/i.test(message) ||
    /could not read username/i.test(message) ||
    /terminal prompts disabled/i.test(message) ||
    /http basic: access denied/i.test(message) ||
    /http 401\b/i.test(message) ||
    /returned error: 401\b/.test(message)
  );
}

const GIT_PERMANENT_FAILURE_PATTERNS: readonly RegExp[] = [
  /returned error: (?:403|404)\b/,
  /\berror: (?:403|404)\b/,
  /ssl certificate problem/,
  /server certificate verification failed/,
  /repository not found/,
  /repository '[^']*' does not exist/,
  /does not appear to be a git repository/,
  /not a git repository/,
];

export function isGitTransientNetFailure(message: string): boolean {
  const lower = message.toLowerCase();
  if (isGitAuthFailure(message)) return false;
  return !GIT_PERMANENT_FAILURE_PATTERNS.some((re) => re.test(lower));
}

export type GitFallbackReason = string;

export interface GitCredentialFallbackOpts {
  what: string;
  allowMachineFallback: boolean;
  onFallback?: (reason: GitFallbackReason) => void;
}

export async function withGitCredentialFallback(
  op: (cred: BoundGitCredentials | null) => Promise<void>,
  cred: BoundGitCredentials | null,
  opts: GitCredentialFallbackOpts,
): Promise<GitCredentialSource> {
  if (cred === null) {
    await op(null);
    return 'machine';
  }
  try {
    await op(cred);
    return 'integration';
  } catch (err) {
    const first = err instanceof Error ? err.message : String(err);
    if (err instanceof GitPushHookError || !opts.allowMachineFallback || !isGitAuthFailure(first))
      throw err;
    opts.onFallback?.(first);
    try {
      await op(null);
      return 'machine';
    } catch (err2) {
      if (err2 instanceof GitPushHookError) throw err2;
      const second = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `git ${opts.what} authentication failed on both credential paths — ` +
          `per-step token: ${first}; machine credentials: ${second}`,
      );
    }
  }
}

export function commitEnv(identity: CommitIdentity): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

const META_TIMEOUT_MS = 30_000;
const CHECKOUT_TIMEOUT_MS = 300_000;
const NET_TIMEOUT_MS = 480_000;

const BRANCH_SCAN_SKEW_MS = 2_000;
const BRANCH_SCAN_MAX_REVS = 20;

export class GitPushHookError extends Error {
  constructor(output: string) {
    super(output);
    this.name = 'GitPushHookError';
  }
}

export async function landGitSquash(input: {
  dir: string;
  branch: string;
  currentBranch: string;
  base: string;
  commit: string;
  receipt: string;
}): Promise<'landed' | 'stale' | 'dirty'> {
  const { dir, branch, currentBranch, base, commit, receipt } = input;
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['update-ref', '--no-deref', '--stdin'], { cwd: dir });
    let output = '';
    let preparing = false;
    let dirty = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), META_TIMEOUT_MS);
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(dirty ? 'dirty' : code === 0 ? 'landed' : 'stale');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (preparing || !output.includes('prepare: ok\n')) return;
      preparing = true;
      void (async () => {
        try {
          if ((await gitPrim.currentBranch(dir)) !== currentBranch)
            throw new Error('Checkout changed');
          const status = await runGitOk(['status', '--porcelain', '--untracked-files=all'], {
            cwd: dir,
            env: { GIT_OPTIONAL_LOCKS: '0' },
            timeoutMs: META_TIMEOUT_MS,
          });
          if (status !== '') throw new Error('Worktree changed');
          if (currentBranch === branch)
            await runGitOk(['read-tree', '-m', '-u', base, commit], {
              cwd: dir,
              timeoutMs: META_TIMEOUT_MS,
            });
          child.stdin.end('commit\n');
        } catch {
          dirty = true;
          child.stdin.end('abort\n');
        }
      })();
    });
    child.stdin.write(
      `start\n${currentBranch === branch ? '' : `symref-verify HEAD refs/heads/${currentBranch}\n`}update refs/heads/${branch} ${commit} ${base}\nupdate ${receipt} ${commit}\nprepare\n`,
    );
  });
}

export const gitPrim = {
  async clone(url: string, dir: string, cred: BoundGitCredentials | null): Promise<void> {
    await runGitOk(['clone', '--end-of-options', url, dir], {
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  async fetch(repoDir: string, cred: BoundGitCredentials | null): Promise<void> {
    await runGitOk(['fetch', '--prune', 'origin'], {
      cwd: repoDir,
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  async remoteDefaultBranch(repoDir: string): Promise<string> {
    const r = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code === 0) {
      const name = r.stdout.trim().replace(/^origin\//, '');
      if (name !== '') return name;
    }
    return 'main';
  },

  async hasRemoteBranch(repoDir: string, branch: string): Promise<boolean> {
    const r = await runGit(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0;
  },

  async remoteUrl(dir: string): Promise<string | null> {
    const r = await runGit(['remote', 'get-url', 'origin'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const url = r.stdout.trim();
    return url === '' ? null : url;
  },

  async originConfigUrl(dir: string): Promise<string | null> {
    const r = await runGit(['config', '--get', 'remote.origin.url'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const url = r.stdout.trim();
    return url === '' ? null : url;
  },

  async isGitDir(dir: string): Promise<boolean> {
    const r = await runGit(['rev-parse', '--git-dir'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0;
  },

  async setRemoteUrl(repoDir: string, url: string): Promise<void> {
    await runGitOk(['remote', 'set-url', 'origin', '--', url], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
  },

  async remoteSetHeadAuto(repoDir: string, cred: BoundGitCredentials | null): Promise<void> {
    await runGitOk(['remote', 'set-head', 'origin', '--auto'], {
      cwd: repoDir,
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  async hasLocalBranch(repoDir: string, branch: string): Promise<boolean> {
    const r = await runGit(['rev-parse', '--verify', `refs/heads/${branch}`], {
      cwd: repoDir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0;
  },

  async countRemoteAhead(repoDir: string, branch: string): Promise<number> {
    const local = await gitPrim.hasLocalBranch(repoDir, branch);
    const range = local ? `refs/heads/${branch}..refs/remotes/origin/${branch}` : '';
    const args = local
      ? ['rev-list', '--count', range]
      : ['rev-list', '--count', `refs/remotes/origin/${branch}`];
    const r = await runGit(args, { cwd: repoDir, timeoutMs: META_TIMEOUT_MS });
    if (r.code !== 0) return 0;
    const n = Number.parseInt(r.stdout.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  },

  async worktreeAdd(
    repoDir: string,
    branch: string,
    dir: string,
    base: string | null,
  ): Promise<void> {
    const args =
      base !== null
        ? ['worktree', 'add', '-b', branch, dir, base]
        : ['worktree', 'add', dir, branch];
    await runGitOk(args, { cwd: repoDir, timeoutMs: CHECKOUT_TIMEOUT_MS });
  },

  async exportTree(repoDir: string, ref: string, dir: string): Promise<void> {
    const indexFile = join(dir, '.cairn-export-index');
    const env = { GIT_INDEX_FILE: indexFile };
    try {
      await runGitOk(['read-tree', '--end-of-options', ref], {
        cwd: repoDir,
        env,
        timeoutMs: META_TIMEOUT_MS,
      });
      await runGitOk(['--work-tree', dir, 'checkout-index', '--all', '--force'], {
        cwd: repoDir,
        env,
        timeoutMs: CHECKOUT_TIMEOUT_MS,
      });
    } finally {
      rmSync(indexFile, { force: true });
    }
  },

  async worktreeRemoveForce(repoDir: string, dir: string): Promise<void> {
    await runGitOk(['worktree', 'remove', '--force', dir], {
      cwd: repoDir,
      timeoutMs: CHECKOUT_TIMEOUT_MS,
    });
  },

  async worktreePrune(repoDir: string): Promise<void> {
    await runGitOk(['worktree', 'prune'], { cwd: repoDir, timeoutMs: META_TIMEOUT_MS });
  },

  async branchDelete(repoDir: string, branch: string): Promise<void> {
    await runGitOk(['branch', '-D', branch], { cwd: repoDir, timeoutMs: META_TIMEOUT_MS });
  },

  async currentBranch(dir: string): Promise<string | null> {
    const r = await runGit(['branch', '--show-current'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
    return r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
  },

  async checkout(dir: string, ref: string, force: boolean): Promise<void> {
    const args = force ? ['checkout', '--force', ref, '--'] : ['checkout', ref, '--'];
    await runGitOk(args, { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  async resetHard(dir: string, commit: string): Promise<void> {
    const oid = await runGitOk(
      ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`],
      { cwd: dir, timeoutMs: META_TIMEOUT_MS },
    );
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) {
      throw new Error(`git reset failed: resolved revision is not an object id (${oid})`);
    }
    await runGitOk(['reset', '--hard', oid], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  async cleanFd(dir: string): Promise<void> {
    await runGitOk(['clean', '-fd'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  async addAll(dir: string): Promise<void> {
    await runGitOk(['add', '-A'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  async stagedPathsContaining(
    dir: string,
    needle: string,
    paths: readonly string[],
  ): Promise<string[]> {
    if (paths.length === 0) return [];
    const r = await runGit(['grep', '--cached', '-l', '-F', '-e', needle, '--', ...paths], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  },

  async unstagePath(dir: string, path: string): Promise<void> {
    await runGitOk(['reset', '-q', '--', path], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
  },

  async pathsContainingInRef(
    dir: string,
    ref: string,
    needle: string,
    paths: readonly string[],
  ): Promise<string[]> {
    if (paths.length === 0) return [];
    const r = await runGit(['grep', '-l', '-F', '-e', needle, ref, '--', ...paths], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const sep = line.indexOf(':');
        return sep === -1 ? line : line.slice(sep + 1);
      });
  },

  async commit(dir: string, message: string, identity: CommitIdentity): Promise<boolean> {
    const r = await runGit(['commit', '-m', message], {
      cwd: dir,
      env: commitEnv(identity),
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code === 0) return true;
    if (/nothing to commit/i.test(r.stdout) || /nothing to commit/i.test(r.stderr)) return false;
    throw new Error(`git commit failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  },

  async head(dir: string): Promise<string | null> {
    const r = await runGit(['rev-parse', '--verify', 'HEAD'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const sha = r.stdout.trim();
    return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
  },

  async push(dir: string, branch: string, cred: BoundGitCredentials | null): Promise<void> {
    const traceDir = mkdtempSync(join(tmpdir(), 'cairn-push-'));
    const traceFile = join(traceDir, 'trace.jsonl');
    try {
      const result = await runGit(['push', '--end-of-options', 'origin', `refs/heads/${branch}`], {
        cwd: dir,
        env: {
          ...(cred ? gitCredentialEnv(cred) : machineGitEnv()),
          GIT_TRACE2_EVENT: traceFile,
        },
        timeoutMs: NET_TIMEOUT_MS,
      });
      if (result.code === 0) return;
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
      const hooks = new Set<number>();
      for (const line of readFileSync(traceFile, 'utf8').split('\n')) {
        if (line === '') continue;
        const event = JSON.parse(line) as {
          event?: string;
          child_class?: string;
          hook_name?: string;
          child_id?: number;
          code?: number;
          sid?: string;
        };
        if (event.sid?.includes('/')) continue;
        if (
          event.event === 'child_start' &&
          event.child_class === 'hook' &&
          event.hook_name === 'pre-push' &&
          event.child_id !== undefined
        )
          hooks.add(event.child_id);
        if (
          event.event === 'child_exit' &&
          event.child_id !== undefined &&
          hooks.has(event.child_id) &&
          event.code !== undefined &&
          event.code !== 0
        )
          throw new GitPushHookError(output);
      }
      throw new Error(
        `git push failed (${result.code ?? `signal ${result.signal ?? 'unknown'}`}): ${output}`,
      );
    } finally {
      rmSync(traceDir, { recursive: true, force: true });
    }
  },

  async tagCreate(
    dir: string,
    tag: string,
    message: string,
    commit: string | null,
    identity: CommitIdentity,
  ): Promise<void> {
    await runGitOk(
      ['tag', '-a', '-m', message, '--end-of-options', tag, ...(commit ? [commit] : [])],
      { cwd: dir, env: commitEnv(identity), timeoutMs: META_TIMEOUT_MS },
    );
  },

  async tagPush(dir: string, tag: string, cred: BoundGitCredentials | null): Promise<void> {
    await runGitOk(['push', '--end-of-options', 'origin', `refs/tags/${tag}`], {
      cwd: dir,
      env: cred ? gitCredentialEnv(cred) : machineGitEnv(),
      timeoutMs: NET_TIMEOUT_MS,
    });
  },

  async mergeNoEdit(dir: string, ref: string): Promise<string> {
    const r = await runGit(['merge', '--no-edit', '--end-of-options', ref], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code === 0) return r.stdout.trim();
    if (/conflict/i.test(r.stdout + r.stderr)) {
      await runGit(['merge', '--abort'], { cwd: dir, timeoutMs: META_TIMEOUT_MS });
      throw new Error(`merge conflict against ${ref} (aborted; manual rerun required)`);
    }
    throw new Error(`git merge failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  },

  async countAhead(dir: string, defaultBranch: string): Promise<number> {
    const r = await runGit(['rev-list', '--count', `refs/remotes/origin/${defaultBranch}..HEAD`], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return 0;
    const n = Number.parseInt(r.stdout.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  },

  async commitsAhead(dir: string, defaultBranch: string): Promise<string[]> {
    const output = await runGitOk(
      ['rev-list', '--reverse', `refs/remotes/origin/${defaultBranch}..HEAD`],
      { cwd: dir, timeoutMs: META_TIMEOUT_MS },
    );
    return output.split('\n').filter((line) => line !== '');
  },

  async branchesWithNewCommits(
    dir: string,
    baseCommit: string,
    sinceMs: number,
  ): Promise<string[]> {
    const r = await runGit(
      [
        'for-each-ref',
        'refs/heads',
        '--sort=-committerdate',
        '--format=%(refname:short)\t%(committerdate:unix)\t%(objectname)',
      ],
      { cwd: dir, timeoutMs: META_TIMEOUT_MS },
    );
    if (r.code !== 0) return [];
    const found: string[] = [];
    let revCalls = 0;
    for (const line of r.stdout.split('\n')) {
      if (revCalls >= BRANCH_SCAN_MAX_REVS) break;
      const [name, unix, sha] = line.split('\t');
      if (name === undefined || unix === undefined || sha === undefined) continue;
      const tipMs = Number.parseInt(unix, 10) * 1_000;
      if (Number.isNaN(tipMs)) continue;
      if (tipMs < sinceMs - BRANCH_SCAN_SKEW_MS) break;
      revCalls++;
      const c = await runGit(['rev-list', '--count', `${baseCommit}..${sha}`], {
        cwd: dir,
        timeoutMs: META_TIMEOUT_MS,
      });
      if (c.code !== 0) continue;
      const n = Number.parseInt(c.stdout.trim(), 10);
      if (!Number.isNaN(n) && n > 0) found.push(name);
    }
    return found;
  },

  async diffAgainstRemoteDefault(dir: string, defaultBranch: string): Promise<string> {
    const r = await runGit(['diff', `origin/${defaultBranch}...HEAD`], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return '';
    return r.stdout;
  },

  async commitTime(dir: string, commit: string): Promise<number | null> {
    const r = await runGit(['log', '-1', '--format=%ct', '--end-of-options', commit], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const secs = Number.parseInt(r.stdout.trim(), 10);
    return Number.isNaN(secs) ? null : secs * 1000;
  },

  async commonGitDir(dir: string): Promise<string | null> {
    const r = await runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0 && r.stdout.trim() !== '' ? r.stdout.trim() : null;
  },
};

export const GIT_NET_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;

export async function withGitNetRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= GIT_NET_RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof GitPushHookError || isGitAuthFailure(msg)) break;
      if (!isGitTransientNetFailure(msg)) break;
      const delay = GIT_NET_RETRY_DELAYS_MS[i];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
