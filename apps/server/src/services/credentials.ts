import {
  type ProviderApi,
  type ProviderCompat,
  type ProviderModel,
  type SecretBox,
  stepTakesSecrets,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKey, build, chief, chiefThread, step, todo } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { createApiKey } from './api-keys.js';
import { openClaudeSubscription } from './claude-subscriptions.js';
import { openProviderKey, type ProviderDeps } from './providers.js';
import { coordinatorProfile, profileForStep } from './routing-rules.js';
import { type HttpSecretRow, openSecretGrants, type SecretDeps } from './secrets.js';

export interface CredentialsDeps {
  db: Db;
  box: SecretBox;
}

export function issueStepGitCredential(
  deps: { db: Db },
  input: { teamId: string; stepId: string },
): { username: string; password: string } {
  revokeStepGitCredential(deps, input.stepId);
  const issued = createApiKey(deps, {
    teamId: input.teamId,
    name: stepGitKeyName(input.stepId),
    gitAccess: true,
    mcpAccess: false,
    machineAccess: false,
    toolGrants: { read: [], write: [] },
  });
  return { username: 'git', password: issued.plaintext };
}

export function revokeStepGitCredential(deps: { db: Db }, stepId: string): void {
  deps.db
    .delete(apiKey)
    .where(eq(apiKey.name, stepGitKeyName(stepId)))
    .run();
}

function stepGitKeyName(stepId: string): string {
  return `git-step-${stepId}`;
}

export interface StepCredentialBundle {
  claudeSubscriptionToken?: string;
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
  const providerId = stepRow.fallback?.model?.provider ?? agentRow?.provider ?? null;
  const modelId = stepRow.fallback?.model?.modelId ?? agentRow?.modelId ?? null;
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
      stepRow.fallback?.model?.provider ?? agentRow?.provider,
    ),
  };
}

export function resolveChiefStepCredentials(
  deps: CredentialsDeps,
  threadId: string,
  providerId?: string | null,
): StepCredentialBundle {
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (!threadRow) throw notFound(`chief thread ${threadId}`);
  const chiefRow = deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
  if (!chiefRow) throw notFound(`chief ${threadRow.chiefId}`);
  const agentRow = coordinatorProfile(deps.db, threadRow.teamId);
  if (!agentRow) throw notFound(`coordinator routing rule for ${threadId}`);

  const boxDeps: ProviderDeps & SecretDeps = deps;
  let provider: StepCredentialBundle['provider'] = null;
  if (agentRow.provider) {
    const opened = openProviderKey(boxDeps, threadRow.teamId, agentRow.provider);
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
        modelId: agentRow.modelId,
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
      providerId === undefined ? agentRow.provider : providerId,
    ),
  };
}
