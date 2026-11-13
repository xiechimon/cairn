import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  MergePolicy,
  ModelRef,
  PolicyUse,
  ProjectRepoKind,
  RequiredCapabilities,
  RouteUse,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { onTestFinished } from 'vitest';
import webpush from 'web-push';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { type Db, openMemoryDb } from '../src/db/client.js';
import {
  apiKey,
  autonomyPause,
  build as buildTable,
  machine as machineTable,
  routingRule,
  step as stepTable,
  todo as todoTable,
  workPolicy,
} from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { newRecordId, newUuidv7 } from '../src/lib/ids.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { enqueueStep } from '../src/services/builds.js';
import { ConversationStreamHub, TeamStreamHub } from '../src/services/events.js';
import { teamAutonomyPaused } from '../src/services/github-autonomy-brake.js';
import { productionHarnessEvalConfig } from '../src/services/harness-eval-production.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import type { VapidKeys } from '../src/services/push.js';
import { setTodoPhase } from '../src/services/todos.js';
import { rejectingGithubFetch } from './network-guard.js';

export interface LegacyWorldIds {
  userId: string;
  teamId: string;
}

export function insertLegacyUserAndTeam(
  sqlite: { prepare(sql: string): { run(...args: unknown[]): unknown } },
  ids: LegacyWorldIds,
): LegacyWorldIds {
  sqlite
    .prepare('INSERT INTO user (id, displayName, avatarUrl) VALUES (?, ?, ?)')
    .run(ids.userId, 'Owner', null);
  sqlite
    .prepare('INSERT INTO team (id, name, createdAt, plan, avatarStyle) VALUES (?, ?, ?, ?, ?)')
    .run(ids.teamId, 'Legacy team', 1, 'free', 'notionist');
  return ids;
}

