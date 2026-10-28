import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type FailureReplayCandidate,
  failureReplayBankCaseSchema,
  failureReplayCandidateSchema,
  otlpTraceIdOfBuild,
  type TrajectoryPack,
  trajectoryPackSchema,
} from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import {
  draftAssertionsFromFeedback,
  failureReplayCandidateId,
  generateFailureReplayCandidates,
  materializeConfirmedBankCases,
} from '../src/trajectory-failure-replay.js';
import {
  enqueueFailureReplayCandidates,
  listCompletedFailureReplayItems,
  parseLangfuseAnnotationTarget,
} from '../src/trajectory-failure-replay-queue.js';

vi.setConfig({ testTimeout: 30_000 });

const dirs: string[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

function basePack(overrides: {
  buildId: string;
  plan?: TrajectoryPack['judgments']['plan'];
  diff?: TrajectoryPack['judgments']['diff'];
  gate?: TrajectoryPack['judgments']['gate_verdict'];
  outcome?: TrajectoryPack['outcome'];
  feedbackReason?: string;
}): TrajectoryPack {
  return trajectoryPackSchema.parse({
    buildId: overrides.buildId,
    input: {
      spec: `Task for ${overrides.buildId}`,
      sourceRef: null,
      baseSha: `sha-${overrides.buildId}`,
      persona: 'implementer',
      agentId: 'agent-1',
      model: 'test/model',
      skillInjection: null,
      blockerHandoff: null,
      harnessHash: 'harness-hash',
    },
    process: { steps: [], plans: [], token_usage: [] },
    judgments: {
      plan: overrides.plan ?? [{ action: 'confirm', reason: null }],
      diff: overrides.diff ?? [{ action: 'approve', reason: null }],
      gate_verdict: overrides.gate ?? [],
      ciFixRounds: 0,
    },
    outcome: overrides.outcome ?? {
      merged: true,
      revertedWithin7d: false,
      fixedByLaterPr: false,
      costTotal: 0.1,
    },
    attribution: null,
  });
}

test('plan rejection produces one pending candidate with prompt = task + base sha', () => {
  const pack = basePack({
    buildId: 'build-plan',
    plan: [{ action: 'revision', reason: 'Missing redaction step in the plan' }],
  });
  const candidates = generateFailureReplayCandidates([pack], {
    draftAssertions: draftAssertionsFromFeedback,
    now: () => 1_700_000_000_000,
  });
  expect(candidates).toHaveLength(1);
  const candidate = failureReplayCandidateSchema.parse(candidates[0]);
  expect(candidate.event).toBe('plan-rejection');
  expect(candidate.status).toBe('pending');
  expect(candidate.prompt).toEqual({
    spec: 'Task for build-plan',
    baseSha: 'sha-build-plan',
  });
  expect(candidate.feedback).toContain('Missing redaction');
  expect(candidate.draftAssertions.length).toBeGreaterThan(0);
  expect(candidate.id).toBe(failureReplayCandidateId('build-plan', 'plan-rejection'));
});

test('review blocking produces one pending candidate', () => {
  const pack = basePack({
    buildId: 'build-review',
    diff: [{ action: 'revision', reason: 'Auth check is missing on the new route' }],
  });
  const candidates = generateFailureReplayCandidates([pack], {
    draftAssertions: draftAssertionsFromFeedback,
    now: () => 1_700_000_000_000,
  });
  expect(candidates).toHaveLength(1);
  const candidate = failureReplayCandidateSchema.parse(candidates[0]);
  expect(candidate.event).toBe('review-blocking');
  expect(candidate.status).toBe('pending');
  expect(candidate.prompt.baseSha).toBe('sha-build-review');
  expect(candidate.feedback).toContain('Auth check');
});

test('post-merge revert produces one pending candidate', () => {
  const pack = basePack({
    buildId: 'build-revert',
    outcome: {
      merged: true,
      revertedWithin7d: true,
      fixedByLaterPr: false,
      costTotal: 0.2,
    },
  });
  const candidates = generateFailureReplayCandidates([pack], {
    draftAssertions: draftAssertionsFromFeedback,
    now: () => 1_700_000_000_000,
  });
  expect(candidates).toHaveLength(1);
  const candidate = failureReplayCandidateSchema.parse(candidates[0]);
  expect(candidate.event).toBe('post-merge-revert');
  expect(candidate.status).toBe('pending');
  expect(candidate.prompt.spec).toBe('Task for build-revert');
});

test('a clean successful pack yields no candidates', () => {
  const pack = basePack({ buildId: 'build-ok' });
  expect(
    generateFailureReplayCandidates([pack], {
      draftAssertions: draftAssertionsFromFeedback,
      now: () => 1,
    }),
  ).toEqual([]);
});

test('unconfirmed candidates never enter the eval bank', () => {
  const bank = mkdtempSync(join(tmpdir(), 'cairn-fr-bank-'));
  dirs.push(bank);
  const pending: FailureReplayCandidate = failureReplayCandidateSchema.parse({
    id: failureReplayCandidateId('build-plan', 'plan-rejection'),
    event: 'plan-rejection',
    buildId: 'build-plan',
    baseSha: 'sha-build-plan',
    prompt: { spec: 'Task for build-plan', baseSha: 'sha-build-plan' },
    feedback: 'Missing redaction',
    draftAssertions: ['must cover secret redaction'],
    status: 'pending',
    createdAt: 1,
  });
  const written = materializeConfirmedBankCases([pending], bank, { now: () => 99 });
  expect(written).toEqual([]);
  expect(readdirSync(bank)).toEqual([]);
  expect(existsSync(join(bank, 'cases'))).toBe(false);
});

test('confirmed candidates materialize into the eval bank as bank cases', () => {
  const bank = mkdtempSync(join(tmpdir(), 'cairn-fr-bank-'));
  dirs.push(bank);
  const confirmed: FailureReplayCandidate = failureReplayCandidateSchema.parse({
    id: failureReplayCandidateId('build-review', 'review-blocking'),
    event: 'review-blocking',
    buildId: 'build-review',
    baseSha: 'sha-build-review',
    prompt: { spec: 'Task for build-review', baseSha: 'sha-build-review' },
    feedback: 'Auth check is missing',
    draftAssertions: ['new routes must enforce auth'],
    status: 'confirmed',
    createdAt: 1,
  });
  const written = materializeConfirmedBankCases([confirmed], bank, { now: () => 42 });
  expect(written).toHaveLength(1);
  const path = join(bank, 'cases', `${confirmed.id}.json`);
  expect(existsSync(path)).toBe(true);
  const bankCase = failureReplayBankCaseSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  expect(bankCase).toEqual({
    id: confirmed.id,
    event: 'review-blocking',
    sourceBuildId: 'build-review',
    prompt: confirmed.prompt,
    assertions: ['new routes must enforce auth'],
    confirmedAt: 42,
  });
});

test('enqueue posts TRACE items to the Langfuse annotation queue and never touches the bank', async () => {
  const bank = mkdtempSync(join(tmpdir(), 'cairn-fr-bank-'));
  dirs.push(bank);
  const received: { method: string; url: string; body: unknown; auth: string | undefined }[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null,
        auth: req.headers.authorization,
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'item-1', status: 'PENDING' }));
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const candidate = failureReplayCandidateSchema.parse({
    id: failureReplayCandidateId('build-plan', 'plan-rejection'),
    event: 'plan-rejection',
    buildId: 'build-plan',
    baseSha: 'sha',
    prompt: { spec: 'Task', baseSha: 'sha' },
    feedback: 'Missing step',
    draftAssertions: ['must include the missing step'],
    status: 'pending',
    createdAt: 1,
  });
  const target = parseLangfuseAnnotationTarget({
    CAIRN_LANGFUSE_HOST: `http://127.0.0.1:${port}`,
    CAIRN_LANGFUSE_PUBLIC_KEY: 'pk-test',
    CAIRN_LANGFUSE_SECRET_KEY: 'sk-test',
    CAIRN_LANGFUSE_ANNOTATION_QUEUE_ID: 'queue-fr',
  });
  const result = await enqueueFailureReplayCandidates([candidate], target);
  expect(result.enqueued).toBe(1);
  expect(received).toHaveLength(1);
  expect(received[0]?.method).toBe('POST');
  expect(received[0]?.url).toBe('/api/public/annotation-queues/queue-fr/items');
  expect(received[0]?.body).toEqual({
    objectId: otlpTraceIdOfBuild('build-plan'),
    objectType: 'TRACE',
    status: 'PENDING',
  });
  expect(readdirSync(bank)).toEqual([]);
});

