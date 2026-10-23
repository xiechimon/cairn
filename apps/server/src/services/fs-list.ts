// 应用内目录浏览数据源（ADR 0003 D5/D6，#441）：本地目录现扫只读投影——
// remote/headless 形态下 POST /api/fs/pick 422 unavailable 的兜底浏览器。
// 现扫律承 skills.ts（不入库、无缓存，每次请求现扫；statSync 跟随符号链接
// 收录链接目录、单条目失败跳过不炸全局）。浏览范围不设白名单（单租户，
// D5）——路径穿越/`..` 只是正规化问题不是安全面；git 标记只是提示不硬过滤
// （真值仍是 rev-parse，且存在父子目录上溯语义，票面钉死）。dotfiles 全量
// 返回，隐藏/toggle 是 web 显示层语义。
//
// 失败方式清单钉在 test/fs-list.test.ts 头注（S1-S21），实现让场景通过：
// - path 真值 = realpath 正规化后的绝对路径（S21，面包屑/lastDir 同源，
//   符号链接目录不产生别名漂移）；
// - 错误分类走 #386 reason code（词汇单源 = shared FS_LIST_ERROR_REASONS）：
//   not_absolute / not_found / not_dir / not_readable；
// - 容量闸：排序后截 FS_LIST_MAX_ENTRIES 条 + truncated 旗标（S12 [设计]，
//   超大目录不炸 wire）。

import { type Dirent, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { FsListEntry, FsListErrorReason, FsListResult } from '@cairn/shared';
import { FS_LIST_MAX_ENTRIES } from '@cairn/shared';
import { HttpError } from '../lib/errors.js';

/** Node errno code → reason 分译（S3/S7/S8 断链与 ELOOP 同归 not_found；
 *  ENOTDIR = 路径段穿过文件，归 not_dir）。返回型 = shared 词汇单源。 */
function reasonForErrno(code: string | undefined): FsListErrorReason {
  if (code === 'EACCES' || code === 'EPERM') return 'not_readable';
  if (code === 'ENOTDIR') return 'not_dir';
  return 'not_found'; // ENOENT / ELOOP / 其余
}

/** fs 系统调用失败 → 400 HttpError（message 原文 + errno→reason 分译）；
 *  realpath / statSync / readdirSync 三处 catch 共用。 */
function errnoHttpError(message: string, err: unknown): HttpError {
  return new HttpError(
    400,
    `${message}: ${(err as Error).message}`,
    reasonForErrno((err as NodeJS.ErrnoException).code),
  );
}

/** 现扫一层目录：只列子目录（localPath 只收目录），name 字典序，git 标记
 *  = 条目下 `.git` 在盘（目录或文件——worktree/submodule 形态是文件）。
 *  dir 缺省/空串 = server $HOME 起点（S1，web 无从知道 server HOME）。
 *  抛 HttpError 400 + reason（FS_LIST_ERROR_REASONS 词汇）。 */
export function listDir(dir: string | undefined): FsListResult {
  const raw = dir === undefined || dir === '' ? homedir() : dir;
  if (!isAbsolute(raw)) {
    // `~` 前缀不展开（S17）：那是创建校验 validateLocalRepoPath 的语义。
    throw new HttpError(400, `dir must be an absolute path: ${raw}`, 'not_absolute');
  }
  let real: string;
  try {
    real = realpathSync(resolve(raw)); // 正规化尾斜杠/`..` 段（S18/S19）
  } catch (err) {
    throw errnoHttpError('dir not accessible', err);
  }
  let isDir = false;
  try {
    isDir = statSync(real).isDirectory();
  } catch (err) {
    // realpath 与 stat 之间目标消失（TOCTOU）= 同 not_found 语义。
    throw errnoHttpError('dir not accessible', err);
  }
  if (!isDir) {
    throw new HttpError(400, `dir is not a directory: ${real}`, 'not_dir');
  }
  let dirents: Dirent[];
  try {
    dirents = readdirSync(real, { withFileTypes: true });
  } catch (err) {
    throw errnoHttpError('dir not readable', err);
  }
  const names: string[] = [];
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      names.push(entry.name);
    } else if (entry.isSymbolicLink()) {
      try {
        // statSync 跟随符号链接：链接目录同律收录（skills.ts S9 同款）；
        // 断链/中途消失（TOCTOU）= 跳过不炸（S10 容错律）。
        if (statSync(join(real, entry.name)).isDirectory()) names.push(entry.name);
      } catch {
        // 跳过
      }
    }
  }
  names.sort((a, b) => a.localeCompare(b));
  const truncated = names.length > FS_LIST_MAX_ENTRIES;
  const entries: FsListEntry[] = names.slice(0, FS_LIST_MAX_ENTRIES).map((name) => ({
    name,
    git: existsSync(join(real, name, '.git')),
  }));
  return { path: real, entries, truncated };
}
