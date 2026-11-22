import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  GitCgiRequest,
  GitCgiResponse,
  GitFileAtRef,
  GitOps,
  GitRefInfo,
  GitTreeEntry,
} from '@cairn/shared';
import type { CompareFile } from '@cairn/shared/merge-gate';

export interface GitRunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const REPO_BINDING_ENV =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES)$/;

function inheritedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (REPO_BINDING_ENV.test(key)) delete env[key];
  return env;
}

export function runGit(
  args: string[],
  opts: { cwd?: string; stdin?: Uint8Array; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      // a pushed refs/replace/* ref must never change what server-side git reads see
      env: { ...inheritedGitEnv(), ...opts.env, GIT_NO_REPLACE_OBJECTS: '1' },
      windowsHide: true,
      ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    });
    const stdout: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr }),
    );
    // an in-flight stdin write becomes EPIPE when the child closes its read end early
    child.stdin.on('error', () => {});
    if (opts.stdin !== undefined) {
      child.stdin.end(Buffer.from(opts.stdin));
    } else {
      child.stdin.end();
    }
  });
}

const META_TIMEOUT_MS = 15_000;
export const DEFAULT_HEAD_BRANCH = 'main';

export function isSafeRepoPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\0')) return false;
  return !path.split('/').includes('..');
}

export function looksBinary(buf: Uint8Array): boolean {
  return buf.subarray(0, 8000).includes(0);
}

export function decodeCgiResponse(raw: Buffer): GitCgiResponse {
  let split = -1;
  let splitLen = 0;
  for (const [needle, len] of [
    ['\r\n\r\n', 4],
    ['\n\n', 2],
  ] as const) {
    const idx = raw.indexOf(needle);
    if (idx >= 0 && (split === -1 || idx < split)) {
      split = idx;
      splitLen = len;
    }
  }
  const headText = split === -1 ? raw.toString('utf8') : raw.subarray(0, split).toString('utf8');
  let body = split === -1 ? Buffer.alloc(0) : raw.subarray(split + splitLen);

  let status = 200;
  const headers: [string, string][] = [];
  let chunked = false;
  for (const line of headText.split(/\r?\n/)) {
    if (line === '') continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const name = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (name.toLowerCase() === 'status') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isInteger(parsed)) status = parsed;
      continue;
    }
    if (name.toLowerCase() === 'transfer-encoding') {
      chunked = value.toLowerCase().includes('chunked');
      continue;
    }
    headers.push([name, value]);
  }
  if (chunked) body = decodeChunked(body);
  return { status, headers, body };
}

const REPLACE_REFS_PREFIX = 'refs/replace';

async function transferHideRefs(dir: string): Promise<string[]> {
  const listed = await runGit(['config', '--get-all', 'transfer.hideRefs'], {
    cwd: dir,
    timeoutMs: META_TIMEOUT_MS,
  });
  return listed.code === 0 ? listed.stdout.toString('utf8').split('\n') : [];
}

async function denyReplaceRefs(dir: string): Promise<void> {
  // the dir itself must be the git dir; inside an unrelated repo the config write would land there
  const probe = await runGit(['rev-parse', '--absolute-git-dir'], {
    cwd: dir,
    timeoutMs: META_TIMEOUT_MS,
  });
  if (probe.code !== 0 || probe.stdout.toString('utf8').trim() !== realpathSync(dir)) return;
  if ((await transferHideRefs(dir)).includes(REPLACE_REFS_PREFIX)) return;
  const added = await runGit(['config', '--add', 'transfer.hideRefs', REPLACE_REFS_PREFIX], {
    cwd: dir,
    timeoutMs: META_TIMEOUT_MS,
  });
  // a racing first touch may hold the config lock; the value it wrote satisfies the guard
  if (added.code !== 0 && !(await transferHideRefs(dir)).includes(REPLACE_REFS_PREFIX)) {
    throw new Error(`git config transfer.hideRefs failed: ${added.stderr}`);
  }
}

