import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECORDING_MAX_BYTES } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { attachment, build, gateVerdict, project, step, team, todo } from '../src/db/schema.js';
import { attachWorkerFile } from '../src/services/agent-attachments.js';
import { compareFilesFromResponse, computePatchDigest } from '../src/services/merge-gate/digest.js';
import { newGateReadCache, readGateGithubFacts } from '../src/services/merge-gate/github-facts.js';
import type { GateGithubPort, GateRaw } from '../src/services/merge-gate/github-port.js';
import { type GateInputs, mergeReadiness } from '../src/services/merge-gate/readiness.js';
import { evaluateMergeGate } from '../src/services/merge-gate-run.js';
import { bootServer, postProject } from './helpers.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const PATH = 'docs/verify/3803/motion.gif';
const FILES = [
  {
    filename: 'apps/web/src/card.tsx',
    status: 'modified',
    sha: 'c'.repeat(40),
    additions: 1,
    deletions: 0,
    patch: '@@ -0,0 +1 @@\n+<div className="transition" />',
  },
  { filename: PATH, status: 'added', sha: 'd'.repeat(40), additions: 0, deletions: 0 },
];
const DIGEST = computePatchDigest(compareFilesFromResponse({ files: FILES }) ?? []).patchDigest;
const GIF = Buffer.from('GIF89a recording');
const ok = (body: unknown): GateRaw => ({ kind: 'ok', status: 200, body, etag: null, link: null });

function github() {
  const probes: string[] = [];
  const port: GateGithubPort = {
    pull: async () =>
      ok({
        number: 7,
        state: 'open',
        merged: false,
        draft: false,
        changed_files: 2,
        mergeable_state: 'clean',
        body: `https://raw.githubusercontent.com/xiechimon/cairn/${HEAD}/${PATH}`,
        head: { sha: HEAD, ref: 'lane', repo: { full_name: 'xiechimon/cairn' } },
        base: { ref: 'main', repo: { full_name: 'xiechimon/cairn', default_branch: 'main' } },
      }),
    branch: async () =>
      ok({
        commit: { sha: BASE },
        protected: true,
        protection: { required_status_checks: { contexts: ['check'] } },
      }),
    branchRules: async () => ok([]),
    compare: async () =>
      ok({
        total_commits: 1,
        behind_by: 0,
        commits: [{ sha: HEAD, parents: [{ sha: BASE }] }],
        files: FILES,
      }),
    checkRuns: async () =>
      ok({
        total_count: 2,
        check_runs: ['check', 'pr-evidence'].map((name, i) => ({
          id: i + 1,
          name,
          status: 'completed',
          conclusion: 'success',
          head_sha: HEAD,
          app: { id: 1 },
        })),
      }),
    combinedStatus: async () => ok({ sha: HEAD, total_count: 0, statuses: [] }),
    contents: async (path) => {
      probes.push(path);
      return ok([{ type: 'file', name: 'motion.gif', path: PATH, size: 100 }]);
    },
    createStatus: async () => ok({}),
  };
  return { port, probes };
}

