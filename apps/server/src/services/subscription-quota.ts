import {
  classifyRetryFailureWithCode,
  type SecretBox,
  type SubscriptionQuota,
} from '@cairn/shared';
import { and, between, eq, or, sql } from 'drizzle-orm';
import { CODEX_PROVIDER_ID } from '../coordinator/codex-login.js';
import { readCodexQuota } from '../coordinator/runtime/codex-quota.js';
import type { Db } from '../db/client.js';
import {
  antigravitySubscription,
  build,
  chiefThread,
  claudeSubscription,
  devinSubscription,
  doubaoSubscription,
  provider,
  step,
  stepQuota,
  stepSubscription,
  todo,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { readCodexQuotaCredential } from './codex-device-login.js';

const HOUR = 3_600_000;
const subscriptions = {
  claude: [claudeSubscription, stepSubscription.claudeSubscriptionId],
  antigravity: [antigravitySubscription, stepSubscription.antigravitySubscriptionId],
  devin: [devinSubscription, stepSubscription.devinSubscriptionId],
  doubao: [doubaoSubscription, step.doubaoSubscriptionId],
} as const;

export async function getSubscriptionQuota(
  deps: { db: Db; box: SecretBox; fetch: FetchLike },
  teamId: string,
  kind: string,
  id: string,
  signal: AbortSignal,
  now = Date.now(),
): Promise<SubscriptionQuota> {
  const { db } = deps;
  const account =
    kind === 'codex'
      ? db
          .select({ cipher: provider.apiKeyCipher })
          .from(provider)
          .where(
            and(
              eq(provider.id, id),
              eq(provider.teamId, teamId),
              eq(provider.providerId, CODEX_PROVIDER_ID),
            ),
          )
          .get()
      : undefined;
  const local = Object.hasOwn(subscriptions, kind)
    ? subscriptions[kind as keyof typeof subscriptions]
    : undefined;
  if (local) {
    const [table] = local;
    if (
      !db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), eq(table.teamId, teamId)))
        .get()
    ) {
      throw notFound('subscription');
    }
  } else if (!account) {
    throw notFound('subscription');
  }
  const limited = sql`coalesce(${step.failureCode} in ('rate_limit', 'quota') or json_extract(${stepQuota.quotaBlock}, '$.source') = 'claude_rate_limit', 0)`;
  const scope = and(
    local
      ? eq(local[1], id)
      : and(
          or(eq(todo.teamId, teamId), eq(chiefThread.teamId, teamId)),
          sql`json_extract(${stepQuota.ranModel}, '$.provider') = ${CODEX_PROVIDER_ID}`,
        ),
    between(step.claimedAt, now - 7 * 24 * HOUR, now),
  );
  const recent = sql`${step.claimedAt} >= ${now - 5 * HOUR}`;
  const counts = db
    .select({
      runs5h: sql<number>`coalesce(sum(${recent}), 0)`,
      limits5h: sql<number>`coalesce(sum(${recent} and ${limited}), 0)`,
      runs7d: sql<number>`count(*)`,
      limits7d: sql<number>`coalesce(sum(${limited}), 0)`,
    })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .leftJoin(stepSubscription, eq(stepSubscription.stepId, step.id))
    .leftJoin(build, eq(step.buildId, build.id))
    .leftJoin(todo, eq(build.todoId, todo.id))
    .leftJoin(chiefThread, and(eq(step.kind, 'chief'), eq(chiefThread.id, step.buildId)))
    .where(scope)
    .get();
  const lastLimit = db
    .select({
      at: step.finishedAt,
      code: step.failureCode,
      block: stepQuota.quotaBlock,
      error: sql<
        string | null
      >`case when ${build.failureCode} = ${step.failureCode} and not exists (
      select 1 from step as other where other.buildId = ${step.buildId} and other.id <> ${step.id} and other.status = 'failed'
    ) then ${build.errorMessage} end`,
    })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .leftJoin(stepSubscription, eq(stepSubscription.stepId, step.id))
    .leftJoin(build, eq(step.buildId, build.id))
    .leftJoin(todo, eq(build.todoId, todo.id))
    .leftJoin(chiefThread, and(eq(step.kind, 'chief'), eq(chiefThread.id, step.buildId)))
    .where(and(scope, limited))
    .orderBy(
      sql`coalesce(json_extract(${stepQuota.quotaBlock}, '$.lastAt'), ${step.finishedAt}, ${step.claimedAt}) desc`,
      step.id,
    )
    .limit(1)
    .get();
  const block = lastLimit?.block;
  const reset =
    block?.source === 'claude_rate_limit' && block.retryAfterMs !== null
      ? block.lastAt + block.retryAfterMs
      : lastLimit?.error && lastLimit.at != null
        ? classifyRetryFailureWithCode(lastLimit.error, lastLimit.code, lastLimit.at).resetAt
        : null;
  const activity = {
    fiveHour: { runs: counts?.runs5h ?? 0, limited: counts?.limits5h ?? 0 },
    sevenDay: { runs: counts?.runs7d ?? 0, limited: counts?.limits7d ?? 0 },
    resetsAt: reset !== null && reset > now ? reset : null,
  };
  if (account?.cipher == null) return { windows: [], activity };
  let credential: ReturnType<typeof readCodexQuotaCredential>;
  try {
    credential = readCodexQuotaCredential(deps.box, account.cipher, now);
  } catch {
    return { windows: [], activity };
  }
  if (!credential) return { windows: [], activity };
  const windows = await readCodexQuota(deps.fetch, credential, signal, now);
  const unchanged = db
    .select({ id: provider.id })
    .from(provider)
    .where(
      and(
        eq(provider.id, id),
        eq(provider.teamId, teamId),
        eq(provider.providerId, CODEX_PROVIDER_ID),
        eq(provider.apiKeyCipher, account.cipher),
      ),
    )
    .get();
  return { windows: unchanged ? windows : [], activity };
}
