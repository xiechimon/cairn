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
// 没有可用 token、项目在飞已满、项目存的 githubRepo 不是 owner/repo（#1466 的
// `.` / `..` 段，与轮询器、importGithubIssue 同经 githubRepoOfProject）= 不导入
// （读不到即不领），一律 202 + 一行 'github webhook import refused' 日志（原因码
// reason + 细节 detail）——拒收不是投递失败，不喂重投。权限读遇限流（#1406
// round 4：429 / 带限流信号的 403 抛 GithubRateLimitedError）同读不到，原因码另
// 记 rate-limited（日志带 status 与重置时刻），不进缓存，下一条投递照判。打标
// 人权限类的三种拒收（不到 triage、读不到、遇限流）对调用方只答同一句
// SENDER_REFUSED_DETAIL：哪一种、哪个账号只进日志（#1477 pr-gate run 1）。这只
// 去掉 detail 里的权限结论：过了权限核验之后的结果（导入、duplicate、issue 读
// 不到）与被拒不同，URL token 持有人仍能拿一条载荷推出某个 login 够不够 triage。
// sender 不是 GitHub 账号名（`.` / `..` / 带 `/`）先拒，不拼进权限读的路径。
// 导入的卡 createdBy 仍是
// seed 用户（轮询器的关闭对账不碰）。注意：载荷只由 URL token 认证，sender 是
// token 持有人说了算；本闸挡的是 GitHub 侧的触发（模板、外部打标），token 泄漏
// 的补救仍是吊销。

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
import {
  evaluateRequestedRun,
  recordAutonomyStart,
  recordAutonomyVerdict,
} from './autonomy-gates.js';
import { githubRepoOfProject } from './git.js';
import { importGithubIssue } from './github-issues.js';
import {
  hasRepoTriage,
  ISSUE_INTAKE_IN_FLIGHT_CAP,
  projectAtInFlightCap,
  teamGithubToken,
} from './issue-intake.js';
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

/** 打标人权限类拒收（sender-below-triage / permission-unreadable /
 * rate-limited）的 202 detail：三种同一句，细节只进日志行。 */
const SENDER_REFUSED_DETAIL = 'sender not confirmed for import (reason in the server log)';

/** GitHub 账号名的形状：字母数字与连字符，不以连字符起头；Enterprise Managed
 * Users 的托管账号再带一段下划线加短码（GitHub 文档「Username considerations for
 * external authentication」：「On GitHub.com, GitHub also adds an underscore and
 * your enterprise's shortcode to the end of each username」，格式
 * IDP-USERNAME_SHORT-CODE，例 mona-cat_octo；设置账号是 SHORT-CODE_admin）。这里
 * 有意比文档宽：下划线后不限位数（文档的短码是三到八位），连字符不查连写与结尾
 * （老账号有这种名字）——宽的那边只多一次权限读，不会改写路径。sender 来自载荷
 * （URL token 持有人说了算）、要拼进权限读的路径：`.` / `..` 会被 URL 规范化改写
 * 成别的路径，带 `/` 的会读错资源，一律先拒。轮询器的打标人来自 GitHub 的 events
 * 应答，不过这道形状闸。 */
const GITHUB_LOGIN_BASE = /^[A-Za-z0-9][A-Za-z0-9-]*(?:_[A-Za-z0-9]+)?$/;

/** 账号名是不是 GitHub 认的形状：去掉 GitHub App bot 账号的 `[bot]` 后缀后至多 39
 * 个字符（文档：「Usernames, including underscore and short code, must not exceed
 * 39 characters」），再过 GITHUB_LOGIN_BASE。 */
