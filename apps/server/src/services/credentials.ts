import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BRAND,
  type ProviderApi,
  type ProviderCompat,
  type ProviderModel,
  type SecretBox,
  stepTakesSecrets,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKey, build, chief, chiefThread, step, todo } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { hashCredential } from '../lib/hash.js';
import type { KeySecretBox } from '../lib/secret-box.js';
import { openAntigravitySubscription } from './antigravity-subscriptions.js';
import { createApiKey } from './api-keys.js';
import { openClaudeSubscription } from './claude-subscriptions.js';
import { openDevinSubscription } from './devin-subscriptions.js';
import { openProviderKey, type ProviderDeps } from './providers.js';
import { coordinatorProfile, profileForStep } from './routing-rules.js';
import { type HttpSecretRow, openSecretGrants, type SecretDeps } from './secrets.js';

export interface CredentialsDeps {
  db: Db;
  box: SecretBox;
}

export interface StepGitScope {
  projectId: string;
  buildId: string;
}

export function issueStepGitCredential(
  deps: { db: Db; box: Pick<KeySecretBox, 'keyBytes'> },
  input: { teamId: string; stepId: string; claimedAt: number | null },
): { username: string; password: string } {
  const plaintext = `${BRAND.apiKeyPrefix}${createHmac('sha256', deps.box.keyBytes)
    .update(`step-git-key-v1\0${input.stepId}\0${input.claimedAt ?? 0}`)
    .digest('hex')
    .slice(0, 48)}`;
  const name = stepGitKeyName(input.stepId);
  const hash = hashCredential(plaintext);
  const existing = deps.db.select().from(apiKey).where(eq(apiKey.name, name)).all();
  if (
    existing.length !== 1 ||
    existing[0]?.keyHash !== hash ||
    existing[0]?.claimGeneration !== input.claimedAt
  ) {
    deps.db.delete(apiKey).where(eq(apiKey.name, name)).run();
    createApiKey(deps, {
      teamId: input.teamId,
      name,
      gitAccess: true,
      mcpAccess: false,
      machineAccess: false,
      toolGrants: { read: [], write: [] },
      plaintext,
      claimGeneration: input.claimedAt,
    });
  }
  return { username: 'git', password: plaintext };
}

export function revokeStepGitCredential(deps: { db: Db }, stepId: string): void {
  deps.db
    .delete(apiKey)
    .where(eq(apiKey.name, stepGitKeyName(stepId)))
    .run();
}

const STEP_GIT_KEY_PREFIX = 'git-step-';

function stepGitKeyName(stepId: string): string {
  return `${STEP_GIT_KEY_PREFIX}${stepId}`;
}

export function stepIdOfGitKey(name: string | null): string | null {
  return name?.startsWith(STEP_GIT_KEY_PREFIX) === true
    ? name.slice(STEP_GIT_KEY_PREFIX.length)
    : null;
}

export interface ResolvedGitAuth {
  keyId: string;
  stepScope: StepGitScope | null;
}

export function resolveGitAuth(db: Db, secretHash: Buffer): ResolvedGitAuth | null {
  return db.transaction((tx) => {
    const rows = tx
      .select({
        id: apiKey.id,
        name: apiKey.name,
        keyHash: apiKey.keyHash,
        claimGeneration: apiKey.claimGeneration,
      })
      .from(apiKey)
      .where(eq(apiKey.gitAccess, true))
      .all();
    const row = rows.find(
      (candidate) =>
        candidate.keyHash.length === secretHash.byteLength &&
        timingSafeEqual(Buffer.from(candidate.keyHash), secretHash),
    );
    if (row === undefined) return null;
    const stepId = stepIdOfGitKey(row.name);
    if (stepId === null) return { keyId: row.id, stepScope: null };
    const scope = tx
      .select({ projectId: todo.projectId, buildId: build.id, claimedAt: step.claimedAt })
      .from(step)
      .innerJoin(build, eq(build.id, step.buildId))
      .innerJoin(todo, eq(todo.id, build.todoId))
      .where(and(eq(step.id, stepId), eq(step.status, 'claimed')))
      .get();
    if (
      scope === undefined ||
      row.claimGeneration === null ||
      row.claimGeneration !== scope.claimedAt
    )
      return null;
    return { keyId: row.id, stepScope: { projectId: scope.projectId, buildId: scope.buildId } };
  });
}

export interface StepCredentialBundle {
  claudeSubscriptionToken?: string;
  devinToken?: string;
  antigravityToken?: string;
  provider: {
    providerId: string;
    label: string;
    baseUrl: string;
    api: ProviderApi;
    authHeader: boolean;
    compat: ProviderCompat;
    apiKey: string | null;
    models: ProviderModel[];
    modelId: string | null;
  } | null;
  secrets: Record<string, string>;
  httpSecrets: HttpSecretRow[];
  git: null;
}

