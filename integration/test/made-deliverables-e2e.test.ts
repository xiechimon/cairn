import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  attachment as attachmentTable,
  message as messageTable,
} from '../../apps/server/src/db/schema.js';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  api,
  bootRealServer,
  CONFINEMENT_READY_LAUNCH,
  daemonLogLines,
  type RealServer,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const PAGE = '<h1>登录方案</h1><p>OAuth</p>';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;

beforeAll(async () => {
  home = makeTestTempDir('cairn-made-deliverables-home-');
  const reportsDir = join(home, 'reports');
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: [
            `for d in ${reportsDir}/*/; do`,
            `printf '# 调研报告\\n结论\\n' > "$d/report.md";`,
            `printf '${PAGE}' > "$d/deliverables/pages/summary.html";`,
            `printf 'PK\\003\\004deck' > "$d/deliverables/slides/deck.pptx";`,
            `printf 'x' > "$d/deliverables/pages/notes.txt";`,
            'done; true',
          ].join(' '),
        },
      },
    },
    { content: '报告、网页和 PPT 已写好。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成工作，然后简短汇报。',
  });
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'made-deliverables-mbp',
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
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('#4837 Made pages and slide decks through a real daemon', () => {
  test('an info task publishes its page and deck with the report, and each downloads intact', async () => {
    const project = await api(server.url, 'POST', '/api/projects', {
      name: 'made-deliverables',
      teamId: server.teamId,
      repoKind: 'hosted',
    });
    const projectId = (project.body as { id: string }).id;
    const todoRes = await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
      title: '调研登录方案',
      spec: '调研登录方案，写报告，并做一页网页和一份 PPT。',
      output: 'info',
    });
    const todoId = (todoRes.body as { id: string }).id;
    const started = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
    });
    expect(started.status).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(todoId) === 'review', 120_000);

    const rows = server.db
      .select()
      .from(attachmentTable)
      .where(eq(attachmentTable.scope, 'deliverable'))
      .all();
    expect(rows.map((r) => [r.fileName, r.status]).sort()).toEqual([
      ['deck.pptx', 'ready'],
      ['summary.html', 'ready'],
    ]);
    const msg = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.id, `deliverables-${buildId}`))
      .get()!;
    const content = JSON.parse(String(msg.content)) as {
      items: { kind: string; name: string }[];
      skipped: { name: string; reason: string }[];
    };
    expect(content.items.map((i) => [i.kind, i.name])).toEqual([
      ['slides', 'deck.pptx'],
      ['page', 'summary.html'],
    ]);
    expect(content.skipped).toEqual([{ name: 'notes.txt', reason: 'unsupported-kind' }]);
    const record = (await api(server.url, 'GET', `/api/todos/${todoId}`)).body as {
      deliverables?: { items: { kind: string; name: string }[]; skipped: unknown[] };
    };
    expect(record.deliverables?.items.map((i) => [i.kind, i.name])).toEqual([
      ['slides', 'deck.pptx'],
      ['page', 'summary.html'],
    ]);
    expect(record.deliverables?.skipped).toEqual(content.skipped);

    const page = rows.find((r) => r.fileName === 'summary.html')!;
    const pageRes = await fetch(`${server.url}/api/attachments/${page.id}?download=1`);
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers.get('content-disposition')).toContain('attachment');
    expect(await pageRes.text()).toBe(PAGE);
    const deck = rows.find((r) => r.fileName === 'deck.pptx')!;
    const deckRes = await fetch(`${server.url}/api/attachments/${deck.id}?download=1`);
    expect(Buffer.from(await deckRes.arrayBuffer())).toEqual(
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('deck')]),
    );
    expect(
      daemonLogLines(paths.daemonLog).some((l) => l.includes('does not take deliverables')),
    ).toBe(false);
  }, 300_000);
});
