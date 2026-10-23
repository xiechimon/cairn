// github_connection 服务面（spec 12 / #359 G2-T1，#352 族）：GitHub OAuth
// 连接行的唯一读写点。纪律（02 §8 凭证族 + spec 12 story 10）：
// - accessToken 只以 SecretBox 信封密文落 accessTokenCipher 列——明文不进表
//   任何列、不进日志、不进 wire 响应；
// - token 唯一读出点 = openGithubToken（server 出站边界消费：repos 代理
//   Authorization 头；spec 12 G2-T2 起另供 daemon 执行凭证下发）；
// - 连接状态读面（login/scope，无 token 位）归 G2-T4 认证面端点封套；
// - DAO 语义：重认证 = 覆盖（teamId 单行，onConflictDoUpdate）、断开 = 删行
//   （幂等，缺行不抛）。

import type { GithubConnectionStatus, SecretBox } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { githubConnection } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export interface GithubConnectionDeps {
  db: Db;
  box: SecretBox;
}

function getRow(deps: GithubConnectionDeps, teamId: string) {
  return deps.db.select().from(githubConnection).where(eq(githubConnection.teamId, teamId)).get();
}

/** 连接落库：无行 = 建、有行 = 整行覆盖（重认证语义，不增行）。 */
export function upsertGithubConnection(
  deps: GithubConnectionDeps,
  input: { teamId: string; login: string; accessToken: string; scope: string },
): void {
  const accessTokenCipher = deps.box.seal(input.accessToken);
  const createdAt = nowMs();
  deps.db
    .insert(githubConnection)
    .values({
      teamId: input.teamId,
      login: input.login,
      accessTokenCipher,
      scope: input.scope,
      createdAt,
    })
    .onConflictDoUpdate({
      target: githubConnection.teamId,
      set: { login: input.login, accessTokenCipher, scope: input.scope, createdAt },
    })
    .run();
}

/** 断开 = 删行（幂等）；返回删除前是否有行。 */
export function deleteGithubConnection(deps: GithubConnectionDeps, teamId: string): boolean {
  const existed = getRow(deps, teamId) !== undefined;
  deps.db.delete(githubConnection).where(eq(githubConnection.teamId, teamId)).run();
  return existed;
}

/** server 内部消费唯一读出点（出站 Authorization 头）；未连接 = null。
 * 密文损坏 / keyfile 不匹配 = SecretBoxError 直抛（secret-box.ts 语义）。 */
export function openGithubToken(deps: GithubConnectionDeps, teamId: string): string | null {
  const row = getRow(deps, teamId);
  if (!row) return null;
  return deps.box.open(row.accessTokenCipher);
}

/** 团队的 GitHub 读写权：连接 token 与密文 box；拿不到给原因（无 box / 无连接 / 密文
 * 解不开）。issue 进料轮询器与 webhook（拿不到就不读，零匿名读）、PR 探测与 PR 对账（拿不到
 * 走匿名读）、经 API 合并（拿不到 409，按原因说连接或重新连接，#1403 段 2b）共用。 */
export function teamGithubToken(
  deps: { db: Db; box?: SecretBox | undefined },
  teamId: string,
):
  | { token: string; box: SecretBox }
  | { reason: 'no-secret-box' | 'no-github-connection' | 'token-unreadable' } {
  const box = deps.box;
  if (box === undefined) return { reason: 'no-secret-box' };
  try {
    const token = openGithubToken({ db: deps.db, box }, teamId);
    return token === null ? { reason: 'no-github-connection' } : { token, box };
  } catch {
    return { reason: 'token-unreadable' };
  }
}

/** teamGithubToken 只要 token 的投影：拿不到（任何原因）= null，调用方走匿名读（PR 探测、
 * PR 对账与磨绿）。 */
export function githubTokenOrNull(
  deps: { db: Db; box?: SecretBox | undefined },
  teamId: string,
): string | null {
  const access = teamGithubToken(deps, teamId);
  return 'token' in access ? access.token : null;
}

/** 连接行存在性（#452 写向；只读行不解密不抛）：createTodo 关键路径判
 * 「已连接才自建 issue」——未连接 = 不建、不报错、不亮失败态（ADR 0006 D2）；
 * 密文损坏留给异步出站时降级（停留未建成，可重试）。 */
export function hasGithubConnection(db: Db, teamId: string): boolean {
  return (
    db
      .select({ teamId: githubConnection.teamId })
      .from(githubConnection)
      .where(eq(githubConnection.teamId, teamId))
      .get() !== undefined
  );
}

/** 认证状态读面（#361 G2-T4 封套，shared githubConnectionStatusSchema 单源）：
 * 仅 login/scope——token/密文位永不出现（02 §8 只写不读出 wire）。 */
export function readGithubConnectionStatus(
  deps: GithubConnectionDeps,
  teamId: string,
): GithubConnectionStatus {
  const row = getRow(deps, teamId);
  if (!row) return { connected: false };
  return { connected: true, login: row.login, scope: row.scope };
}
