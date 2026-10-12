// agent 失败分类（#1261）：Multica `server/pkg/taskfailure/classify.go` 同形
// 四桶——quota（额度空：402 / usage-limit）与 capacity（限流：429/529）明确
// **不可重试**（挂起等额度，不是任务失败），唯一可重试的 agent 侧原因是
// provider_network（#1257 流断族；本模块只分桶，重试策略归消费方）。
//
// 不可见即污染可观测性（Multica 同注）：分桶失败 = 额度事件落回普通失败
// 漏斗，板面零「等额度」态——这正是 #1261 的用户实测形态。分类面单源在
// shared（daemon runner 检测 + 诊断文案复用），server 只消费结构化
// quotaBlock（machine-wire.ts），不再对 errorMessage 二次猜桶（两处分类
// = 漂移面）。
//
// 词表覆盖三来源：① HTTP 状态码（#882 诊断行 `-> 402` 形态携带真状态码）；
// ② SSE 流内错误文案（anthropic usage_limit_reached / relay JSON body）；
// ③ 中英文 relay 文案（new-api/one-api 族实测中文消息在位）。判定序 =
// quota → capacity → provider_network → other（quota 语义最绑定，先判）。

/** 失败桶词表（classifyAgentFailure 的值域）。 */
export const AGENT_FAILURE_KINDS = ['quota', 'capacity', 'provider_network', 'other'] as const;
export type AgentFailureKind = (typeof AGENT_FAILURE_KINDS)[number];

/** quota（额度空）：余额/欠费/用量上限族。403+usage-limit 同入本桶
 * （Multica classify.go 同律——Anthropic 的用量上限以 403 形态出现）。 */
const QUOTA_PATTERN =
  /\b402\b|usage[_\s-]?limit|insufficient\s+(?:quota|credit|balance)|(?:quota|credit|balance)\s+is\s+insufficient|quota\s+(?:exceed|exhaust|limit)|credit\s+balance|billing|余额不足|额度(?:不足|用完|耗尽|已用尽)|欠费/i;

/** capacity（限流）：429/529/请求过频族。与 quota 的分桶差异 = 恢复语义
 * （限流有 Retry-After 短窗，额度要充值/等月结）——板面文案与探测窗起点
 * 分道。 */
const CAPACITY_PATTERN =
  /\b(?:429|529)\b|rate[_\s-]?limit|too\s+many\s+requests|overloaded|请求过于频繁|限流|负载(?:已)?饱和/i;

/** provider_network（网络瞬态，可重试）：连接重置 / 上游流断（#1257 家族）/
 * 连接拒绝 / 超时。 */
const NETWORK_PATTERN =
  /connection\s+(?:reset|refused|closed)|upstream\s+stream\s+disconnected|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket\s+hang\s+up|fetch\s+failed|network\s+error|temporarily\s+unavailable/i;

/** 四桶分类（纯函数；空串/未知形态 → other，不抛）。 */
export function classifyAgentFailure(message: string): AgentFailureKind {
  if (message === '') return 'other';
  if (QUOTA_PATTERN.test(message)) return 'quota';
  if (CAPACITY_PATTERN.test(message)) return 'capacity';
  if (NETWORK_PATTERN.test(message)) return 'provider_network';
  return 'other';
}

/** Retry-After 解析的秒数上限：超过即视为 bogus relay 值丢弃（不造数值）。
 * 24h——限流窗口的物理上界之上的值对探测排程没有信息量。 */
export const RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000;

/** Retry-After 解析（纯函数）：接受 `retry-after: 120` / `Retry-After: 30` /
 * `retry after 45 seconds` / `retry-after=60s` / `2 minutes` 形态（诊断行与
 * HTTP 头同源复用）。返回毫秒；HTTP 日期形态与非法值 → null（降级为缺省
 * 探测窗，不造数值）。秒/分/时单位归一，上限 RETRY_AFTER_MAX_MS。 */
export function parseRetryAfterMs(text: string): number | null {
  const match = /retry[ _-]?after[\s:=]+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)?/i.exec(
    text,
  );
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]?.toLowerCase() ?? 's';
  const multiplier = unit.startsWith('m') ? 60_000 : unit.startsWith('h') ? 3_600_000 : 1_000;
  const ms = value * multiplier;
  return ms <= RETRY_AFTER_MAX_MS ? ms : null;
}