async function world(mode: 'attachments' | 'repository' | null = 'attachments') {
  const s = bootServer();
  const projectId = await postProject(s.app, 'recording');
  s.db
    .update(project)
    .set({
      githubRepo: 'xiechimon/cairn',
      repoKind: 'github',
      evidenceStore: mode === 'repository' ? 'attachments' : 'repository',
    })
    .where(eq(project.id, projectId))
    .run();
  s.db
    .insert(todo)
    .values({
      id: 'todo-recording',
      teamId: s.team.id,
      projectId,
      title: 'motion',
      phase: 'review',
      phaseAt: 1,
      seqNum: 3803,
      latestBuildId: 'build-recording',
      sourceKind: 'github-issue',
      sourceRef: 'github:xiechimon/cairn#3803',
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build-recording',
      todoId: 'todo-recording',
      withPlan: false,
      triggerSource: 'user',
      prNumber: 7,
      evidenceStore: mode,
      createdAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'verify-recording',
      buildId: 'build-recording',
      kind: 'verify',
      status: 'claimed',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(gateVerdict)
    .values({
      stepId: 'verify-recording',
      buildId: 'build-recording',
      kind: 'verify',
      outcome: 'pass',
      headSha: HEAD,
      expectedHeadSha: HEAD,
      patchDigest: DIGEST,
      createdAt: 1,
    })
    .run();
  const stepRow = s.db.select().from(step).where(eq(step.id, 'verify-recording')).get();
  const todoRow = s.db.select().from(todo).where(eq(todo.id, 'todo-recording')).get();
  if (!stepRow || !todoRow) throw new Error('missing verify world');
  const uploaded = JSON.parse(
    attachWorkerFile(
      { ...s.svc, attachmentsDir: s.attachmentsDir, box: s.secretBox, reposDir: s.reposDir },
      stepRow,
      todoRow,
      {
        fileName: 'motion.gif',
        contentBase64: GIF.toString('base64'),
      },
    ),
  ) as { id: string; key: string };
  s.db.update(step).set({ status: 'done' }).where(eq(step.id, stepRow.id)).run();
  const g = github();
  const recordingMissing = async () => {
    const readiness = await evaluateMergeGate(
      { ...s.svc, attachmentsDir: s.attachmentsDir },
      'build-recording',
      { port: g.port },
    );
    expect(readiness).not.toBeNull();
    return readiness?.blockers.some((b) => b.code === 'recording-missing');
  };
  return { s, uploaded, recordingMissing, ...g };
}

test('a current passing verify recording clears the blocker without repository probes', async () => {
  const w = await world();
  try {
    expect(await w.recordingMissing()).toBe(false);
    expect(w.probes).toEqual([]);
    w.s.db.delete(attachment).where(eq(attachment.id, w.uploaded.id)).run();
    expect(await w.recordingMissing()).toBe(true);
  } finally {
    w.s.dispose();
  }
});

test.each(['attachments', null] as const)(
  'raw links do not satisfy %s recording mode',
  async (mode) => {
    const w = await world(mode);
    try {
      w.s.db.delete(attachment).where(eq(attachment.id, w.uploaded.id)).run();
      expect(await w.recordingMissing()).toBe(true);
      expect(w.probes).toEqual([]);
    } finally {
      w.s.dispose();
    }
  },
);

test.each([
  { outcome: 'block' as const },
  { outcome: 'unbound' as const },
  { patchDigest: 'd'.repeat(64) },
  { headSha: BASE },
  { patchDigest: null, headSha: BASE },
])('recordings require a passing bound current verdict: %j', async (change) => {
  const w = await world();
  try {
    expect(await w.recordingMissing()).toBe(false);
    w.s.db.update(gateVerdict).set(change).where(eq(gateVerdict.stepId, 'verify-recording')).run();
    expect(await w.recordingMissing()).toBe(true);
  } finally {
    w.s.dispose();
  }
});

test.each([
  { createdBy: 'step:other-verify' },
  { createdBy: 'owner' },
  { todoId: 'other-todo' },
  { teamId: 'other-team' },
  { fileName: 'motion.png' },
  { mimeType: 'image/png' },
  { sizeBytes: 0 },
  { sizeBytes: RECORDING_MAX_BYTES + 1 },
  { status: 'pending' as const },
  { status: 'failed' as const },
  { sha256: null },
])('invalid attachment never counts: %j', async (change) => {
  const w = await world();
  try {
    expect(await w.recordingMissing()).toBe(false);
    if ('teamId' in change)
      w.s.db.insert(team).values({ id: 'other-team', name: 'Other', createdAt: 1 }).run();
    w.s.db.update(attachment).set(change).where(eq(attachment.id, w.uploaded.id)).run();
    expect(await w.recordingMissing()).toBe(true);
  } finally {
    w.s.dispose();
  }
});

test.each(['missing', 'changed', 'size mismatch'] as const)(
  'unreadable proof fails closed: %s',
  async (failure) => {
    const w = await world();
    try {
      expect(await w.recordingMissing()).toBe(false);
      const path = join(w.s.attachmentsDir, w.uploaded.key);
      if (failure === 'missing') rmSync(path);
      else if (failure === 'changed') writeFileSync(path, Buffer.alloc(GIF.length));
      else
        w.s.db
          .update(attachment)
          .set({ sizeBytes: GIF.length + 1 })
          .where(eq(attachment.id, w.uploaded.id))
          .run();
      expect(await w.recordingMissing()).toBe(true);
    } finally {
      w.s.dispose();
    }
  },
);

test('the 5 MiB boundary counts and repository snapshots retain raw-link behavior', async () => {
  const w = await world();
  try {
    const bytes = Buffer.alloc(RECORDING_MAX_BYTES);
    GIF.copy(bytes);
    writeFileSync(join(w.s.attachmentsDir, w.uploaded.key), bytes);
    w.s.db
      .update(attachment)
      .set({ sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      .where(eq(attachment.id, w.uploaded.id))
      .run();
    expect(await w.recordingMissing()).toBe(false);
    expect(w.probes).toEqual([]);
    w.s.db
      .update(build)
      .set({ evidenceStore: 'repository' })
      .where(eq(build.id, 'build-recording'))
      .run();
    w.s.db.delete(attachment).where(eq(attachment.id, w.uploaded.id)).run();
    expect(await w.recordingMissing()).toBe(false);
    expect(w.probes.length).toBeGreaterThan(0);
  } finally {
    w.s.dispose();
  }
});

test('attachment facts skip raw presence reads even when repository links are present', async () => {
  const g = github();
  await readGateGithubFacts(
    g.port,
    {
      owner: 'xiechimon',
      repo: 'cairn',
      prNumber: 7,
      ticketRef: '3803',
      now: 1,
      ...{ evidenceStore: 'attachments' as const },
    },
    newGateReadCache(),
  );
  expect(g.probes).toEqual([]);
});

test('a recording from a different build cannot satisfy the current build', async () => {
  const w = await world();
  try {
    expect(await w.recordingMissing()).toBe(false);
    w.s.db
      .insert(build)
      .values({
        id: 'old-build',
        todoId: 'todo-recording',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 0,
      })
      .run();
    w.s.db.update(step).set({ buildId: 'old-build' }).where(eq(step.id, 'verify-recording')).run();
    expect(await w.recordingMissing()).toBe(true);
  } finally {
    w.s.dispose();
  }
});

test('pure recording readiness binds attachments to a passing current digest and preserves repository rules', async () => {
  const g = github();
  const facts = await readGateGithubFacts(
    g.port,
    { owner: 'xiechimon', repo: 'cairn', prNumber: 7, ticketRef: '3803', now: 1 },
    newGateReadCache(),
  );
  const inputs: GateInputs & { evidenceStore: 'attachments' | 'repository' | null } = {
    evidenceStore: 'attachments',
    policy: { mergePolicy: 'autonomous', autonomyPaused: false, dailyCapReached: false },
    build: { isGithubPr: true, isCurrent: true, phase: 'review', stepsInFlight: 0 },
    repo: { owner: 'xiechimon', name: 'cairn', defaultBranch: 'main' },
    ticketRef: '3803',
    issueNumber: 3803,
    pr: facts.pr,
    checks: facts.checks,
    compare: facts.compare,
    evidence: facts.evidence,
    verdicts: [
      {
        kind: 'verify',
        outcome: 'pass',
        perspective: null,
        patchDigest: DIGEST,
        ...{ recordingAttached: true },
      },
    ],
    round: null,
    availability: { reviewerPerspectives: [], verifier: true, decider: true },
  };
  const missing = () => mergeReadiness(inputs).blockers.some((b) => b.code === 'recording-missing');
  expect(missing()).toBe(false);
  inputs.verdicts = [];
  expect(missing()).toBe(true);
  inputs.verdicts = [
    {
      kind: 'verify',
      outcome: 'pass',
      perspective: null,
      patchDigest: 'f'.repeat(64),
      ...{ recordingAttached: true },
    },
  ];
  expect(missing()).toBe(true);
  inputs.evidenceStore = 'repository';
  inputs.evidence = [];
  expect(missing()).toBe(true);
});
