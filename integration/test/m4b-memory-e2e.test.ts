import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  agentMemory,
  step as stepTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const MEMORY_TITLE = 'README 只在末尾追加小节';
const MEMORY_CONTENT = 'README.md 约定：新增说明一律在文件末尾追加二级标题小节。';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let world1: { projectId: string; todoId: string };
let world2: { projectId: string; todoId: string };
let build1 = '';
let stepStatusAtWrite: string | null = null;

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'save_memory',
        arguments: { title: MEMORY_TITLE, content: MEMORY_CONTENT },
      },
    },
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "mem probe line\\n" >> README.md' } },
    },
    { content: '已完成：README 追加小节，并已按要求保存一条项目经验到记忆。', delayMs: 1500 },
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "mem task2 line\\n" >> README.md' } },
    },
    { content: '已完成任务二。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求完成改动，然后简短汇报。',
  });
  home = mkdtempSync(join(tmpdir(), 'cairn-m4b-mem-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'm4b-mem-mbp',
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  const diagTail = logLines().slice(-40).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('M4b memory E2E: instruction-triggered + mid-step write + provenance + zero auto-write (r5 §6)', () => {
  test('spec instruction turn: save_memory persists mid-build-step, three-level provenance = live context', async () => {
    world1 = await seedWorld(
      server.url,
      server.teamId,
      {
        title: '记忆指令任务',
        spec: `在 README.md 追加一行探针。\n\n完成后请用你的记忆工具保存一条与本项目相关的一句话经验（r5 §6 指令原文形）。`,
      },
      { projectName: 'm4b-mem-1' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world1.projectId}/builds`, {
      todoIds: [world1.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    build1 = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => {
      const rows = server.db.select().from(agentMemory).all();
      if (rows.length > 0) {
        if (stepStatusAtWrite === null) {
          stepStatusAtWrite =
            server.db.select().from(stepTable).where(eq(stepTable.buildId, build1)).all()[0]
              ?.status ?? null;
        }
        return true;
      }
      return false;
    }, 120_000);
    expect(stepStatusAtWrite).toBe('claimed');

    const rows = server.db.select().from(agentMemory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: AGENT_ID,
      teamId: server.teamId,
      title: MEMORY_TITLE,
      content: MEMORY_CONTENT,
      projectId: world1.projectId,
      sourceTodoId: world1.todoId,
      sourceBuildId: build1,
    });

    await waitFor(() => server.todoPhase(world1.todoId) === 'review', 120_000);
    expect(server.db.select().from(agentMemory).all()).toHaveLength(1);
  }, 150_000);

  test('no-instruction turn: zero writes + read-side injection trace visible on the wire (04 appendix A)', async () => {
    const todo2Res = await api(server.url, 'POST', `/api/projects/${world1.projectId}/todos`, {
      title: '无记忆指令任务',
      spec: '在 README.md 追加一行任务二探针。',
    });
    world2 = { projectId: world1.projectId, todoId: (todo2Res.body as { id: string }).id };
    const started = await api(server.url, 'POST', `/api/projects/${world2.projectId}/builds`, {
      todoIds: [world2.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);

    await waitFor(() => server.todoPhase(world2.todoId) === 'review', 120_000);

    expect(server.db.select().from(agentMemory).all()).toHaveLength(1);
    const todo2 = server.db.select().from(todoTable).where(eq(todoTable.id, world2.todoId)).get();
    expect(todo2?.phase).toBe('review');

    const task2Requests = stub.requests.filter((r) => JSON.stringify(r).includes('无记忆指令任务'));
    expect(task2Requests.length).toBeGreaterThan(0);
    const wire = JSON.stringify(task2Requests[0]);
    expect(wire).toContain('## 记忆');
    expect(wire).toContain(MEMORY_TITLE);
    expect(wire).toContain(MEMORY_CONTENT);
  }, 150_000);
});
