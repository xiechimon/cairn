// D4 路径判定（#1404，ADR 0021 D4）：默认拒绝。只有可自动合并集里、且不落入
// 保护类别的路径能不经人；改名两头（新名与原名）都要过一遍，保护文件改名
// 移走也算动了它。匹配不分大小写（macOS 默认文件系统不分），折叠按方向分，见
// globToRegExp 上的注释；与 .claude/workflows/pr-gate.js 用同一种 glob 写法与同一条
// 折叠规则，两边判同一份清单。名字里
// 有白名单外的字符（换行、空格之类）时不判类、一律算保护：glob 的 `.` 跨不过
// 换行，而 `*` 能，判类会落空；pr-gate 对这类名字同样拒绝自动判定。
// 证据目录之外的二进制文件留人（D4）：没有行数，也没有可读的 diff。compare
// 对二进制不给 patch，纯改名也不给，两者分不出来，没有 patch 的一律算（严的
// 一侧；pr-gate 用 --no-renames 看 numstat 的 `- -` 行，纯文本改名不算）。
// 纯函数，无 I/O。

import {
  AUTO_MERGE_PATH_GLOBS,
  CHIEF_DISPATCH_HARNESS_PATHS,
  type CompareFile,
  EVIDENCE_EXECUTABLE_EXTENSIONS,
  EVIDENCE_PREFIX,
  MERGE_GATE_SOURCE_GLOBS,
  PROTECTED_PATH_GLOBS,
} from '@cairn/shared';
import { isEvidencePath } from './digest.js';

// 大小写折叠按方向分（与 pr-gate.js 同一条规则）：放行的匹配只折 ASCII，收紧的
// 匹配按 Unicode 折叠。protect 时带 `iu`（ſ U+017F 同 s、K U+212A 同 k），末尾的 `/**`
// 也认同名的目录项本身（指向别处的符号链接 .claude、scripts）；保护类别、闸源码、
// 判别票与可执行用的证据前缀与扩展名都按 protect 建，测试目录与后缀两条正则也带
// `iu`。可自动合并集不带 protect、只带 `i`：只靠 Unicode 折叠或符号链接才像产品
// 源码、证据的名字（apps/web/ſrc/x.ts）落在集外，按默认拒绝留人。opaque 的证据豁免
// 另用大小写敏感的 isEvidencePath（豁免是放行的一侧）。
// `**/` 含仓根，`**` 跨目录，`*` 不跨目录；其余字符按字面，转义的都是语法字符，
// `u` 下照样合法。
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
/** 判别票与可执行用。折叠只在单码元字符之间（ſ 与 s），命中时前缀长度仍是
 * EVIDENCE_PREFIX.length；单独的 docs/verify 条目（顶替证据目录的符号链接）也算，
 * 票号段为空，列进别票。 */
const EVIDENCE_RE = protectedRe(`${EVIDENCE_PREFIX}**`);
const EXECUTABLE_RE = EVIDENCE_EXECUTABLE_EXTENSIONS.map((ext) => protectedRe(`**/*${ext}`));
/** 与 pr-gate.js 的 SAFE_PATH 同一白名单：字母、组合符、数字与 ._/@+%-。 */
const SAFE_PATH = /^[\p{L}\p{M}\p{N}._/@+%-]+$/u;

const matches = (path: string, res: readonly RegExp[]) => res.some((re) => re.test(path));
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
  /** 命中保护类别 ①–⑤ 的路径，以及名字里有 SAFE_PATH 白名单外字符、不判类的路径
   * （改名按两头各算）。 */
  protected: string[];
  /** 其中属合并就绪闸自身源码（D4 ④）的。 */
  gateSource: string[];
  /** 不在可自动合并集里、也不在 protected 里的路径。 */
  outsideAutoMerge: string[];
  /** 删除的测试文件，或被改名的测试文件（记原名；与 pr-gate 的 --no-renames 一致）。 */
  deletedTests: string[];
  /** 改动了别的票的证据目录（含删除）。 */
  otherTicketEvidence: string[];
  /** 本 PR 新增或改动的、证据目录里的可执行文件。 */
  executableEvidence: string[];
  /** compare 没给 patch 的条目（二进制、diff 过大、纯改名）在证据目录之外的
   * 名字；改名两头各判，含删除。证据豁免与摘要同一条（digest.ts 的
   * isEvidencePath，前缀大小写敏感）：GitHub 的树分大小写，Docs/Verify/ 不是
   * 证据目录。pr-gate 的 EVIDENCE_RE 带 /i，这一项上它比本闸宽。 */
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
  // 别票与可执行两项的证据前缀用 EVIDENCE_RE（判进来是严的一侧），票号段按原样比。
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
