// Webhook 事件入口（#1137：GitHub webhook → 建 todo + orchestrate）。
// shared 单源三样：触发 label 名、投递去重窗口、载荷/响应 zod 形状。
// 语义裁决（票面 + 方案钉死）：
// - 事件源 = issues 事件的 `action === 'labeled'`，且被贴 label 名 =
//   WEBHOOK_TRIGGER_LABEL——只有显式贴标的 issue 才建任务（信噪比纪律）；
// - token 走 URL 路径不走 header（GitHub webhook 无法自定义 Authorization
//   头；HMAC 签名与「token 只存哈希」互斥），安全模型 = 等价 Bearer 高熵
//   随机凭证，可吊销（删行即失效）；
// - 非 2xx 会触发 GitHub 重试风暴：一切配置错（repo 未映射 / 未连接 /
//   非 issues 事件 / 非 labeled / 非触发 label / 重复投递 / 已有任务）一律
//   202 + 结构化 result，只有上游 API 瞬时失败（502 直透）喂重试。

import { z } from 'zod';

/** 触发 label 名（贴此 label 的 issue 事件 → 建 todo + orchestrate）。 */
export const WEBHOOK_TRIGGER_LABEL = 'pacman';

/** X-GitHub-Delivery 去重窗口（重复投递防御，server 内存态；跨窗口/重启
 * 由 todo.sourceRef 409 持久闸兜底）。 */
export const WEBHOOK_DEDUP_WINDOW_MS = 60_000;

/** GitHub issues 事件载荷最小子集（未知字段宽容剥离；label 位只在
 * `action === 'labeled'` 时出现，schema 里 optional、消费面先判 action）。 */
export const githubIssuesEventSchema = z.object({
  action: z.string(),
  issue: z.object({
    number: z.number().int().positive(),
  }),
  /** 触发 label（labeled 动作时在位）。 */
  label: z
    .object({
      name: z.string(),
    })
    .optional(),
  repository: z.object({
    full_name: z.string().min(1),
  }),
});
export type GithubIssuesEvent = z.infer<typeof githubIssuesEventSchema>;

/** receiver 响应封套（tracer 请求段：result 四值 + 溯源 id）。 */
export const webhookReceiverResponseSchema = z.object({
  /** created = 建 todo + 入编排；duplicate = 重复投递或 issue 已有任务；
   * ignored = 非 issues 事件 / 非 labeled / 非触发 label / 载荷形坏；
   * misconfigured = repo 未映射项目 / GitHub 未连接（重试无意义，收 202）。 */
  result: z.enum(['created', 'duplicate', 'ignored', 'misconfigured']),
  /** X-GitHub-Delivery 原样回显（请求段对账键）。 */
  deliveryId: z.string(),
  todoId: z.string().optional(),
  threadId: z.string().optional(),
  detail: z.string().optional(),
});
export type WebhookReceiverResponse = z.infer<typeof webhookReceiverResponseSchema>;
