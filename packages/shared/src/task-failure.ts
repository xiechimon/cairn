// 失败分类单源（两个分类器同文件共存，词表规则序对齐 Multica
// taskfailure/classify.go；MUL-1949 SQL 是其正本，此处同律）：
// - classifyStepFailure（#1257）：把 agent 后端自由文本错误分到
//   quota / capacity / network / other 四桶。daemon 侧 network 桶驱动会话
//   续跑重试（runner），server 侧 quota 桶驱动「等额度」挂起（done 面的
//   文本兜底腿——quotaBlock 结构化信号优先，见 machine-wire.ts）。
// - classifyAgentFailure（#1261）：daemon 检测面分类 + 板面文案复用，
//   值域多一档 provider_network（与 #1257 network 同义，命名保持各自
//   消费面原文）。附带 parseRetryAfterMs（Retry-After 头/诊断行 → 毫秒）。
// 两个分类器的差异是有意的（#1257 桶序规则更细：语义先于词面、数字边界），
// 消费面各钉各自测试（task-failure.test.ts 两 describe 块），不互相代偿。
//
// 通用规则（两分类器同律，Multica 同注）：
// - 语义先于词面：concurrent request limit（403 形的瞬态并发拒绝）归
//   capacity，先于 token/quota 词面；token limit 归上下文（other）不归
//   quota——「额度用完」与「窗口装不下」是两种病。
// - 桶序 quota > capacity > network：额度致死常以流断文案浮出（#1257 评论
//   1），quota 词面在串里即归 quota，不被 network 抢走。
// - 数字边界：402/403/429/529 只在非更长数字里命中（Multica 同款防
//   「402913 tokens」「15290ms」「exit status 4030」误触）。
// - 不可见即污染可观测性：分桶失败 = 额度事件落回普通失败漏斗，板面零
//   「等额度」态——这正是 #1261 的用户实测形态。
// 本模块刻意零依赖（不 import zod）：daemon / server / web 三端可直接消费。

// ---------------------------------------------------------------------------
// #1257：classifyStepFailure（server done 面文本兜底 + network 重试判定）
// ---------------------------------------------------------------------------

/** 失败桶（行为面枚举：quota → 挂起等额度；network → 续跑重试；
 *  model_unavailable → 回填 dead + 指认；其余 → 既有失败漏斗）。 */
export const STEP_FAILURE_KINDS = [
  'quota',
  'capacity',
  'model_unavailable',
  'network',
  'other',
] as const;
export type StepFailureKind = (typeof STEP_FAILURE_KINDS)[number];

/** 三位数状态码的数字边界正则（Multica 同款：两侧不贴其它数字才算命中）。 */
const digitBounded = (codes: string): RegExp => new RegExp(`(^|[^0-9])(${codes})([^0-9]|$)`);

const httpQuotaCodeRe = digitBounded('402');
const httpCapacityCodeRe = digitBounded('429|529');

const httpModelNotFoundCodeRe = digitBounded('404');

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** 把 agent 后端错误文本分桶。空串/无规则命中 → other。
 *  规则序（先具体后宽泛，同 Multica Classify）：
 *  1. concurrent request limit → capacity（语义先于 403/token 词面）
 *  2. 上下文超长（context length / prompt too long / token×limit）→ other
 *  3. quota：402 | usage limit | insufficient balance | quota | credits | hit your limit
 *  4. capacity：429 | 529 | rate limit | overloaded | no capacity available
 *  5. network：流断 / 连接失败 / DNS / IO 超时族
 *  6. 其余 → other（auth 401/403、model not found、provider 5xx、空） */
export function classifyStepFailure(rawError: string): StepFailureKind {
  const trimmed = rawError.trim();
  if (trimmed === '') return 'other';
  const lower = trimmed.toLowerCase();

  // 1. 瞬态并发拒绝（Anthropic 形 403）：凭证有效、稍后能成——归 capacity
  //    而不是 auth/quota 词面。
  if (lower.includes('concurrent request limit')) return 'capacity';

  // 2. 上下文 / token 窗口超长 → other（Multica context_overflow 桶：不是配额）。
  //    「token」与「limit」双在场近似 SQL 的 %token%limit%（TPM 限速文案
  //    同落此桶——Multica 同律，宁可保守不把限速当额度）。
  if (
    containsAny(lower, [
      'context length',
      'context_length_exceeded',
      'maximum context',
      'prompt is too long',
      'context size has been exceeded',
    ]) ||
    (lower.includes('token') && lower.includes('limit'))
  ) {
    return 'other';
  }

  // 3. quota / 计费：402（数字边界）、usage limit（403 形同样命中——凭证
  //    有效、额度用尽）、余额/配额/credits 词面。
  if (
    httpQuotaCodeRe.test(lower) ||
    containsAny(lower, [
      'insufficient_balance',
      'balance is too low',
      'monthly usage limit',
      'usage limit',
      "you've hit your limit",
      'you’ve hit your limit',
      'quota',
      'credits',
    ])
  ) {
    return 'quota';
  }

  // 3.5 model_unavailable：/v1/messages 404（模型已被上游下架）。识别在
  //     quota/capacity 之后、network 之前——404 不抢 quota 词面（额度致死
  //     的文案也常带状态码），也不被 network 的泛化连接词吞掉（模型死是
  //     语义事件不是网络事件）。
  if (lower.includes('/v1/messages') && httpModelNotFoundCodeRe.test(lower)) {
    return 'model_unavailable';
  }
  if (
    containsAny(lower, [
      'model not found',
      'model_not_found',
      'model unavailable',
      'model is not available',
      'no such model',
    ]) ||
    (httpModelNotFoundCodeRe.test(lower) &&
      (lower.includes('model') || lower.includes('not found')))
  ) {
    return 'model_unavailable';
  }

  // 4. capacity / 限速：429 / 529（数字边界）+ 限速词面。
  if (
    httpCapacityCodeRe.test(lower) ||
    containsAny(lower, ['rate limit', 'overloaded', 'no capacity available'])
  ) {
    return 'capacity';
  }

  // 5. network：流断 / 连接失败 / DNS / IO 超时。pi/OpenAI SDK 裸串
  //    （Request timed out.）与 Node 错误码（ECONNRESET）同桶。
  if (
    containsAny(lower, [
      'stream disconnected',
      'connection closed',
      'mid-response',
      'connection reset',
      'econnreset',
      'etimedout',
      'socket hang up',
      'error sending request',
      'unable to connect',
      'dial tcp',
      'connection refused',
      'connectionrefused',
      'dns',
      'i/o timeout',
      'deadline exceeded',
      'timeout exceeded while awaiting',
      'request timed out',
    ])
  ) {
    return 'network';
  }

  // 6. 其余（auth 401/403、provider 5xx、未识别）→ other。
  //    403 单独出现无 usage-limit 词面 = 授权/访问问题（非配额）。
  //    model not found 已在 3.5 model_unavailable 分支处理，不进此桶。
  return 'other';
}

// ---------------------------------------------------------------------------
// #1261：classifyAgentFailure（daemon 检测面）+ parseRetryAfterMs
// ---------------------------------------------------------------------------

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

/** 四桶分类（纯函数；空串/未知形态 → other，不抛）。判定序 =
 * quota → capacity → provider_network → other（quota 语义最绑定，先判）。 */
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
