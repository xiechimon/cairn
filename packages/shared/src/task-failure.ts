// 失败分类器（#1257，Multica 同形三桶）：把 agent 后端的自由文本错误分到
// quota / capacity / network / other 四桶。双端单源——daemon 侧 network 桶
// 驱动会话续跑重试（runner），server 侧 quota 桶驱动「等额度」挂起（done
// 面）；词表与规则序对齐 Multica taskfailure/classify.go（MUL-1949 SQL 是
// 其正本，此处同律）：
// - 语义先于词面：concurrent request limit（403 形的瞬态并发拒绝）归
//   capacity，先于 token/quota 词面；token limit 归上下文（other）不归
//   quota——「额度用完」与「窗口装不下」是两种病。
// - 桶序 quota > capacity > network：额度致死常以流断文案浮出（#1257 评论
//   1），quota 词面在串里即归 quota，不被 network 抢走。
// - 数字边界：402/403/429/529 只在非更长数字里命中（Multica 同款防
//   「402913 tokens」「15290ms」「exit status 4030」误触）。
// 本模块刻意零依赖（不 import zod）：daemon / server / web 三端可直接消费。

/** 失败桶（行为面枚举：quota → 挂起等额度；network → 续跑重试；其余 → 既有失败漏斗）。 */
export const STEP_FAILURE_KINDS = ['quota', 'capacity', 'network', 'other'] as const;
export type StepFailureKind = (typeof STEP_FAILURE_KINDS)[number];

/** 三位数状态码的数字边界正则（Multica 同款：两侧不贴其它数字才算命中）。 */
const digitBounded = (codes: string): RegExp => new RegExp(`(^|[^0-9])(${codes})([^0-9]|$)`);

const httpQuotaCodeRe = digitBounded('402');
const httpCapacityCodeRe = digitBounded('429|529');

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

  // 6. 其余（auth 401/403、model not found、provider 5xx、未识别）→ other。
  //    403 单独出现无 usage-limit 词面 = 授权/访问问题（非配额）。
  return 'other';
}