export function decodeChunked(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const lineEnd = buf.indexOf('\n', pos);
    if (lineEnd === -1) break;
    const sizeHex = buf.subarray(pos, lineEnd).toString('ascii').trim();
    const size = Number.parseInt(sizeHex.split(';')[0] ?? '', 16);
    if (!Number.isFinite(size) || Number.isNaN(size)) break;
    pos = lineEnd + 1;
    if (size === 0) break;
    out.push(buf.subarray(pos, pos + size));
    pos += size;
    if (buf[pos] === 0x0d) pos += 1;
    if (buf[pos] === 0x0a) pos += 1;
  }
  return Buffer.concat(out);
}

function parseLsTreeLines(stdout: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const line of stdout.toString('utf8').split('\n')) {
    if (line === '') continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const path = line.slice(tab + 1);
    if (meta[1] !== 'tree' && meta[1] !== 'blob') continue;
    const type = meta[1] === 'tree' ? 'tree' : 'blob';
    const rawSize = meta[3];
    const size = rawSize !== undefined && rawSize !== '-' ? Number.parseInt(rawSize, 10) : null;
    const name = path.split('/').filter(Boolean).pop() ?? path;
    entries.push({
      name,
      path,
      type,
      size: Number.isNaN(size) ? null : size,
    });
  }
  return entries;
}

export async function lsFilesRecursive(dir: string, commit: string): Promise<GitTreeEntry[]> {
  const r = await runGit(['ls-tree', '-r', '-t', '-l', commit, '--'], {
    cwd: dir,
    timeoutMs: META_TIMEOUT_MS,
  });
  if (r.code !== 0) return [];
  return parseLsTreeLines(r.stdout);
}

export interface GitTreeChange {
  path: string;
  status: string;
  mode: string;
  sha: string;
  size: number | null;
}

export interface GitBlobEntry {
  mode: string;
  sha: string;
  size: number | null;
}

export interface GitFileVersion {
  commit: string;
  at: number;
  subject: string;
}

const FULL_SHA = /^[0-9a-f]{40,64}$/;
const SERVER_COMMIT_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 'cairn-git',
  GIT_AUTHOR_EMAIL: 'git@localhost',
  GIT_COMMITTER_NAME: 'cairn-git',
  GIT_COMMITTER_EMAIL: 'git@localhost',
};

function requireFullSha(...shas: string[]): void {
  for (const sha of shas) if (!FULL_SHA.test(sha)) throw new Error(`unsafe commit: ${sha}`);
}

async function objectSizes(dir: string, shas: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  if (shas.length === 0) return sizes;
  const r = await runGit(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    cwd: dir,
    stdin: Buffer.from(`${shas.join('\n')}\n`),
    timeoutMs: 30_000,
  });
  if (r.code !== 0) throw new Error(`git cat-file failed: ${r.stderr}`);
  for (const line of r.stdout.toString('utf8').split('\n')) {
    const [sha, type, size] = line.split(' ');
    if (sha !== undefined && type === 'blob' && size !== undefined) sizes.set(sha, Number(size));
  }
  return sizes;
}

export async function diffTreeChanges(
  dir: string,
  base: string,
  head: string,
): Promise<GitTreeChange[]> {
  requireFullSha(base, head);
  const r = await runGit(['diff-tree', '-r', '-z', '--no-renames', base, head], {
    cwd: dir,
    timeoutMs: 30_000,
  });
  if (r.code !== 0) throw new Error(`git diff-tree failed: ${r.stderr}`);
  const parts = r.stdout.toString('utf8').split('\0');
  const raw: Omit<GitTreeChange, 'size'>[] = [];
  for (let i = 0; i + 1 < parts.length && parts[i] !== ''; i += 2) {
    const [, mode, , sha, status] = (parts[i] ?? '').slice(1).split(' ');
    const path = parts[i + 1];
    if (mode === undefined || sha === undefined || status === undefined || !path) {
      throw new Error('Unreadable git diff-tree output');
    }
    raw.push({ path, status, mode, sha });
  }
  const sizes = await objectSizes(
    dir,
    raw.filter((c) => c.status !== 'D').map((c) => c.sha),
  );
  return raw.map((c) => ({ ...c, size: sizes.get(c.sha) ?? null }));
}

