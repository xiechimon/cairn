import type { GitCredentials, MachineTokenResponse, ProviderConfig } from '@cairn/shared';
import { GITHUB_ACCESS_TOKEN_USERNAME, isBackendRuntimeId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { agent, build, chief, chiefThread, step, todo } from '../db/schema.js';
import type { StepCredentialBundle } from './credentials.js';
import {
  issueStepGitCredential,
  resolveChiefStepCredentials,
  resolveStepCredentials,
} from './credentials.js';
import { projectOfTodo } from './git.js';
import { openGithubToken } from './github-connection.js';
import { agentForStep, isChiefConversation, type MachineDeps, ownedStep } from './machine-deps.js';

export function stepToken(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): MachineTokenResponse {
  const owned = ownedStep(deps, machineId, stepId);
  if (isChiefConversation(owned.buildId)) return chiefStepToken(deps, stepId, owned.buildId);
  const bundle = resolveStepCredentials({ db: deps.db, box: deps.box }, stepId);
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  const buildRow = stepRow
    ? deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get()
    : undefined;
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const agentRow =
    stepRow && todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : null;
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  const git =
    projectRow?.repoKind === 'hosted' && todoRow
      ? issueStepGitCredential(deps, { teamId: todoRow.teamId, stepId })
      : projectRow?.repoKind === 'github' && todoRow
        ? githubExecCredential(deps, todoRow.teamId)
        : null;
  return {
    provider: toProviderConfig(
      bundle.provider,
      stepRow?.fallback?.model?.provider ?? agentRow?.provider,
    ),
    secrets: bundle.secrets,
    git,
  };
}

function githubExecCredential(deps: MachineDeps, teamId: string): GitCredentials | null {
  const token = openGithubToken({ db: deps.db, box: deps.box }, teamId);
  return token !== null ? { username: GITHUB_ACCESS_TOKEN_USERNAME, password: token } : null;
}

export function toProviderConfig(
  bundleProvider: StepCredentialBundle['provider'],
  agentProviderId: string | null | undefined,
): ProviderConfig | null {
  if (bundleProvider) {
    return {
      kind: 'http',
      providerId: bundleProvider.providerId,
      label: bundleProvider.label,
      baseUrl: bundleProvider.baseUrl,
      api: bundleProvider.api,
      authHeader: bundleProvider.authHeader,
      compat: bundleProvider.compat,
      models: bundleProvider.models,
      ...(bundleProvider.apiKey !== null ? { apiKey: bundleProvider.apiKey } : {}),
    };
  }
  if (isBackendRuntimeId(agentProviderId)) return null;
  return agentProviderId ? { kind: 'api_key', providerId: agentProviderId } : null;
}

function chiefStepToken(
  deps: MachineDeps,
  _stepId: string,
  conversationId: string,
): MachineTokenResponse {
  const threadId = conversationId;
  const bundle = resolveChiefStepCredentials({ db: deps.db, box: deps.box }, threadId);
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  const chiefRow = threadRow
    ? deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get()
    : undefined;
  const agentRow = chiefRow?.agentId
    ? deps.db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get()
    : undefined;
  return {
    provider: toProviderConfig(bundle.provider, agentRow?.provider),
    secrets: bundle.secrets,
    git: null,
  };
}
