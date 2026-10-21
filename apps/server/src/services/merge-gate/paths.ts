// D4 路径判定（#1404，ADR 0021 D4）：默认拒绝。只有可自动合并集里、且不落入
// 保护类别的路径能不经人；改名两头（新名与原名）都要过一遍，保护文件改名
// 移走也算动了它。匹配不分大小写（macOS 默认文件系统不分），与
// .claude/workflows/pr-gate.js 用同一种 glob 写法，两边判同一份清单。
// 纯函数，无 I/O。

import {
  AUTO_MERGE_PATH_GLOBS,
  type CompareFile,
  EVIDENCE_EXECUTABLE_EXTENSIONS,
  EVIDENCE_PREFIX,
  MERGE_GATE_SOURCE_GLOBS,
  PROTECTED_PATH_GLOBS,
} from '@pacman/shared';

// `**/` 含仓根，`**` 跨目录，`*` 不跨目录；其余字符按字面。
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      re += '(?:.*/)?';
      i += 2;
    } else if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else {
      re += (ch ?? '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

const PROTECTED_RE = [...PROTECTED_PATH_GLOBS, ...MERGE_GATE_SOURCE_GLOBS].map(globToRegExp);
const GATE_SOURCE_RE = MERGE_GATE_SOURCE_GLOBS.map(globToRegExp);
const AUTO_MERGE_RE = AUTO_MERGE_PATH_GLOBS.map(globToRegExp);
const TEST_DIR_RE = /(^|\/)(e2e|test|tests|__tests__)\//;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const matches = (path: string, res: readonly RegExp[]) => res.some((re) => re.test(path));
const isTestPath = (path: string) => TEST_DIR_RE.test(path) || TEST_FILE_RE.test(path);

export interface PathFindings {
  /** 命中保护类别 ①–④ 的路径（改名按两头各算）。 */
  protected: string[];
  /** 其中属合并就绪闸自身源码（D4 ④）的。 */
  gateSource: string[];
  /** 不在可自动合并集里、也不在 protected 里的路径。 */
  outsideAutoMerge: string[];
  /** 删除的测试文件，或被改名成非测试路径的测试文件（记原名）。 */
  deletedTests: string[];
  /** 改动了别的票的证据目录（含删除）。 */
  otherTicketEvidence: string[];
  /** 本 PR 新增或改动的、证据目录里的可执行文件。 */
  executableEvidence: string[];
}

function namesOf(f: CompareFile): string[] {
  return f.previousFilename !== null && f.previousFilename !== f.filename
    ? [f.filename, f.previousFilename]
    : [f.filename];
}

export function classifyPaths(files: readonly CompareFile[], ticketRef: string): PathFindings {
  const out: PathFindings = {
    protected: [],
    gateSource: [],
    outsideAutoMerge: [],
    deletedTests: [],
    otherTicketEvidence: [],
    executableEvidence: [],
  };
  const push = (list: string[], path: string) => {
    if (!list.includes(path)) list.push(path);
  };
  const ownEvidence = `${EVIDENCE_PREFIX}${ticketRef}/`;

  for (const f of files) {
    for (const name of namesOf(f)) {
      if (matches(name, PROTECTED_RE)) {
        push(out.protected, name);
        if (matches(name, GATE_SOURCE_RE)) push(out.gateSource, name);
      } else if (!matches(name, AUTO_MERGE_RE)) {
        push(out.outsideAutoMerge, name);
      }
      if (name.startsWith(EVIDENCE_PREFIX) && !name.startsWith(ownEvidence))
        push(out.otherTicketEvidence, name);
    }

    if (f.status === 'removed' && isTestPath(f.filename)) push(out.deletedTests, f.filename);
    if (
      f.status === 'renamed' &&
      f.previousFilename !== null &&
      isTestPath(f.previousFilename) &&
      !isTestPath(f.filename)
    ) {
      push(out.deletedTests, f.previousFilename);
    }

    const lower = f.filename.toLowerCase();
    if (
      f.status !== 'removed' &&
      f.filename.startsWith(EVIDENCE_PREFIX) &&
      EVIDENCE_EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext))
    ) {
      push(out.executableEvidence, f.filename);
    }
  }
  return out;
}
