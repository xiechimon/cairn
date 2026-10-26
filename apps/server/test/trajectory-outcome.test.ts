import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { join, resolve } from 'node:path';
import { trajectoryPackSchema } from '@cairn/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import { agent, build, message, project, step, team, todo } from '../src/db/schema.js';
import { DONE_ROW, prClosedUnmergedRow } from '../src/services/delivery-rows.js';
import { REVERT_PROMPT_HEAD } from '../src/trajectory-outcome.js';

vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const serverDir = resolve(import.meta.dirname, '..');

interface BuildSeed {
  id: string;
  todo: string;
  createdAt: number;
  prNumber?: number;
  rows?: { content: string; at: number }[];
  prompt?: string;
}

const homes: string[] = [];
let labeler: Server;
let labelerUrl: string;
let labelerRequests: string[];

beforeEach(async () => {
  labelerRequests = [];
  labeler = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const content: string = body.messages.at(-1).content;
      const buildId = JSON.parse(content).buildId as string;
      labelerRequests.push(buildId);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  where: 'runtime',
                  why: 'premature_finish',
                  evidence: [{ stepId: `${buildId}-step`, messageIndex: 0 }],
                }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((done) => labeler.listen(0, '127.0.0.1', done));
  labelerUrl = `http://127.0.0.1:${(labeler.address() as AddressInfo).port}/v1`;
});

