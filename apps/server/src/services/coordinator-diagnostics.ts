import {
  chiefTurnErrorContentSchema,
  type DeployRecord,
  isChiefSideThreadId,
  OWN_COMPUTER_NO_MAC,
  type RemoteToolDef,
  type StepFailureCode,
  type StepKind,
} from '@cairn/shared';
import { otlpTraceIdOfStep } from '@cairn/shared/otel';
import { and, desc, eq, isNull, notLike, or, sql } from 'drizzle-orm';
import { build, chiefMessage, chiefThread, step, todo } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { connectorToolDefsForTeam } from './connector-broker.js';
import { browserOfferFor, teamMachines } from './coordinator-browser.js';
import { coordinatorToolDefs } from './coordinator-tool-defs.js';
import { readDeployStatus } from './deploy-status.js';
import { teamOffersDesktop } from './machine-computer.js';
import type { MachineDeps } from './machine-deps.js';
import {
  ownComputerOffered,
  ownComputerTarget,
  ownComputerWorkspaceOffered,
} from './own-computer.js';
import { offeredPhoneNames } from './phone-computer.js';
import { readServerVersionInfo } from './server-version.js';

const DIAGNOSTIC_CORE_TOOLS = [
  'create_todo',
  'todos',
  'projects',
  'machines',
  'open_thread',
  'message_thread',
  'threads',
  'needs_you',
] as const;

const RECENT_FAILURES_LIMIT = 5;

export interface CoordinatorToolGroups {
  router: boolean;
  desktop: boolean;
  ownComputer: boolean;
  browser: boolean;
  ownerChrome: boolean;
  phones: string[];
  connectorToolCount: number;
}

export interface CoordinatorRemoteToolsResult {
  tools: RemoteToolDef[];
  groups: CoordinatorToolGroups;
  ownComputerReady: boolean;
  ownComputerReason: string | null;
}

export interface CoordinatorDiagnosticsMachine {
  id: string;
  name: string;
  kind: string;
  online: boolean;
  hubConnected: boolean;
  latestCliVersion: string | null;
  capabilities: {
    ownComputer: boolean;
    ownComputerShell: boolean;
    browser: boolean;
    computer: boolean;
    mcpServers: string[];
    skills: string[];
  };
}

export interface CoordinatorDiagnosticsFailure {
  stepId: string;
  buildId: string;
  kind: StepKind;
  status: 'failed';
  failureCode: StepFailureCode | null;
  errorMessage: string | null;
  createdAt: number;
  finishedAt: number | null;
  traceId: string;
}

export interface CoordinatorDiagnostics {
  deploy: DeployRecord | null;
  serverVersion: { version: string | null; commit: string | null };
  threadId: string | null;
  coordinator: {
    offeredToolCount: number;
    offeredTools: string[];
    coreToolsPresent: boolean;
    missingCoreTools: string[];
    groups: CoordinatorToolGroups;
    ownComputerReady: boolean;
    ownComputerReason: string | null;
  };
  machines: CoordinatorDiagnosticsMachine[];
  recentFailures: CoordinatorDiagnosticsFailure[];
}

export function resolveCoordinatorRemoteTools(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  options: {
    teamId: string;
    threadRow?: typeof chiefThread.$inferSelect | null;
    routerTools?: boolean;
    includeSubagent?: boolean;
  },
): CoordinatorRemoteToolsResult {
  const threadRow = options.threadRow ?? null;
  const phones = threadRow === null ? [] : offeredPhoneNames(deps, threadRow.id);
  const browserOffer = browserOfferFor(
    deps.db,
    threadRow ?? { teamId: options.teamId, userId: '' },
    phones,
  );
  const desktop = teamOffersDesktop(deps.db, options.teamId);
  const ownComputer = threadRow !== null && ownComputerOffered(deps.db, threadRow.id);
  const connectorTools = connectorToolDefsForTeam(deps.db, options.teamId);
  const tools = [
    ...coordinatorToolDefs({
      ...(options.routerTools === undefined ? {} : { routerTools: options.routerTools }),
      desktopTools: desktop,
      ownComputer,
      ownComputerWorkspace: threadRow !== null && ownComputerWorkspaceOffered(deps, threadRow.id),
      ...browserOffer,
      phoneComputer: phones,
      ...(options.includeSubagent === undefined
        ? {}
        : { includeSubagent: options.includeSubagent }),
    }),
    ...connectorTools,
  ];
  let ownComputerReady = false;
  let ownComputerReason: string | null = 'no active Coordinator thread for team';
  if (threadRow !== null) {
    const shellTarget = ownComputerTarget(deps, threadRow, 'user_computer_shell');
    const actTarget = ownComputerTarget(deps, threadRow, 'user_computer_act');
    if (shellTarget.kind === 'ready' || actTarget.kind === 'ready') {
      ownComputerReady = true;
      ownComputerReason = null;
    } else {
      ownComputerReason =
        actTarget.text !== OWN_COMPUTER_NO_MAC ? actTarget.text : shellTarget.text;
    }
  }
  return {
    tools,
    groups: {
      router: options.routerTools !== false,
      desktop,
      ownComputer,
      browser: browserOffer.browser,
      ownerChrome: browserOffer.ownerChrome,
      phones: [...phones],
      connectorToolCount: connectorTools.length,
    },
    ownComputerReady,
    ownComputerReason,
  };
}

