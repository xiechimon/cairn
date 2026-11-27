import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_ROUTER_TOOLS,
  CHIEF_TURN_ERROR_KIND,
  type ClaudeCodeReport,
  CORE_COORDINATOR_TOOLS,
  chiefDigestThreadId,
  chiefMemoryThreadId,
  connectorToolName,
  OWN_COMPUTER_NO_ACCESSIBILITY,
  OWN_COMPUTER_NO_MAC,
  OWN_COMPUTER_NOT_OWNER,
  SUGGEST_REPLIES_TOOL_NAME,
  WORKER_MEMORY_REMOTE_TOOLS,
} from '@cairn/shared';
import { otlpTraceIdOfBuild, otlpTraceIdOfTurn } from '@cairn/shared/otel';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { startCoordinator } from '../src/coordinator/index.js';
import * as serverRuntimeMod from '../src/coordinator/runtime/server-runtime.js';
import {
  build as buildTable,
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  computerCall as computerCallTable,
  machine as machineTable,
  mcpConnector as mcpConnectorTable,
  phone as phoneTable,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
  user as userTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer, setCoordinatorWake } from '../src/services/coordinator-context.js';
import {
  buildCoordinatorDiagnostics,
  type CoordinatorDiagnostics,
  resolveCoordinatorRemoteTools,
} from '../src/services/coordinator-diagnostics.js';
import { claimStep } from '../src/services/machine-claim.js';
import { createProvider } from '../src/services/providers.js';
import { readServerVersionInfo } from '../src/services/server-version.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  seedRoute,
  type TestServer,
} from './helpers.js';

let server: TestServer | null = null;
const tempDirs: string[] = [];

afterEach(() => {
  server?.dispose();
  server = null;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) releaseTestTempDir(dir);
  }
});

function makeTempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

function insertMainChief(
  s: TestServer,
  opts: {
    chiefId?: string;
    threadId?: string;
    userId?: string;
    projectId?: string | null;
    updatedAt?: number;
    archivedAt?: number | null;
  } = {},
): string {
  const chiefId = opts.chiefId ?? `chief-${s.user.id}-${s.team.id}`;
  const threadId = opts.threadId ?? 'chief-thread-main';
  const userId = opts.userId ?? s.user.id;
  const now = opts.updatedAt ?? 1_000;
  const existingChief = s.db.select().from(chiefTable).where(eq(chiefTable.id, chiefId)).get();
  if (existingChief === undefined) {
    s.db
      .insert(chiefTable)
      .values({ id: chiefId, userId, teamId: s.team.id, createdAt: now })
      .run();
  }
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId,
      userId,
      teamId: s.team.id,
      projectId: opts.projectId ?? null,
      title: 'Coordinator',
      createdAt: now,
      updatedAt: now,
      sessionId: '',
      sessionOpenedAt: now,
      archivedAt: opts.archivedAt ?? null,
    })
    .run();
  return threadId;
}

function connectMachine(s: TestServer, machineId: string): () => void {
  return s.machineHub.subscribeMachine(s.team.id, machineId, () => {});
}

