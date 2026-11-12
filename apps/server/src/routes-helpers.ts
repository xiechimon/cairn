import { timingSafeEqual } from 'node:crypto';
import {
  apiKeyRecordSchema,
  BRAND,
  categoryFreeTaskInputSchema,
  githubIssueStateSchema,
  type MemoryRecord,
  phaseSchema,
  routeOverrideSchema,
  secretDeliverySchema,
  secretHttpPolicySchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { type agentMemory, apiKey, project } from './db/schema.js';
import { sha256Hex } from './lib/crypto.js';
import { notFound } from './lib/errors.js';
import { tailnetOriginOf } from './lib/tailnet-listener.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import type { GithubIssueFaceDeps } from './services/github-issues.js';
import { productionHarnessEvalConfig } from './services/harness-eval-production.js';
import { assertDeviceActive } from './services/paired-devices.js';

export const SESSION_COOKIE = BRAND.sessionCookieName;

export const GIT_AUTH_REALM = 'cairn-git';

export function requireTeam(ctx: AppContext, id: string): void {
  if (id !== ctx.team.id) throw notFound(`team ${id}`);
}

export function requireProject(ctx: AppContext, id: string): typeof project.$inferSelect {
  const row = ctx.db.select().from(project).where(eq(project.id, id)).get();
  if (!row) throw notFound(`project ${id}`);
  return row;
}

export const githubIssuesQuerySchema = z.object({
  state: githubIssueStateSchema,
  page: z.coerce.number().int().min(1),
});

export const patchTodoBodySchema = categoryFreeTaskInputSchema.pipe(
  z.object({
    title: z.string().optional(),
    spec: z.string().optional(),
    phase: phaseSchema.optional(),
    orderIndex: z.number().optional(),
    projectId: z.string().min(1).optional(),
    assignment: z.unknown().optional(),
    routeOverride: routeOverrideSchema.nullable().optional(),
  }),
);

export const patchSecretBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  value: z.string().optional(),
  delivery: secretDeliverySchema.optional(),
  http: secretHttpPolicySchema.optional(),
});

export const createApiKeyBodySchema = apiKeyRecordSchema.extend({ name: z.string().nullish() });

export function toMemoryRecord(row: typeof agentMemory.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    teamId: row.teamId,
    title: row.title,
    content: row.content,
    projectId: row.projectId,
    sourceTodoId: row.sourceTodoId,
    sourceBuildId: row.sourceBuildId,
    source: row.source,
    layer: row.layer,
    threadId: row.threadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    invalidAt: row.invalidAt,
    supersededBy: row.supersededBy,
    lastInjectedAt: row.lastInjectedAt,
    history: row.history,
  };
}

export async function jsonBody(c: Context): Promise<unknown> {
  const body = await c.req.json().catch(() => null);
  assertDeviceActive(pairedDeviceIdOf(c));
  return body;
}

export function requestOrigin(c: Context): string {
  return tailnetOriginOf(c) ?? new URL(c.req.url).origin;
}

export function verifyGitBasicAuth(ctx: AppContext, header: string): string | undefined {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return undefined;
  const decoded = Buffer.from(match[1] ?? '', 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return undefined;
  const secret = decoded.slice(sep + 1);
  if (secret === '') return undefined;
  const hash = Buffer.from(sha256Hex(secret));
  const rows = ctx.db.select().from(apiKey).where(eq(apiKey.gitAccess, true)).all();
  return rows.find(
    (r) => r.keyHash.length === hash.byteLength && timingSafeEqual(Buffer.from(r.keyHash), hash),
  )?.id;
}

export function githubAppOf(ctx: AppContext) {
  return {
    githubAppTokenSocket: ctx.githubAppTokenSocket ?? null,
    githubAppIdentity: ctx.githubAppIdentity ?? null,
  };
}

export function svcOf(ctx: AppContext) {
  return {
    ...githubAppOf(ctx),
    db: ctx.db,
    hub: ctx.hub,
    machineHub: ctx.machineHub,
    user: ctx.user,
    vapidKeys: ctx.vapidKeys,
    convHub: ctx.convHub,
    reposDir: ctx.reposDir,
    attachmentsDir: ctx.attachmentsDir,
    box: ctx.secretBox,
    oauthClient: ctx.oauthClient,
    harnessEval: productionHarnessEvalConfig(),
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
  };
}

export function githubIssueDepsOf(ctx: AppContext): GithubIssueFaceDeps {
  return {
    ...githubAppOf(ctx),
    db: ctx.db,
    box: ctx.secretBox,
    oauthClient: ctx.oauthClient,
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
  };
}
