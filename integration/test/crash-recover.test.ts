import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_VARS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { step as stepTable } from '../../apps/server/src/db/schema.js';
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

const DAEMON_DIR = fileURLToPath(new URL('../../apps/daemon', import.meta.url));

let stub: StubLlm;
let server: RealServer;
let home: string;
const children: ChildProcess[] = [];

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await server?.close();
  await stub?.close();
});

function spawnDaemon(): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/cli.ts',
      'start',
      '--foreground',
      '--server',
      server.url,
      '--api-key',
      server.apiKey,
      '--team',
      server.teamId,
      '--name',
      'crash-mbp',
    ],
    {
      cwd: DAEMON_DIR,
      env: {
        ...process.env,
        [ENV_VARS.home]: home,
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  return child;
}

function logLines(): string[] {
  return daemonLogLines(join(home, 'daemon.log'));
}

describe('crash recovery (T2: AgentSession seam × host durable orchestration)', () => {
  test('SIGKILL mid-step → restart → recover reconciliation → continue session resumes → confirm', async () => {
    stub = await startStubLlm([
      { content: '第一轮响应（崩溃前）。', delayMs: 6_000 },
      {
        toolCall: {
          name: 'bash',
          arguments: {
            command: `cat > plan.md <<'EOF'\n# 方案\nKind: fix\n\nContext: 崩溃恢复探针。\nChanges: README 加一行。\nVerification: 读回 README.md。\nEOF`,
          },
        },
      },
      { content: '恢复后续跑完成。' },
    ]);
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 500 });
    home = mkdtempSync(join(tmpdir(), 'cairn-crash-home-'));
    const world = await seedWorld(server.url, server.teamId, {
      title: '崩溃恢复探针',
      spec: '写一行崩溃恢复探针。',
    });

    const first = spawnDaemon();
    await waitFor(() => logLines().includes('[wake] push channel connected'), 60_000);

    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    // pi keeps the prompt on disk if the first turn never completes (pi #10000):
    // at this point the session jsonl already carries the first user message, so
    // recovery resumes via a real continue session.
    await waitFor(() => logLines().some((l) => l.includes(`new session ${buildId}`)), 90_000);
    await waitFor(() => stub.requests.length >= 1, 30_000);
    await new Promise((r) => setTimeout(r, 300));
    first.kill('SIGKILL');
    await new Promise<void>((resolve) => first.once('exit', () => resolve()));

    const midSteps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(midSteps).toHaveLength(1);
    expect(midSteps[0]!.status).toBe('claimed');
    expect(server.todoPhase(world.todoId)).toBe('planning');

    const second = spawnDaemon();
    await waitFor(
      () => logLines().some((l) => l.includes('[recover] 1 pending step(s) found')),
      60_000,
    );
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);
    await waitFor(() => logLines().some((l) => l.includes('finished (0 running)')), 30_000);

    const lines = logLines();
    expect(lines.some((l) => l.includes(`continue session ${buildId}`))).toBe(true);
    expect(lines.some((l) => l.includes('continue session unavailable'))).toBe(false);
    expect(lines.filter((l) => l.includes(`new session ${buildId}`))).toHaveLength(1);
    expect(lines.some((l) => l.includes('finished (0 running)'))).toBe(true);
    expect(JSON.stringify(stub.requests[1]?.messages ?? [])).toContain('崩溃恢复探针');

    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(steps[0]!.status).toBe('done');
    expect(steps[0]!.sessionId).toBeTruthy();

    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    expect(
      JSON.stringify((msgs.body as { messages: unknown[] }).messages).includes('崩溃恢复探针'),
    ).toBe(true);

    second.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5_000);
      second.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
    expect(logLines()).toContain('[machine] Shutting down… (SIGTERM)');
  }, 240_000);
});
