import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chiefMessage, chiefThread, step as stepTable } from '../../apps/server/src/db/schema.js';
import { setCoordinatorMachineId } from '../../apps/server/src/services/coordinator-context.js';
import { AGENT_ID, api, bootRealServer, type RealServer, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const COORDINATOR_DIR = resolve(import.meta.dirname, '../../apps/coordinator');

let stub: StubLlm;
let server: RealServer;
let home: string;
let sidecar: ChildProcess | null = null;
const sidecarLog: string[] = [];

function startSidecar(): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: COORDINATOR_DIR,
    env: {
      ...process.env,
      CAIRN_HOME: home,
      CAIRN_COORDINATOR_SERVER_URL: server.url,
      CAIRN_COORDINATOR_SUMMARY_MODEL: 'stub-model',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (b: Buffer) => sidecarLog.push(b.toString()));
  child.stderr?.on('data', (b: Buffer) => sidecarLog.push(b.toString()));
  return child;
}

async function killSidecar(signal: NodeJS.Signals): Promise<void> {
  const child = sidecar;
  if (child === null || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill(signal);
  await exited;
  sidecar = null;
}

beforeAll(async () => {
  stub = await startStubLlm([
    { content: 'ANSWER-ONE' },
    { content: 'ANSWER-TWO-CUT', delayMs: 6_000 },
    { content: 'ANSWER-TWO' },
    { content: 'ANSWER-THREE' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  const enrolled = await fetch(`${server.url}/api/machine/enroll`, {
    method: 'POST',
    headers: { authorization: `Bearer ${server.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: server.teamId,
      name: 'coordinator-sidecar',
      cliVersion: '99.0.0',
    }),
  });
  expect(enrolled.status).toBe(200);
  const { token, machineId } = (await enrolled.json()) as { token: string; machineId: string };
  setCoordinatorMachineId(machineId);
  home = mkdtempSync(join(tmpdir(), 'cairn-sidecar-home-'));
  mkdirSync(join(home, 'coordinator'), { mode: 0o700 });
  writeFileSync(join(home, 'coordinator', 'machine-token'), token, { mode: 0o600 });
  const bound = await api(server.url, 'PATCH', `/api/teams/${server.teamId}/chief`, {
    agent: { agentId: AGENT_ID, thinkingLevel: null },
  });
  expect(bound.status).toBe(200);
  sidecar = startSidecar();
}, 120_000);

afterAll(async () => {
  setCoordinatorMachineId(null);
  await killSidecar('SIGKILL');
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

function threadId(): string {
  return server.db
    .select()
    .from(chiefThread)
    .all()
    .find((t) => !t.id.startsWith('chief-digest-'))!.id;
}

function assistantTexts(): string[] {
  return server.db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, threadId()), eq(chiefMessage.role, 'assistant')))
    .all()
    .map((r) => JSON.stringify(r.content));
}

function chiefSteps() {
  return server.db
    .select()
    .from(stepTable)
    .where(and(eq(stepTable.kind, 'chief'), like(stepTable.buildId, 'chief-%')))
    .all()
    .filter((s) => !s.buildId.startsWith('chief-digest-'));
}

async function send(content: string): Promise<void> {
  const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/coordinator/messages`, {
    content,
  });
  expect(sent.status).toBeLessThan(300);
}

describe('Coordinator on the Pi Durable sidecar (D72), real server and real sidecar process', () => {
  test('a turn is claimed by the sidecar, answered and mirrored into chief_message', async () => {
    await send('first question');
    await waitFor(() => assistantTexts().some((t) => t.includes('ANSWER-ONE')), 60_000);
    await waitFor(() => chiefSteps().every((s) => s.status === 'done'), 30_000);
    expect(new Set(chiefSteps().map((s) => s.machineId)).size).toBe(1);
  }, 90_000);

  test('kill -9 mid-turn: the restarted sidecar re-claims the same step and finishes it once', async () => {
    await send('second question');
    await waitFor(() => stub.requests.length >= 2, 30_000);
    const turn = chiefSteps().find((s) => s.status === 'claimed');
    expect(turn).toBeDefined();
    await killSidecar('SIGKILL');
    sidecar = startSidecar();
    await waitFor(() => assistantTexts().some((t) => t.includes('ANSWER-TWO"')), 60_000);
    await waitFor(() => chiefSteps().every((s) => s.status === 'done'), 30_000);
    const turns = chiefSteps();
    expect(turns).toHaveLength(2);
    expect(turns.find((s) => s.id === turn?.id)?.status).toBe('done');
    expect(assistantTexts().filter((t) => t.includes('ANSWER-TWO"'))).toHaveLength(1);
    expect(assistantTexts().some((t) => t.includes('ANSWER-TWO-CUT'))).toBe(false);
  }, 120_000);

  test('the next turn sends the earlier turns from the sidecar store', async () => {
    await send('third question');
    await waitFor(() => assistantTexts().some((t) => t.includes('ANSWER-THREE')), 60_000);
    const last = JSON.stringify(stub.requests.at(-1)?.messages);
    expect(last).toContain('first question');
    expect(last).toContain('ANSWER-ONE');
    expect(last).toContain('second question');
    expect(last).toContain('ANSWER-TWO');
    expect(last).toContain('third question');
  }, 90_000);

  test('a second sidecar on the same store refuses to start while the first runs', async () => {
    const second = startSidecar();
    const code = await new Promise<number | null>((r) => second.once('exit', r));
    expect(code).not.toBe(0);
    expect(sidecarLog.join('')).toMatch(/in use by another Coordinator sidecar/);
    expect(sidecar?.exitCode).toBeNull();
  }, 60_000);
});
