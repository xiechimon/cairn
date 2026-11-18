import type {
  GitCredentials,
  HttpSecretGrant,
  MachineTokenResponse,
  ProviderConfig,
  SecretSurface,
} from '@cairn/shared';
import { GITHUB_ACCESS_TOKEN_USERNAME, isBackendRuntimeId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { CODEX_PROVIDER_ID } from '../coordinator/codex-login.js';
import { build, chiefThread, machine, step, todo } from '../db/schema.js';
import { githubAppTokenExpiry, isAppToken } from '../lib/github-token.js';
import { materializeCodexAccessToken } from './codex-device-login.js';
import type { StepCredentialBundle } from './credentials.js';
import {
  issueStepGitCredential,
  resolveChiefStepCredentials,
  resolveStepCredentials,
} from './credentials.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { autonomousToken, softwareCommitIdentity } from './github-autonomous-token.js';
import { chiefTurnLocked, stepMcpGrant } from './machine-claim.js';
import {
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  profileForStep,
} from './machine-deps.js';
import {
  defaultMcpConfigPath,
  newMcpOAuthState,
  publicOAuthFetch,
  stepConnectorEndpoints,
} from './mcp-servers.js';
import { coordinatorProfile } from './routing-rules.js';
import { materializeXaiAccessToken } from './xai-device-login.js';

export async function stepToken(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  surface: SecretSurface = 'host',
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
  if (projectRow?.repoKind === 'hosted' && todoRow && owned.status === 'claimed') {
    git = issueStepGitCredential(deps, {
      teamId: todoRow.teamId,
      stepId,
      claimedAt: owned.claimedAt,
    });
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
  const provider = await dispatchProvider(
    deps,
    todoRow?.teamId,
    bundle.provider,
    stepRow?.fallback?.model?.provider ?? agentRow?.provider,
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
    ...(owned.status === 'claimed' && todoRow && agentRow
      ? await connectorFields(deps, owned, todoRow.teamId)
      : {}),
    git,
  };
}

type ClaimedStepRow = Pick<typeof step.$inferSelect, 'id' | 'machineId' | 'claimedAt'>;

function stillClaimedBy(deps: MachineDeps, claimed: ClaimedStepRow): boolean {
  const current = deps.db
    .select({ status: step.status, machineId: step.machineId, claimedAt: step.claimedAt })
    .from(step)
    .where(eq(step.id, claimed.id))
    .get();
  return (
    current?.status === 'claimed' &&
    current.machineId === claimed.machineId &&
    current.claimedAt === claimed.claimedAt
  );
}

async function connectorFields(
  deps: MachineDeps,
  claimed: ClaimedStepRow,
  teamId: string,
  locked = false,
): Promise<Pick<MachineTokenResponse, 'mcpConnectors' | 'withheldMcp'>> {
  if (claimed.machineId === null) return {};
  const machineRow = deps.db.select().from(machine).where(eq(machine.id, claimed.machineId)).get();
  if (machineRow?.capabilities?.mcpConnectors !== true) return {};
  const grant = stepMcpGrant(deps.db, machineRow, locked);
  const fields = await stepConnectorEndpoints(
    {
      db: deps.db,
      box: deps.box,
      mcpConfigPath: deps.mcpConfigPath ?? defaultMcpConfigPath(),
      fetch: deps.mcpFetch ?? globalThis.fetch,
      oauthFetch: deps.mcpFetch ?? publicOAuthFetch,
      oauthState: deps.mcpOAuthState ?? newMcpOAuthState(),
      githubFetch: deps.githubFetch,
      oauthClient: deps.oauthClient,
    },
    teamId,
    grant ?? [],
  );
  return stillClaimedBy(deps, claimed) ? fields : {};
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
    stepRow?.fallback?.model?.provider,
    stepRow?.claudeSubscriptionId,
  );
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  const agentRow = threadRow
    ? coordinatorProfile(deps.db, threadRow.teamId, threadRow.projectId)
    : null;
  return {
    provider: await dispatchProvider(deps, threadRow?.teamId, bundle.provider, agentRow?.provider),
    secrets: bundle.secrets,
    ...(claimed && bundle.claudeSubscriptionToken !== undefined
      ? { claudeSubscriptionToken: bundle.claudeSubscriptionToken }
      : {}),
    ...(claimed && stepRow && threadRow && agentRow
      ? await connectorFields(deps, stepRow, threadRow.teamId, chiefTurnLocked(stepRow))
      : {}),
    git: null,
    commitIdentity: softwareCommitIdentity(deps),
  };
}