function resolveDiagnosticsThread(
  deps: Pick<MachineDeps, 'db'> & { user?: { id: string } },
  teamId: string,
  threadId?: string,
): typeof chiefThread.$inferSelect | null {
  const requested = threadId?.trim();
  if (requested !== undefined && requested !== '') {
    const row = deps.db
      .select()
      .from(chiefThread)
      .where(and(eq(chiefThread.id, requested), eq(chiefThread.teamId, teamId)))
      .get();
    if (row === undefined || isChiefSideThreadId(row.id)) {
      throw notFound(`chief thread ${requested}`);
    }
    return row;
  }
  const baseWhere = [
    eq(chiefThread.teamId, teamId),
    isNull(chiefThread.archivedAt),
    isNull(chiefThread.projectId),
    notLike(chiefThread.id, 'chief-digest-%'),
    notLike(chiefThread.id, 'chief-memory-%'),
  ];
  if (deps.user?.id !== undefined) {
    const ownMain = deps.db
      .select()
      .from(chiefThread)
      .where(and(...baseWhere, eq(chiefThread.userId, deps.user.id)))
      .orderBy(desc(chiefThread.updatedAt), desc(chiefThread.createdAt), desc(sql`rowid`))
      .limit(1)
      .get();
    if (ownMain !== undefined) return ownMain;
  }
  return (
    deps.db
      .select()
      .from(chiefThread)
      .where(and(...baseWhere))
      .orderBy(desc(chiefThread.updatedAt), desc(chiefThread.createdAt), desc(sql`rowid`))
      .limit(1)
      .get() ?? null
  );
}

function parseChiefTurnErrorMessage(content: unknown): string | null {
  if (content === null || content === undefined) return null;
  let parsedJson: unknown = content;
  if (typeof content === 'string') {
    try {
      parsedJson = JSON.parse(content);
    } catch {
      return null;
    }
  }
  const parsed = chiefTurnErrorContentSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data.message : null;
}

export function buildCoordinatorDiagnostics(
  deps: Pick<MachineDeps, 'db' | 'machineHub'> & {
    user?: { id: string };
    deployRecordPath?: string;
  },
  teamId: string,
  threadId?: string,
  options: { routerTools?: boolean } = {},
): CoordinatorDiagnostics {
  const threadRow = resolveDiagnosticsThread(deps, teamId, threadId);
  const resolved = resolveCoordinatorRemoteTools(deps, {
    teamId,
    threadRow,
    ...(options.routerTools === undefined ? {} : { routerTools: options.routerTools }),
  });
  const offeredTools = [...new Set(resolved.tools.map((tool) => tool.name))].sort();
  const offeredSet = new Set(offeredTools);
  const missingCoreTools = DIAGNOSTIC_CORE_TOOLS.filter((name) => !offeredSet.has(name)).sort();
  const machines: CoordinatorDiagnosticsMachine[] = teamMachines(deps.db, teamId).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    online: row.online,
    hubConnected: deps.machineHub.isConnected(row.id),
    latestCliVersion: row.latestCliVersion ?? null,
    capabilities: {
      ownComputer: Boolean(row.capabilities?.ownComputer),
      ownComputerShell: Boolean(row.capabilities?.ownComputerShell),
      browser: Boolean(row.capabilities?.browser),
      computer: Boolean(row.capabilities?.computer),
      mcpServers: row.capabilities?.mcpServers ?? [],
      skills: row.capabilities?.skills ?? [],
    },
  }));
  const recentFailures: CoordinatorDiagnosticsFailure[] = deps.db
    .select({
      stepId: step.id,
      buildId: step.buildId,
      kind: step.kind,
      stepFailureCode: step.failureCode,
      buildFailureCode: build.failureCode,
      buildErrorMessage: build.errorMessage,
      chiefErrorContent: chiefMessage.content,
      createdAt: step.createdAt,
      finishedAt: step.finishedAt,
    })
    .from(step)
    .leftJoin(build, eq(step.buildId, build.id))
    .leftJoin(todo, eq(build.todoId, todo.id))
    .leftJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .leftJoin(chiefMessage, eq(chiefMessage.id, sql`'chief-err-' || ${step.id}`))
    .where(
      and(eq(step.status, 'failed'), or(eq(todo.teamId, teamId), eq(chiefThread.teamId, teamId))),
    )
    .orderBy(
      desc(sql`coalesce(${step.finishedAt}, ${step.createdAt})`),
      desc(step.createdAt),
      desc(sql`"step"."rowid"`),
    )
    .limit(RECENT_FAILURES_LIMIT)
    .all()
    .map((row) => ({
      stepId: row.stepId,
      buildId: row.buildId,
      kind: row.kind,
      status: 'failed',
      failureCode: row.stepFailureCode ?? row.buildFailureCode ?? null,
      errorMessage:
        row.buildErrorMessage ?? parseChiefTurnErrorMessage(row.chiefErrorContent) ?? null,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      traceId: otlpTraceIdOfStep({
        kind: row.kind,
        buildId: row.buildId,
        stepId: row.stepId,
      }),
    }));
  return {
    deploy: readDeployStatus(deps.deployRecordPath).deployed,
    serverVersion: readServerVersionInfo({ deployRecordPath: deps.deployRecordPath }),
    threadId: threadRow?.id ?? null,
    coordinator: {
      offeredToolCount: offeredTools.length,
      offeredTools,
      coreToolsPresent: missingCoreTools.length === 0,
      missingCoreTools,
      groups: resolved.groups,
      ownComputerReady: resolved.ownComputerReady,
      ownComputerReason: resolved.ownComputerReason,
    },
    machines,
    recentFailures,
  };
}
