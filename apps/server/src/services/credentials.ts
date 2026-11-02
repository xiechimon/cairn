import {
  type ProviderApi,
  type ProviderCompat,
  type ProviderModel,
  type SecretBox,
  SUBSCRIPTION_PI_PROVIDER_ID,
  stepTakesSecrets,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, apiKey, build, chief, chiefThread, step, todo } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { createApiKey } from './api-keys.js';
import { openClaudeSubscription } from './claude-subscriptions.js';
import { agentForStep } from './dispatch-eligibility.js';
import { openProviderKey, type ProviderDeps } from './providers.js';
import { openSecretValues, type SecretDeps } from './secrets.js';

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

  const agentId = todoRow.assignment?.build?.agentId ?? todoRow.assignment?.plan?.agentId ?? null;
  const agentRow = agentId ? deps.db.select().from(agent).where(eq(agent.id, agentId)).get() : null;

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

  const secrets =
    todoRow.assignment?.source !== 'intake-label' && agentRow && stepTakesSecrets(stepRow.kind)
      ? openSecretValues(boxDeps, todoRow.teamId, agentRow.secrets)
      : {};

  return {
    provider,
    secrets,
    git: null,
    claudeSubscriptionToken: subscriptionTokenFor(
      deps,
      todoRow.teamId,
      stepRow.fallback?.model?.provider ??
        agentForStep(deps.db, todoRow, stepRow.kind, stepRow.prompt)?.provider,
      provider,
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
  if (!chiefRow?.agentId) throw notFound(`chief agent binding for ${threadId}`);
  const agentRow = deps.db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get();
  if (!agentRow) throw notFound(`agent ${chiefRow.agentId}`);

  const boxDeps: ProviderDeps & SecretDeps = deps;
  let provider: StepCredentialBundle['provider'] = null;
  const effectiveProviderId = providerId === undefined ? agentRow.provider : providerId;
  if (effectiveProviderId) {
    const opened = openProviderKey(boxDeps, threadRow.teamId, effectiveProviderId);
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
    git: null,
    claudeSubscriptionToken: subscriptionTokenFor(
      deps,
      threadRow.teamId,
      effectiveProviderId,
      provider,
    ),
  };
}

function subscriptionTokenFor(
  deps: CredentialsDeps,
  teamId: string,
  effectiveProviderId: string | null | undefined,
  provider: StepCredentialBundle['provider'],
): string | undefined {
  if (effectiveProviderId === SUBSCRIPTION_PI_PROVIDER_ID && provider !== null) return undefined;
  return openClaudeSubscription(deps, teamId, effectiveProviderId);
}
