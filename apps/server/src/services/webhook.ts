// GitHub webhook receiver（#1137 事件入口 tracer）：
// POST /api/webhook/github/:token → token 哈希反查（401）→ 事件分诊 →
// 投递去重 → 载荷闸 → repo 映射项目 → #1459 进料闸（sender 在位 → 在飞上限 →
// 团队 token → sender 权限 D5 → 导入前再数上限）→ importGithubIssue →
// orchestrateTodo。
//
// 响应纪律（GitHub 重试风暴防御）：一切配置错/重复/忽略 = 202 + 结构化
// result（`{result, deliveryId, ...}`，shared webhookReceiverResponseSchema）；
// 唯一例外 = importGithubIssue 的上游瞬时失败（HttpError 502/429 直透——
// 重试有意义，GitHub 侧重投）。409（issue 已有任务）→ 202 duplicate。
//
// tracer 三段：
// - 请求段 = 响应 JSON + pino 日志行（deliveryId 键，ctx.logger，bootServer
//   缺省静默）；
// - 落库段 = todo 行 sourceKind/sourceRef + webhook_token.lastUsedAt（verify
//   回写）；
// - 派发段 = chief_thread/chief_message/step 行（orchestrateTodo 落）。
//
// 去重双层：60s 投递窗口（X-GitHub-Delivery → 内存 Map + 惰性清扫）管
// 重复投递；todo.sourceRef 409（importGithubIssue D4 护栏）管跨窗口/重启
// 的同一 issue 重放（持久）。单团队保形（02 §2.2）：token 行带 teamId，
// repo 反查限本 team（代码面不假设单团队）。
//
// #1459 进料闸（ADR 0021 D5，与 #1406 轮询器同一判据、同一缓存、同一上限）：
// 打标人 = 事件的 sender，在仓库上 triage / write / maintain / admin 才导入
// （issue 模板自动打的标，sender 是开票人：外部作者不导入）。读不到权限、团队
// 没有可用 token、项目在飞已满 = 不导入（读不到即不领），一律 202 + detail
// 原因 + 一行 'github webhook import refused' 日志——拒收不是投递失败，不喂
// 重投。权限读遇限流（#1406 round 4：429 / 带限流信号的 403 抛
// GithubRateLimitedError）同读不到，原因码另记 rate-limited（日志带 status 与
// 重置时刻），不进缓存，下一条投递照判。导入的卡 createdBy 仍是 seed 用户（轮询器的关闭对账不碰）。注意：载荷
// 只由 URL token 认证，sender 是 token 持有人说了算；本闸挡的是 GitHub 侧的
// 触发（模板、外部打标），token 泄漏的补救仍是吊销。

import {
  type GithubIssuesEvent,
  githubIssuesEventSchema,
  type SecretBox,
  WEBHOOK_DEDUP_WINDOW_MS,
  WEBHOOK_TRIGGER_LABEL,
  type WebhookReceiverResponse,
} from '@pacman/shared';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type FetchLike, GithubRateLimitedError } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { teamGithubToken } from './github-connection.js';
import { importGithubIssue } from './github-issues.js';
import { hasRepoTriage, ISSUE_INTAKE_IN_FLIGHT_CAP, projectAtInFlightCap } from './issue-intake.js';
import { type OrchestrateDeps, orchestrateTodo } from './orchestrate.js';
import { verifyWebhookToken } from './webhook-tokens.js';

export interface WebhookDeps extends OrchestrateDeps {
  /** GitHub connection token 解密位（importGithubIssue 必经，必选——TodoDeps
   *  的可选 box 是「自建 issue 写向」语义，webhook 读连接面不适用）。 */
  box: SecretBox;
  /** GitHub 出站注入位（importGithubIssue 消费；缺省 globalThis.fetch，
   * 测试注入 mock——零真实出站）。 */
  githubFetch?: FetchLike;
  /** pino 日志（请求段 deliveryId 行；缺省 = 静默，bootServer 形态）。 */
  logger?: Logger;
}

/** 投递去重册（deliveryId → 到达时刻；模块级内存态——重启清零无害，
 * sourceRef 409 是持久闸）。惰性清扫：每次投递顺手清过期项，无定时器。 */
const deliveries = new Map<string, number>();

