import type { GitCredentials, MachineTokenResponse, ProviderConfig } from '@cairn/shared';
import { GITHUB_ACCESS_TOKEN_USERNAME, isBackendRuntimeId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, chiefThread, step, todo } from '../db/schema.js';
import { githubAppTokenExpiry, isAppToken } from '../lib/github-token.js';
import type { StepCredentialBundle } from './credentials.js';
import {
  issueStepGitCredential,
  resolveChiefStepCredentials,
  resolveStepCredentials,
} from './credentials.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { autonomousToken, softwareCommitIdentity } from './github-autonomous-token.js';
import { humanWorkIdentity } from './github-work-attribution.js';
import {
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  profileForStep,
} from './machine-deps.js';
import { coordinatorProfile } from './routing-rules.js';
import { readTeamAttributionSettings } from './team-attribution-settings.js';

export async function stepToken(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): Promise<MachineTokenResponse> {
  const owned = ownedStep(deps, machineId, stepId);
  if (isChiefConversation(owned.buildId))
    return chiefStepToken(deps, stepId, owned.buildId, owned.status === 'claimed');
  const bundle = resolveStepCredentials({ db: deps.db, box: deps.box }, stepId);
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  const buildRow = stepRow
    ? deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get()
    : undefined;
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const agentRow =
    stepRow && todoRow ? profileForStep(deps, todoRow, stepRow.kind, stepRow.id) : null;
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  let git: GitCredentials | null = null;
  if (projectRow?.repoKind === 'hosted' && todoRow) {
    git = issueStepGitCredential(deps, { teamId: todoRow.teamId, stepId });
  } else if (projectRow?.repoKind === 'github' && todoRow) {
    const ref = githubRepoOfProject(projectRow);
    const githubToken =
      ref === null ? null : await autonomousToken(deps, todoRow.teamId, ref, true, 50 * 60_000);
    console.info('github step credential', {
      stepId,
      kind: githubToken === null ? 'none' : isAppToken(githubToken) ? 'app' : 'unattributed',
    });
    git =
      githubToken !== null
        ? {
            username: GITHUB_ACCESS_TOKEN_USERNAME,
            password: githubToken,
            kind: isAppToken(githubToken) ? 'app' : 'unattributed',
            ...(isAppToken(githubToken) ? { expiresAt: githubAppTokenExpiry(githubToken) } : {}),
          }
        : null;
  }
  return {
    commitIdentity: softwareCommitIdentity(deps),
    coAuthor:
      todoRow &&
      stepRow?.scheduleId == null &&
      readTeamAttributionSettings(deps.db, todoRow.teamId).coAuthorTrailer
        ? humanWorkIdentity(deps.db, todoRow, buildRow?.triggerSource)
        : null,
    provider: toProviderConfig(
      bundle.provider,
      stepRow?.fallback?.model?.provider ?? agentRow?.provider,
    ),
    secrets: bundle.secrets,
    ...(owned.status === 'claimed' && bundle.claudeSubscriptionToken !== undefined
      ? { claudeSubscriptionToken: bundle.claudeSubscriptionToken }
      : {}),
    git,
  };
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
  stepId: string,
  conversationId: string,
  claimed: boolean,
): MachineTokenResponse {
  const threadId = conversationId;
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  const bundle = resolveChiefStepCredentials(
    { db: deps.db, box: deps.box },
    threadId,
    stepRow?.fallback?.model?.provider,
  );
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  const agentRow = threadRow ? coordinatorProfile(deps.db, threadRow.teamId) : null;
  return {
    provider: toProviderConfig(bundle.provider, agentRow?.provider),
    secrets: bundle.secrets,
    ...(claimed && bundle.claudeSubscriptionToken !== undefined
      ? { claudeSubscriptionToken: bundle.claudeSubscriptionToken }
      : {}),
    git: null,
    coAuthor: null,
  };
}