export async function commitTree(
  dir: string,
  treeish: string,
  parent: string,
  message: string,
): Promise<string> {
  requireFullSha(parent);
  const r = await runGit(['commit-tree', treeish, '-p', parent, '-m', message], {
    cwd: dir,
    env: SERVER_COMMIT_ENV,
    timeoutMs: META_TIMEOUT_MS,
  });
  const sha = r.stdout.toString('utf8').trim();
  if (r.code !== 0 || !FULL_SHA.test(sha)) throw new Error(`git commit-tree failed: ${r.stderr}`);
  return sha;
}

export async function swapBranchRef(
  dir: string,
  branch: string,
  next: string,
  expected: string,
): Promise<boolean> {
  requireFullSha(next, expected);
  if (!/^[\w./-]+$/.test(branch)) throw new Error(`unsafe branch: ${branch}`);
  const r = await runGit(['update-ref', `refs/heads/${branch}`, next, expected], {
    cwd: dir,
    timeoutMs: META_TIMEOUT_MS,
  });
  return r.code === 0;
}

export async function blobEntryAt(
  dir: string,
  commit: string,
  path: string,
): Promise<GitBlobEntry | null> {
  requireFullSha(commit);
  if (!isSafeRepoPath(path)) throw new Error(`unsafe path: ${path}`);
  const r = await runGit(['--literal-pathspecs', 'ls-tree', '-l', '-z', commit, '--', path], {
    cwd: dir,
    timeoutMs: META_TIMEOUT_MS,
  });
  if (r.code !== 0) return null;
  for (const record of r.stdout.toString('utf8').split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0 || record.slice(tab + 1) !== path) continue;
    const [mode, type, sha, size] = record.slice(0, tab).split(/\s+/);
    if (type === 'tree' || mode === undefined || sha === undefined) return null;
    return { mode, sha, size: size === undefined || size === '-' ? null : Number(size) };
  }
  return null;
}

