import { GITHUB_WEBHOOK_DELIVERY_LIMIT, type WebhookReceiverResponse } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { githubConnection } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { newWebhookToken, webhookTokenMatches } from '../lib/webhook-token.js';

export interface WebhookDeps {
  db: Db;
  logger?: Logger;
}

type GithubConnectionRow = typeof githubConnection.$inferSelect;

function verifyGithubWebhookToken(deps: { db: Db }, token: string): GithubConnectionRow | null {
  const row = deps.db
    .select()
    .from(githubConnection)
    .where(eq(githubConnection.webhookTokenHash, sha256Hex(token)))
    .get();
  if (row === undefined || row.webhookTokenHash === null) return null;
  return webhookTokenMatches(row.webhookTokenHash, token) ? row : null;
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
  const secret = newWebhookToken();
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

export function receiveGithubWebhook(
  deps: WebhookDeps,
  input: {
    token: string;
    event: string | undefined;
    deliveryId: string | undefined;
  },
): WebhookReceiverResponse {
  const logger = deps.logger;
  const deliveryId = (input.deliveryId ?? '').slice(0, 128);

  const tokenRow = verifyGithubWebhookToken({ db: deps.db }, input.token);
  if (tokenRow === null) throw new HttpError(401, 'invalid webhook token');

  if (!consumeDelivery(deps, tokenRow, deliveryId)) {
    return respond(logger, { result: 'duplicate', deliveryId, detail: 'delivery already seen' });
  }

  return respond(logger, {
    result: 'ignored',
    deliveryId,
    detail: `event ${input.event ?? '(none)'} not consumed`,
  });
}
