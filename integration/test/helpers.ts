import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectRepoKind, Scheduler } from '@cairn/shared';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../apps/server/src/app.js';
import { openDbWithHandle, openMemoryDb } from '../../apps/server/src/db/client.js';
import {
  agent as agentTable,
  provider as providerTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { createEphemeralSecretBox } from '../../apps/server/src/lib/secret-box.js';
import { createApiKey } from '../../apps/server/src/services/api-keys.js';
import { ConversationStreamHub, TeamStreamHub } from '../../apps/server/src/services/events.js';
import { MachineWakeHub } from '../../apps/server/src/services/machine-wake-hub.js';
import { createScheduler } from '../../apps/server/src/services/scheduler.js';

export const AGENT_ID = 'agent-it-1';

export interface RealServer {
  url: string;
  teamId: string;
  apiKey: string;
  db: ReturnType<typeof openMemoryDb>;
  reposDir: string;
  attachmentsDir: string;
  skillsDir: string;
  claimCount: () => number;
  todoPhase(todoId: string): string;
  scheduler: Scheduler | null;
  close(): Promise<void>;
}

export async function bootRealServer(opts: {
  providerBaseUrl: string;
  claimHoldMs?: number;
  agentDescription?: string;
  webDir?: string;
  scheduler?: boolean;
  mcpConfigPath?: string;
  dbPath?: string;
  port?: number;
}): Promise<RealServer> {
  const db = opts.dbPath !== undefined ? openDbWithHandle(opts.dbPath).db : openMemoryDb();
  const { user, team } = seed(db);
  const hub = new TeamStreamHub();
  const machineHub = new MachineWakeHub();
  const convHub = new ConversationStreamHub();
  const secretBox = createEphemeralSecretBox();
  const reposDir = mkdtempSync(join(tmpdir(), 'cairn-it-repos-'));
  const attachmentsDir = mkdtempSync(join(tmpdir(), 'cairn-it-att-'));
  const skillsDir = mkdtempSync(join(tmpdir(), 'cairn-it-skills-'));
  const app = createApp({
    db,
    hub,
    machineHub,
    convHub,
    secretBox,
    user,
    team,
    pingIntervalMs: 15_000,
    claimHoldMs: opts.claimHoldMs ?? 1_000,
    uploads: new Map(),
    enrollments: new Map(),
    oauthStates: new Map(),
    oauthClient: null,
    reposDir,
    attachmentsDir,
    skillsDir,
    skillSourcesPath: join(
      mkdtempSync(join(tmpdir(), 'cairn-it-skill-sources-')),
      'skill-sources.json',
    ),
    webDir: opts.webDir ?? null,
    authToken: null,
    tailscaleUsers: [],
    mcpConfigPath: opts.mcpConfigPath ?? join(tmpdir(), `cairn-it-mcp-${randomUUID()}.json`),
  });
  const scheduler = opts.scheduler
    ? createScheduler({ db, hub, user, convHub }, { tickMs: 60_000 })
    : null;
  const issuedKey = createApiKey(
    { db },
    {
      teamId: team.id,
      name: 'machine-bootstrap',
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    },
  );

  let claims = 0;
  const fetchImpl: typeof app.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes('/api/machine/tasks/claim')) claims += 1;
    if (
      url.includes('/api/machine/enroll') &&
      ((init as RequestInit | undefined)?.method ?? 'POST') === 'POST'
    ) {
      const res = await app.fetch(input as never, init);
      if (res.status === 200) {
        const body = (await res
          .clone()
          .json()
          .catch(() => null)) as {
          machineId?: string;
        } | null;
        if (typeof body?.machineId === 'string') {
          db.update(agentTable)
            .set({ machineId: body.machineId })
            .where(and(eq(agentTable.teamId, team.id), isNull(agentTable.machineId)))
            .run();
        }
      }
      return res;
    }
    return app.fetch(input as never, init);
  };

  const server = serve({ fetch: fetchImpl, port: opts.port ?? 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  if (db.select().from(providerTable).where(eq(providerTable.id, 'prov-it')).get() === undefined) {
    db.insert(providerTable)
      .values({
        id: 'prov-it',
        teamId: team.id,
        kind: 'custom',
        providerId: 'stub-gw',
        label: 'Stub Gateway',
        baseUrl: opts.providerBaseUrl,
        api: 'openai-completions',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'stub-model', name: 'stub-model' }],
        createdBy: user.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
  }
  if (db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get() === undefined) {
    db.insert(agentTable)
      .values({
        id: AGENT_ID,
        teamId: team.id,
        displayName: 'it-builder',
        description:
          opts.agentDescription ?? '你是集成测试执行 Agent：直接简短回答，不使用任何工具。',
        provider: 'stub-gw',
        modelId: 'stub-model',
        tools: ['合并分支', '推送分支'],
      })
      .run();
  }

  return {
    url,
    teamId: team.id,
    apiKey: issuedKey.plaintext,
    db,
    reposDir,
    attachmentsDir,
    skillsDir,
    claimCount: () => claims,
    todoPhase(todoId: string) {
      return db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase ?? '';
    },
    scheduler,
    close: () =>
      new Promise<void>((resolve, reject) => {
        scheduler?.stop();
        // node:http long-polling/SSE connections keep close() pending; drop all live connections first.
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
        rmSync(reposDir, { recursive: true, force: true });
        rmSync(skillsDir, { recursive: true, force: true });
      }),
  };
}

export async function api(
  url: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

export interface WorldIds {
  projectId: string;
  todoId: string;
}

export async function seedWorld(
  url: string,
  teamId: string,
  todo: { title: string; spec: string },
  opts: {
    repoKind?: ProjectRepoKind;
    projectName?: string;
    localPath?: string;
  } = {},
): Promise<WorldIds> {
  const name = opts.projectName ?? 'it-project';
  const project = await api(url, 'POST', '/api/projects', {
    name,
    teamId,
    ...(opts.repoKind !== undefined ? { repoKind: opts.repoKind } : {}),
    ...(opts.localPath !== undefined ? { localPath: opts.localPath } : {}),
  });
  const projectId = (project.body as { id: string }).id;
  const res = await api(url, 'POST', `/api/projects/${projectId}/todos`, todo);
  const todoId = (res.body as { id: string }).id;
  return { projectId, todoId };
}

export function daemonLogLines(daemonLog: string): string[] {
  try {
    return readFileSync(daemonLog, 'utf8')
      .split('\n')
      .map((l) => l.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /, ''));
  } catch {
    return [];
  }
}

export async function startExternalMcp(): Promise<{
  url: string;
  calls: { name: string; args: Record<string, unknown> }[];
  close(): Promise<void>;
}> {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const http: Server = createServer((req, res) => {
    void (async () => {
      const server = new McpServer({ name: 'external-fixture', version: '0.0.1' });
      server.registerTool(
        'echo',
        { description: 'Echo text back.', inputSchema: { text: z.string() } },
        async (args) => {
          calls.push({ name: 'echo', args: args as Record<string, unknown> });
          return { content: [{ type: 'text', text: `external-echo:${args.text}` }] };
        },
      );
      server.resource(
        'note',
        'demo://note',
        { description: 'A demo note resource (#930).' },
        async () => ({ contents: [{ uri: 'demo://note', text: 'demo-note-content' }] }),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body =
        chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await transport.handleRequest(req, res, body);
    })();
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 60_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