export function resolveStepCredentials(
  deps: CredentialsDeps,
  stepId: string,
): StepCredentialBundle {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw notFound(`step ${stepId}`);
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) throw notFound(`build ${stepRow.buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw notFound(`todo ${buildRow.todoId}`);

  const agentRow = profileForStep(deps.db, todoRow, stepRow.kind, stepRow.id);

  const boxDeps: ProviderDeps & SecretDeps = deps;
  let provider: StepCredentialBundle['provider'] = null;
  const providerId =
    stepRow.fallback?.model?.provider ?? stepRow.ranModel?.provider ?? agentRow?.provider ?? null;
  const modelId =
    stepRow.fallback?.model?.modelId ?? stepRow.ranModel?.modelId ?? agentRow?.modelId ?? null;
  if (agentRow && providerId) {
    const opened = openProviderKey(boxDeps, todoRow.teamId, providerId);
    if (opened) {
      provider = {
        providerId: opened.row.providerId,
        label: opened.row.label,
        baseUrl: opened.row.baseUrl,
        api: opened.row.api,
        authHeader: opened.row.authHeader,
        compat: opened.row.compat,
        apiKey: opened.apiKey,
        models: opened.row.models,
        modelId,
      };
    }
  }

  const grants =
    agentRow && stepTakesSecrets(stepRow.kind)
      ? openSecretGrants(boxDeps, todoRow.teamId, agentRow.secrets, todoRow.projectId)
      : { values: {}, http: [] };

  return {
    provider,
    secrets: grants.values,
    httpSecrets: grants.http,
    git: null,
    claudeSubscriptionToken: openClaudeSubscription(
      deps,
      todoRow.teamId,
      stepRow.fallback?.model?.provider ?? stepRow.ranModel?.provider ?? agentRow?.provider,
      stepRow.claudeSubscriptionId,
    ),
    devinToken: openDevinSubscription(
      deps,
      todoRow.teamId,
      stepRow.fallback?.model?.provider ?? stepRow.ranModel?.provider ?? agentRow?.provider,
      stepRow.devinSubscriptionId,
    ),
    antigravityToken: openAntigravitySubscription(
      deps,
      todoRow.teamId,
      stepRow.fallback?.model?.provider ?? stepRow.ranModel?.provider ?? agentRow?.provider,
      stepRow.antigravitySubscriptionId,
    ),
  };
}

export interface ChiefBoundSubscriptions {
  claudeSubscriptionId?: string | null;
  devinSubscriptionId?: string | null;
  antigravitySubscriptionId?: string | null;
  doubaoSubscriptionId?: string | null;
}

export function resolveChiefStepCredentials(
  deps: CredentialsDeps,
  threadId: string,
  model?: { provider: string; modelId: string } | null,
  boundSubscriptionId?: string | null | ChiefBoundSubscriptions,
): StepCredentialBundle {
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (!threadRow) throw notFound(`chief thread ${threadId}`);
  const chiefRow = deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  if (!chiefRow) throw notFound(`chief ${threadRow.chiefId}`);
  const agentRow = coordinatorProfile(deps.db, threadRow.teamId, threadRow.projectId);
  if (!agentRow) throw notFound(`coordinator routing rule for ${threadId}`);

  const effectiveProvider = model === undefined ? agentRow.provider : model?.provider;
  const boundClaudeId =
    typeof boundSubscriptionId === 'object' && boundSubscriptionId !== null
      ? boundSubscriptionId.claudeSubscriptionId
      : boundSubscriptionId;
  const boundDevinId =
    typeof boundSubscriptionId === 'object' && boundSubscriptionId !== null
      ? boundSubscriptionId.devinSubscriptionId
      : undefined;
  const boundAntigravityId =
    typeof boundSubscriptionId === 'object' && boundSubscriptionId !== null
      ? boundSubscriptionId.antigravitySubscriptionId
      : undefined;

  const boxDeps: ProviderDeps & SecretDeps = deps;
  let provider: StepCredentialBundle['provider'] = null;
  if (effectiveProvider) {
    const opened = openProviderKey(boxDeps, threadRow.teamId, effectiveProvider);
    if (opened) {
      provider = {
        providerId: opened.row.providerId,
        label: opened.row.label,
        baseUrl: opened.row.baseUrl,
        api: opened.row.api,
        authHeader: opened.row.authHeader,
        compat: opened.row.compat,
        apiKey: opened.apiKey,
        models: opened.row.models,
        modelId: model?.modelId ?? agentRow.modelId,
      };
    }
  }
  return {
    provider,
    secrets: {},
    httpSecrets: [],
    git: null,
    claudeSubscriptionToken: openClaudeSubscription(
      deps,
      threadRow.teamId,
      effectiveProvider,
      boundClaudeId,
    ),
    devinToken: openDevinSubscription(deps, threadRow.teamId, effectiveProvider, boundDevinId),
    antigravityToken: openAntigravitySubscription(
      deps,
      threadRow.teamId,
      effectiveProvider,
      boundAntigravityId,
    ),
  };
}
