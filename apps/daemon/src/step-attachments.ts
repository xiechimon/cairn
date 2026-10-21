// 步 prompt/steer 的图片附件解析下载（#730）：把 spec / 消息 / steer 文本里
// 的整行 `![name](attachment:<key>)` token 解析成模型真正可见的像素。
// 分路（票面正典 §Part 2 裁定）：
//   - png/jpg/jpeg/gif/webp → machine 面下载 → **内联交付**（backend 缝
//     DeliveredImage；claude-code = image content block，pi = PromptOptions
//     .images / steer 第二参——两引擎同机制，CC 本尊同款）
//   - svg/bmp/ico/avif → 下载 → **素材化**到 worktree 外（PACMAN_HOME 面
//     step-attachments/<stepId>/）+ token 行下追加绝对路径 + Read 提示——
//     引擎 Read 工具按需转换（pi photon / CC 内建）后进上下文
//   - text/pdf → 零触碰（既有 attachment 工具路径不动）
// 失败可见律：下载失败（pending/404/网络）与 key 语法复验不过 → token 原样
// 保留 + 文本注明不可用 + 日志行——步不崩、不静默假装看过（票面失败方式
// 3/10）。原文保真律：journal/transcript 侧的原始文本不经本模块（runner
// 在解析前已落 transcript）——web 渲染面的 chip 形态不因展开而丢。
// #1406 issue 原文围栏：GitHub issue 导入任务的标题与 spec 逐行带引用前缀进
// 围栏。围栏里的整行 token 去掉这一层前缀照常解析，改写行与注记行补回同一
// 前缀，留在围栏里；围栏外的引用 token 行不认（web 不给它渲染 chip）。

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DeliveredImage, MachineAttachmentResponse } from '@pacman/shared';
import {
  ATTACHMENT_TOKEN_LINE,
  ISSUE_FENCE_QUOTE,
  isImageAttachmentExt,
  issueFenceQuotedLines,
  parseAttachmentTokenLines,
} from '@pacman/shared';

/** 素材化文件名的独立安全化（票面失败方式 2 的纵深防御第二道）：server 面
 * isValidFileName 已挡 / 与 \，但 label 是用户可控文本——落盘名恒取
 * basename 段并剥控制字符，防 `../evil/name.bmp` 类 label 逃逸。 */
function safeFileName(fileName: string): string {
  const base = basename(fileName.replaceAll('\\', '/'));
  let out = '';
  for (const ch of base) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp < 0x20) continue;
    out += ch;
  }
  return out === '' || out === '.' ? 'attachment' : out;
}

/** 响应 mime → 素材化文件的规范扩展名（mime 与 fileName 扩展名漂移时以
 * mime 为准——素材内容与扩展名一致，Read 工具才能按内容分路）。 */
const MATERIALIZE_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/vnd.microsoft.icon': 'ico',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
};

/** 响应 mime 是否内联交付面（png/jpeg/gif/webp——两引擎 inline 支持面，
 * parent 正典 §Part 2；image/jpg 归一 image/jpeg，pi processImage 同律）。 */
function inlineMime(mimeType: string): string | null {
  if (mimeType === 'image/jpg') return 'image/jpeg';
  switch (mimeType) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return mimeType;
    default:
      return null;
  }
}

/** 素材化落盘（幂等覆写）：`<materializeDir>/<stepId>/<name>`。
 * 返回绝对路径（提示行与 Read 用）。 */
export function materializeFile(
  materializeDir: string,
  stepId: string,
  fileName: string,
  bytes: Buffer,
): string {
  const dir = join(materializeDir, stepId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, safeFileName(fileName));
  writeFileSync(path, bytes);
  return path;
}

/** 步素材 scratch 保质期（#759 R3，策略正本 docs/spec/20 §4：步以分钟/小时
 * 计，72h = 步早死透 + 机器离线一个周末回来仍可复用；再生前提 = 源附件
 * 仍在 server + 步文本仍含 token + 机器在线，走正常下载路径）。 */
