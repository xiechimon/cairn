// webhook token 服务面（#1137；api-keys.ts 同族逐位对齐）：
// - 创建：`cairn_wh_<36hex>` 明文一次性返回（前缀区分 apiKey 凭证族）；
//   服务端存哈希不存可逆值（hashCredential，02 §8 同律）。
// - 列表：行掩码（maskApiKey 同规则），tokenHash 永不出响应。
// - 撤销：删行（receiver 反查即 miss → 401，吊销即时生效）。
// - receiver 校验：verifyWebhookToken = 哈希精确反查（唯一索引保证至多一
//   行）+ 回写 lastUsedAt（请求段追踪位）。GitHub webhook 无法自定义
//   Authorization 头，token 走 URL 路径段——安全模型 = 等价 Bearer 高熵
//   随机凭证，可吊销。

import { randomBytes } from 'node:crypto';
import { maskApiKey } from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { webhookToken } from '../db/schema.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export interface WebhookTokenDeps {
  db: Db;
}

type WebhookTokenRow = typeof webhookToken.$inferSelect;

/** 列表/创建响应投影（keyHash [内部] 列永不出响应）。 */
export interface WebhookTokenRowView {
  id: string;
  name: string | null;
  masked: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function toWebhookTokenRowView(row: WebhookTokenRow): WebhookTokenRowView {
  return {
    id: row.id,
    name: row.name,
    masked: row.masked,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/** `cairn_wh_<36hex>`（webhook 凭证族形态；hex 小写，apiKey 同律）。 */
export function newWebhookTokenPlaintext(): string {
  return `cairn_wh_${randomBytes(18).toString('hex')}`;
}

export function listWebhookTokens(deps: WebhookTokenDeps, teamId: string): WebhookTokenRowView[] {
  return deps.db
    .select()
    .from(webhookToken)
    .where(eq(webhookToken.teamId, teamId))
    .orderBy(asc(webhookToken.createdAt))
    .all()
    .map(toWebhookTokenRowView);
}

export function createWebhookToken(
  deps: WebhookTokenDeps,
  input: { teamId: string; name?: string | null },
): WebhookTokenRowView & { plaintext: string } {
  const plaintext = newWebhookTokenPlaintext();
  const id = newRecordId();
  const createdAt = nowMs();
  deps.db
    .insert(webhookToken)
    .values({
      id,
      teamId: input.teamId,
      name: input.name ?? null,
      tokenHash: hashCredential(plaintext),
      masked: maskApiKey(plaintext),
      createdAt,
      lastUsedAt: null,
    })
    .run();
  return {
    id,
    name: input.name ?? null,
    masked: maskApiKey(plaintext),
    createdAt,
    lastUsedAt: null,
    plaintext, // 一次性明文（api-key 同律：此后任何视图不再出现）
  };
}

/** 撤销 = 删行（幂等；行不存在或属他 team → false）。 */
export function deleteWebhookToken(deps: WebhookTokenDeps, teamId: string, id: string): boolean {
  const row = deps.db
    .select({ id: webhookToken.id, teamId: webhookToken.teamId })
    .from(webhookToken)
    .where(eq(webhookToken.id, id))
    .get();
  if (!row || row.teamId !== teamId) return false;
  deps.db.delete(webhookToken).where(eq(webhookToken.id, id)).run();
  return true;
}

/** receiver 反查：路径 token 段 → 哈希反查（唯一索引，至多一行）+ 回写
 * lastUsedAt。miss → null（调用面统一 401，不区分「不存在 vs 错值」）。 */
export function verifyWebhookToken(
  deps: WebhookTokenDeps,
  plaintext: string,
): (WebhookTokenRowView & { teamId: string }) | null {
  const row = deps.db
    .select()
    .from(webhookToken)
    .where(eq(webhookToken.tokenHash, hashCredential(plaintext)))
    .get();
  if (!row) return null;
  deps.db
    .update(webhookToken)
    .set({ lastUsedAt: nowMs() })
    .where(eq(webhookToken.id, row.id))
    .run();
  return { ...toWebhookTokenRowView(row), teamId: row.teamId };
}