export function bootServer(
  opts: {
    db?: Db;
    pingIntervalMs?: number;
    claimHoldMs?: number;
    reposDir?: string;
    attachmentsDir?: string;
    skillsDir?: string;
    skillSourcesPath?: string;
    skillImportFetch?: AppContext['skillImportFetch'];
    skillImportTimeoutMs?: number;
    webDir?: string | null;
    githubFetch?: AppContext['githubFetch'];
    githubAppIdentity?: AppContext['githubAppIdentity'];
    logger?: AppContext['logger'];
    oauthClient?: AppContext['oauthClient'];
    oauthFetch?: AppContext['oauthFetch'];
    providerTestTimeoutMs?: number;
    authToken?: string | null;
    loopbackOwner?: AppContext['loopbackOwner'];
    vapidKeys?: VapidKeys | null;
    webOrigin?: string;
    pushEndpointHosts?: ReadonlySet<string>;
    mcpConfigPath?: string;
    backupStatusPath?: string;
    deployRecordPath?: string;
    remote?: Partial<NonNullable<AppContext['remote']>>;
  } = {},
) {
  const db = opts.db ?? openMemoryDb();
  const { user, team } = seed(db);
  const hub = new TeamStreamHub();
  const machineHub = new MachineWakeHub();
  const convHub = new ConversationStreamHub();
  const secretBox = createEphemeralSecretBox();
  const generatedVapidKeys = webpush.generateVAPIDKeys();
  const vapidKeys =
    opts.vapidKeys === undefined
      ? {
          ...generatedVapidKeys,
          subject: 'mailto:push@cairn.dev',
          webOrigin: opts.webOrigin ?? 'https://cairn.local',
        }
      : opts.vapidKeys;
  const ownedDirs: string[] = [];
  const takeDir = (prefix: string): string => {
    const dir = makeTestTempDir(prefix);
    ownedDirs.push(dir);
    return dir;
  };
  const reposDir = opts.reposDir ?? takeDir('server-repos-');
  const attachmentsDir = opts.attachmentsDir ?? takeDir('server-att-');
  const skillsDir = opts.skillsDir ?? takeDir('server-skills-');
  const skillSourcesPath =
    opts.skillSourcesPath ?? join(takeDir('skill-sources-'), 'skill-sources.json');
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const dir of ownedDirs.splice(0)) releaseTestTempDir(dir);
  };
  const oauthStates: AppContext['oauthStates'] = new Map();
  const xaiDeviceStates: AppContext['xaiDeviceStates'] = new Map();
  try {
    const appContext: AppContext = {
      remote: {
        environmentId: '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80',
        listenHost: '127.0.0.1',
        listenPort: 8787,
        tailnetStatus: () => null,
        ...opts.remote,
      },
      db,
      hub,
      machineHub,
      convHub,
      secretBox,
      vapidKeys,
      ...(opts.pushEndpointHosts !== undefined
        ? { pushEndpointHosts: opts.pushEndpointHosts }
        : {}),
      user,
      team,
      pingIntervalMs: opts.pingIntervalMs ?? 3_600_000,
      claimHoldMs: opts.claimHoldMs ?? 250,
      uploads: new Map(),
      enrollments: new Map(),
      oauthStates,
      xaiDeviceStates,
      oauthClient: opts.oauthClient ?? null,
      ...(opts.oauthFetch !== undefined ? { oauthFetch: opts.oauthFetch } : {}),
      ...(opts.providerTestTimeoutMs === undefined
        ? {}
        : { providerTestTimeoutMs: opts.providerTestTimeoutMs }),
      githubFetch: opts.githubFetch ?? rejectingGithubFetch,
      ...(opts.githubAppIdentity !== undefined
        ? { githubAppIdentity: opts.githubAppIdentity }
        : {}),
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
      ...(opts.skillImportFetch !== undefined ? { skillImportFetch: opts.skillImportFetch } : {}),
      ...(opts.skillImportTimeoutMs !== undefined
        ? { skillImportTimeoutMs: opts.skillImportTimeoutMs }
        : {}),
      reposDir,
      attachmentsDir,
      ...(opts.backupStatusPath !== undefined ? { backupStatusPath: opts.backupStatusPath } : {}),
      ...(opts.deployRecordPath !== undefined ? { deployRecordPath: opts.deployRecordPath } : {}),
      skillsDir,
      skillSourcesPath,
      ...(opts.webDir !== undefined ? { webDir: opts.webDir } : {}),
      authToken: opts.authToken ?? null,
      loopbackOwner: opts.loopbackOwner ?? null,
      mcpConfigPath: opts.mcpConfigPath ?? join(tmpdir(), `cairn-mcp-absent-${randomUUID()}.json`),
    };
    const app = createApp(appContext, opts.logger);
    const rawRequest = app.request.bind(app);
    app.request = ((
      input: Parameters<typeof app.request>[0],
      init?: RequestInit,
      ...rest: unknown[]
    ) => {
      const forward = (next: RequestInit | undefined) => rawRequest(input, next, ...(rest as []));
      if (init?.method !== 'POST' || typeof init.body !== 'string' || typeof input !== 'string') {
        return forward(init);
      }
      if (new Headers(init.headers).get('x-cairn-raw-send') === '1') return forward(init);
      try {
        const parsed = JSON.parse(init.body) as unknown;
        const stamped = stampPersonSendBody(input.split('?')[0] ?? input, parsed);
        if (stamped === parsed) return forward(init);
        return forward({ ...init, body: JSON.stringify(stamped) });
      } catch {
        return forward(init);
      }
    }) as typeof app.request;
    try {
      onTestFinished(dispose);
    } catch {
      void 0;
    }
    return {
      app,
      db,
      hub,
      machineHub,
      convHub,
      secretBox,
      vapidKeys,
      user,
      team,
      reposDir,
      attachmentsDir,
      skillsDir,
      skillSourcesPath,
      oauthStates,
      xaiDeviceStates,
      svc: {
        db,
        hub,
        machineHub,
        convHub,
        user,
        skillsDir,
        vapidKeys,
        harnessEval: productionHarnessEvalConfig(),
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function issueApiKey(s: ReturnType<typeof bootServer>): Promise<string> {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/api-keys`, {
    name: 'machine-bootstrap',
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`issueApiKey: ${res.status}`);
  }
  const body = (await res.json()) as { plaintext?: string; apiKey?: string; key?: string };
  const plain = body.plaintext ?? body.apiKey ?? body.key;
  if (!plain) throw new Error(`issueApiKey: no plaintext in ${JSON.stringify(body)}`);
  return plain;
}

export type TestServer = ReturnType<typeof bootServer>;

const jsonHeaders = { 'content-type': 'application/json' };

let personSendStamp = 0;

export function stampPersonSendBody(path: string, body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (record.clientMessageId !== undefined || typeof record.queuedMessageId === 'string')
    return body;
  const bare = path.split('?')[0] ?? path;
  const send =
    bare.endsWith('/coordinator/messages') ||
    bare.endsWith('/chief/threads') ||
    /\/conversations\/[^/]+\/messages$/.test(bare);
  if (!send) return body;
  personSendStamp += 1;
  return { ...record, clientMessageId: `test-send-${personSendStamp}` };
}

export function req(app: Hono, method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: body !== undefined ? jsonHeaders : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

export async function postProject(
  app: Hono,
  name = 'demo',
  opts: { mergePolicy?: MergePolicy; repoKind?: ProjectRepoKind } = {},
): Promise<string> {
  const res = await req(app, 'POST', '/api/projects', {
    name,
    ...(opts.repoKind !== undefined ? { repoKind: opts.repoKind } : {}),
  });
  if (res.status !== 201) throw new Error(`postProject: ${res.status}`);
  const body = (await res.json()) as { id: string };
  const mergePolicy = opts.mergePolicy ?? 'human';
  const patched = await req(app, 'PATCH', `/api/projects/${body.id}/merge-policy`, { mergePolicy });
  if (patched.status !== 200) throw new Error(`postProject merge-policy: ${patched.status}`);
  return body.id;
}

export function insertGitApiKey(s: TestServer, secret: string): string {
  const id = newRecordId();
  s.db
    .insert(apiKey)
    .values({
      id,
      teamId: s.team.id,
      name: 'git-e2e',
      gitAccess: true,
      mcpAccess: false,
      machineAccess: false,
      toolGrants: { read: [], write: [] },
      keyHash: sha256Hex(secret),
      masked: `${secret.slice(0, 12)}…`,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export async function openStream(app: Hono, teamId: string) {
  return openSse(app, `/api/teams/${teamId}/stream`);
}

export async function openConvStream(app: Hono, conversationId: string) {
  return openSse(app, `/api/conversations/${conversationId}/stream`);
}

async function openSse(app: Hono, path: string) {
  const ctrl = new AbortController();
  const res = await app.request(path, { signal: ctrl.signal });
  if (!res.body) throw new Error('stream response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const pending: unknown[] = [];

  async function pump(deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) pending.push(JSON.parse(line.slice(5).trim()));
        }
        idx = buf.indexOf('\n\n');
      }
      if (pending.length > 0) return;
    }
  }

  return {
    async next(
      match: (ev: Record<string, unknown>) => boolean,
      timeoutMs = 3000,
    ): Promise<Record<string, unknown>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = pending.findIndex((ev) => match(ev as Record<string, unknown>));
        if (hit >= 0) return pending.splice(hit, 1)[0] as Record<string, unknown>;
        await pump(deadline);
        if (
          pending.findIndex((ev) => match(ev as Record<string, unknown>)) < 0 &&
          Date.now() >= deadline
        ) {
          throw new Error(`stream timeout waiting for event (buffered ${pending.length})`);
        }
      }
    },
    close(): void {
      ctrl.abort();
      void reader.cancel().catch(() => {});
    },
  };
}

export const subscriptionClaudeReport = {
  installed: true,
  hostname: 'test',
  models: [],
  auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
} satisfies import('@cairn/shared').ClaudeCodeReport;

export function insertMachine(
  s: TestServer,
  opts: {
    name?: string;
    enabledRuntimes?: string[];
    claudeCodeReport?: import('@cairn/shared').ClaudeCodeReport | null;
  } = {},
): string {
  const id = opts.name
    ? `machine-${opts.name}`
    : `machine-${Math.random().toString(36).slice(2, 10)}`;
  s.db
    .insert(machineTable)
    .values(
      readyMachine({
        id,
        teamId: s.team.id,
        name: opts.name ?? 'test-machine',
        online: true,
        enabledRuntimes: opts.enabledRuntimes ?? ['pi', 'claude-code'],
        claudeCodeReport: opts.claudeCodeReport ?? null,
      }),
    )
    .run();
  return id;
}

export interface RouteSeed {
  id?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string | null;
  machineId?: string | null;
  requiredCapabilities?: RequiredCapabilities | null;
  fallbackModels?: ModelRef[] | null;
  mcpServers?: string[] | null;
}

export function seedRoute(s: TestServer, use: RouteUse, opts: RouteSeed = {}): string {
  const existing = s.db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, s.team.id), eq(routingRule.use, use)))
    .get();
  const values = {
    provider: opts.provider ?? 'claude-code',
    modelId: opts.modelId ?? 'claude-sonnet-5-5',
    thinkingLevel: opts.thinkingLevel ?? null,
    machineId: opts.machineId ?? null,
    requiredCapabilities: opts.requiredCapabilities ?? null,
    fallbackModels: opts.fallbackModels ?? null,
    mcpServers: opts.mcpServers ?? null,
    updatedAt: Date.now(),
  };
  if (existing !== undefined) {
    s.db.update(routingRule).set(values).where(eq(routingRule.id, existing.id)).run();
    return existing.id;
  }
  const id = opts.id ?? newRecordId();
  s.db
    .insert(routingRule)
    .values({ id, teamId: s.team.id, use, ...values, createdAt: Date.now() })
    .run();
  return id;
}

export interface PolicySeed {
  tools?: string[];
  mcpServers?: string[];
  skillsAllowlist?: string[] | null;
  defaultSkill?: string | null;
  secrets?: string[];
}

export function seedPolicy(s: TestServer, use: PolicyUse, opts: PolicySeed = {}): void {
  const values = {
    tools: opts.tools ?? [],
    mcpServers: opts.mcpServers ?? [],
    skillsAllowlist: opts.skillsAllowlist ?? null,
    defaultSkill: opts.defaultSkill ?? null,
    secrets: opts.secrets ?? [],
    updatedAt: Date.now(),
  };
  const existing = s.db
    .select()
    .from(workPolicy)
    .where(and(eq(workPolicy.teamId, s.team.id), eq(workPolicy.use, use)))
    .get();
  if (existing !== undefined) {
    s.db.update(workPolicy).set(values).where(eq(workPolicy.id, existing.id)).run();
    return;
  }
  s.db
    .insert(workPolicy)
    .values({ id: newRecordId(), teamId: s.team.id, use, ...values, createdAt: Date.now() })
    .run();
}

export function seedSessionRoute(s: TestServer, opts: RouteSeed & PolicySeed = {}): string {
  const id = seedRoute(s, 'session', opts);
  seedPolicy(s, 'session', opts);
  return id;
}

export function pinSessionRoute(s: TestServer, machineId: string): void {
  s.db
    .update(routingRule)
    .set({ machineId })
    .where(and(eq(routingRule.teamId, s.team.id), eq(routingRule.use, 'session')))
    .run();
}

export function startLegacyBuild(
  s: TestServer,
  todoId: string,
  opts: { withPlan: boolean; prompt?: string; triggerSource?: 'user' | 'schedule' },
): string {
  const todoRow = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
  if (todoRow === undefined) throw new Error(`startLegacyBuild: todo ${todoId} missing`);
  const id = newUuidv7();
  const createdAt = Date.now();
  s.db
    .insert(buildTable)
    .values({
      id,
      todoId,
      withPlan: opts.withPlan,
      prevPhase: todoRow.phase,
      triggerSource: opts.triggerSource ?? 'user',
      createdAt,
    })
    .run();
  enqueueStep(s.svc, id, opts.withPlan ? 'plan' : 'build', todoRow.teamId, opts.prompt);
  setTodoPhase(s.svc, todoId, 'queued', { latestBuildId: id, lastRunAt: createdAt });
  return id;
}

export function dropQueuedVerify(s: TestServer, buildId: string): void {
  s.db
    .delete(stepTable)
    .where(
      and(
        eq(stepTable.buildId, buildId),
        eq(stepTable.kind, 'verify'),
        eq(stepTable.status, 'pending'),
      ),
    )
    .run();
}

export function machineIdByName(s: TestServer, name: string): string {
  const row = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get();
  if (row === undefined) throw new Error(`machineIdByName: ${name} 不在库里`);
  return row.id;
}

export function withVerification(plan: string): string {
  return `Kind: fix\n${plan}\n\n## Verification\n- \`pnpm test\` 通过\n`;
}

export function pauseTeamForTest(db: Db, teamId: string): void {
  db.insert(autonomyPause)
    .values({
      id: newRecordId(),
      teamId,
      source: 'settings',
      reason: 'Paused in a test.',
      markers: [],
      publishError: 'test pause publishes no marker',
      openedAt: Date.now(),
    })
    .run();
}

export function teamPausedForTest(db: Db, teamId: string): boolean {
  return teamAutonomyPaused(db, teamId);
}
