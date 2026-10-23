// 运行简报的落盘与擦除（#958 闸 1/闸 2，spec 24）。
//
// 简报写进任务 worktree 里引擎原生会读的上下文文件（词表与落点判定在
// @cairn/shared 的 brief-file.ts），跑完再**逐字节回滚**。 Multipic 的三态
// 写入语义照搬：文件缺失 → 只写块（无前导分隔符）；已有文件无块 → 追加
// 分隔符+块；已有块 → 原地替换（幂等，重跑不叠副本）。
//
// 为什么擦除而不是靠 .git/info/exclude 隐身（#958 的取舍，别再翻）：
// exclude 按**文件名**匹配，会把 agent 合法产出的 CLAUDE.md（「给这仓库加个
// CLAUDE.md」是完全合理的任务）从步收尾的 `git add -A` 里静默吞掉——隐形丢活。
// 按内容（标记）匹配才没有误伤面。纵深防御那一层落在 commitAll（阶段 5）。

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRIEF_MARKER_BEGIN as BEGIN,
  BRIEF_RECONCILE_FILENAMES,
  type BriefBackendId,
  BRIEF_MARKER_END as END,
  resolveBriefTarget,
  BRIEF_MANAGED_SEPARATOR as SEP,
} from '@cairn/shared';

/** 本机文件系统是否大小写不敏感（决定 `existsSync('CLAUDE.md')` 在盘上是
 * `CLAUDE.MD` 时成立与否）。落点判定与写入必须同源，否则会在用户已跟踪文件旁
 * 多造一个同名异写副本，而「创建态擦除」会把它删掉。 */
export function caseInsensitiveFsFor(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/** 写入结果（擦除与告警都按它定位）。 */
export interface BriefHandle {
  /** 写入目标绝对路径。 */
  path: string;
  /** 盘上的文件名（日志 / transcript 用）。 */
  file: string;
  /** create = 这文件是我们建的（擦除即删，连存在性一起回滚）；
   *  append = 追加进用户本来就有的文件（擦除只剥块）。 */
  mode: 'create' | 'append';
}

/** 托管块首尾在文本里的位置。end 含块后那一个换行（吃掉它，重跑才不会逐轮
 * 累积空行）。 */
export interface MarkerSpan {
  begin: number;
  end: number;
}

/** 定位托管块。找不到 = null。
 *
 * 两个畸形形态要认得（都是崩溃/异常留下的，不认就会每轮多叠一块或误删用户内容）：
 * - **游离的 END 标记**：搜索从 BEGIN 之后开始，故用户正文里本来就有的 END 串
 *   不会被误当块头（前后顺序反了不算块）。
 * - **半写块**（BEGIN 在、END 不在）：把从 BEGIN 到文末整段当块——下次写入整体
 *   替换掉它，而不是在残骸后面再追加一个完整块。 */
export function locateMarkerBlock(text: string): MarkerSpan | null {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return null;
  const endMarkerAt = text.indexOf(END, begin + BEGIN.length);
  if (endMarkerAt === -1) return { begin, end: text.length };
  const afterEnd = endMarkerAt + END.length;
  return { begin, end: text[afterEnd] === '\n' ? afterEnd + 1 : afterEnd };
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err; // EISDIR / EACCES 等：向上抛，调用方 fail-closed，绝不降级成无简报运行
  }
}

/** 组块：`BEGIN\n<正文>\nEND\n`。正文尾部空白先削平，块边界才是确定的。 */
function buildBlock(brief: string): string {
  // 简报正文里出现标记串会破坏「块」这个结构的可解析性（下次定位到的是正文里
  // 那个假标记）。构造性堵死：宁可这一步失败，也不写出一份以后擦不干净的文件。
  if (brief.includes(BEGIN) || brief.includes(END)) {
    throw new Error('brief content must not contain the runtime markers');
  }
  return `${BEGIN}\n${brief.trimEnd()}\n${END}\n`;
}

