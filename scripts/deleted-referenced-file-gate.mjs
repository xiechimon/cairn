#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './diff-base.mjs';
import { isLivingDoc, livingText } from './living-docs.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';

const DISTINCTIVE_EXT_RE = /\.(?:sh|bash|zsh|service|timer|plist)$/;
const OPS_SCRIPT_EXT_RE = /\.(?:mjs|mts|ts|js|py)$/;
const UNIT_OR_INSTALLER_RE =
  /(?:\.(?:service|timer|plist)$|^scripts\/ops\/install-.*\.(?:sh|bash|mjs|mts|ts|js)$|^ops\/.*\.(?:service|timer|plist|sh)$)/;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function runGit(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    env: scrubGitEnv({ ...process.env }),
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

function tryGit(root, args) {
  try {
    return runGit(root, args).toString('utf8').trim();
  } catch {
    return '';
  }
}

const splitNul = (buffer) => buffer.toString('utf8').split('\0').filter(Boolean);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDistinctiveBasenameCandidate(filePath) {
  if (DISTINCTIVE_EXT_RE.test(filePath)) return true;
  return filePath.startsWith('scripts/ops/') && OPS_SCRIPT_EXT_RE.test(filePath);
}

function isScannedTarget(filePath) {
  return isLivingDoc(filePath) || UNIT_OR_INSTALLER_RE.test(filePath);
}

function resolveDefaultBase(root) {
  const configured = process.env.PREPUSH_BASE_SHA;
  if (configured && !/^0{40}$/.test(configured)) {
    const resolved = mergeBase(root, configured);
    if (resolved) return resolved;
  }
  const upstreamRef = ['refs', 'remotes', 'origin', 'main'].join('/');
  if (tryGit(root, ['rev-parse', '--verify', '--quiet', upstreamRef])) {
    const fromUpstream = mergeBase(root, ['origin', 'main'].join('/'));
    if (fromUpstream) return fromUpstream;
  }
  const fromMain = mergeBase(root, 'main');
  if (fromMain) return fromMain;
  const parent = tryGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD~1']);
  return parent || null;
}

function verifyRev(root, rev) {
  try {
    return runGit(root, ['rev-parse', '--verify', `${rev}^{commit}`])
      .toString('utf8')
      .trim();
  } catch {
    throw new Error(`unknown git revision: ${rev}`);
  }
}

function deletedFilesBetween(root, baseSha, headSha) {
  const args = ['diff', '--no-renames', '--diff-filter=D', '--name-only', '-z', baseSha];
  if (headSha) args.push(headSha);
  return splitNul(runGit(root, args)).map((filePath) => filePath.replace(/\\/g, '/'));
}

function remainingTreeEntries(root, headSha) {
  const args = headSha ? ['ls-tree', '-r', '-z', headSha] : ['ls-files', '-s', '-z'];
  const entries = [];
  for (const line of splitNul(runGit(root, args))) {
    if (line.startsWith('120000') || line.startsWith('160000')) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    entries.push(line.slice(tab + 1).replace(/\\/g, '/'));
  }
  return entries;
}

function readTargetContents(root, paths, headSha) {
  const contents = new Map();
  if (paths.length === 0) return contents;
  if (!headSha) {
    for (const filePath of paths) {
      try {
        const raw = readFileSync(join(root, filePath), 'utf8');
        contents.set(filePath, isLivingDoc(filePath) ? livingText(filePath, raw) : raw);
      } catch (error) {
        if (error && error.code !== 'ENOENT') throw error;
      }
    }
    return contents;
  }
  const blobs = runGit(root, ['cat-file', '--batch'], {
    input: paths.map((filePath) => `${headSha}:${filePath}\n`).join(''),
  });
  let offset = 0;
  for (const filePath of paths) {
    const headerEnd = blobs.indexOf('\n', offset);
    if (headerEnd === -1) break;
    const header = blobs.subarray(offset, headerEnd).toString('utf8');
    if (header.endsWith(' missing')) {
      offset = headerEnd + 1;
      continue;
    }
    const size = Number(header.split(' ').at(-1));
    const raw = blobs.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8');
    contents.set(filePath, isLivingDoc(filePath) ? livingText(filePath, raw) : raw);
    offset = headerEnd + 1 + size + 1;
  }
  return contents;
}

function resolveRelativeLinkTarget(referencingFile, rawTarget) {
  let target = rawTarget;
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  const hash = target.indexOf('#');
  if (hash !== -1) target = target.slice(0, hash);
  const query = target.indexOf('?');
  if (query !== -1) target = target.slice(0, query);
  if (!target || target.startsWith('/') || URI_SCHEME_RE.test(target)) return null;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }
  const joined = posix.normalize(posix.join(posix.dirname(referencingFile), decoded));
  if (joined === '..' || joined.startsWith('../')) return null;
  return joined;
}

