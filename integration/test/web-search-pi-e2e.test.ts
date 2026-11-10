import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EXA_BASE_URL_ENV } from '../../apps/daemon/src/backend/web-search.js';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { build as buildTable } from '../../apps/server/src/db/schema.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  api,
  bootRealServer,
  CONFINEMENT_READY_LAUNCH,
  daemonLogLines,
  type RealServer,
  updateSessionPolicy,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const FAKE_EXA_KEY = 'exa-it-key-7f3a9c1d5e2b48a6d0c4';
const OTHER_SECRET_NAME = 'IT_OTHER_SECRET';
const OTHER_SECRET_VALUE = 'it-other-secret-value';
const FIXTURE_URL = 'https://fixture.example/ci-sharding';
const FIXTURE_COST = 0.0123;
const REPORT_MARK = 'WEB-SEARCH-REPORT: time-balanced sharding';

interface ExaRequest {
  path: string;
  apiKey: string | undefined;
  body: { query?: string };
}

let exaServer: Server;
let exaRequests: ExaRequest[];
let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let savedBaseUrl: string | undefined;

async function startFakeExa(): Promise<string> {
  exaRequests = [];
  exaServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => {
      raw += d;
    });
    req.on('end', () => {
      exaRequests.push({
        path: req.url ?? '',
        apiKey: req.headers['x-api-key'] as string | undefined,
        body: raw === '' ? {} : (JSON.parse(raw) as ExaRequest['body']),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          requestId: 'fake-exa-1',
          results: [
            {
              title: 'Time-balanced test sharding',
              url: FIXTURE_URL,
              publishedDate: '2026-10-30',
              text: 'Shard test files by recorded duration instead of by count.',
            },
          ],
          costDollars: { total: FIXTURE_COST },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => {
    exaServer.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(exaServer.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  const exaUrl = await startFakeExa();
  savedBaseUrl = process.env[EXA_BASE_URL_ENV];
  process.env[EXA_BASE_URL_ENV] = exaUrl;
  home = makeTestTempDir('cairn-web-search-home-');
  const reportsDir = join(home, 'reports');
  stub = await startStubLlm([
    {
      toolCall: {
        id: 'call-web-search',
        name: WEB_SEARCH_TOOL_NAME,
        arguments: { query: 'time-balanced test sharding' },
      },
    },
    { toolCall: { id: 'call-get-secret', name: 'get_secret', arguments: { name: 'EXA_API_KEY' } } },
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: `for d in ${reportsDir}/*/; do printf '# report\\n${REPORT_MARK}\\n${FIXTURE_URL}\\n' > "$d/report.md"; done; true`,
        },
      },
    },
    { content: 'report written.' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: 'You are an integration-test agent: use the tools asked for, then report.',
  });
  const exaSecret = await api(server.url, 'POST', `/api/teams/${server.teamId}/secrets`, {
    name: 'EXA_API_KEY',
    value: FAKE_EXA_KEY,
  });
  const otherSecret = await api(server.url, 'POST', `/api/teams/${server.teamId}/secrets`, {
    name: OTHER_SECRET_NAME,
    value: OTHER_SECRET_VALUE,
  });
  expect(exaSecret.status).toBe(201);
  expect(otherSecret.status).toBe(201);
  updateSessionPolicy(server, {
    secrets: [(exaSecret.body as { id: string }).id, (otherSecret.body as { id: string }).id],
  });
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'web-search-mbp',
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  handle = await runMachine({
    config,
    paths,
    logger: createDaemonLogger({ logFile: paths.daemonLog }),
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,

    confinementPreflight: CONFINEMENT_READY_LAUNCH,
  });
  await waitFor(
    () => daemonLogLines(paths.daemonLog).includes('[wake] push channel connected'),
    30_000,
  );
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  await new Promise<void>((resolve) => {
    if (exaServer === undefined) resolve();
    else exaServer.close(() => resolve());
  });
  if (savedBaseUrl === undefined) delete process.env[EXA_BASE_URL_ENV];
  else process.env[EXA_BASE_URL_ENV] = savedBaseUrl;
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('Phase 1b: a pi info step uses web_search through the daemon tool', () => {
  test('transcript shows web_search with a fixture result; the key never leaves the daemon', async () => {
    const project = await api(server.url, 'POST', '/api/projects', {
      name: 'web-search-it',
      teamId: server.teamId,
      repoKind: 'hosted',
    });
    const projectId = (project.body as { id: string }).id;
    const todoRes = await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Research CI sharding',
      spec: 'Search the web for time-balanced test sharding and write a report.',
      output: 'info',
    });
    expect(todoRes.status).toBe(201);
    const todoId = (todoRes.body as { id: string }).id;
    const started = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      withPlan: false,
    });
    expect(started.status).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(todoId) === 'review', 120_000);

    const messagesRes = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    expect(messagesRes.status).toBe(200);
    const messages = (messagesRes.body as { messages: unknown[] }).messages;
    const storedMessages = JSON.stringify(messages);
    const build = server.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(build.reportAttachmentId).not.toBeNull();
    const report = await (
      await fetch(`${server.url}/api/attachments/${build.reportAttachmentId}`)
    ).text();
    const daemonLog = readFileSync(paths.daemonLog, 'utf8');
    const ledger = JSON.parse(readFileSync(join(home, 'web-search-spend.json'), 'utf8')) as Record<
      string,
      number
    >;

    const evidenceDir = join(home, 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, `web-search-pi-${buildId}.json`);
    writeFileSync(
      evidencePath,
      JSON.stringify(
        {
          buildId,
          messages,
          exaRequests: exaRequests.map((r) => ({
            ...r,
            apiKey: r.apiKey === FAKE_EXA_KEY ? '<fake-key-seen>' : r.apiKey,
          })),
          ledger,
          report,
          webToolLogLines: daemonLog.split('\n').filter((l) => l.includes('web tool step=')),
          stubToolResults: stub.requests.map((r) => r.messages.filter((m) => m.role === 'tool')),
        },
        null,
        2,
      ),
    );
    process.stdout.write(`evidence: ${evidencePath}\n`);

    expect(storedMessages).toContain(WEB_SEARCH_TOOL_NAME);
    expect(storedMessages).toContain(FIXTURE_URL);
    expect(storedMessages).toMatch(/fetchedAt/);

    expect(exaRequests).toHaveLength(1);
    expect(exaRequests[0]!.path).toBe('/search');
    expect(exaRequests[0]!.apiKey).toBe(FAKE_EXA_KEY);
    expect(exaRequests[0]!.body.query).toBe('time-balanced test sharding');

    expect(storedMessages).not.toContain(FAKE_EXA_KEY);
    expect(report).not.toContain(FAKE_EXA_KEY);
    expect(report).toContain(REPORT_MARK);
    expect(daemonLog).not.toContain(FAKE_EXA_KEY);
    expect(JSON.stringify(stub.requests)).not.toContain(FAKE_EXA_KEY);

    const toolResults = JSON.stringify(stub.requests.map((r) => r.messages));
    expect(toolResults).toContain(`granted: ${OTHER_SECRET_NAME}`);
    expect(toolResults).not.toMatch(/granted:[^"]*EXA_API_KEY/);

    const month = new Date().toISOString().slice(0, 7);
    expect(ledger[month]).toBeCloseTo(FIXTURE_COST, 6);
    expect(daemonLog).toContain(`tool=${WEB_SEARCH_TOOL_NAME} provider=exa results=1`);
    expect(WEB_FETCH_TOOL_NAME).toBe('web_fetch');
  }, 180_000);
});
