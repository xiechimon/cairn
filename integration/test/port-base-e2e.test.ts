import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import {
  DAEMON_MAX_CONCURRENT_ENV,
  type MachineHandle,
  runMachine,
} from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  build as buildTable,
  machine as machineTable,
  step as stepTable,
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

interface Stack {
  stub: StubLlm;
  server: RealServer;
  handle: MachineHandle;
  paths: StatePaths;
  home: string;
  lines(): string[];
  machineId: string;
  close(): Promise<void>;
}

const stacks: Stack[] = [];

async function bootStack(opts: {
  responses: Parameters<typeof startStubLlm>[0];
  capEnv?: NodeJS.ProcessEnv;
}): Promise<Stack> {
  const stub = await startStubLlm(opts.responses);
  const server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  const home = mkdtempSync(join(tmpdir(), 'cairn-1148-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'pb-mbp' },
    {},
  );
  const paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  const handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    ...(opts.capEnv !== undefined ? { capEnv: opts.capEnv } : {}),
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(
    () => daemonLogLines(paths.daemonLog).includes('[wake] push channel connected'),
    30_000,
  );
  const machineId = server.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'pb-mbp'))
    .get()!.id;
  const stack: Stack = {
    stub,
    server,
    handle,
    paths,
    home,
    lines: () => daemonLogLines(paths.daemonLog),
    machineId,
    close: async () => {
      await handle.stop();
      await handle.done;
      await server.close();
      await stub.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
  stacks.push(stack);
  return stack;
}

let lastFailedStack: Stack | null = null;

afterAll(async () => {
  for (const s of stacks) {
    if (s === lastFailedStack) {
      const steps = s.server.db.select().from(stepTable).all();
      process.stdout.write(
        `\n[diag] steps: ${JSON.stringify(
          steps.map((st) => ({ id: st.id, kind: st.kind, status: st.status })),
        )}\n[diag] builds: ${JSON.stringify(
          s.server.db
            .select()
            .from(buildTable)
            .all()
            .map((b) => ({ id: b.id, todoId: b.todoId, errorMessage: b.errorMessage })),
        )}\n[diag] stub requests: ${s.stub.requests.length}; flattened tails:\n${s.stub.requests
          .map((r, i) => `  [${i}] ${JSON.stringify(r.messages).slice(0, 400)}`)
          .join('\n')}\n[diag] daemon.log tail:\n${s.lines().slice(-50).join('\n')}\n`,
      );
    }
    await s.close();
  }
});

async function startBuild(
  stack: Stack,
  title: string,
): Promise<{ todoId: string; buildId: string }> {
  const world = await seedWorld(stack.server.url, stack.server.teamId, {
    title,
    spec: '探针：跑一条命令并收尾。',
  });
  const started = await api(stack.server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
    todoIds: [world.todoId],
    assignment: { plan: null, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  expect(started.status).toBe(201);
  const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
  return { todoId: world.todoId, buildId };
}

function stepsOf(stack: Stack, buildId: string) {
  return stack.server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}

describe('#1148 E2E: port base segmentation (two concurrent worker steps in different segments)', () => {
  test('two concurrent worker steps see CAIRN_PORT_BASE = 20000 / 20100 in their bash env', async () => {
    const bashProbe = {
      toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$CAIRN_PORT_BASE"` } },
    };
    const stack = await bootStack({
      responses: [
        bashProbe,
        bashProbe,
        bashProbe,
        bashProbe,
        bashProbe,
        bashProbe,
        { content: '探针完成。' },
      ],
    });
    const t1 = await startBuild(stack, '端口探针一');
    const t2 = await startBuild(stack, '端口探针二');
    try {
      await waitFor(() => stepsOf(stack, t1.buildId)[0]?.status === 'done', 120_000);
      await waitFor(() => stepsOf(stack, t2.buildId)[0]?.status === 'done', 120_000);
    } catch (err) {
      lastFailedStack = stack;
      throw err;
    }
    const lines = stack.lines();
    expect(lines.some((l) => l.includes('(1 running)'))).toBe(true);
    expect(lines.some((l) => l.includes('(2 running)'))).toBe(true);
    const flat = JSON.stringify(stack.stub.requests.map((r) => r.messages));
    const found = [...flat.matchAll(/PB=(\d{5})/g)].map((m) => m[1]);
    expect(new Set(found)).toEqual(new Set(['20000', '20100']));
  }, 150_000);
});

describe('#1260 E2E: chief occupies the machine concurrency slot (cap 1)', () => {
  test('while a worker runs (cap 1) the chief queues for a free slot; a later worker is FIFO behind it', async () => {
    const stack = await bootStack({
      responses: [
        {
          delayMs: 6_000,
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$CAIRN_PORT_BASE"` } },
        },
        { delayMs: 2_000, content: '收到，已了解当前进度。' },
        { content: '探针完成。' },
        {
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$CAIRN_PORT_BASE"` } },
        },
        { content: '探针完成。' },
      ],
    });
    stack.server.db
      .update(machineTable)
      .set({ maxConcurrent: 1 })
      .where(eq(machineTable.id, stack.machineId))
      .run();
    const patch = await api(stack.server.url, 'PATCH', `/api/teams/${stack.server.teamId}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: null },
    });
    expect(patch.status).toBe(200);

    const w1 = await startBuild(stack, '并发探针一');
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'claimed', 30_000);

    const sent = await api(
      stack.server.url,
      'POST',
      `/api/teams/${stack.server.teamId}/chief/threads`,
      { content: '现在团队里在跑什么？' },
    );
    expect(sent.status).toBe(201);
    const threadId = (sent.body as { thread: { id: string } }).thread.id;
    await new Promise((r) => setTimeout(r, 1_500));
    expect(stepsOf(stack, threadId)[0]?.status).toBe('pending');

    const w2 = await startBuild(stack, '并发探针二');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(stepsOf(stack, w2.buildId)[0]?.status).toBe('pending');

    await waitFor(
      () =>
        stepsOf(stack, threadId)[0]?.status === 'claimed' ||
        stack.lines().some((l) => l.includes(`for conv ${threadId}`)),
      30_000,
    );
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'done', 120_000);

    await waitFor(() => {
      const chiefSteps = stack.server.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, threadId))
        .all();
      return chiefSteps[0]?.status === 'done';
    }, 120_000);
    await waitFor(() => stepsOf(stack, w2.buildId)[0]?.status === 'done', 120_000);
  }, 240_000);
});

describe('#1148 E2E: env fallback precedence (env > DB > default)', () => {
  test('DB 2 / env 1 → only 1 worker runs at a time (env beats DB; server gate narrows to self-report)', async () => {
    const stack = await bootStack({
      capEnv: { [DAEMON_MAX_CONCURRENT_ENV]: '1' },
      responses: [
        {
          delayMs: 6_000,
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$CAIRN_PORT_BASE"` } },
        },
        { content: '探针完成。' },
        {
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$CAIRN_PORT_BASE"` } },
        },
        { content: '探针完成。' },
      ],
    });
    stack.server.db
      .update(machineTable)
      .set({ maxConcurrent: 2 })
      .where(eq(machineTable.id, stack.machineId))
      .run();
    const w1 = await startBuild(stack, 'env 探针一');
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'claimed', 30_000);
    const w2 = await startBuild(stack, 'env 探针二');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(stepsOf(stack, w2.buildId)[0]?.status).toBe('pending');
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'done', 120_000);
    await waitFor(() => stepsOf(stack, w2.buildId)[0]?.status === 'done', 120_000);
  }, 240_000);
});
