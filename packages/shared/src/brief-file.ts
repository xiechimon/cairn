// 运行简报落 worktree 上下文文件（#958，spec 24）。
//
// 每一步的 agent 简报不再追加进 system prompt，而是写进任务 worktree 里引擎
// **原生就会读**的那个上下文文件（pi 走 AGENTS.md 系，claude-code 走 CLAUDE.md），
// 由 CLI 自己的记忆机制加载。本模块只放跨端共享的词表与纯函数：标记串、托管
// 分隔符、各引擎的候选文件序，以及「这次该写哪个文件」的判定。文件的实际读写
// （三态写入、逐字节擦除、跨候选对账）归 daemon：apps/daemon/src/brief-file.ts。

import { isBackendRuntimeId } from './agent-backend.js';

/** 托管区的起止标记。用 HTML 注释：在任何 markdown 渲染器里都是惰性的，喂给
 * 模型当指令也无害。改这两个串会让已带旧标记的文件失去可切除性——是破坏性
 * 变更，要有意识地升并给出迁移。 */
export const BRIEF_MARKER_BEGIN = '<!-- BEGIN CAIRN-RUNTIME (auto-managed; do not edit) -->';
export const BRIEF_MARKER_END = '<!-- END CAIRN-RUNTIME -->';

/** 用户既有内容与托管区之间的固定分隔符。它**算托管区的一部分**——擦除时连它
 * 一起剥掉，文件才能逐字节回滚到注入前，无论用户文件原本以 0 个、1 个还是多个
 * 换行结尾（不固定宽度的话，擦除就得重新规范化用户的尾部字节，每轮留下一个
 * 细微但真实的 diff）。
 *
 * 它同时是「这文件是我们建的还是本来就有的」判别位：块前没有分隔符 = 我们创建
 * 的（擦除即删文件，连文件存在性一起回滚）；块前有分隔符 = 追加进用户文件
 * （擦除即剥块+分隔符）。 */
export const BRIEF_MANAGED_SEPARATOR = '\n\n';

/** 简报落点的后端身份（= AgentBackend 现有两实现）。未来若加第三个后端而它不
 * 读上下文文件，就不该进本表——那种后端保留 system prompt 通道（`briefTarget`
 * 返回 null 的逃生口，daemon 侧）。 */
export const BRIEF_BACKEND_IDS = ['pi', 'claude-code', 'gemini'] as const;
export type BriefBackendId = (typeof BRIEF_BACKEND_IDS)[number];

/** 各引擎**真实的**同目录候选序，first-wins。pi 这份是从
 * `@earendil-works/pi-coding-agent` 的 `dist/core/resource-loader.js`
 * `loadContextFileFromDir` 的 candidates 数组逐字抄的；claude-code 只认
 * CLAUDE.md（Agent SDK 的 `settingSources` 含 `'project'` 时读的就是它，
 * `AGENTS.md` 一概不读）。改这里之前先回去核上游那两处。 */
export const BRIEF_CANDIDATES: Record<BriefBackendId, readonly string[]> = {
  pi: ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'],
  'claude-code': ['CLAUDE.md'],
  gemini: ['GEMINI.md'],
};

/** 候选全落空时新建的文件名（= 该引擎候选序里最标准的那个）。 */
export const BRIEF_CREATE_NAME: Record<BriefBackendId, string> = {
  pi: 'AGENTS.md',
  'claude-code': 'CLAUDE.md',
  gemini: 'GEMINI.md',
};

/** 对账用的**全后端候选名并集**（按后端序去重拼接）。
 *
 * 落点判定只认本后端的候选序——那是引擎真正会读的那一个。但对账必须扫全部：
 * 同一棵 worktree 会被不同后端的步复用，pi 步留下的 `AGENTS.md` 在随后的
 * claude-code 步里若不清，就会残到下一步的 `git add -A` 里被提交推送。 */
export const BRIEF_RECONCILE_FILENAMES: readonly string[] = [
  ...new Set(BRIEF_BACKEND_IDS.flatMap((backend) => BRIEF_CANDIDATES[backend])),
];

/** 本次简报落哪个文件、以及是新建还是追加。 */
export interface BriefTarget {
  /** 写入目标 = **盘上真实的文件名**（大小写按实际条目），不是候选表里的拼写——
   * 否则大小写不敏感的盘上会以为在写新文件，实际落回同一个 inode。 */
  file: string;
  /** create = 我们建的文件（擦除即删）；append = 用户本来就有的（只剥块）。 */
  mode: 'create' | 'append';
}

/** agent.provider → 简报后端身份。与 daemon runner 的 `backendFor` 同律（spec 17
 * A3 唯一分叉点）：runtime 身份词表命中 → claude-code，其余（custom provider id /
 * null / undefined）→ pi。两处判定必须同源，否则简报会写进一个引擎不读的文件。 */
export function briefBackendForProvider(provider: string | null | undefined): BriefBackendId {
  if (provider === 'gemini') return 'gemini';
  return isBackendRuntimeId(provider) ? 'claude-code' : 'pi';
}

/** 判定本次简报该落在哪个文件（#958 闸 2）。
 *
 * 语义 = 逐字复刻引擎自己的发现动作：按 `BRIEF_CANDIDATES` 的顺序对每个候选做
 * 一次 `existsSync(join(dir, candidate))`，先命中者胜。故本函数需要知道盘上的
 * 实际条目**和**文件系统是否大小写不敏感——后者决定 `existsSync('CLAUDE.md')`
 * 在盘上是 `CLAUDE.MD` 时是否成立（darwin/win32 成立，linux 不成立）。这个参数
 * 由调用方给（shared 是 web 也消费的包，不能引用 `process`）。
 *
 * 为什么不能按名字逐个 existsSync 了事：
 * - pi 是同目录 first-wins。仓库只有 CLAUDE.md 时写 AGENTS.md 会**遮蔽用户自己
 *   的 CLAUDE.md**（引擎只读命中的那一个）；仓库有 AGENTS.override.md 时写
 *   AGENTS.md 则简报**完全不被读**——全搬之后没有回退通道，等于静默零指令步。
 * - 大小写变体上 macOS 与 Linux 的 existsSync 答案不同；判定与写入若不同源，
 *   会在用户已跟踪文件旁多造一个同名异写的副本，而「创建态擦除」会把它删掉。 */
export function resolveBriefTarget(
  entries: readonly string[],
  backend: BriefBackendId,
  opts: { caseInsensitiveFs: boolean },
): BriefTarget {
  const realNameFor = new Map<string, string>();
  for (const name of entries) {
    const key = opts.caseInsensitiveFs ? name.toLowerCase() : name;
    if (!realNameFor.has(key)) realNameFor.set(key, name);
  }
  for (const candidate of BRIEF_CANDIDATES[backend]) {
    const key = opts.caseInsensitiveFs ? candidate.toLowerCase() : candidate;
    const real = realNameFor.get(key);
    if (real !== undefined) return { file: real, mode: 'append' };
  }
  return { file: BRIEF_CREATE_NAME[backend], mode: 'create' };
}
