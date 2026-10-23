// apiKey record——02 §6.2（r3 §6 实测）。
// 密钥纪律（02 §8）：创建响应含明文一次 +「请立即复制密钥，它仅显示一次。」，
// 此后列表行掩码（`cairn_afe07565…`，r3 §6 样例原形前缀 = tds_，随品牌槽
// 切换 #109）；服务端存哈希不存可逆值（[设计] 02 §8——
// 登录校验只需匹配，与 todos.dev 内部实现无关）。
// 双用途（r3 §6 实测）：同一把 key 走 cairn start --api-key（机器注册）与
// MCP Bearer 两路；调用以 key 属主身份执行（02 §7.2）。

import { z } from 'zod';
import { BRAND } from '../brand.js';
import { epochMs, recordId } from './common.js';

/** 02 §6.2 形状原样：{name(可选), gitAccess:bool, mcpAccess:bool,
 * toolGrants:{read[],write[]}}。行标识/掩码展示列的 wire 字段未采到，
 * 不发明 [推断]（r3 §6 展示规则 = UI 面）。 */
export const apiKeyRecordSchema = z.object({
  name: z.string().nullable(), // 密钥名称（可选）（r3 §6 弹窗）
  gitAccess: z.boolean(),
  mcpAccess: z.boolean(),
  /** key 级工具白名单（02 §7.2 权限模型 1:1）：项 = 24 工具白名单
   * （protocol/mcp.ts MCP_TOOLS_READ/WRITE）；wire id 形未采 [推断]，
   * 不收窄。 */
  toolGrants: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
  }),
});
export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>;

/** 列表行 = record + 安全子集投影位（M5 [推断] 封套：行标识/掩码/时刻为
 * r3 §6 展示规则的数据面，record 本体不发明位——列表封套位承载；值永不
 * 出现，02 §8 API 面纪律）。server listApiKeys / web 列表消费双端单源。 */
export const apiKeyRowSchema = apiKeyRecordSchema.extend({
  id: recordId,
  /** 掩码 `cairn_afe07565…`（r3 §6 展示规则，前缀随品牌槽）。 */
  masked: z.string(),
  createdAt: epochMs,
});
export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>;

/** 一次性展示提示 canon（r3 §6 原文）。 */
export const API_KEY_ONE_TIME_COPY = '请立即复制密钥，它仅显示一次。';

/** 列表行掩码（r3 §6 实测展示规则）：明文 `cairn_<48hex>` → `cairn_afe07565…`
 * = 品牌前缀 + 前 8 位 hex + 省略号（样例掩码与省略号字形原样；r3 样例前缀
 * tds_ 随品牌槽切换，#109）。server 建行与 web 展示同吃本函数（掩码规则单源）。 */
export function maskApiKey(plaintext: string): string {
  return `${plaintext.slice(0, BRAND.apiKeyPrefix.length + 8)}…`;
}

/** 页首说明 canon（r3 §6 原文；品牌串无涉）。 */
export const API_KEY_PAGE_COPY = 'API 密钥用于从命令行接入机器，也让 MCP 客户端能访问你的看板。';

/** key 级授权语义 canon（02 §7.2/r3 §5.2 原文收录）。 */
export const API_KEY_GRANT_SEMANTICS_COPY = [
  "The key's tool selection limits every call: a client cannot invoke a tool it was not granted.",
  'Removing every MCP tool disables MCP for that key, and does not affect machines that hold their own machine token.',
] as const;