export async function treeWithBlob(
  dir: string,
  commit: string,
  path: string,
  entry: GitBlobEntry,
): Promise<string> {
  requireFullSha(commit, entry.sha);
  if (!isSafeRepoPath(path) || !/^\d{6}$/.test(entry.mode)) throw new Error(`unsafe path: ${path}`);
  const index = join(dir, `cairn-index-${randomUUID()}`);
  const opts = { cwd: dir, env: { GIT_INDEX_FILE: index }, timeoutMs: 30_000 };
  try {
    const read = await runGit(['read-tree', commit], opts);
    if (read.code !== 0) throw new Error(`git read-tree failed: ${read.stderr}`);
    const add = await runGit(
      ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.sha},${path}`],
      opts,
    );
    if (add.code !== 0) throw new Error(`git update-index failed: ${add.stderr}`);
    const write = await runGit(['write-tree'], opts);
    const tree = write.stdout.toString('utf8').trim();
    if (write.code !== 0 || !FULL_SHA.test(tree)) {
      throw new Error(`git write-tree failed: ${write.stderr}`);
    }
    return tree;
  } finally {
    rmSync(index, { force: true });
  }
}

export async function fileHistory(
  dir: string,
  branch: string,
  path: string,
): Promise<GitFileVersion[]> {
  if (!isSafeRepoPath(path) || !/^[\w./-]+$/.test(branch)) throw new Error(`unsafe path: ${path}`);
  const r = await runGit(
    [
      '--literal-pathspecs',
      'log',
      '-z',
      '--format=%H%x1f%ct%x1f%s',
      `refs/heads/${branch}`,
      '--',
      path,
    ],
    { cwd: dir, timeoutMs: 30_000 },
  );
  if (r.code !== 0) return [];
  return r.stdout
    .toString('utf8')
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const [commit = '', at = '0', subject = ''] = record.split('\x1f');
      return { commit, at: Number(at) * 1000, subject };
    });
}

export const systemGitOps: GitOps = {
  async initBareRepo(dir) {
    const init = await runGit(['init', '--bare', dir], { timeoutMs: META_TIMEOUT_MS });
    if (init.code !== 0) throw new Error(`git init --bare failed: ${init.stderr}`);
    const steps: string[][] = [
      ['symbolic-ref', 'HEAD', `refs/heads/${DEFAULT_HEAD_BRANCH}`],
      ['config', 'http.receivepack', 'true'],
      ['config', 'http.uploadpack', 'true'],
      ['config', 'transfer.hideRefs', REPLACE_REFS_PREFIX],
    ];
    for (const args of steps) {
      const r = await runGit(args, { cwd: dir, timeoutMs: META_TIMEOUT_MS });
      if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
    }
  },

  async seedInitialCommit(dir, message) {
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const env: NodeJS.ProcessEnv = {
      GIT_AUTHOR_NAME: 'cairn-git',
      GIT_AUTHOR_EMAIL: 'git@localhost',
      GIT_COMMITTER_NAME: 'cairn-git',
      GIT_COMMITTER_EMAIL: 'git@localhost',
    };
    const ct = await runGit(['commit-tree', emptyTree, '-m', message], {
      cwd: dir,
      env,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (ct.code !== 0) throw new Error(`git commit-tree failed: ${ct.stderr}`);
    const sha = ct.stdout.toString('utf8').trim();
    const up = await runGit(['update-ref', `refs/heads/${DEFAULT_HEAD_BRANCH}`, sha], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (up.code !== 0) throw new Error(`git update-ref failed: ${up.stderr}`);
    return sha;
  },

  async isAncestor(dir, ancestor, commit) {
    const r = await runGit(['merge-base', '--is-ancestor', '--end-of-options', ancestor, commit], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    return r.code === 0;
  },

  async updateBranchRef(dir, branch, commit) {
    if (!/^[\w./-]+$/.test(branch) || !/^[0-9a-f]{40,64}$/.test(commit)) {
      throw new Error(`unsafe ref update: ${branch} ${commit}`);
    }
    const r = await runGit(['update-ref', `refs/heads/${branch}`, commit], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) throw new Error(`git update-ref failed: ${r.stderr}`);
  },

  async denyPushes(dir, refPrefixes) {
    for (const prefix of refPrefixes) {
      if (!/^refs\/[\w./-]+$/.test(prefix)) throw new Error(`unsafe ref prefix: ${prefix}`);
      const r = await runGit(['config', '--add', 'receive.hideRefs', prefix], {
        cwd: dir,
        timeoutMs: META_TIMEOUT_MS,
      });
      if (r.code !== 0) throw new Error(`git config receive.hideRefs failed: ${r.stderr}`);
    }
  },

  async resolveCommit(dir, ref) {
    const r = await runGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    const sha = r.stdout.toString('utf8').trim();
    return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
  },

  async isGitRepo(dir) {
    try {
      const r = await runGit(['rev-parse', '--show-toplevel'], {
        cwd: dir,
        timeoutMs: META_TIMEOUT_MS,
      });
      if (r.code !== 0) return false;
      const toplevel = r.stdout.toString('utf8').trim();
      return toplevel !== '' && realpathSync(toplevel) === realpathSync(dir);
    } catch {
      return false;
    }
  },

  async lsTree(dir, commit, subPath) {
    const args = ['ls-tree', '-l', commit];
    if (subPath !== undefined && subPath !== '') {
      if (!isSafeRepoPath(subPath)) throw new Error(`unsafe path: ${subPath}`);
      args.push('--', subPath.endsWith('/') ? subPath : `${subPath}/`);
    }
    const r = await runGit(args, { cwd: dir, timeoutMs: META_TIMEOUT_MS });
    if (r.code !== 0) return [];
    return parseLsTreeLines(r.stdout);
  },

  async readFileAt(dir, commit, path): Promise<GitFileAtRef | null> {
    if (!isSafeRepoPath(path)) throw new Error(`unsafe path: ${path}`);
    const r = await runGit(['cat-file', 'blob', `${commit}:${path}`], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    if (r.code !== 0) return null;
    return { size: r.stdout.byteLength, content: new Uint8Array(r.stdout) };
  },

  async localCompareFiles(dir: string, base: string, head: string): Promise<CompareFile[]> {
    for (const sha of [base, head]) {
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`unsafe local compare commit: ${sha}`);
    }
    const args = [
      '--literal-pathspecs',
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
    ];
    const nameResult = await runGit(
      [...args, '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'],
      { cwd: dir, timeoutMs: 30_000 },
    );
    if (nameResult.code !== 0) throw new Error(`git diff failed: ${nameResult.stderr}`);
    const parts = nameResult.stdout.toString('utf8').split('\0');
    const files: CompareFile[] = [];
    for (let i = 0; i < parts.length && parts[i] !== ''; ) {
      const status = parts[i++] ?? '';
      const first = parts[i++];
      const renamed = status.startsWith('R');
      const filename = renamed ? parts[i++] : first;
      if (!filename || !first) throw new Error('Unreadable local diff');
      const paths = renamed ? [first, filename] : [filename];
      const numstat = await runGit([...args, '--numstat', `${base}...${head}`, '--', ...paths], {
        cwd: dir,
        timeoutMs: 30_000,
      });
      if (numstat.code !== 0) throw new Error(`git diff failed: ${numstat.stderr}`);
      const [added, removed] = numstat.stdout.toString('utf8').trim().split('\t');
      const diffResult = await runGit(
        [...args, '--unified=3', `${base}...${head}`, '--', ...paths],
        { cwd: dir, timeoutMs: 30_000 },
      );
      if (diffResult.code !== 0) throw new Error(`git diff failed: ${diffResult.stderr}`);
      const diff = diffResult.stdout.toString('utf8').replace(/\n$/, '');
      const hunk = diff.indexOf('\n@@');
      const patch = hunk === -1 ? null : diff.slice(hunk + 1);
      const shaResult = await runGit(
        ['rev-parse', '--verify', `${status === 'D' ? base : head}:${filename}`],
        { cwd: dir, timeoutMs: META_TIMEOUT_MS },
      );
      if (shaResult.code !== 0) throw new Error(`git rev-parse failed: ${shaResult.stderr}`);
      files.push({
        status: renamed
          ? 'renamed'
          : status === 'A'
            ? 'added'
            : status === 'D'
              ? 'removed'
              : 'modified',
        filename,
        previousFilename: renamed ? first : null,
        sha: shaResult.stdout.toString('utf8').trim(),
        additions: added === '-' ? 0 : Number(added),
        deletions: removed === '-' ? 0 : Number(removed),
        patchSha: patch === null ? null : createHash('sha256').update(patch, 'utf8').digest('hex'),
      });
    }
    return files;
  },

  async listBranches(dir) {
    const head = await runGit(['symbolic-ref', '--short', 'HEAD'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    const defaultBranch = head.code === 0 ? head.stdout.toString('utf8').trim() || null : null;
    const refs = await runGit(['for-each-ref', 'refs/heads', '--format=%(refname:short)'], {
      cwd: dir,
      timeoutMs: META_TIMEOUT_MS,
    });
    const branches: GitRefInfo[] = refs.stdout
      .toString('utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((name) => ({ name, isDefault: name === defaultBranch }));
    return { defaultBranch, branches };
  },

  async httpBackend(req: GitCgiRequest): Promise<GitCgiResponse> {
    // existing repositories predate initBareRepo's transfer.hideRefs; backfill on first touch
    const repoName = req.pathInfo.slice(1).split('/')[0] ?? '';
    if (repoName.endsWith('.git')) await denyReplaceRefs(join(req.projectRoot, repoName));
    const env: NodeJS.ProcessEnv = {
      GIT_PROJECT_ROOT: req.projectRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: req.pathInfo,
      QUERY_STRING: req.queryString,
      REQUEST_METHOD: req.method,
      GIT_COMMITTER_NAME: 'cairn-git',
      GIT_COMMITTER_EMAIL: 'git@localhost',
      ...(req.contentType !== undefined ? { CONTENT_TYPE: req.contentType } : {}),
      ...(req.method === 'POST' ? { CONTENT_LENGTH: String(req.body.byteLength) } : {}),
      ...(req.remoteUser !== undefined ? { REMOTE_USER: req.remoteUser } : {}),
    };
    const r = await runGit(['http-backend'], { env, stdin: req.body });
    if (r.code !== 0 && r.stdout.byteLength === 0) {
      throw new Error(`git http-backend failed: ${r.stderr}`);
    }
    return decodeCgiResponse(r.stdout);
  },
};
