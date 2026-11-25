import type {
  GitCredentials,
  HttpSecretGrant,
  MachineTokenResponse,
  ProviderConfig,
  SecretSurface,
} from '@cairn/shared';
import {
  GITHUB_ACCESS_TOKEN_USERNAME,
  GITHUB_REPOSITORY_RENAMED,
  isBackendRuntimeId,
  isBuildStepKind,
  isInfoOutput,
  parseGithubRepoRef,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { CODEX_PROVIDER_ID } from '../coordinator/codex-login.js';
import { build, chiefThread, machine, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type AppTokenReason, githubAppTokenExpiry } from '../lib/github-token.js';
import { materializeCodexAccessToken } from './codex-device-login.js';
import type { StepCredentialBundle } from './credentials.js';
import {
  issueStepGitCredential,
  resolveChiefStepCredentials,
  resolveStepCredentials,
} from './credentials.js';
import { projectOfTodo } from './git.js';
import { appTokenOrNull } from './github-app-token.js';
import { softwareCommitIdentity } from './github-autonomous-token.js';
import { stepMcpGrant } from './machine-claim.js';
import {
  isChiefConversation,
  type MachineDeps,
  ownedStepRow,
  profileForStep,
} from './machine-deps.js';
import { mcpConnectorDepsOf, stepConnectorEndpoints } from './mcp-servers.js';
import { coordinatorProfile } from './routing-rules.js';
import { materializeXaiAccessToken } from './xai-device-login.js';

export async function stepToken(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  generation?: number,
  surface: SecretSurface = 'host',
  refresh = false,
): Promise<MachineTokenResponse> {
  const owned = ownedStepRow(deps, machineId, stepId);
  fenceClaimSnapshot(owned, generation);
  const response = isChiefConversation(owned.buildId)
    ? await chiefStepToken(deps, stepId, owned.buildId, true)
    : await workerStepToken(deps, machineId, stepId, surface, owned, refresh);
  fenceLiveClaim(deps, machineId, stepId, generation);
  return response;
}

function fenceClaimSnapshot(
  owned: ReturnType<typeof ownedStepRow>,
  generation: number | undefined,
): void {
  if (owned.status !== 'claimed' || generation === undefined || owned.claimedAt !== generation)
    throw new HttpError(409, 'step claim no longer matches this runner', 'claim-moved');
}

function fenceLiveClaim(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  generation: number | undefined,
): void {
  const current = deps.db
    .select({ status: step.status, machineId: step.machineId, claimedAt: step.claimedAt })
    .from(step)
    .where(eq(step.id, stepId))
    .get();
  if (
    current === undefined ||
    current.status !== 'claimed' ||
    current.machineId !== machineId ||
    generation === undefined ||
    current.claimedAt !== generation
  )
    throw new HttpError(409, 'step claim no longer matches this runner', 'claim-moved');
}

async function workerStepToken(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  surface: SecretSurface,
  owned: ReturnType<typeof ownedStepRow>,
  refresh: boolean,
): Promise<MachineTokenResponse> {
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
  const pinnedRepo =
    stepRow?.claimedRepo === null || stepRow?.claimedRepo === undefined
      ? null
      : parseGithubRepoRef(stepRow.claimedRepo);
  const pinnedRepoId = stepRow?.claimedRepoId ?? null;
  const infoCard =
    stepRow !== undefined && todoRow !== undefined
      ? isBuildStepKind(stepRow.kind) && isInfoOutput(todoRow.output)
      : false;
  let git: GitCredentials | null = null;
  if (
    !infoCard &&
    pinnedRepo === null &&
    projectRow?.repoKind === 'hosted' &&
    todoRow &&
    owned.status === 'claimed'
  ) {
    git = issueStepGitCredential(deps, {
      teamId: todoRow.teamId,
      stepId,
      claimedAt: owned.claimedAt,
    });
  } else if (
    !infoCard &&
    (pinnedRepo !== null || projectRow?.repoKind === 'github') &&
    todoRow &&
    owned.status === 'claimed'
  ) {
    if (pinnedRepo === null) {
      throw new HttpError(503, 'github step claim has no repository pin', 'claim-pin-missing');
    }
    if (pinnedRepoId === null) {
      throw new HttpError(
        503,
        'github step claim could not resolve a repository id pin',
        'claim-pin-unresolved',
      );
    }
    const socketPath = deps.githubAppTokenSocket === undefined ? null : deps.githubAppTokenSocket;
    const ref = { ...pinnedRepo, repositoryId: pinnedRepoId };
    const mintFailure: { reason: AppTokenReason } = { reason: 'app-token-unavailable' };
    const appToken = await appTokenOrNull(
      {
        config: {
          githubAppTokenSocket: socketPath,
        },
        ...(deps.githubFetch ? { fetchImpl: deps.githubFetch } : {}),
        onReason: (failure) => {
          mintFailure.reason = failure.reason;
        },
      },
      ref,
      refresh,
      50 * 60_000,
      'runner',
    );
    if (appToken === null) {
      const { reason } = mintFailure;
      if (reason === 'app-token-unconfigured' && !socketPath) {
        console.info('github step credential', { stepId, kind: 'none' });
      } else {
        throw new HttpError(
          503,
          reason === GITHUB_REPOSITORY_RENAMED.reason
            ? GITHUB_REPOSITORY_RENAMED.message
            : 'github app credential unavailable for the claimed step',
          reason,
        );
      }
    } else {
      console.info('github step credential', { stepId, kind: 'app' });
      const expiresAt = githubAppTokenExpiry(appToken);
      git = {
        username: GITHUB_ACCESS_TOKEN_USERNAME,
        password: appToken,
        kind: 'app',
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };
    }
  }
  const provider = await dispatchProvider(
    deps,
    todoRow?.teamId,
    bundle.provider,
    stepRow?.fallback?.model?.provider ?? stepRow?.ranModel?.provider ?? agentRow?.provider,
  );
  return {
    commitIdentity: softwareCommitIdentity(deps),
    provider,
    secrets: bundle.secrets,
    ...httpSecretFields(
      deps,
      bundle.httpSecrets,
      gatewayMayReceive(deps, machineId, surface, owned.status === 'claimed'),
    ),
    ...(owned.status === 'claimed' && bundle.claudeSubscriptionToken !== undefined
      ? { claudeSubscriptionToken: bundle.claudeSubscriptionToken }
      : {}),
    ...(owned.status === 'claimed' && bundle.devinToken !== undefined
      ? { devinToken: bundle.devinToken }
      : {}),
    ...(owned.status === 'claimed' && bundle.antigravityToken !== undefined
      ? { antigravityToken: bundle.antigravityToken }
      : {}),
    ...(owned.status === 'claimed' && todoRow && agentRow
      ? await connectorFields(deps, owned, todoRow.teamId)
      : {}),
    git,
  };
}

type ClaimedStepRow = Pick<typeof step.$inferSelect, 'machineId' | 'mcpGrant'>;

async function connectorFields(
  deps: MachineDeps,
  claimed: ClaimedStepRow,
  teamId: string,
): Promise<Pick<MachineTokenResponse, 'mcpConnectors' | 'withheldMcp'>> {
  if (claimed.machineId === null) return {};
  const machineRow = deps.db.select().from(machine).where(eq(machine.id, claimed.machineId)).get();
  if (machineRow?.capabilities?.mcpConnectors !== true) return {};
  const current = new Set(stepMcpGrant(deps.db, machineRow) ?? []);
  const grant = (claimed.mcpGrant ?? []).filter((slug) => current.has(slug));
  const fields = await stepConnectorEndpoints(mcpConnectorDepsOf(deps), teamId, grant);
  return fields;
}

function gatewayMayReceive(
  deps: MachineDeps,
  machineId: string,
  surface: SecretSurface,
  claimed: boolean,
): boolean {
  if (surface !== 'orb' || !claimed) return false;
  const capabilities = deps.db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get()?.capabilities;
  return capabilities?.secretGateway === true && capabilities.executor === 'orb';
}

function httpSecretFields(
  deps: MachineDeps,
  rows: StepCredentialBundle['httpSecrets'],
  deliver: boolean,
): Pick<MachineTokenResponse, 'httpSecrets' | 'withheldSecrets'> {
  if (rows.length === 0) return {};
  const httpSecrets: HttpSecretGrant[] = [];
  const withheldSecrets: string[] = [];
  for (const row of rows) {
    if (!deliver || row.valueCipher === null) {
      withheldSecrets.push(row.name);
      continue;
    }
    httpSecrets.push({
      id: row.id,
      name: row.name,
      revision: row.revision,
      origin: row.policy.origin,
      header: row.policy.header,
      template: row.policy.template,
      value: deps.box.open(row.valueCipher),
    });
  }
  return {
    ...(httpSecrets.length > 0 ? { httpSecrets } : {}),
    ...(withheldSecrets.length > 0 ? { withheldSecrets } : {}),
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

async function dispatchProvider(
  deps: MachineDeps,
  teamId: string | undefined,
  bundleProvider: StepCredentialBundle['provider'],
  agentProviderId: string | null | undefined,
): Promise<ProviderConfig | null> {
  if (!bundleProvider || bundleProvider.apiKey === null || teamId === undefined) {
    return toProviderConfig(bundleProvider, agentProviderId);
  }
  const loginDeps = {
    db: deps.db,
    box: deps.box,
    fetch: deps.oauthFetch ?? globalThis.fetch,
    states: new Map(),
  };
  const apiKey =
    bundleProvider.providerId === CODEX_PROVIDER_ID
      ? await materializeCodexAccessToken(loginDeps, teamId)
      : await materializeXaiAccessToken(loginDeps, teamId, bundleProvider.providerId);
  return toProviderConfig({ ...bundleProvider, apiKey }, agentProviderId);
}

async function chiefStepToken(
  deps: MachineDeps,
  stepId: string,
  conversationId: string,
  claimed: boolean,
): Promise<MachineTokenResponse> {
  const threadId = conversationId;
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  const bundle = resolveChiefStepCredentials(
    { db: deps.db, box: deps.box },
    threadId,
    stepRow === undefined ? undefined : (stepRow.fallback?.model ?? stepRow.ranModel ?? undefined),
    {
      claudeSubscriptionId: stepRow?.claudeSubscriptionId ?? null,
      devinSubscriptionId: stepRow?.devinSubscriptionId ?? null,
      antigravitySubscriptionId: stepRow?.antigravitySubscriptionId ?? null,
    },
  );
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  const agentRow = threadRow
    ? coordinatorProfile(deps.db, threadRow.teamId, threadRow.projectId)
    : null;
  return {
    provider: await dispatchProvider(
      deps,
      threadRow?.teamId,
      bundle.provider,
      stepRow?.fallback?.model?.provider ?? stepRow?.ranModel?.provider ?? agentRow?.provider,
    ),
    secrets: bundle.secrets,
    ...(claimed && bundle.claudeSubscriptionToken !== undefined
      ? { claudeSubscriptionToken: bundle.claudeSubscriptionToken }
      : {}),
    ...(claimed && bundle.devinToken !== undefined ? { devinToken: bundle.devinToken } : {}),
    ...(claimed && bundle.antigravityToken !== undefined
      ? { antigravityToken: bundle.antigravityToken }
      : {}),
    ...(claimed && stepRow && threadRow && agentRow
      ? await connectorFields(deps, stepRow, threadRow.teamId)
      : {}),
    git: null,
    commitIdentity: softwareCommitIdentity(deps),
  };
}
