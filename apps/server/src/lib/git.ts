import { spawn } from 'node:child_process';
import type {
  GitCgiRequest,
  GitCgiResponse,
  GitFileAtRef,
  GitOps,
  GitRefInfo,
  GitTreeEntry,
} from '@cairn/shared';

export interface GitRunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export function runGit(
  args: string[],
  opts: { cwd?: string; stdin?: Uint8Array; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
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
      resolve({ code: code ?? 0, stdout: Buffer.concat(stdout), stderr }),
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
const DEFAULT_HEAD_BRANCH = 'main';

export function isSafeRepoPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\0')) return false;
  return !path.split('/').includes('..');
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

export const systemGitOps: GitOps = {
  async initBareRepo(dir) {
    const init = await runGit(['init', '--bare', dir], { timeoutMs: META_TIMEOUT_MS });
    if (init.code !== 0) throw new Error(`git init --bare failed: ${init.stderr}`);
    const steps: string[][] = [
      ['symbolic-ref', 'HEAD', `refs/heads/${DEFAULT_HEAD_BRANCH}`],
      ['config', 'http.receivepack', 'true'],
      ['config', 'http.uploadpack', 'true'],
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
      const r = await runGit(['rev-parse', '--is-inside-work-tree'], {
        cwd: dir,
        timeoutMs: META_TIMEOUT_MS,
      });
      return r.code === 0 && r.stdout.toString('utf8').trim() === 'true';
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
