import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MergePolicy, ProjectRepoKind } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { onTestFinished } from 'vitest';
import webpush from 'web-push';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createApp } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { openMemoryDb } from '../src/db/client.js';
import { agent as agentTable, apiKey, machine as machineTable } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { newRecordId } from '../src/lib/ids.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { ConversationStreamHub, TeamStreamHub } from '../src/services/events.js';
import { productionHarnessEvalConfig } from '../src/services/harness-eval-production.js';
import { MachineWakeHub } from '../src/services/machine-wake-hub.js';
import type { VapidKeys } from '../src/services/push.js';

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
    logger?: AppContext['logger'];
    oauthClient?: AppContext['oauthClient'];
    oauthFetch?: AppContext['oauthFetch'];
    authToken?: string | null;
    tailscaleUsers?: string[];
    vapidKeys?: VapidKeys | null;
    webOrigin?: string;
    pushEndpointHosts?: ReadonlySet<string>;
    mcpConfigPath?: string;
    backupStatusPath?: string;
  } = {},
) {
  const db = openMemoryDb();
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
  try {
    const app = createApp({
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
      oauthClient: opts.oauthClient ?? null,
      ...(opts.oauthFetch !== undefined ? { oauthFetch: opts.oauthFetch } : {}),
      ...(opts.githubFetch !== undefined ? { githubFetch: opts.githubFetch } : {}),
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
      ...(opts.skillImportFetch !== undefined ? { skillImportFetch: opts.skillImportFetch } : {}),
      ...(opts.skillImportTimeoutMs !== undefined
        ? { skillImportTimeoutMs: opts.skillImportTimeoutMs }
        : {}),
      reposDir,
      attachmentsDir,
      ...(opts.backupStatusPath !== undefined ? { backupStatusPath: opts.backupStatusPath } : {}),
      skillsDir,
      skillSourcesPath,
      ...(opts.webDir !== undefined ? { webDir: opts.webDir } : {}),
      authToken: opts.authToken ?? null,
      tailscaleUsers: opts.tailscaleUsers ?? [],
      mcpConfigPath: opts.mcpConfigPath ?? join(tmpdir(), `cairn-mcp-absent-${randomUUID()}.json`),
    });
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
    .values({
      id,
      teamId: s.team.id,
      name: opts.name ?? 'test-machine',
      online: true,
      enabledRuntimes: opts.enabledRuntimes ?? ['pi', 'claude-code'],
      claudeCodeReport: opts.claudeCodeReport ?? null,
    })
    .run();
  return id;
}

export function bindAllAgents(s: TestServer, machineId?: string): void {
  const mid =
    machineId ??
    s.db.select().from(machineTable).where(eq(machineTable.teamId, s.team.id)).get()?.id;
  if (mid === undefined) throw new Error('bindAllAgents: 世界里还没有机器（先 enroll/插入）');
  s.db.update(agentTable).set({ machineId: mid }).run();
}

export function bindAgentHome(s: TestServer, agentId: string, machineId: string): void {
  s.db.update(agentTable).set({ machineId }).where(eq(agentTable.id, agentId)).run();
}

export function machineIdByName(s: TestServer, name: string): string {
  const row = s.db.select().from(machineTable).where(eq(machineTable.name, name)).get();
  if (row === undefined) throw new Error(`machineIdByName: ${name} 不在库里`);
  return row.id;
}

export function withVerification(plan: string): string {
  return `Kind: fix\n${plan}\n\n## Verification\n- \`pnpm test\` 通过\n`;
}