describe('coordinator diagnostics and shared tool resolution', () => {
  test('reports healthy core tools, deploy metadata, normalized machine capabilities, and connected local Mac readiness over HTTP', async () => {
    const dir = makeTempDir('diag-deploy-');
    const deployRecordPath = join(dir, 'deploy.json');
    const deployRecord = {
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      previous: '0123456789abcdef0123456789abcdef01234567',
      result: 'ok' as const,
      failed: '',
      snapshot: 'snap-diag',
      at: '2026-11-27T10:00:00Z',
      host: 'macmini',
    };
    writeFileSync(deployRecordPath, JSON.stringify(deployRecord));

    const s = bootServer({ deployRecordPath });
    server = s;
    const threadId = insertMainChief(s);
    const macId = insertMachine(s, {
      name: 'owners-mac',
      capabilities: {
        mcpServers: ['filesystem'],
        skills: ['verify'],
        ownComputer: true,
        ownComputerShell: true,
        browser: true,
        computer: true,
        hostPermissions: {
          accessibility: 'granted',
          automation: 'granted',
          screenRecording: 'granted',
        },
      },
    });
    s.db
      .update(machineTable)
      .set({ kind: 'local', online: true, latestCliVersion: '0.5.0' })
      .where(eq(machineTable.id, macId))
      .run();
    const release = connectMachine(s, macId);
    const retiredId = insertMachine(s, { name: 'retired-mac' });
    s.db.update(machineTable).set({ retiredAt: 500 }).where(eq(machineTable.id, retiredId)).run();

    s.db
      .insert(mcpConnectorTable)
      .values({
        id: 'conn-1',
        teamId: s.team.id,
        slug: 'linear',
        label: 'Linear',
        transport: 'http',
        url: 'https://mcp.example.com/linear',
        headerNames: [],
        authKind: 'none',
        status: 'connected',
        toolCount: 1,
        toolsJson: [
          { name: 'list_issues', description: 'List issues', inputSchema: { type: 'object' } },
        ],
        createdAt: 100,
        updatedAt: 100,
      })
      .run();

    try {
      const res = await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as CoordinatorDiagnostics;
      expect(body.deploy).toEqual(deployRecord);
      expect(body.serverVersion).toEqual(readServerVersionInfo({ deployRecordPath }));
      expect(body.threadId).toBe(threadId);
      expect(body.coordinator.coreToolsPresent).toBe(true);
      expect(body.coordinator.missingCoreTools).toEqual([]);
      expect(body.coordinator.ownComputerReady).toBe(true);
      expect(body.coordinator.ownComputerReason).toBeNull();
      expect(body.coordinator.groups).toEqual({
        router: true,
        desktop: true,
        ownComputer: true,
        browser: true,
        ownerChrome: false,
        phones: [],
        connectorToolCount: 1,
      });
      expect(body.coordinator.offeredToolCount).toBe(body.coordinator.offeredTools.length);
      expect(body.coordinator.offeredTools).toEqual([...body.coordinator.offeredTools].sort());
      expect(body.coordinator.offeredTools).toContain(connectorToolName('linear', 'list_issues'));
      expect(body.machines).toHaveLength(1);
      expect(body.machines[0]).toEqual({
        id: macId,
        name: 'owners-mac',
        kind: 'local',
        online: true,
        hubConnected: true,
        latestCliVersion: '0.5.0',
        capabilities: {
          ownComputer: true,
          ownComputerShell: true,
          browser: true,
          computer: true,
          mcpServers: ['filesystem'],
          skills: ['verify'],
        },
      });
    } finally {
      release();
    }
  });

  test('does not hydrate uncached connected HTTP connectors in diagnostics snapshot', () => {
    const s = bootServer();
    server = s;
    insertMainChief(s);
    s.db
      .insert(mcpConnectorTable)
      .values({
        id: 'conn-null',
        teamId: s.team.id,
        slug: 'notion',
        label: 'Notion',
        transport: 'http',
        url: 'https://mcp.example.com/notion',
        headerNames: [],
        authKind: 'none',
        status: 'connected',
        toolCount: null,
        toolsJson: null,
        createdAt: 100,
        updatedAt: 100,
      })
      .run();

    const diag = buildCoordinatorDiagnostics(
      { db: s.db, machineHub: s.machineHub, user: s.user },
      s.team.id,
    );
    expect(diag.coordinator.groups.connectorToolCount).toBe(0);
    expect(
      diag.coordinator.offeredTools.some((name) =>
        name.startsWith(connectorToolName('notion', '')),
      ),
    ).toBe(false);
  });

  test('reports coreToolsPresent false and lists missingCoreTools when router tools are omitted', () => {
    const s = bootServer();
    server = s;
    const threadId = insertMainChief(s);

    const diag = buildCoordinatorDiagnostics(
      { db: s.db, machineHub: s.machineHub, user: s.user },
      s.team.id,
      threadId,
      { routerTools: false },
    );
    expect(diag.coordinator.coreToolsPresent).toBe(false);
    expect(diag.coordinator.missingCoreTools).toEqual([
      'message_thread',
      'needs_you',
      'open_thread',
      'threads',
    ]);
    expect(diag.coordinator.groups.router).toBe(false);
  });

  test('surfaces ownComputerReady false and OWN_COMPUTER_NO_MAC after local Mac disconnects', async () => {
    const s = bootServer();
    server = s;
    insertMainChief(s);
    const macId = insertMachine(s, {
      name: 'owners-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        ownComputer: true,
        ownComputerShell: true,
        hostPermissions: {
          accessibility: 'granted',
          automation: 'granted',
          screenRecording: 'granted',
        },
      },
    });
    s.db
      .update(machineTable)
      .set({ kind: 'local', online: false })
      .where(eq(machineTable.id, macId))
      .run();

    const res = await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoordinatorDiagnostics;
    expect(body.coordinator.coreToolsPresent).toBe(true);
    expect(body.coordinator.groups.ownComputer).toBe(true);
    expect(body.coordinator.ownComputerReady).toBe(false);
    expect(body.coordinator.ownComputerReason).toBe(OWN_COMPUTER_NO_MAC);
    expect(body.machines[0]?.hubConnected).toBe(false);
  });

  test('surfaces Accessibility refusal for GUI-only local Mac and ready state for shell-only local Mac', () => {
    const s = bootServer();
    server = s;
    const threadId = insertMainChief(s);
    const macId = insertMachine(s, {
      name: 'gui-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        ownComputer: true,
        hostPermissions: {
          accessibility: 'denied',
          automation: 'granted',
          screenRecording: 'granted',
        },
      },
    });
    s.db
      .update(machineTable)
      .set({ kind: 'local', online: true })
      .where(eq(machineTable.id, macId))
      .run();
    const release = connectMachine(s, macId);

    try {
      const deps = {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      };
      const guiOnly = buildCoordinatorDiagnostics(deps, s.team.id, threadId);
      expect(guiOnly.coordinator.ownComputerReady).toBe(false);
      expect(guiOnly.coordinator.ownComputerReason).toBe(OWN_COMPUTER_NO_ACCESSIBILITY('gui-mac'));

      s.db
        .update(machineTable)
        .set({
          capabilities: {
            mcpServers: [],
            skills: [],
            ownComputerShell: true,
          },
        })
        .where(eq(machineTable.id, macId))
        .run();

      const shellOnly = buildCoordinatorDiagnostics(deps, s.team.id, threadId);
      expect(shellOnly.coordinator.ownComputerReady).toBe(true);
      expect(shellOnly.coordinator.ownComputerReason).toBeNull();
    } finally {
      release();
    }
  });

  test('evaluates phone pairing/consent/link states and browser takeover, stealth, and ownerChrome flags', () => {
    const s = bootServer();
    server = s;
    const threadId = insertMainChief(s);
    const threadRow = s.db
      .select()
      .from(chiefThreadTable)
      .where(eq(chiefThreadTable.id, threadId))
      .get()!;

    const macId = insertMachine(s, {
      name: 'phone-and-browser-host',
      capabilities: {
        mcpServers: [],
        skills: [],
        browser: true,
        stealthBrowser: true,
        screenHandoff: true,
        phones: [
          { deviceId: 'dev-ready', platform: 'ios', name: 'iPhone Ready', link: 'ready' },
          { deviceId: 'dev-pairing', platform: 'android', name: 'Pixel Pairing', link: 'seen' },
          { deviceId: 'dev-unconsented', platform: 'ios', name: 'Unconsented', link: 'ready' },
          { deviceId: 'dev-offline', platform: 'ios', name: 'Offline Phone', link: 'offline' },
        ],
      },
    });
    s.db
      .update(machineTable)
      .set({ kind: 'local', online: true })
      .where(eq(machineTable.id, macId))
      .run();
    const release = connectMachine(s, macId);

    s.db
      .insert(phoneTable)
      .values([
        {
          id: 'phone-ready',
          teamId: s.team.id,
          machineId: macId,
          platform: 'ios',
          deviceId: 'dev-ready',
          name: 'iPhone Ready',
          consentAt: 100,
          consentedBy: s.user.id,
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: 'phone-pairing',
          teamId: s.team.id,
          machineId: macId,
          platform: 'android',
          deviceId: 'dev-pairing',
          name: 'Pixel Pairing',
          consentAt: 100,
          consentedBy: s.user.id,
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: 'phone-unconsented',
          teamId: s.team.id,
          machineId: macId,
          platform: 'ios',
          deviceId: 'dev-unconsented',
          name: 'Unconsented',
          consentAt: null,
          consentedBy: null,
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: 'phone-offline',
          teamId: s.team.id,
          machineId: macId,
          platform: 'ios',
          deviceId: 'dev-offline',
          name: 'Offline Phone',
          consentAt: 100,
          consentedBy: s.user.id,
          createdAt: 100,
          updatedAt: 100,
        },
      ])
      .run();

    s.db
      .insert(computerCallTable)
      .values({
        id: 'call-pair-1',
        teamId: s.team.id,
        stepId: 'step-pair-1',
        toolCallId: 'tc-1',
        machineId: macId,
        phoneId: 'phone-pairing',
        tool: 'phone_manage',
        replaySafe: false,
        params: { action: 'pair' },
        state: 'running',
        deadlineAt: 999_999_999,
        createdAt: 100,
      })
      .run();

    try {
      const resolved = resolveCoordinatorRemoteTools(
        { db: s.db, machineHub: s.machineHub },
        { teamId: s.team.id, threadRow },
      );
      expect(resolved.groups.phones).toEqual(['iPhone Ready', 'Pixel Pairing']);
      expect(resolved.groups.browser).toBe(true);
      expect(resolved.groups.ownerChrome).toBe(false);
      const names = resolved.tools.map((t) => t.name);
      expect(names).toContain('phone_observe');
      expect(names).toContain('phone_act');
      expect(names).toContain('request_takeover');
      const navTool = resolved.tools.find((t) => t.name === 'browser_navigate');
      const navProps = (navTool?.parameters as { properties?: Record<string, unknown> })
        ?.properties;
      expect(navProps).toHaveProperty('stealth');

      s.db
        .insert(mcpConnectorTable)
        .values({
          id: 'conn-browsermcp',
          teamId: s.team.id,
          slug: 'browsermcp',
          label: 'Browser MCP',
          catalogId: 'browsermcp',
          transport: 'stdio',
          headerNames: [],
          authKind: 'none',
          status: 'local',
          createdAt: 100,
          updatedAt: 100,
        })
        .run();
      s.db
        .update(machineTable)
        .set({
          capabilities: {
            mcpServers: ['browsermcp'],
            skills: [],
            browser: true,
          },
        })
        .where(eq(machineTable.id, macId))
        .run();
      s.db.delete(phoneTable).where(eq(phoneTable.teamId, s.team.id)).run();

      const ownerChromeResolved = resolveCoordinatorRemoteTools(
        { db: s.db, machineHub: s.machineHub },
        { teamId: s.team.id, threadRow },
      );
      expect(ownerChromeResolved.groups.ownerChrome).toBe(true);
      expect(ownerChromeResolved.groups.browser).toBe(true);
      expect(ownerChromeResolved.groups.phones).toEqual([]);
      const ownerNav = ownerChromeResolved.tools.find((t) => t.name === 'browser_navigate');
      const ownerNavProps = (ownerNav?.parameters as { properties?: Record<string, unknown> })
        ?.properties;
      expect(ownerNavProps).not.toHaveProperty('stealth');
      expect(ownerChromeResolved.tools.map((t) => t.name)).not.toContain('request_takeover');
    } finally {
      release();
    }
  });

  test('handles omitted threadId selection, null threadId fallback, non-owner thread, side threads, and unknown team/thread 404s', async () => {
    const s = bootServer();
    server = s;

    const noThreadRes = await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics`);
    expect(noThreadRes.status).toBe(200);
    const noThreadBody = (await noThreadRes.json()) as CoordinatorDiagnostics;
    expect(noThreadBody.threadId).toBeNull();
    expect(noThreadBody.coordinator.ownComputerReady).toBe(false);

    const projectId = 'proj-1';
    s.db.insert(projectTable).values({ id: projectId, name: 'P1', teamId: s.team.id }).run();
    s.db.insert(userTable).values({ id: 'user-other', displayName: 'Guest' }).run();
    const otherChiefId = `chief-user-other-${s.team.id}`;
    insertMainChief(s, {
      chiefId: otherChiefId,
      threadId: 'thread-other-user',
      userId: 'user-other',
      updatedAt: 9_000,
    });
    const ownerChiefId = `chief-${s.user.id}-${s.team.id}`;
    const ownerMainThreadId = insertMainChief(s, {
      chiefId: ownerChiefId,
      threadId: 'thread-owner-main',
      userId: s.user.id,
      updatedAt: 5_000,
    });
    insertMainChief(s, {
      chiefId: ownerChiefId,
      threadId: 'thread-owner-project',
      userId: s.user.id,
      projectId,
      updatedAt: 9_500,
    });
    const digestId = chiefDigestThreadId(ownerChiefId);
    const memoryId = chiefMemoryThreadId(ownerChiefId);
    insertMainChief(s, {
      chiefId: ownerChiefId,
      threadId: digestId,
      userId: s.user.id,
      updatedAt: 9_800,
    });
    insertMainChief(s, {
      chiefId: ownerChiefId,
      threadId: memoryId,
      userId: s.user.id,
      updatedAt: 9_900,
    });

    const macId = insertMachine(s, {
      name: 'owners-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        ownComputerShell: true,
      },
    });
    s.db
      .update(machineTable)
      .set({ kind: 'local', online: true })
      .where(eq(machineTable.id, macId))
      .run();
    const release = connectMachine(s, macId);

    try {
      const defaultRes = await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics`);
      expect(defaultRes.status).toBe(200);
      const defaultBody = (await defaultRes.json()) as CoordinatorDiagnostics;
      expect(defaultBody.threadId).toBe(ownerMainThreadId);
      expect(defaultBody.coordinator.ownComputerReady).toBe(true);

      const nonOwnerRes = await s.app.request(
        `/api/teams/${s.team.id}/chief/diagnostics?threadId=thread-other-user`,
      );
      expect(nonOwnerRes.status).toBe(200);
      const nonOwnerBody = (await nonOwnerRes.json()) as CoordinatorDiagnostics;
      expect(nonOwnerBody.threadId).toBe('thread-other-user');
      expect(nonOwnerBody.coordinator.ownComputerReady).toBe(false);
      expect(nonOwnerBody.coordinator.ownComputerReason).toBe(OWN_COMPUTER_NOT_OWNER);

      expect(
        (await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics?threadId=${memoryId}`))
          .status,
      ).toBe(404);
      expect(
        (await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics?threadId=${digestId}`))
          .status,
      ).toBe(404);
      expect(
        (await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics?threadId=missing-thread`))
          .status,
      ).toBe(404);
      expect((await s.app.request('/api/teams/unknown-team/chief/diagnostics')).status).toBe(404);
    } finally {
      release();
    }
  });

  test('returns null deploy and empty capabilities when deployRecordPath is absent and machine capabilities are null', async () => {
    const dir = makeTempDir('diag-missing-deploy-');
    const s = bootServer({ deployRecordPath: join(dir, 'missing.json') });
    server = s;
    const machineId = insertMachine(s, { name: 'null-caps' });
    s.db
      .update(machineTable)
      .set({ capabilities: null })
      .where(eq(machineTable.id, machineId))
      .run();

    const res = await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoordinatorDiagnostics;
    expect(body.deploy).toBeNull();
    expect(body.serverVersion.commit).toBeNull();
    expect(body.machines[0]?.capabilities).toEqual({
      ownComputer: false,
      ownComputerShell: false,
      browser: false,
      computer: false,
      mcpServers: [],
      skills: [],
    });
  });

  test('returns latest 5 team-scoped recentFailures across build and chief steps with traceId and error fallbacks', async () => {
    const s = bootServer();
    server = s;
    const projectId = 'proj-1';
    s.db.insert(projectTable).values({ id: projectId, name: 'Proj', teamId: s.team.id }).run();
    const threadId = insertMainChief(s);

    s.db.insert(teamTable).values({ id: 'team-other', name: 'Other', createdAt: 1 }).run();
    s.db
      .insert(projectTable)
      .values({ id: 'proj-other', name: 'OtherP', teamId: 'team-other' })
      .run();
    s.db
      .insert(todoTable)
      .values([
        {
          id: 'todo-1',
          teamId: s.team.id,
          projectId,
          seqNum: 1,
          title: 'T1',
          phase: 'failed',
          phaseAt: 10,
        },
        {
          id: 'todo-other',
          teamId: 'team-other',
          projectId: 'proj-other',
          seqNum: 1,
          title: 'OT',
          phase: 'failed',
          phaseAt: 10,
        },
      ])
      .run();
    s.db
      .insert(buildTable)
      .values([
        {
          id: 'build-1',
          todoId: 'todo-1',
          withPlan: false,
          triggerSource: 'user',
          errorMessage: 'build boom',
          failureCode: 'auth',
          createdAt: 100,
        },
        {
          id: 'build-restarted',
          todoId: 'todo-1',
          withPlan: false,
          triggerSource: 'user',
          errorMessage: null,
          failureCode: null,
          createdAt: 200,
        },
        {
          id: 'build-other',
          todoId: 'todo-other',
          withPlan: false,
          triggerSource: 'user',
          errorMessage: 'other team failure',
          failureCode: 'auth',
          createdAt: 900,
        },
      ])
      .run();

    s.db
      .insert(stepTable)
      .values([
        {
          id: 'step-old',
          buildId: 'build-1',
          kind: 'build',
          status: 'failed',
          createdAt: 100,
          finishedAt: 150,
        },
        {
          id: 'step-b1',
          buildId: 'build-1',
          kind: 'build',
          status: 'failed',
          failureCode: 'network',
          createdAt: 200,
          finishedAt: 250,
        },
        {
          id: 'step-restarted',
          buildId: 'build-restarted',
          kind: 'build',
          status: 'failed',
          createdAt: 300,
          finishedAt: 350,
        },
        {
          id: 'step-chief-err',
          buildId: threadId,
          kind: 'chief',
          status: 'failed',
          failureCode: 'quota',
          createdAt: 400,
          finishedAt: 450,
        },
        {
          id: 'step-chief-noerr',
          buildId: threadId,
          kind: 'chief',
          status: 'failed',
          createdAt: 500,
          finishedAt: 550,
        },
        {
          id: 'step-latest',
          buildId: 'build-1',
          kind: 'verify',
          status: 'failed',
          createdAt: 600,
          finishedAt: null,
        },
        {
          id: 'step-done',
          buildId: 'build-1',
          kind: 'build',
          status: 'done',
          createdAt: 700,
          finishedAt: 750,
        },
        {
          id: 'step-other',
          buildId: 'build-other',
          kind: 'build',
          status: 'failed',
          createdAt: 900,
          finishedAt: 950,
        },
      ])
      .run();

    s.db
      .insert(chiefMessageTable)
      .values({
        id: 'chief-err-step-chief-err',
        threadId,
        role: 'system',
        content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: 'coordinator quota hit' }),
        createdAt: 450,
      })
      .run();

    const res = await s.app.request(`/api/teams/${s.team.id}/chief/diagnostics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoordinatorDiagnostics;
    expect(body.recentFailures).toHaveLength(5);
    expect(body.recentFailures.map((f: { stepId: string }) => f.stepId)).toEqual([
      'step-latest',
      'step-chief-noerr',
      'step-chief-err',
      'step-restarted',
      'step-b1',
    ]);
    expect(body.recentFailures[0]).toEqual({
      stepId: 'step-latest',
      buildId: 'build-1',
      kind: 'verify',
      status: 'failed',
      failureCode: 'auth',
      errorMessage: 'build boom',
      createdAt: 600,
      finishedAt: null,
      traceId: otlpTraceIdOfBuild('build-1'),
    });
    expect(body.recentFailures[1]).toEqual({
      stepId: 'step-chief-noerr',
      buildId: threadId,
      kind: 'chief',
      status: 'failed',
      failureCode: null,
      errorMessage: null,
      createdAt: 500,
      finishedAt: 550,
      traceId: otlpTraceIdOfTurn('step-chief-noerr'),
    });
    expect(body.recentFailures[2]).toEqual({
      stepId: 'step-chief-err',
      buildId: threadId,
      kind: 'chief',
      status: 'failed',
      failureCode: 'quota',
      errorMessage: 'coordinator quota hit',
      createdAt: 400,
      finishedAt: 450,
      traceId: otlpTraceIdOfTurn('step-chief-err'),
    });
    expect(body.recentFailures[3]?.errorMessage).toBeNull();
    expect(body.recentFailures[4]?.failureCode).toBe('network');
  });

  test('preserves machine-claim deferred rules, mail/memory turn guards, and coordinator/index routerTools toggle', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    server = s;
    insertClaudeSubscription(s);
    const runnerId = insertMachine(s, {
      name: 'runner',
      claudeCodeReport: {
        installed: true,
        hostname: 'mac',
        models: [{ id: 'sonnet', name: 'sonnet' }],
        auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
      } as ClaudeCodeReport,
    });
    s.db
      .update(machineTable)
      .set({ latestCliVersion: '0.5.0' })
      .where(eq(machineTable.id, runnerId))
      .run();
    seedRoute(s, 'coordinator', {
      provider: 'claude-code',
      modelId: 'sonnet',
      thinkingLevel: 'off',
      machineId: runnerId,
    });
    const threadId = insertMainChief(s);
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    };

    s.db
      .insert(stepTable)
      .values({
        id: 'step-normal',
        buildId: threadId,
        kind: 'chief',
        status: 'pending',
        ownerMessageIds: ['m1'],
        createdAt: 10,
      })
      .run();
    const normalClaim = await claimStep(deps, runnerId, s.team.id, 10, 'http://localhost');
    expect(normalClaim).not.toBeNull();
    const normalTools = normalClaim!.remoteTools ?? [];
    for (const def of normalTools) {
      if (CORE_COORDINATOR_TOOLS.has(def.name) || def.name === SUGGEST_REPLIES_TOOL_NAME) {
        expect(def.deferred).toBeUndefined();
      } else {
        expect(def.deferred).toBe(true);
      }
    }
    expect(normalTools.find((d) => d.name === SUGGEST_REPLIES_TOOL_NAME)?.deferred).toBeUndefined();
    expect(normalTools.find((d) => d.name === 'projects')?.deferred).toBe(true);
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 'step-normal')).run();

    s.db
      .insert(stepTable)
      .values({
        id: 'step-mail',
        buildId: threadId,
        kind: 'chief',
        status: 'pending',
        prompt: '[wake:wake] provenance=mail:evt-1\nhello',
        createdAt: 20,
      })
      .run();
    const mailClaim = await claimStep(deps, runnerId, s.team.id, 10, 'http://localhost');
    expect(mailClaim?.remoteTools).toEqual([]);
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 'step-mail')).run();

    s.db
      .insert(stepTable)
      .values({
        id: 'step-mem',
        buildId: threadId,
        kind: 'chief',
        status: 'pending',
        prompt: '[wake:wake] provenance=memory-edit:medit-1\nupdate memory',
        createdAt: 30,
      })
      .run();
    const memClaim = await claimStep(deps, runnerId, s.team.id, 10, 'http://localhost');
    expect(memClaim?.remoteTools).toEqual([...WORKER_MEMORY_REMOTE_TOOLS]);
    s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, 'step-mem')).run();

    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        body: {
          providerId: 'stub',
          label: 'Stub',
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          apiKey: 'stub-key',
          models: [{ id: 'm', name: 'm' }],
        },
        createdBy: s.user.id,
      },
    );
    seedRoute(s, 'coordinator', {
      provider: 'stub',
      modelId: 'm',
      thinkingLevel: 'off',
      machineId: null,
    });
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses([() => fauxAssistantMessage('ok'), () => fauxAssistantMessage('ok')]);
    const prevEnv = process.env.CAIRN_COORDINATOR_RUNTIME;
    process.env.CAIRN_COORDINATOR_RUNTIME = 'pi';
    setCoordinatorInServer(true);
    setCoordinatorWake(() => {});
    const capturedTools: string[][] = [];
    const realCreateRuntime = serverRuntimeMod.createServerRuntime;
    const createSpy = vi
      .spyOn(serverRuntimeMod, 'createServerRuntime')
      .mockImplementation((config, api) => {
        const runtime = realCreateRuntime(config, api);
        const realRunTurn = runtime.runTurn.bind(runtime);
        runtime.runTurn = async (input) => {
          capturedTools.push((input.claimed.remoteTools ?? []).map((t) => t.name));
          return realRunTurn(input);
        };
        return runtime;
      });
    const storageDir = makeTempDir('coord-tools-');
    const coordinator = startCoordinator({
      machine: deps,
      storageDir,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      routerTools: false,
      fixedProviders: [faux.provider],
      tickMs: 60_000,
    });
    try {
      s.db
        .insert(stepTable)
        .values({
          id: 'step-pi',
          buildId: threadId,
          kind: 'chief',
          status: 'pending',
          prompt: 'hello',
          ownerMessageIds: ['m2'],
          createdAt: 40,
        })
        .run();
      coordinator.wake(threadId);
      await coordinator.idle();
      expect(capturedTools).toHaveLength(1);
      for (const tool of CHIEF_REMOTE_TOOLS) expect(capturedTools[0]).toContain(tool.name);
      for (const tool of CHIEF_ROUTER_TOOLS) expect(capturedTools[0]).not.toContain(tool.name);
    } finally {
      createSpy.mockRestore();
      await coordinator.close();
      setCoordinatorInServer(false);
      setCoordinatorWake(() => {});
      if (prevEnv === undefined) delete process.env.CAIRN_COORDINATOR_RUNTIME;
      else process.env.CAIRN_COORDINATOR_RUNTIME = prevEnv;
    }
  });
});