function buildDeletedMatchers(deleted, remainingPaths) {
  const remainingBasenames = new Set(remainingPaths.map((p) => posix.basename(p)));
  return deleted.map((delPath) => {
    const exactRe = new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(delPath)}(?![A-Za-z0-9_./-])`);
    const basename = posix.basename(delPath);
    const useBasename =
      isDistinctiveBasenameCandidate(delPath) && !remainingBasenames.has(basename);
    const basenameRe = useBasename
      ? new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(basename)}(?![A-Za-z0-9_./-])`)
      : null;
    return { delPath, exactRe, basenameRe };
  });
}

function matchLineForDeleted(line, referencingFile, isMarkdown, matcher) {
  if (matcher.exactRe.test(line)) return 'exact-path';
  if (isMarkdown) {
    MARKDOWN_LINK_RE.lastIndex = 0;
    let match = MARKDOWN_LINK_RE.exec(line);
    while (match !== null) {
      const target = match[1];
      if (target && resolveRelativeLinkTarget(referencingFile, target) === matcher.delPath) {
        return 'markdown-link';
      }
      match = MARKDOWN_LINK_RE.exec(line);
    }
  }
  if (matcher.basenameRe?.test(line)) return 'basename';
  return null;
}

export function checkDeletedReferences(cwd, options = {}) {
  const root = resolve(cwd);
  const headSha = options.headRef ? verifyRev(root, options.headRef) : null;
  const baseSha = options.baseRef ? verifyRev(root, options.baseRef) : resolveDefaultBase(root);
  if (!baseSha) return { deleted: [], violations: [] };
  const deleted = deletedFilesBetween(root, baseSha, headSha);
  if (deleted.length === 0) return { deleted: [], violations: [] };

  const deletedSet = new Set(deleted);
  const remainingPaths = remainingTreeEntries(root, headSha).filter((p) => !deletedSet.has(p));
  const scanPaths = remainingPaths.filter(isScannedTarget);
  const contents = readTargetContents(root, scanPaths, headSha);
  const matchers = buildDeletedMatchers(deleted, remainingPaths);
  const violations = [];

  for (const referencingFile of scanPaths) {
    const text = contents.get(referencingFile);
    if (!text) continue;
    const isMarkdown = referencingFile.endsWith('.md');
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index];
      if (!lineText) continue;
      for (const matcher of matchers) {
        const matchKind = matchLineForDeleted(lineText, referencingFile, isMarkdown, matcher);
        if (matchKind === null) continue;
        violations.push({
          deletedPath: matcher.delPath,
          referencingFile,
          line: index + 1,
          matchKind,
          snippet: lineText.trim().slice(0, 160),
        });
      }
    }
  }
  return { deleted, violations };
}

function parseCliArgs(argv) {
  let baseRef;
  let headRef;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') {
      const value = argv[i + 1];
      if (!value) throw new Error('missing value for --base');
      baseRef = value;
      i += 1;
      continue;
    }
    if (arg === '--head') {
      const value = argv[i + 1];
      if (!value) throw new Error('missing value for --head');
      headRef = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { baseRef, headRef };
}

function runCli() {
  const root = resolve(import.meta.dirname, '..');
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[deleted-referenced-file-gate] ${error.message}`);
    process.exit(2);
  }
  let result;
  try {
    result = checkDeletedReferences(root, args);
  } catch (error) {
    console.error(`[deleted-referenced-file-gate] ${error.message}`);
    process.exit(2);
  }
  if (result.violations.length === 0) {
    console.log(
      `[deleted-referenced-file-gate] ${result.deleted.length} deleted file(s): no dangling references in living docs or unit templates`,
    );
    process.exit(0);
  }
  for (const v of result.violations) {
    console.error(
      `${v.referencingFile}:${v.line}: references deleted ${v.deletedPath} (${v.matchKind}) — remove or update the reference in the same commit\n  ${v.snippet}`,
    );
  }
  console.error(
    `[deleted-referenced-file-gate] ${result.violations.length} dangling reference(s) to deleted file(s)`,
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