afterEach(async () => {
  await new Promise<void>((done) => labeler.close(() => done()));
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function seedInstance(builds: BuildSeed[]) {
  const home = makeTestTempDir('cairn-outcome-');
  homes.push(home);
  const opened = openDbWithHandle(join(home, 'server/server.db'));
  const db = opened.db;
  db.insert(team).values({ id: 'team-1', name: 'Test', createdAt: 1 }).run();
  db.insert(project).values({ id: 'project-1', teamId: 'team-1', name: 'Test' }).run();
  db.insert(agent)
    .values({ id: 'agent-1', teamId: 'team-1', displayName: 'B', provider: 'test', modelId: 'm' })
    .run();
  const sessions = join(home, 'server/attachments/step-sessions');
  mkdirSync(sessions, { recursive: true });
  const todos = new Set(builds.map((seed) => seed.todo));
  let seq = 0;
  for (const id of todos) {
    db.insert(todo)
      .values({
        id,
        teamId: 'team-1',
        projectId: 'project-1',
        title: id,
        spec: `Spec ${id}`,
        phaseAt: 1,
        seqNum: ++seq,
        assignment: { plan: null, build: { agentId: 'agent-1' } },
      })
      .run();
  }
  for (const seed of builds) {
    db.insert(build)
      .values({
        id: seed.id,
        todoId: seed.todo,
        withPlan: false,
        triggerSource: 'user',
        createdAt: seed.createdAt,
        baseSha: 'base-sha',
        harnessHash: 'harness-hash',
        prNumber: seed.prNumber ?? null,
      })
      .run();
    db.insert(step)
      .values({
        id: `${seed.id}-step`,
        buildId: seed.id,
        kind: 'build',
        createdAt: seed.createdAt + 1,
        prompt: seed.prompt ?? null,
        checkpointCommit: 'head-sha',
      })
      .run();
    writeFileSync(
      join(sessions, `${seed.id}-step.jsonl`),
      `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', model: 'agent-model', provider: 'tested' } })}\n`,
    );
    for (const [index, row] of (seed.rows ?? []).entries()) {
      db.insert(message)
        .values({
          id: `${seed.id}-row-${index}`,
          conversationId: seed.id,
          role: 'system',
          content: row.content,
          createdAt: row.at,
        })
        .run();
    }
  }
  opened.close();
  return home;
}

function exportAll(home: string) {
  const out = join(home, 'packs.jsonl');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/trajectory-export-cli.ts', '--since', '1970-01-01', '--out', out],
    { cwd: serverDir, env: { ...process.env, CAIRN_HOME: home }, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  const packs = readFileSync(out, 'utf8')
    .trim()
    .split('\n')
    .map((line) => trajectoryPackSchema.parse(JSON.parse(line)));
  return { out, packs, stdout: result.stdout };
}

function outcomeOf(packs: ReturnType<typeof exportAll>['packs'], buildId: string) {
  const outcome = packs.find((pack) => pack.buildId === buildId)?.outcome;
  expect(outcome, buildId).toBeTruthy();
  return {
    merged: outcome?.merged,
    revertedWithin7d: outcome?.revertedWithin7d,
    fixedByLaterPr: outcome?.fixedByLaterPr,
  };
}

const longAgo = 1_700_000_000_000;

const threeKinds: BuildSeed[] = [
  {
    id: 'build-merged',
    todo: 'todo-merged',
    createdAt: longAgo,
    prNumber: 11,
    rows: [{ content: DONE_ROW, at: longAgo + 1000 }],
  },
  {
    id: 'build-closed',
    todo: 'todo-closed',
    createdAt: longAgo,
    prNumber: 12,
    rows: [{ content: prClosedUnmergedRow(12), at: longAgo + 1000 }],
  },
  {
    id: 'build-reverted',
    todo: 'todo-reverted',
    createdAt: longAgo,
    prNumber: 13,
    rows: [{ content: DONE_ROW, at: longAgo + 1000 }],
  },
  {
    id: 'build-revert-of-13',
    todo: 'todo-reverted',
    createdAt: longAgo + 2 * DAY,
    prNumber: 14,
    prompt: `${REVERT_PROMPT_HEAD} undo PR #13`,
  },
];

test('merged, closed-unmerged and reverted builds export with matching outcomes', () => {
  const { packs } = exportAll(seedInstance(threeKinds));
  expect(outcomeOf(packs, 'build-merged')).toEqual({
    merged: true,
    revertedWithin7d: false,
    fixedByLaterPr: false,
  });
  expect(outcomeOf(packs, 'build-closed')).toEqual({
    merged: false,
    revertedWithin7d: null,
    fixedByLaterPr: null,
  });
  expect(outcomeOf(packs, 'build-reverted')).toEqual({
    merged: true,
    revertedWithin7d: true,
    fixedByLaterPr: false,
  });
});

test('a revert after the 7 day window does not count, and a later PR on the same ticket marks the fix', () => {
  const { packs } = exportAll(
    seedInstance([
      {
        id: 'build-late-revert',
        todo: 'todo-late',
        createdAt: longAgo,
        rows: [{ content: DONE_ROW, at: longAgo }],
      },
      {
        id: 'build-late-revert-pr',
        todo: 'todo-late',
        createdAt: longAgo + 8 * DAY,
        prNumber: 21,
        prompt: `${REVERT_PROMPT_HEAD} undo`,
      },
      {
        id: 'build-fixed',
        todo: 'todo-fixed',
        createdAt: longAgo,
        rows: [{ content: DONE_ROW, at: longAgo }],
      },
      { id: 'build-fixer', todo: 'todo-fixed', createdAt: longAgo + DAY, prNumber: 22 },
    ]),
  );
  expect(outcomeOf(packs, 'build-late-revert').revertedWithin7d).toBe(false);
  expect(outcomeOf(packs, 'build-fixed')).toEqual({
    merged: true,
    revertedWithin7d: false,
    fixedByLaterPr: true,
  });
});

test('a merge newer than 7 days leaves the revert window open and reports it', () => {
  const { packs, stdout } = exportAll(
    seedInstance([
      {
        id: 'build-fresh',
        todo: 'todo-fresh',
        createdAt: Date.now() - 1000,
        rows: [{ content: DONE_ROW, at: Date.now() - 500 }],
      },
    ]),
  );
  expect(outcomeOf(packs, 'build-fresh')).toEqual({
    merged: true,
    revertedWithin7d: null,
    fixedByLaterPr: null,
  });
  expect(stdout).toContain('revert_window_open=1');
});

test('builds without a merge or close record keep every outcome field null', () => {
  const { packs, stdout } = exportAll(
    seedInstance([{ id: 'build-pending', todo: 'todo-pending', createdAt: longAgo }]),
  );
  expect(outcomeOf(packs, 'build-pending')).toEqual({
    merged: null,
    revertedWithin7d: null,
    fixedByLaterPr: null,
  });
  expect(stdout).toContain('revert_window_open=0');
});

test('a close followed by a later merge counts as merged, and the latest record wins', () => {
  const { packs } = exportAll(
    seedInstance([
      {
        id: 'build-reopened',
        todo: 'todo-reopened',
        createdAt: longAgo,
        prNumber: 31,
        rows: [
          { content: prClosedUnmergedRow(31), at: longAgo + 1000 },
          { content: DONE_ROW, at: longAgo + 2000 },
        ],
      },
    ]),
  );
  expect(outcomeOf(packs, 'build-reopened').merged).toBe(true);
});

test('traj:export feeds traj:label: failed packs get labeled, successful packs are skipped', async () => {
  const home = seedInstance(threeKinds);
  const { out } = exportAll(home);
  const labeled = join(home, 'labeled.jsonl');
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (done) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/trajectory-label-cli.ts',
          '--in',
          out,
          '--out',
          labeled,
          '--model',
          'openai/gpt-5',
        ],
        {
          cwd: serverDir,
          env: {
            ...process.env,
            CAIRN_LABELER_BASE_URL: labelerUrl,
            CAIRN_LABELER_API_KEY: 'test-key',
          },
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (status) => done({ status, stdout, stderr }));
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('labeled=2 already_labeled=0 not_failed=2');
  expect([...labelerRequests].sort()).toEqual(['build-closed', 'build-reverted']);
  const attributionOf = Object.fromEntries(
    readFileSync(labeled, 'utf8')
      .trim()
      .split('\n')
      .map((line) => trajectoryPackSchema.parse(JSON.parse(line)))
      .map((pack) => [pack.buildId, pack.attribution !== null]),
  );
  expect(attributionOf).toEqual({
    'build-merged': false,
    'build-closed': true,
    'build-reverted': true,
    'build-revert-of-13': false,
  });
});
