import { timingSafeEqual } from 'node:crypto';
import {
  apiKeyRecordSchema,
  BRAND,
  githubIssueStateSchema,
  type MemoryRecord,
  phaseSchema,
  routeOverrideSchema,
  type TagRecord,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { type agentMemory, apiKey, project, type tag } from './db/schema.js';
import { sha256Hex } from './lib/crypto.js';
import { notFound } from './lib/errors.js';
import type { GithubIssueFaceDeps } from './services/github-issues.js';
import { productionHarnessEvalConfig } from './services/harness-eval-production.js';

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

export function toTagRecord(row: typeof tag.$inferSelect): TagRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
    v: row.v,
  };
}

export const patchTodoBodySchema = z.object({
  title: z.string().optional(),
  spec: z.string().optional(),
  phase: phaseSchema.optional(),
  tagIds: z.array(z.string()).optional(),
  orderIndex: z.number().optional(),
  projectId: z.string().min(1).optional(),
  assignment: z.unknown().optional(),
  routeOverride: routeOverrideSchema.nullable().optional(),
});

export const patchSecretBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  value: z.string().optional(),
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

export async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export function requestOrigin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
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

export function svcOf(ctx: AppContext) {
  return {
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
    db: ctx.db,
    box: ctx.secretBox,
    oauthClient: ctx.oauthClient,
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
  };
}