function seenRecently(deliveryId: string): boolean {
  const now = Date.now();
  // 惰性清扫（窗口外的残项不常驻）。
  for (const [id, at] of deliveries) {
    if (now - at > WEBHOOK_DEDUP_WINDOW_MS) deliveries.delete(id);
  }
  const at = deliveries.get(deliveryId);
  if (at !== undefined && now - at <= WEBHOOK_DEDUP_WINDOW_MS) return true;
  deliveries.set(deliveryId, now);
  return false;
}

/** 清空投递去重册（测试隔离钩子——模块级内存态跨 bootServer 存续，同文件
 * 多用例共 delivery id 会互相吞投递；生产零消费，60s 窗口自清扫）。 */
export function resetWebhookDeliveryWindow(): void {
  deliveries.clear();
}

/** 202 响应封套 + 请求段日志行。 */
function respond(
  logger: Logger | undefined,
  body: WebhookReceiverResponse,
): WebhookReceiverResponse {
  logger?.info({ deliveryId: body.deliveryId, result: body.result }, 'github webhook');
  return body;
}

/** receiver 主流程。返回值 = 响应封套（调用面 202）；HttpError 直透
 * （401 = token 错，importGithubIssue 的 502/429 = 上游瞬时失败喂重试）。 */
export async function receiveGithubWebhook(
  deps: WebhookDeps,
  input: {
    /** URL 路径 token 段（明文，只进哈希比对，不进日志）。 */
    token: string;
    /** X-GitHub-Event 头（缺省按未知事件处理）。 */
    event: string | undefined;
    /** X-GitHub-Delivery 头（缺省 = 空串，不参与去重册）。 */
    deliveryId: string | undefined;
    body: unknown;
  },
): Promise<WebhookReceiverResponse> {
  const logger = deps.logger;
  const deliveryId = input.deliveryId ?? '';

  // token 闸：哈希反查（miss = 401，不区分不存在 vs 错值；命中回写
  // lastUsedAt——落库段追踪位）。
  const tokenRow = verifyWebhookToken({ db: deps.db }, input.token);
  if (!tokenRow) throw new HttpError(401, 'invalid webhook token');

  // 事件分诊：ping（GitHub 建 webhook 首发）/未知事件 = 202 noop，零副作用。
  if (input.event !== 'issues') {
    return respond(logger, {
      result: 'ignored',
      deliveryId,
      detail: `event ${input.event ?? '(none)'} not consumed`,
    });
  }

  // 投递去重（60s 窗口；GitHub 重复投递防御）。
  if (deliveryId !== '' && seenRecently(deliveryId)) {
    return respond(logger, { result: 'duplicate', deliveryId, detail: 'delivery within window' });
  }

  // 载荷闸：非 labeled / 非触发 label / 形坏 = 202 ignored（不透 400 给
  // GitHub——畸形载荷重投也不会变好）。
  const parsed = githubIssuesEventSchema.safeParse(input.body);
  if (!parsed.success) {
    return respond(logger, {
      result: 'ignored',
      deliveryId,
      detail: 'payload does not match issues event shape',
    });
  }
  const payload: GithubIssuesEvent = parsed.data;
  if (payload.action !== 'labeled' || payload.label?.name !== WEBHOOK_TRIGGER_LABEL) {
    return respond(logger, {
      result: 'ignored',
      deliveryId,
      detail: `action ${payload.action} / label not ${WEBHOOK_TRIGGER_LABEL}`,
    });
  }

  // repo 映射：payload repository.full_name 反查本 team 的 github 形态项目
  // （miss = 202 misconfigured——重试无意义，不喂重试风暴）。
  const repoRow = deps.db
    .select()
    .from(project)
    .where(
      and(
        eq(project.teamId, tokenRow.teamId),
        eq(project.repoKind, 'github'),
        eq(project.githubRepo, payload.repository.full_name),
      ),
    )
    .get();
  if (!repoRow) {
    return respond(logger, {
      result: 'misconfigured',
      deliveryId,
      detail: `no github project for ${payload.repository.full_name}`,
    });
  }

  // #1459 进料闸：拒收 = 一行日志（原因码）+ 202 带 detail。
  const fullName = payload.repository.full_name;
  const issueNumber = payload.issue.number;
  const sender = payload.sender?.login ?? '';
  const refuse = (
    reason: string,
    result: 'ignored' | 'misconfigured',
    detail: string,
    extra: Record<string, unknown> = {},
  ): WebhookReceiverResponse => {
    logger?.info(
      {
        deliveryId,
        projectId: repoRow.id,
        repo: fullName,
        issue: issueNumber,
        sender: sender === '' ? null : sender,
        reason,
        ...extra,
      },
      'github webhook import refused',
    );
    return respond(logger, { result, deliveryId, detail });
  };
  const atCapDetail = `project at the in-flight cap (${ISSUE_INTAKE_IN_FLIGHT_CAP} open github-issue tasks)`;
  if (sender === '') return refuse('no-sender', 'ignored', 'event has no sender');
  // 先数上限（只读库）：满了不必读 GitHub。
  if (projectAtInFlightCap(deps.db, repoRow.id)) return refuse('at-cap', 'ignored', atCapDetail);
  const access = teamGithubToken(deps, tokenRow.teamId);
  if ('reason' in access) {
    return refuse(
      access.reason,
      'misconfigured',
      access.reason === 'token-unreadable'
        ? 'github token unreadable'
        : 'github connection not found',
    );
  }
  const githubFetch = deps.githubFetch ?? fetch;
  const slash = fullName.indexOf('/');
  const now = nowMs();
  let trusted: boolean | null;
  try {
    trusted = await hasRepoTriage(
      githubFetch,
      tokenRow.teamId,
      access.token,
      fullName.slice(0, slash),
      fullName.slice(slash + 1),
      sender,
      now,
    );
  } catch (err) {
    // 限流 = 读不到（不进缓存）；其余异常照旧上抛。
    if (!(err instanceof GithubRateLimitedError)) throw err;
    const retryAt = err.retryAt(now);
    const resetAt = retryAt === null ? null : new Date(retryAt).toISOString();
    return refuse(
      'rate-limited',
      'ignored',
      `github rate limited reading the permission of ${sender} on ${fullName}${
        resetAt === null ? '' : ` (resets at ${resetAt})`
      }`,
      { status: err.status, resetAt },
    );
  }
  if (trusted === null) {
    return refuse(
      'permission-unreadable',
      'ignored',
      `permission of ${sender} on ${fullName} unreadable`,
    );
  }
  if (!trusted) {
    return refuse('sender-below-triage', 'ignored', `${sender} is below triage on ${fullName}`);
  }
  // 权限读的 await 期间别路可能已占位：导入前再数一次。这次现数与
  // importGithubIssue 落占位之间不隔 await，同时到的几条投递合起来不超上限。
  if (projectAtInFlightCap(deps.db, repoRow.id)) return refuse('at-cap', 'ignored', atCapDetail);

  // 建 todo + 入编排。409（issue 已有任务，D4 持久闸）= 202 duplicate；
  // GitHub 未连接（importGithubIssue 内 requireToken 404，读窗口里连接被删）=
  // 202 misconfigured；上游瞬时失败（502/429）直透 = 唯一喂 GitHub 重试的分支。
  let todoId: string;
  try {
    const record = await importGithubIssue({ ...deps, githubFetch }, repoRow, issueNumber);
    todoId = record.id;
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      return respond(logger, {
        result: 'duplicate',
        deliveryId,
        detail: `issue ${fullName}#${issueNumber} already has a task`,
      });
    }
    if (err instanceof HttpError && err.status === 404) {
      return respond(logger, {
        result: 'misconfigured',
        deliveryId,
        detail: 'github connection not found',
      });
    }
    throw err;
  }

  // 入编排（webhook 建的 todo 恒 phase='todo'，直通；chief 未绑定 Agent 的
  // 409 属部署配置错——透出去即 409，GitHub 不重试 4xx）。
  const orchestration = orchestrateTodo(deps, todoId);
  // 审计：谁的打标导入了这张卡（轮询器 'issue intake candidate taken' 同律）。
  logger?.info({ deliveryId, todoId, sender }, 'github webhook import accepted');
  return respond(logger, {
    result: 'created',
    deliveryId,
    todoId,
    threadId: orchestration.thread.id,
  });
}