test('intake promotes only COMPLETED queue items into the bank', async () => {
  const bank = mkdtempSync(join(tmpdir(), 'cairn-fr-bank-'));
  dirs.push(bank);
  const pendingPlan = failureReplayCandidateSchema.parse({
    id: failureReplayCandidateId('build-plan', 'plan-rejection'),
    event: 'plan-rejection',
    buildId: 'build-plan',
    baseSha: 'sha-plan',
    prompt: { spec: 'Task plan', baseSha: 'sha-plan' },
    feedback: 'Missing step',
    draftAssertions: ['must include the missing step'],
    status: 'pending',
    createdAt: 1,
  });
  const pendingRevert = failureReplayCandidateSchema.parse({
    id: failureReplayCandidateId('build-revert', 'post-merge-revert'),
    event: 'post-merge-revert',
    buildId: 'build-revert',
    baseSha: 'sha-revert',
    prompt: { spec: 'Task revert', baseSha: 'sha-revert' },
    feedback: 'reverted within 7 days',
    draftAssertions: ['must not regress the reverted behavior'],
    status: 'pending',
    createdAt: 1,
  });
  const completedTraceId = otlpTraceIdOfBuild('build-revert');
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    if (
      req.method === 'GET' &&
      req.url?.startsWith('/api/public/annotation-queues/queue-fr/items')
    ) {
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'item-completed',
              queueId: 'queue-fr',
              objectId: completedTraceId,
              objectType: 'TRACE',
              status: 'COMPLETED',
              createdAt: '2026-10-28T00:00:00.000Z',
              updatedAt: '2026-10-28T00:00:00.000Z',
            },
          ],
          meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const target = parseLangfuseAnnotationTarget({
    CAIRN_LANGFUSE_HOST: `http://127.0.0.1:${port}`,
    CAIRN_LANGFUSE_PUBLIC_KEY: 'pk-test',
    CAIRN_LANGFUSE_SECRET_KEY: 'sk-test',
    CAIRN_LANGFUSE_ANNOTATION_QUEUE_ID: 'queue-fr',
  });
  const completed = await listCompletedFailureReplayItems(target);
  expect(completed.map((item) => item.objectId)).toEqual([completedTraceId]);
  const confirmed = [pendingPlan, pendingRevert].map((candidate) =>
    completed.some((item) => item.objectId === otlpTraceIdOfBuild(candidate.buildId))
      ? { ...candidate, status: 'confirmed' as const }
      : candidate,
  );
  const written = materializeConfirmedBankCases(confirmed, bank, { now: () => 77 });
  expect(written).toHaveLength(1);
  expect(written[0]?.id).toBe(pendingRevert.id);
  expect(existsSync(join(bank, 'cases', `${pendingPlan.id}.json`))).toBe(false);
  expect(existsSync(join(bank, 'cases', `${pendingRevert.id}.json`))).toBe(true);
});

test('draftAssertionsFromFeedback turns human feedback into executable check stubs', () => {
  expect(draftAssertionsFromFeedback('Auth check is missing on the new route')).toEqual([
    'must satisfy reviewer feedback: Auth check is missing on the new route',
  ]);
});