/** 对账：清掉候选集里**残留**的托管块与残留的创建态文件（崩溃/超时/被杀留下的）。
 *
 * 只动带标记的文件——**无标记的未跟踪文件一律不碰**，那可能是 agent 的合法产物，
 * 必须走到 commitAll。独占本函数的是「continue-action 恢复」那个洞：continue 步
 * 不触发 fresh-session rewind，没有任何兜底会把上一轮的残留清掉。
 *
 * 返回被动过的文件名（日志用）。 */
export function reconcileBriefLeftovers(
  cwd: string,
  caseInsensitiveFs: boolean,
  /** 本次将要写入的文件（盘上真实名）——它由三态写入自处，对账跳过。 */
  targetFile: string,
): string[] {
  const entries = readdirSync(cwd);
  const folded = new Set(BRIEF_RECONCILE_FILENAMES.map((c) => c.toLowerCase()));
  const touched: string[] = [];
  for (const name of entries) {
    const key = caseInsensitiveFs ? name.toLowerCase() : name;
    if (!folded.has(key)) continue; // 非候选名（无标记的 agent 产物走这条）
    if (name === targetFile) continue;
    if (cleanupBriefFile(join(cwd, name)) !== 'noop') touched.push(name);
  }
  return touched;
}

/** 三态写入。返回的 handle 供擦除与告警定位。
 *
 * 写入前先对账（`reconcileBriefLeftovers`）：崩溃残留必须在本轮开工前清掉，否则
 * 它会在事后被下一步的 `git add -A` 扫进提交。 */
export function writeBrief(opts: {
  cwd: string;
  backendId: BriefBackendId;
  content: string;
  caseInsensitiveFs: boolean;
}): BriefHandle {
  const { cwd, backendId, content, caseInsensitiveFs } = opts;
  const block = buildBlock(content);
  const target = resolveBriefTarget(readdirSync(cwd), backendId, { caseInsensitiveFs });
  reconcileBriefLeftovers(cwd, caseInsensitiveFs, target.file);

  const path = join(cwd, target.file);
  const existing = readIfPresent(path);
  if (existing === null) {
    writeFileSync(path, block);
    return { path, file: target.file, mode: 'create' };
  }
  const found = locateMarkerBlock(existing);
  if (found !== null) {
    // 幂等原地替换：重跑不叠副本。块在偏移 0 = 这文件当初就是我们建的，
    // 即便它现在"存在"也仍是创建态（擦除要删掉它，不是剥块留空文件）。
    writeFileSync(path, existing.slice(0, found.begin) + block + existing.slice(found.end));
    return { path, file: target.file, mode: found.begin === 0 ? 'create' : 'append' };
  }
  writeFileSync(path, existing + SEP + block);
  return { path, file: target.file, mode: 'append' };
}

/** 擦除 = 逐字节回滚。**幂等**：已擦干净时再来一次是 noop。
 *
 * 三态判别（与写入对称）：
 * - 文件不在 / 无块 → noop
 * - 块在偏移 0（无前导分隔符）→ 这文件是我们建的 → 删掉，连存在性一起回滚
 * - 块前有分隔符 → 剥掉分隔符+块，**逐字节**还原用户内容（尾部字节不重新规范化）
 * - 块前既非 0 也无分隔符（异常形）→ 只剥块本身，保住用户内容 */
export function cleanupBriefFile(path: string): 'removed' | 'excised' | 'noop' {
  const text = readIfPresent(path);
  if (text === null) return 'noop';
  const found = locateMarkerBlock(text);
  if (found === null) return 'noop';
  if (found.begin === 0) {
    rmSync(path, { force: true });
    return 'removed';
  }
  const sepAt = found.begin - SEP.length;
  if (sepAt >= 0 && text.slice(sepAt, found.begin) === SEP) {
    writeFileSync(path, text.slice(0, sepAt) + text.slice(found.end));
    return 'excised';
  }
  writeFileSync(path, text.slice(0, found.begin) + text.slice(found.end));
  return 'excised';
}

/** 擦除句柄指向的文件（runStep 各出口调）。 */
export function cleanupBrief(handle: BriefHandle): 'removed' | 'excised' | 'noop' {
  return cleanupBriefFile(handle.path);
}
