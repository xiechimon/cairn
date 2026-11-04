import {
  AUTO_MERGE_PATH_GLOBS,
  CHIEF_DISPATCH_HARNESS_PATHS,
  type CompareFile,
  EVIDENCE_EXECUTABLE_EXTENSIONS,
  EVIDENCE_PREFIX,
  MERGE_GATE_SOURCE_GLOBS,
  PROTECTED_PATH_GLOBS,
} from '@cairn/shared/merge-gate';
import { isEvidencePath } from './digest.js';

export function globToRegExp(glob: string, { protect = false } = {}): RegExp {
  const tail = protect && glob.endsWith('/**');
  const g = tail ? glob.slice(0, -3) : glob;
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*' && g[i + 2] === '/') {
      re += '(?:.*/)?';
      i += 2;
    } else if (ch === '*' && g[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else {
      re += (ch ?? '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}${tail ? '(?:/.*)?' : ''}$`, protect ? 'iu' : 'i');
}

const protectedRe = (glob: string) => globToRegExp(glob, { protect: true });
const PROTECTED_RE = [...PROTECTED_PATH_GLOBS, ...MERGE_GATE_SOURCE_GLOBS].map(protectedRe);
const GATE_SOURCE_RE = MERGE_GATE_SOURCE_GLOBS.map(protectedRe);
const AUTO_MERGE_RE = AUTO_MERGE_PATH_GLOBS.map((glob) => globToRegExp(glob));
const TEST_DIR_RE = /(^|\/)(e2e|test|tests|__tests__)\//iu;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/iu;
const EVIDENCE_RE = protectedRe(`${EVIDENCE_PREFIX}**`);
const EXECUTABLE_RE = EVIDENCE_EXECUTABLE_EXTENSIONS.map((ext) => protectedRe(`**/*${ext}`));
const SAFE_PATH = /^[\p{L}\p{M}\p{N}._/@+%-]+$/u;

const matches = (path: string, res: readonly RegExp[]) => res.some((re) => re.test(path));
export const pathHitsProtectedCategory = (path: string): boolean =>
  matches(path, PROTECTED_RE) || !SAFE_PATH.test(path);
const isTestPath = (path: string) => TEST_DIR_RE.test(path) || TEST_FILE_RE.test(path);
const HARNESS_NAMES = new Set(CHIEF_DISPATCH_HARNESS_PATHS.map((p) => p.toLowerCase()));

export function touchesHarness(files: readonly CompareFile[]): boolean {
  return files.some((f) => {
    const names =
      f.previousFilename !== null && f.previousFilename !== f.filename
        ? [f.filename, f.previousFilename]
        : [f.filename];
    return names.some((name) => HARNESS_NAMES.has(name.toLowerCase()));
  });
}

export interface PathFindings {
  protected: string[];
  gateSource: string[];
  outsideAutoMerge: string[];
  deletedTests: string[];
  otherTicketEvidence: string[];
  executableEvidence: string[];
  opaque: string[];
}

export function classifyPaths(files: readonly CompareFile[], ticketRef: string): PathFindings {
  const out: PathFindings = {
    protected: [],
    gateSource: [],
    outsideAutoMerge: [],
    deletedTests: [],
    otherTicketEvidence: [],
    executableEvidence: [],
    opaque: [],
  };
  const push = (list: string[], path: string) => {
    if (!list.includes(path)) list.push(path);
  };
  const isEvidence = (name: string) => EVIDENCE_RE.test(name);

  for (const f of files) {
    const names =
      f.previousFilename !== null && f.previousFilename !== f.filename
        ? [f.filename, f.previousFilename]
        : [f.filename];
    for (const name of names) {
      if (!SAFE_PATH.test(name) || matches(name, PROTECTED_RE)) {
        push(out.protected, name);
        if (matches(name, GATE_SOURCE_RE)) push(out.gateSource, name);
      } else if (!matches(name, AUTO_MERGE_RE)) {
        push(out.outsideAutoMerge, name);
      }
      if (isEvidence(name) && !name.slice(EVIDENCE_PREFIX.length).startsWith(`${ticketRef}/`)) {
        push(out.otherTicketEvidence, name);
      }
      if (f.patchSha === null && !isEvidencePath(name)) push(out.opaque, name);
    }

    if (f.status === 'removed' && isTestPath(f.filename)) push(out.deletedTests, f.filename);
    if (f.status === 'renamed' && f.previousFilename !== null && isTestPath(f.previousFilename)) {
      push(out.deletedTests, f.previousFilename);
    }

    if (f.status !== 'removed' && isEvidence(f.filename) && matches(f.filename, EXECUTABLE_RE)) {
      push(out.executableEvidence, f.filename);
    }
  }
  return out;
}
