// 分支对话框「同步到机器」daemon 端执行层（M7 #319，08 册附录 B）：
// 收到 server 派发的 sync 命令（machine wire `sync` 事件）→ 执行 git
// fetch + reset/clean + clone（无基座时）→ POST sync-result 回写状态机。
//
// 路径分两族（[推断]）：
// - 复用路径（推荐）：目标目录 = `<workspacesRoot>/<buildId>` 或 build 当次
//   worktree 路径，daemon 此前已 clone 过该 project 的基座仓 → 直接 fetch
//   origin + reset --hard 到目标 commit + （force 时）clean -fd。
// - 冷路径：目标目录空 + 给了 cloneUrl → git clone（匿名/凭证缺省，GitHub
//   公开仓可走；私有仓需后续 per-machine git 凭证设计 [推断]）。
//
// force 语义（r1 changelog 09-13）：丢弃工作区修改 + 删未跟踪文件
// （保留 .gitignore 内容；clean -fd 不删 .gitignore 列出的路径）。

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineSyncCommand } from '@pacman/shared';
import { gitPrim, runGitOk } from './git.js';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';

export interface SyncDeps {
  client: MachineApi;
  logger: DaemonLogger;
}

/** sync 命令执行器：POST running 即跑、做完 POST synced/failed 兜底。
 * 任何失败 = POST failed + errorMessage（捕获即落，不重抛——本函数是 sync 命令
 * 全权代理，错误已写到 server；非 sync 命令异常由机器主循环兜）。 */
export async function performSync(deps: SyncDeps, cmd: MachineSyncCommand): Promise<void> {
  const { client, logger } = deps;
  // 起步 = running（web 结果卡过渡态「正在同步…」）
  try {
    await client.syncResult(cmd.syncId, { status: 'running' });
  } catch (err) {
    logger.workspace(
      `sync ${cmd.syncId} running ack failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  logger.workspace(
    `sync ${cmd.syncId} start: ${cmd.directory} -> ${cmd.ref}@${cmd.commit.slice(0, 12)}`,
  );

  try {
    await runSyncGit(cmd);
    await client.syncResult(cmd.syncId, { status: 'synced' });
    logger.workspace(`sync ${cmd.syncId} done (commit ${cmd.commit.slice(0, 12)})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.workspace(`sync ${cmd.syncId} failed: ${message}`);
    try {
      await client.syncResult(cmd.syncId, { status: 'failed', errorMessage: message });
    } catch (postErr) {
      logger.workspace(
        `sync ${cmd.syncId} failed-ack post failed: ${postErr instanceof Error ? postErr.message : String(postErr)}`,
      );
    }
  }
}

async function runSyncGit(cmd: MachineSyncCommand): Promise<void> {
  const { directory, cloneUrl, ref, commit, force } = cmd;
  const hasGit = existsSync(join(directory, '.git'));

  if (!hasGit) {
    // 冷路径：clone 到目标目录。无 cloneUrl = 无基座仓 + 未绑 repo = 抛错
    // （web 默认值场景：用户选无 repo 项目的分支 = 无 clone 目标）。
    if (cloneUrl === '') {
      throw new Error('clone url missing (project has no repo binding)');
    }
    // 确保父目录在 + 清空目标（可能为残留空目录）
    rmSync(directory, { recursive: true, force: true });
    await gitPrim.clone(cloneUrl, directory, null);
  }

  // 复用路径或冷路径刚 clone：fetch origin 拿目标 ref + commit。
  // 冷路径刚 clone 时 fetch 退化为无新拉取（refs 已有）——safe 且幂等。
  try {
    await gitPrim.fetch(directory, null);
  } catch (err) {
    // 冷路径无 origin ref 时 fetch 会失败（本地 commit 已在）——降级跳过
    // [推断]：后续 reset --hard 用本地 commit 兜底；远程领先信息不必要。
    const msg = err instanceof Error ? err.message : String(err);
    if (!/couldn't find remote ref/i.test(msg)) {
      // 其他网络/auth 错误 = 真正失败上抛
      throw err;
    }
  }

  // checkout ref：远端跟踪 ref（`origin/<ref>`）存在则用它，否则退到 `refs/heads/<ref>`，
  // 再否则用 `rev-parse <ref>^{commit}` 兜底（tag / SHA 等非分支 ref 仍可解析）。
  // 失败直接上抛——reset --hard 会移动当前检出的分支，checkout 未成功时不能继续。
  const checkoutRef = await resolveCheckoutRef(directory, ref);
  await gitPrim.checkout(directory, checkoutRef, force);

  // reset --hard 到目标 commit
  await gitPrim.resetHard(directory, commit);

  // force = 清未跟踪文件 + 丢弃 stash（spec r1 changelog 09-13 文本语义）
  if (force) {
    await gitPrim.cleanFd(directory);
  }
}

/** ref 解析三层兜底（#1329 + 旧 tag/SHA 行为恢复）：
 *   1. `refs/remotes/origin/<ref>`（origin 跟踪分支，主路径——fetch 后的 refs）
 *   2. `refs/heads/<ref>`（本地分支——已 clone 但未 fetch，或未推送 origin）
 *   3. `rev-parse --verify <ref>^{commit}`（tag / SHA / 任意 git 可消解的 rev）
 * 三层都失败 = 抛错（带 ref 名），调用方 performSync 落 failed。 */
async function resolveCheckoutRef(directory: string, ref: string): Promise<string> {
  if (await gitPrim.hasRemoteBranch(directory, ref)) {
    return `refs/remotes/origin/${ref}`;
  }
  if (await gitPrim.hasLocalBranch(directory, ref)) {
    return `refs/heads/${ref}`;
  }
  // 兜底 rev-parse：tag / SHA / 任意可消解 rev。把 git 原文包上 ref 名
  // 上抛——调用方（performSync）把 errorMessage 落 server，未点名 ref 会让
  // web 报错读起来像「Needed a single revision」这种无主语（test 守门）。
  try {
    return await runGitOk(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
      cwd: directory,
      timeoutMs: 30_000,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`unable to resolve ref ${ref}: ${why}`);
  }
}
