import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_VARS, type TrajectoryPack } from '@cairn/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDbWithHandle } from '../src/db/client.js';
import { agent, build, memoryCandidate, project, team, todo } from '../src/db/schema.js';
import {
  trajectoryExportRunOf,
  trajectoryOutcomeRunOf,
  trajectoryReflectCurateRunOf,
} from '../src/services/scheduler.js';
import {
  REFLECT_CURATE_INTERVAL_MS,
  sweepReflectCurate,
} from '../src/trajectory-reflect-curate.js';

vi.setConfig({ testTimeout: 30_000 });

let server: Server;
let baseUrl: string;
let requests: number;
const dirs: string[] = [];

beforeEach(async () => {
  requests = 0;
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages: { content: string }[];
      };
      const user = JSON.parse(body.messages.at(-1)?.content ?? '{}') as { buildId: string };
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [
                    {
                      kind: 'memory',
                      title: 'Use pnpm vitest',
                      content: 'Run server tests with pnpm vitest, not npm test',
                      evidence: [{ stepId: `${user.buildId}-step-1`, messageIndex: 1 }],
                    },
                    {
                      kind: 'guard',
                      title: 'Block npm test in CI',
                      content: 'Reject scripts that invoke npm test in this repo',
                      evidence: [{ stepId: `${user.buildId}-step-1`, messageIndex: 0 }],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-reflect-curate-'));
  dirs.push(dir);
  return dir;
}

function pack(buildId: string): TrajectoryPack {
  return {
    buildId,
    input: {
      spec: `Task ${buildId}`,
      sourceRef: null,
      baseSha: 'a'.repeat(40),
      persona: null,
      agentId: 'agent-1',
      model: 'anthropic/claude-sonnet-4',
      skillInjection: null,
      blockerHandoff: null,
      harnessHash: 'harness-v1',
    },
    process: {
      steps: [
        {
          stepId: `${buildId}-step-1`,
          kind: 'build',
          transcript: [
            {
              role: 'assistant',
              content: [
                { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'npm test' } },
              ],
            },
            { role: 'system', content: [{ type: 'text', text: 'npm: missing script test' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
          ],
          checkpointCommit: null,
        },
      ],
      plans: [],
      token_usage: [],
    },
    judgments: {
      plan: [],
      diff: [],
      gate_verdict: [],
      ciFixRounds: 1,
    },
    outcome: {
      merged: true,
      revertedWithin7d: null,
      fixedByLaterPr: null,
      costTotal: 0.1,
    },
    attribution: null,
  } as TrajectoryPack;
}

function seedHome(home: string) {
  const dataDir = join(home, 'server');
  mkdirSync(dataDir, { recursive: true });
  const opened = openDbWithHandle(join(dataDir, 'server.db'));
  opened.db.insert(team).values({ id: 'team-1', name: 'T', createdAt: 1 }).run();
  opened.db.insert(project).values({ id: 'project-1', teamId: 'team-1', name: 'P' }).run();
  opened.db
    .insert(agent)
    .values({ id: 'agent-1', teamId: 'team-1', displayName: 'A', provider: 'p', modelId: 'm' })
    .run();
  opened.db
    .insert(todo)
    .values({
      id: 'todo-1',
      teamId: 'team-1',
      projectId: 'project-1',
      title: 't',
      phaseAt: 1,
      seqNum: 1,
    })
    .run();
  opened.db
    .insert(build)
    .values({
      id: 'build-1',
      todoId: 'todo-1',
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  return opened;
}

test('ENV_VARS.trajectoryReflectCurate names the schedule flag', () => {
  expect(ENV_VARS.trajectoryReflectCurate).toBe('CAIRN_TRAJ_REFLECT_CURATE');
  expect(ENV_VARS.trajectoryReflectOpenGuardIssues).toBe('CAIRN_TRAJ_REFLECT_OPEN_GUARD_ISSUES');
});

test('loadConfig reads the reflect-curate schedule flag', () => {
  const off = configFor(scratch());
  expect(off.trajectoryReflectCurate).toBe(false);
  expect(off.trajectoryReflectOpenGuardIssues).toBe(false);
  const previous = {
    curate: process.env[ENV_VARS.trajectoryReflectCurate],
    issues: process.env[ENV_VARS.trajectoryReflectOpenGuardIssues],
  };
  process.env[ENV_VARS.trajectoryReflectCurate] = '1';
  process.env[ENV_VARS.trajectoryReflectOpenGuardIssues] = 'true';
  try {
    const on = configFor(scratch());
    expect(on.trajectoryReflectCurate).toBe(true);
    expect(on.trajectoryReflectOpenGuardIssues).toBe(true);
  } finally {
    if (previous.curate === undefined) delete process.env[ENV_VARS.trajectoryReflectCurate];
    else process.env[ENV_VARS.trajectoryReflectCurate] = previous.curate;
    if (previous.issues === undefined)
      delete process.env[ENV_VARS.trajectoryReflectOpenGuardIssues];
    else process.env[ENV_VARS.trajectoryReflectOpenGuardIssues] = previous.issues;
  }
});

function configFor(home: string) {
  const dataDir = join(home, 'server');
  const skillsDir = join(home, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  return loadConfig({
    homeDir: home,
    dataDir,
    dbPath: join(dataDir, 'server.db'),
    keyfilePath: join(dataDir, 'secretbox.key'),
    skillsDir,
  });
}

test('trajectoryReflectCurateRunOf is null when the schedule flag is off', () => {
  const logs: string[] = [];
  const logger = { info: (_obj: object, msg: string) => logs.push(msg) };
  const config = configFor(scratch());
  expect(
    trajectoryReflectCurateRunOf(
      { trajectoryReflectCurate: false, trajectoryReflectOpenGuardIssues: false },
      {
        logger,
        config,
        model: 'm',
        endpoint: { baseUrl: 'http://x', apiKey: 'k' },
      },
    ),
  ).toBeNull();
  expect(logs.some((line) => line.includes('off'))).toBe(true);
});

test('trajectoryReflectCurateRunOf stays off without reflector credentials', () => {
  const logs: string[] = [];
  const logger = { info: (_obj: object, msg: string) => logs.push(msg) };
  const config = configFor(scratch());
  expect(
    trajectoryReflectCurateRunOf(
      { trajectoryReflectCurate: true, trajectoryReflectOpenGuardIssues: false },
      { logger, config, model: '', endpoint: { baseUrl: '', apiKey: '' } },
    ),
  ).toBeNull();
  expect(logs.some((line) => line.includes('missing reflector'))).toBe(true);
});

test('createScheduler in index.ts ends with trajectoryReflectCurateRunOf after export', () => {
  const src = readFileSync(join(import.meta.dirname, '../src/index.ts'), 'utf8');
  const call = /createScheduler\(([\s\S]*?)\n\);/.exec(src)?.[1] ?? '';
  expect(call).toMatch(
    /trajectoryOutcomeRunOf\(config,[\s\S]*trajectoryExportRunOf\(config,[\s\S]*trajectoryReflectCurateRunOf\(config,/,
  );
});

test('export and outcome runOf helpers still exist for the prior slots', () => {
  const logger = { info: () => {} };
  expect(trajectoryExportRunOf(configFor(scratch()), { logger }).logger).toBe(logger);
  expect(trajectoryOutcomeRunOf({ trajectoryOutcomeBackfill: true }, { logger })).toEqual({
    logger,
  });
});

test('sweepReflectCurate reflects then curates a daily export once', async () => {
  const home = scratch();
  const opened = seedHome(home);
  const config = configFor(home);
  const exportsDir = join(config.dataDir, 'trajectory-exports');
  mkdirSync(exportsDir, { recursive: true });
  const date = '2026-10-28';
  writeFileSync(join(exportsDir, `${date}.jsonl`), `${JSON.stringify(pack('build-1'))}\n`);
  const summary = await sweepReflectCurate({
    config,
    db: opened.db,
    logger: { info: () => {} },
    model: 'openai/gpt-5-mini',
    endpoint: { baseUrl, apiKey: 'test-key' },
    now: () => Date.parse(`${date}T12:00:00.000Z`),
  });
  expect(summary).toMatchObject({
    date,
    skipped: null,
    reflect: { reflected: 1, notEligible: 0, candidates: 2, rejected: 0 },
    curate: expect.objectContaining({ memoryPending: 1, guardNew: 1 }),
  });
  expect(requests).toBe(1);
  expect(existsSync(join(config.dataDir, 'experience-candidates', 'reflect', `${date}.done`))).toBe(
    true,
  );
  expect(opened.db.select().from(memoryCandidate).all()).toHaveLength(1);
  const again = await sweepReflectCurate({
    config,
    db: opened.db,
    logger: { info: () => {} },
    model: 'openai/gpt-5-mini',
    endpoint: { baseUrl, apiKey: 'test-key' },
    now: () => Date.parse(`${date}T18:00:00.000Z`),
  });
  expect(again.skipped).toBe('already_done');
  expect(requests).toBe(1);
  opened.close();
});

test('sweepReflectCurate opens GitHub issues for new guards when asked', async () => {
  const home = scratch();
  const opened = seedHome(home);
  const config = configFor(home);
  const exportsDir = join(config.dataDir, 'trajectory-exports');
  mkdirSync(exportsDir, { recursive: true });
  const date = '2026-10-29';
  writeFileSync(join(exportsDir, `${date}.jsonl`), `${JSON.stringify(pack('build-1'))}\n`);
  const openedGuards: { title: string; content: string }[] = [];
  const summary = await sweepReflectCurate({
    config,
    db: opened.db,
    logger: { info: () => {} },
    model: 'openai/gpt-5-mini',
    endpoint: { baseUrl, apiKey: 'test-key' },
    now: () => Date.parse(`${date}T12:00:00.000Z`),
    openNewGuards: async (guards) => {
      for (const guard of guards) openedGuards.push({ title: guard.title, content: guard.content });
      return guards.length;
    },
  });
  expect(summary.guardIssuesOpened).toBe(1);
  expect(openedGuards).toEqual([
    {
      title: 'Block npm test in CI',
      content: 'Reject scripts that invoke npm test in this repo',
    },
  ]);
  opened.close();
});

test('REFLECT_CURATE_INTERVAL_MS matches the daily trajectory cadence', () => {
  expect(REFLECT_CURATE_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
});