function isGithubLogin(login: string): boolean {
  const base = login.endsWith('[bot]') ? login.slice(0, -'[bot]'.length) : login;
  return base.length <= 39 && GITHUB_LOGIN_BASE.test(base);
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

  // #1459 进料闸：拒收 = 一行日志（原因码 + 细节）+ 202 带 detail（answer 缺省
  // = 细节；打标人权限类的拒收答 SENDER_REFUSED_DETAIL）。
  const fullName = payload.repository.full_name;
  const issueNumber = payload.issue.number;
  const sender = payload.sender?.login ?? '';
  const refuse = (
    reason: string,
    result: 'ignored' | 'misconfigured',
    detail: string,
    extra: Record<string, unknown> = {},
    answer: string = detail,
  ): WebhookReceiverResponse => {
    logger?.info(
      {
        deliveryId,
        projectId: repoRow.id,
        repo: fullName,
        issue: issueNumber,
        sender: sender === '' ? null : sender,
        reason,
        detail,
        ...extra,
      },
      'github webhook import refused',
    );
    return respond(logger, { result, deliveryId, detail: answer });
  };
  // 打标人权限类的拒收：202 只答同一句，哪一种、哪个账号只进日志。
  const refuseSender = (
    reason: 'rate-limited' | 'permission-unreadable' | 'sender-below-triage',
    detail: string,
    extra: Record<string, unknown> = {},
  ): WebhookReceiverResponse => refuse(reason, 'ignored', detail, extra, SENDER_REFUSED_DETAIL);
  // 存量行的 githubRepo 不合法（#1466：`.` / `..` 段会改写请求路径）：同按配置错
  // 收，不拆 full_name、不出站（轮询器与 importGithubIssue 同一判据）。
  const repoRef = githubRepoOfProject(repoRow);
  if (repoRef === null) {
    return refuse(
      'malformed-repo',
      'misconfigured',
      `github repo of the project is not owner/repo: ${fullName}`,
    );
  }
  const atCapDetail = `project at the in-flight cap (${ISSUE_INTAKE_IN_FLIGHT_CAP} open github-issue tasks)`;
  if (sender === '') return refuse('no-sender', 'ignored', 'event has no sender');
  if (!isGithubLogin(sender)) {
    // 载荷里的 login 没有长度上限：日志只记前 64 个字符与总长。
    return refuse('sender-malformed', 'ignored', 'event sender is not a GitHub login', {
      sender: sender.slice(0, 64),
      senderLength: sender.length,
    });
  }
  // 先数上限（只读库）：满了不必读 GitHub。
  if (projectAtInFlightCap(deps.db, repoRow.id)) return refuse('at-cap', 'ignored', atCapDetail);
  // 触发闸（#1491）：打标是人明确要的，不让路、不冷却；总开关关了或当天预算
  // 满（读不到同样算满）就不领。标签留在 issue 上，轮询器开着时下一轮重判。
  const gate = evaluateRequestedRun(deps.db, repoRow, nowMs());
  if (!gate.ok) {
    recordAutonomyVerdict(deps.db, repoRow.id, 'issue-intake', gate, nowMs());
    return refuse('gated', 'ignored', `project autonomy gate: ${gate.reason}`, {
      gate: gate.reason,
    });
  }
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
  const now = nowMs();
  let trusted: boolean | null;
  try {
    trusted = await hasRepoTriage(
      githubFetch,
      tokenRow.teamId,
      access.token,
      repoRef.owner,
      repoRef.repo,
      sender,
      now,
    );
  } catch (err) {
    // 限流 = 读不到（不进缓存）；其余异常照旧上抛。
    if (!(err instanceof GithubRateLimitedError)) throw err;
    const retryAt = err.retryAt(now);
    const resetAt = retryAt === null ? null : new Date(retryAt).toISOString();
    return refuseSender(
      'rate-limited',
      `github rate limited reading the permission of ${sender} on ${fullName}${
        resetAt === null ? '' : ` (resets at ${resetAt})`
      }`,
      { status: err.status, resetAt },
    );
  }
  if (trusted === null) {
    return refuseSender(
      'permission-unreadable',
      `permission of ${sender} on ${fullName} unreadable`,
    );
  }
  if (!trusted) {
    return refuseSender('sender-below-triage', `${sender} is below triage on ${fullName}`);
  }
  // 权限读的 await 期间别路可能已占位：导入前再数一次。这次现数与
  // importGithubIssue 落占位之间不隔 await，同时到的几条投递合起来不超上限。
  if (projectAtInFlightCap(deps.db, repoRow.id)) return refuse('at-cap', 'ignored', atCapDetail);

  // 建 todo + 入编排。409（issue 已有任务，D4 持久闸）= 202 duplicate；404 =
  // 202 misconfigured，两种来源分开说：GitHub 未连接（importGithubIssue 内
  // requireToken 的 404，权限读期间连接被删）与 GitHub 读 issue / 标签答 404
  // （issue 不存在或已删，或团队 token 看不到）——重查一次团队 token 分辨；上游
  // 瞬时失败（502/429）直透 = 唯一喂 GitHub 重试的分支。
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
      if ('reason' in teamGithubToken(deps, tokenRow.teamId)) {
        return refuse('no-github-connection', 'misconfigured', 'github connection not found');
      }
      return refuse(
        'issue-not-found',
        'misconfigured',
        `issue ${fullName}#${issueNumber} not found on GitHub (or not visible to the team token)`,
      );
    }
    throw err;
  }

  // 导入即开跑一次：轮询器的冷却从这里起算。
  recordAutonomyStart(deps.db, repoRow.id, 'issue-intake', nowMs());
  // 审计：谁的打标导入了这张卡（轮询器 'issue intake candidate taken' 同律）。
  // 写在编排之前：编排抛错时卡已建成，这一行照样要在。
  logger?.info({ deliveryId, todoId, sender }, 'github webhook import accepted');
  // 入编排（webhook 建的 todo 恒 phase='todo'，直通；chief 未绑定 Agent 的
  // 409 属部署配置错——透出去即 409，GitHub 不重试 4xx）。
  const orchestration = orchestrateTodo(deps, todoId);
  return respond(logger, {
    result: 'created',
    deliveryId,
    todoId,
    threadId: orchestration.thread.id,
  });
}
