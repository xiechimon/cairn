// apiKey 服务面（02 §6.2 形状 + 02 §8/r3 §6 实测展示规则）。
// - 创建：生成 `cairn_<48hex>` 明文，响应含明文一次（一次性展示，02 §8；
//   文案 canon「请立即复制密钥，它仅显示一次。」= shared API_KEY_ONE_TIME_COPY，
//   web 面渲染）。服务端存哈希不存可逆值（[设计] 02 §8——登录校验只需匹配）。
// - 列表：行掩码 `cairn_afe07565…`（r3 §6 样例原形前缀 tds_ 随品牌槽切换；
//   掩码函数 = shared maskApiKey 单源）。
//   行标识/掩码列 wire 字段未采 [推断]（records/api-key.ts 注同），按 DB 行
//   安全子集投影：{id,name,gitAccess,mcpAccess,toolGrants,masked,createdAt}。
// - 校验：哈希比对（机器注册 `cairn start --api-key` 与 MCP Bearer 双用途，
//   r3 §6；HTTP 挂接面归 M3）。撤销面未观测，不发明（04 附录 A 补采口径）。

import { randomBytes } from 'node:crypto';
import type { ApiKeyRow as SharedApiKeyRow } from '@cairn/shared';
import { BRAND, maskApiKey } from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKey } from '../db/schema.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';

export interface ApiKeyDeps {
  db: Db;
}

type ApiKeyRow = typeof apiKey.$inferSelect;

/** 列表行投影 [推断]（keyHash [内部] 列永不出响应）；形状单源 = shared
 * apiKeyRowSchema（M5 双端消费收口，web hooks 同型）。 */
export type ApiKeyRowView = SharedApiKeyRow;

export function toApiKeyRowView(row: ApiKeyRow): ApiKeyRowView {
  return {
    id: row.id,
    name: row.name,
    gitAccess: row.gitAccess,
    mcpAccess: row.mcpAccess,
    toolGrants: row.toolGrants,
    masked: row.masked,
    createdAt: row.createdAt,
  };
}

/** `cairn_<48hex>`（02 §5.8 API key 形态，前缀 = 品牌槽；hex 小写 [推断]，brand.ts 注同）。 */
export function newApiKeyPlaintext(): string {
  return `${BRAND.apiKeyPrefix}${randomBytes(24).toString('hex')}`;
}

export function listApiKeys(deps: ApiKeyDeps, teamId: string): ApiKeyRowView[] {
  return deps.db
    .select()
    .from(apiKey)
    .where(eq(apiKey.teamId, teamId))
    .orderBy(asc(apiKey.createdAt))
    .all()
    .map(toApiKeyRowView);
}

export function createApiKey(
  deps: ApiKeyDeps,
  input: {
    teamId: string;
    name?: string | null;
    gitAccess: boolean;
    mcpAccess: boolean;
    toolGrants: { read: string[]; write: string[] };
  },
): ApiKeyRowView & { plaintext: string } {
  const plaintext = newApiKeyPlaintext();
  const id = newRecordId();
  const createdAt = nowMs();
  deps.db
    .insert(apiKey)
    .values({
      id,
      teamId: input.teamId,
      name: input.name ?? null,
      gitAccess: input.gitAccess,
      mcpAccess: input.mcpAccess,
      toolGrants: input.toolGrants,
      keyHash: hashCredential(plaintext), // 存哈希不存可逆值（02 §8 [设计]）
      masked: maskApiKey(plaintext), // 行掩码（r3 §6 展示规则）
      createdAt,
    })
    .run();
  return {
    id,
    name: input.name ?? null,
    gitAccess: input.gitAccess,
    mcpAccess: input.mcpAccess,
    toolGrants: input.toolGrants,
    masked: maskApiKey(plaintext),
    createdAt,
    plaintext, // 一次性明文（响应封套 [推断]；此后任何视图不再出现）
  };
}

/** 校验 = 哈希匹配（02 §8：登录校验只需匹配）；命中返回行（含 teamId 供
 * 授权面），否则 null。单团队保形（02 §2.2）：按哈希全局匹配，teamId 随行走。 */
export function verifyApiKey(
  deps: ApiKeyDeps,
  plaintext: string,
): (ApiKeyRowView & { teamId: string }) | null {
  const row = deps.db
    .select()
    .from(apiKey)
    .where(eq(apiKey.keyHash, hashCredential(plaintext)))
    .get();
  return row ? { ...toApiKeyRowView(row), teamId: row.teamId } : null;
}