export const STEP_ATTACHMENTS_TTL_MS = 72 * 60 * 60 * 1000;

/** 超龄步目录回收（返回被收的 stepId；根缺省 = 空数组不抛；根下零散文件
 * 不动——只收步目录。落盘即建的目录 mtime 随素材写入刷新，在跑步天然新鲜，
 * 无需 journal 对账）。 */
export function sweepStepAttachments(
  materializeDir: string,
  opts?: { ttlMs?: number; now?: number },
): string[] {
  if (!existsSync(materializeDir)) return [];
  const ttlMs = opts?.ttlMs ?? STEP_ATTACHMENTS_TTL_MS;
  const now = opts?.now ?? Date.now();
  const removed: string[] = [];
  for (const entry of readdirSync(materializeDir)) {
    const full = join(materializeDir, entry);
    let mtimeMs: number | undefined;
    try {
      const st = statSync(full);
      if (st.isDirectory()) mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs === undefined || now - mtimeMs < ttlMs) continue;
    rmSync(full, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

/** 下载面最小结构（MachineApi.attachment 的投影——测试注入最小 fake 即可，
 * 不必实现整个 machine 接口）。 */
export interface AttachmentDownloader {
  attachment(stepId: string, attachmentId: string): Promise<MachineAttachmentResponse>;
}

export interface ResolveStepImagesOpts {
  /** 待展开文本（prompt 或 steer——两者同一解析面）。 */
  text: string;
  stepId: string;
  /** machine 面客户端（attachment 下载）。 */
  client: AttachmentDownloader;
  /** 素材化根（StatePaths.stepAttachmentsDir——worktree 外）。 */
  materializeDir: string;
  /** 步日志出口（不可用注记配套行）。 */
  log: (line: string) => void;
}

export interface ResolvedStepImages {
  /** 展开后的文本：inline token 行 → 锚行；素材化 token 行 → 路径提示行；
   * 不可用 → token 原样 + 注记行；非图片 token → 原样。无 token 时与原文
   * 逐字节一致。 */
  text: string;
  /** 内联交付图片（顺序 = token 行序）。 */
  images: DeliveredImage[];
}

/** 单行处置结果。 */
type Outcome =
  | { kind: 'inline'; anchor: string; image: DeliveredImage }
  | { kind: 'materialized'; note: string }
  | { kind: 'unavailable'; note: string }
  | { kind: 'untouched' };

/** 整行 token 形态的行：body = token 本身，prefix = 它前面的围栏引用前缀
 * （裸整行 token 为空串）。 */
interface TokenLine {
  prefix: string;
  body: string;
}

/** 逐行认 token 形态（整行形状命中，含 key 语法复验不过的行——它们也要可见地
 * 失败，而不是无声当普通文本）；非 token 行为 null。 */
function tokenLinesOf(lines: readonly string[]): (TokenLine | null)[] {
  const quoted = issueFenceQuotedLines(lines);
  return lines.map((line, i) => {
    if (ATTACHMENT_TOKEN_LINE.test(line)) return { prefix: '', body: line };
    const body = quoted[i] ?? null;
    return body !== null && ATTACHMENT_TOKEN_LINE.test(body)
      ? { prefix: ISSUE_FENCE_QUOTE, body }
      : null;
  });
}

/** 解析 + 下载 + 分路（纯文本管线——逐 token 求结果后按行重建文本）。 */
export async function resolveStepImages(opts: ResolveStepImagesOpts): Promise<ResolvedStepImages> {
  const lines = opts.text.split('\n');
  const tokens = tokenLinesOf(lines);
  const bodies = tokens.flatMap((t) => (t === null ? [] : [t.body]));
  const images: DeliveredImage[] = [];
  if (bodies.length === 0) return { text: opts.text, images };
  const refs = parseAttachmentTokenLines(bodies.join('\n'));
  // 逐 token 处置（串行：同步下载窗口不放大并发；10MiB cap = 单件内存上界，
  // 串行即同刻至多一件在途——票面失败方式 8 的内存预算答案）。
  const outcomes = new Map<string, Outcome>();
  for (const ref of refs) {
    const outcome = await resolveOne(ref, opts);
    outcomes.set(ref.line, outcome);
    if (outcome.kind === 'inline') images.push(outcome.image);
  }
  // 重建文本：token 形态行按处置改写（key 语法外 = 不可用注记，零下载——
  // 纵深防御 + 可见失败）；其余行原样（原文保真律）。改写行与注记行的每一行
  // 都带上原行的前缀（报错原文可能带换行），围栏里的产物不出围栏。
  const outLines: string[] = [];
  for (const [i, line] of lines.entries()) {
    const token = tokens[i] ?? null;
    if (token === null) {
      outLines.push(line);
      continue;
    }
    const emit = (text: string): void => {
      for (const part of text.split('\n')) outLines.push(`${token.prefix}${part}`);
    };
    const outcome = outcomes.get(token.body);
    if (outcome === undefined) {
      outLines.push(line);
      emit('[图片附件形态不合法（key 语法外）——该图片未交付]');
      opts.log(`attachment token rejected (key grammar): ${line}`);
      continue;
    }
    if (outcome.kind === 'inline') {
      emit(outcome.anchor);
    } else if (outcome.kind === 'untouched') {
      outLines.push(line);
    } else if (outcome.kind === 'materialized') {
      emit(outcome.note); // token 行替换为路径提示行（路径即锚）
    } else {
      outLines.push(line); // 不可用：token 原样保留（票面失败方式 3 裁定）
      emit(outcome.note);
    }
  }
  return { text: outLines.join('\n'), images };
}

/** 单 token 分路处置。 */
async function resolveOne(
  ref: { line: string; label: string; key: string; attachmentId: string; ext: string },
  opts: ResolveStepImagesOpts,
): Promise<Outcome> {
  if (!isImageAttachmentExt(ref.ext)) return { kind: 'untouched' };
  let res: MachineAttachmentResponse;
  try {
    res = await opts.client.attachment(opts.stepId, ref.attachmentId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    opts.log(`attachment download failed: ${ref.key} — ${reason}`);
    return {
      kind: 'unavailable',
      note: `[图片附件 ${ref.key} 不可用：${reason} — 该图片未交付]`,
    };
  }
  // 分类以响应 mime 为权威（key ext 只是预筛——漂移时按真值分路）。
  const mime = inlineMime(res.mimeType);
  if (mime !== null) {
    return {
      kind: 'inline',
      anchor: `[image attached: ${res.fileName}]`,
      image: { data: res.contentBase64, mimeType: mime },
    };
  }
  const bytes = Buffer.from(res.contentBase64, 'base64');
  const path = materializeFile(
    opts.materializeDir,
    opts.stepId,
    withMimeExt(res.fileName, res.mimeType),
    bytes,
  );
  opts.log(
    `attachment materialized: ${res.fileName} → ${path} (${res.mimeType} 不支持内联交付，走 Read 路线)`,
  );
  return {
    kind: 'materialized',
    note: `[图片附件 ${res.fileName}（${res.mimeType} 不支持内联交付）——用 Read 工具读取以下路径查看图片：${path}]`,
  };
}

/** fileName 扩展名与响应 mime 漂移时换成 mime 的规范扩展名（内容与扩展名
 * 一致，Read 按内容/扩展名分路才不误导）。 */
function withMimeExt(fileName: string, mimeType: string): string {
  const wantExt = MATERIALIZE_EXT_BY_MIME[mimeType];
  if (wantExt === undefined) return fileName;
  const base = safeFileName(fileName);
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
  return `${stem}.${wantExt}`;
}
