import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

const GIT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const STALE_PREFIXES = ['eval-lane-', 'eval-lane-tmp-'];

export function commitExists(repoRoot: string, sha: string): boolean {
  if (!/^[0-9a-f]{40}$/i.test(sha)) return false;
  const res = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  return res.status === 0;
}

export function parentOfCommit(repoRoot: string, sha: string): string | null {
  if (!/^[0-9a-f]{40}$/i.test(sha)) return null;
  const res = spawnSync('git', ['rev-parse', '--verify', `${sha}^`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (res.status !== 0) return null;
  const parent = res.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(parent) ? parent : null;
}

export function isRegularBlobAtCommit(repoRoot: string, sha: string, relPath: string): boolean {
  const res = spawnSync('git', ['ls-tree', sha, '--', relPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (res.status !== 0) return false;
  return /^(?:100644|100755) blob [0-9a-f]{40}\t/.test(res.stdout.trim());
}

export function materializeCommitTree(repoRoot: string, sha: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const tarPath = `${resolve(destDir)}.archive.tar`;
  try {
    execFileSync('git', ['archive', '--format=tar', '-o', tarPath, sha], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('tar', ['-xf', tarPath, '-C', destDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    rmSync(tarPath, { force: true });
  }
}

export function initBaselineRepo(destDir: string): string {
  execFileSync('git', ['init', '-q'], { cwd: destDir, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['add', '-A'], { cwd: destDir, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=eval@cairn.dev',
      '-c',
      'user.name=eval',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: destDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: destDir,
    encoding: 'utf8',
  }).trim();
}

function workspaceNodeModules(repoRoot: string): string[] {
  const candidates = ['node_modules'];
  for (const top of ['apps', 'packages']) {
    const dir = join(repoRoot, top);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(top, entry.name, 'node_modules'));
    }
  }
  candidates.push(join('integration', 'node_modules'));
  candidates.push(join('eval', 'node_modules'));
  return candidates.filter((rel) => existsSync(join(repoRoot, rel)));
}

function mirrorNodeModulesDir(
  repoRoot: string,
  srcDir: string,
  dstDir: string,
  destRoot: string,
  depth = 0,
): void {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcEntry = join(srcDir, entry);
    const dstEntry = join(dstDir, entry);
    let alreadyExists = false;
    try {
      lstatSync(dstEntry);
      alreadyExists = true;
    } catch {}
    if (alreadyExists) continue;
    const stat = lstatSync(srcEntry);
    if (stat.isSymbolicLink()) {
      const rawTarget = resolve(srcDir, readlinkSync(srcEntry));
      const absTarget = existsSync(rawTarget) ? realpathSync(rawTarget) : rawTarget;
      const relTarget = relative(repoRoot, absTarget);
      const isWorkspacePkg =
        relTarget !== '' &&
        !relTarget.startsWith('..') &&
        !relTarget.split(/[\\/]/).includes('node_modules') &&
        existsSync(join(destRoot, relTarget));
      symlinkSync(isWorkspacePkg ? join(destRoot, relTarget) : absTarget, dstEntry);
      continue;
    }
    if (depth === 0 && entry.startsWith('@') && stat.isDirectory()) {
      mirrorNodeModulesDir(repoRoot, srcEntry, dstEntry, destRoot, 1);
      continue;
    }
    symlinkSync(srcEntry, dstEntry);
  }
}

export function linkDependencyDirs(repoRoot: string, destDir: string): void {
  const resolvedRoot = realpathSync(repoRoot);
  const resolvedDest = realpathSync(destDir);
  for (const rel of workspaceNodeModules(resolvedRoot)) {
    mirrorNodeModulesDir(
      resolvedRoot,
      join(resolvedRoot, rel),
      join(resolvedDest, rel),
      resolvedDest,
    );
  }
}

function ensureSafeParentDirs(destReal: string, destDir: string, parts: string[]): string {
  let current = destDir;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const segment = parts[i];
    if (!segment || segment === '.' || segment === '..') {
      throw new Error(`unsafe relative path segment: ${parts.join('/')}`);
    }
    current = join(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        rmSync(current, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!existsSync(current)) mkdirSync(current);
    const currentReal = realpathSync(current);
    if (currentReal !== destReal && !currentReal.startsWith(`${destReal}${sep}`)) {
      throw new Error(`path escapes destination directory: ${parts.join('/')}`);
    }
  }
  return current;
}

export function overlayCommitFiles(
  repoRoot: string,
  sha: string,
  relPaths: string[],
  destDir: string,
): void {
  if (relPaths.length === 0) return;
  const destReal = realpathSync(destDir);
  for (const relPath of relPaths) {
    if (
      !relPath ||
      relPath.startsWith('/') ||
      relPath.includes('\\') ||
      relPath.split('/').includes('..')
    ) {
      throw new Error(`invalid overlay path: ${relPath}`);
    }
    if (!isRegularBlobAtCommit(repoRoot, sha, relPath)) {
      throw new Error(`missing blob ${relPath} at ${sha.slice(0, 10)}`);
    }
    const parts = relPath.split('/').filter(Boolean);
    const leaf = parts.at(-1);
    if (!leaf) throw new Error(`invalid overlay path: ${relPath}`);
    const parentDir = ensureSafeParentDirs(destReal, destDir, parts);
    const target = join(parentDir, leaf);
    rmSync(target, { recursive: true, force: true });
    const content = execFileSync('git', ['show', `${sha}:${relPath}`], {
      cwd: repoRoot,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
    });
    writeFileSync(target, content);
  }
}

export function sweepStaleTempDirs(
  baseTmpDir = tmpdir(),
  maxAgeMs = 24 * 3600 * 1000,
  nowMs = Date.now(),
): void {
  try {
    for (const name of readdirSync(baseTmpDir)) {
      if (!STALE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      const fullPath = join(baseTmpDir, name);
      try {
        const stat = statSync(fullPath);
        if (nowMs - stat.mtimeMs > maxAgeMs) {
          rmSync(fullPath, { recursive: true, force: true });
        }
      } catch {}
    }
  } catch {}
}
