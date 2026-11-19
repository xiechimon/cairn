import {
  GITHUB_WEBHOOK_DELIVERY_LIMIT,
  type GithubIssuesEvent,
  githubIssuesEventSchema,
  type SecretBox,
  WEBHOOK_TRIGGER_LABEL,
  type WebhookReceiverResponse,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { githubConnection, project } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { type FetchLike, GithubRateLimitedError } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { newScheduleWebhookToken, scheduleWebhookTokenMatches } from '../lib/webhook-token.js';
import {
  evaluateRequestedRun,
  recordAutonomyStart,
  recordAutonomyVerdict,
} from './autonomy-gates.js';
import { chiefBinding } from './chief.js';
import { githubRepoOfProject } from './git.js';
import { teamGithubToken } from './github-connection.js';
import { importGithubIssue } from './github-issues.js';
import { hasRepoTriage, ISSUE_INTAKE_IN_FLIGHT_CAP, projectAtInFlightCap } from './issue-intake.js';
import type { OAuthClientConfig } from './oauth.js';
import { type OrchestrateDeps, orchestrateTodo } from './orchestrate.js';

export interface WebhookDeps extends OrchestrateDeps {
  box: SecretBox;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
  logger?: Logger;
}

type GithubConnectionRow = typeof githubConnection.$inferSelect;

const SENDER_REFUSED_DETAIL = 'sender not confirmed for import (reason in the server log)';

const GITHUB_LOGIN_BASE = /^[A-Za-z0-9][A-Za-z0-9-]*(?:_[A-Za-z0-9]+)?$/;

function isGithubLogin(login: string): boolean {
  const base = login.endsWith('[bot]') ? login.slice(0, -'[bot]'.length) : login;
  return base.length <= 39 && GITHUB_LOGIN_BASE.test(base);
}

export function verifyGithubWebhookToken(
  deps: { db: Db },
  token: string,
): GithubConnectionRow | null {
  const row = deps.db
    .select()
    .from(githubConnection)
    .where(eq(githubConnection.webhookTokenHash, sha256Hex(token)))
    .get();
  if (row === undefined || row.webhookTokenHash === null) return null;
  return scheduleWebhookTokenMatches(row.webhookTokenHash, token) ? row : null;
}

export function mintGithubWebhook(
  deps: { db: Db },
  teamId: string,
): { token: string; masked: string } | null {
  const row = deps.db
    .select({ teamId: githubConnection.teamId })
    .from(githubConnection)
    .where(eq(githubConnection.teamId, teamId))
    .get();
  if (row === undefined) return null;
  const secret = newScheduleWebhookToken();
  deps.db
    .update(githubConnection)
    .set({
      webhookTokenHash: secret.hash,
      webhookMasked: secret.masked,
      webhookDeliveries: [],
      webhookLastUsedAt: null,
    })
    .where(eq(githubConnection.teamId, teamId))
    .run();
  return { token: secret.token, masked: secret.masked };
}

export function revokeGithubWebhook(deps: { db: Db }, teamId: string): boolean {
  const row = deps.db
    .select({ teamId: githubConnection.teamId })
    .from(githubConnection)
    .where(eq(githubConnection.teamId, teamId))
    .get();
  if (row === undefined) return false;
  deps.db
    .update(githubConnection)
    .set({
      webhookTokenHash: null,
      webhookMasked: null,
      webhookDeliveries: null,
      webhookLastUsedAt: null,
    })
    .where(eq(githubConnection.teamId, teamId))
    .run();
  return true;
}

function consumeDelivery(deps: { db: Db }, row: GithubConnectionRow, deliveryId: string): boolean {
  return deps.db.transaction((tx) => {
    const current = tx
      .select({
        webhookDeliveries: githubConnection.webhookDeliveries,
      })
      .from(githubConnection)
      .where(eq(githubConnection.teamId, row.teamId))
      .get();
    const deliveries = current?.webhookDeliveries ?? [];
    if (deliveryId !== '' && deliveries.includes(deliveryId)) return false;
    tx.update(githubConnection)
      .set({
        webhookDeliveries:
          deliveryId === ''
            ? deliveries
            : [...deliveries, deliveryId].slice(-GITHUB_WEBHOOK_DELIVERY_LIMIT),
        webhookLastUsedAt: nowMs(),
      })
      .where(eq(githubConnection.teamId, row.teamId))
      .run();
    return true;
  });
}

function respond(
  logger: Logger | undefined,
  body: WebhookReceiverResponse,
): WebhookReceiverResponse {
  logger?.info({ deliveryId: body.deliveryId, result: body.result }, 'github webhook');
  return body;
}

export async function receiveGithubWebhook(
  deps: WebhookDeps,
  input: {
    token: string;
    event: string | undefined;
    deliveryId: string | undefined;
    body: unknown;
  },
): Promise<WebhookReceiverResponse> {
  const logger = deps.logger;
  const deliveryId = input.deliveryId ?? '';

  const tokenRow = verifyGithubWebhookToken({ db: deps.db }, input.token);
  if (tokenRow === null) throw new HttpError(401, 'invalid webhook token');

  if (!consumeDelivery(deps, tokenRow, deliveryId)) {
    return respond(logger, { result: 'duplicate', deliveryId, detail: 'delivery already seen' });
  }

  if (input.event !== 'issues') {
    return respond(logger, {
      result: 'ignored',
      deliveryId,
      detail: `event ${input.event ?? '(none)'} not consumed`,
    });
  }

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
  const refuseSender = (
    reason: 'rate-limited' | 'permission-unreadable' | 'sender-below-triage',
    detail: string,
    extra: Record<string, unknown> = {},
  ): WebhookReceiverResponse => refuse(reason, 'ignored', detail, extra, SENDER_REFUSED_DETAIL);
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
    return refuse('sender-malformed', 'ignored', 'event sender is not a GitHub login', {
      sender: sender.slice(0, 64),
      senderLength: sender.length,
    });
  }
  if (projectAtInFlightCap(deps.db, repoRow.id)) return refuse('at-cap', 'ignored', atCapDetail);
  const gate = evaluateRequestedRun(deps.db, repoRow, nowMs());
  if (!gate.ok) {
    recordAutonomyVerdict(deps.db, repoRow.id, 'issue-intake', gate, nowMs());
    return refuse('gated', 'ignored', `project autonomy gate: ${gate.reason}`, {
      gate: gate.reason,
    });
  }
  const access = await teamGithubToken(deps, tokenRow.teamId);
  if ('reason' in access) {
    return refuse(
      access.reason,
      'misconfigured',
      access.reason === 'token-unreadable'
        ? 'github token unreadable'
        : access.reason === 'github-disconnected'
          ? 'github connection disconnected (refresh failed); reconnect GitHub'
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
  if (projectAtInFlightCap(deps.db, repoRow.id)) return refuse('at-cap', 'ignored', atCapDetail);

  const binding = chiefBinding(deps, tokenRow.teamId);
  const createdBy =
    binding.canOrchestrate && binding.agentId !== null ? binding.agentId : deps.user.id;

  let todoId: string;
  try {
    const record = await importGithubIssue({ ...deps, githubFetch }, repoRow, issueNumber, {
      createdBy,
    });
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
      if ('reason' in (await teamGithubToken(deps, tokenRow.teamId))) {
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

  recordAutonomyStart(deps.db, repoRow.id, 'issue-intake', nowMs());
  logger?.info({ deliveryId, todoId, sender }, 'github webhook import accepted');
  let threadId: string | undefined;
  try {
    threadId = orchestrateTodo(deps, todoId).thread.id;
  } catch (err) {
    logger?.info(
      { deliveryId, todoId, err: err instanceof Error ? err.message : String(err) },
      'github webhook orchestrate failed',
    );
  }
  return respond(logger, {
    result: 'created',
    deliveryId,
    todoId,
    ...(threadId !== undefined ? { threadId } : {}),
  });
}
