import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, MachineDoneBody } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { EMPTY_SECRET_VAULT, type StepCredentials } from '../src/credentials.js';
import { StepJournal, TranscriptBuffer } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { deliverStepOutcome, type StepDeliveryInput } from '../src/step-deliver.js';
import { deliverablesOutboxOf } from '../src/step-deliverables.js';
import { testTempDir } from './test-temp-dir.js';

const STEP_ID = 's1';

function claimedBuildStep(): ClaimedStep {
  return {
    step: { id: STEP_ID, buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: 'probe', spec: 'spec' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

function silentLogger(lines: string[]): DaemonLogger {
  const push = (msg: string) => lines.push(msg);
  return {
    raw: push,
    prefixed: (_prefix, msg) => push(msg),
    supervisor: push,
    machine: push,
    step: push,
    workspace: push,
    recover: push,
    wake: push,
    skills: push,
    gate: push,
    trust: push,
    mcp: push,
  };
}

function harness(options: { uploadFails?: boolean; stopped?: boolean; lastError?: string }) {
  const root = testTempDir('step-deliver');
  const journal = new StepJournal(join(root, 'journal'));
  const claimed = claimedBuildStep();
  journal.claim({
    stepId: STEP_ID,
    buildId: claimed.step.buildId,
    kind: claimed.step.kind,
    conversationId: claimed.conversationId,
    sessionAction: 'new',
    prompt: 'do it',
  });
  const doneBodies: MachineDoneBody[] = [];
  const puts: string[] = [];
  const client = {
    uploadUrls: async (_stepId: string, files: { name: string }[]) => {
      if (options.uploadFails === true) throw new Error('storage down');
      return {
        uploads: files.map((file) => ({
          name: file.name,
          url: `https://upload.test/${file.name}`,
          method: 'PUT' as const,
          headers: {},
        })),
      };
    },
    putUpload: async () => {},
    putDeliverable: async (url: string) => {
      puts.push(url);
    },
    done: async (_stepId: string, body: MachineDoneBody) => {
      doneBodies.push(body);
    },
  } as unknown as MachineApi;
  const creds: StepCredentials = {
    provider: null,
    secrets: EMPTY_SECRET_VAULT,
    git: null,
    claudeSubscriptionToken: 'sk-held',
  };
  const lines: string[] = [];
  const input: StepDeliveryInput = {
    client,
    journal,
    logger: silentLogger(lines),
    workspace: undefined,
    outboxDir: join(root, 'outbox'),
    plansDir: join(root, 'plans'),
    stepId: STEP_ID,
    claimed,
    convId: claimed.conversationId,
    cwd: root,
    ws: null,
    repo: null,
    creds,
    credentialValues: [],
    refreshGitToken: null,
    transcript: new TranscriptBuffer(join(root, 'outbox'), STEP_ID),
    session: { sessionId: 'sess-1', sessionFile: undefined },
    usage: [],
    lastError: options.lastError ?? null,
    stopped: options.stopped === true,
    isReview: false,
    attachmentVerify: false,
    infoReportFile: null,
    quotaBlock: null,
    skillInjectionFacts: null,
    uploadedEvidence: new Set(),
    git: {
      headCommit: null,
      branchDrift: null,
      artifactBranches: [],
      hasChanges: false,
      pushHookOutput: null,
      preservedCommits: [],
    },
    running: 1,
  };
  return { input, journal, doneBodies, creds, lines, puts, root, client };
}

describe('deliverStepOutcome', () => {
  test('a delivered step reports done, clears credentials and leaves the journal', async () => {
    const h = harness({});
    await deliverStepOutcome(h.input);
    expect(h.doneBodies.map((body) => body.status)).toEqual(['success']);
    expect(h.doneBodies[0]?.sessionId).toBe('sess-1');
    expect(h.journal.get(STEP_ID)).toBeNull();
    expect(h.creds.claudeSubscriptionToken).toBeUndefined();
  });

  test('a failed upload keeps the journal entry with its done body for recovery', async () => {
    const h = harness({ uploadFails: true, lastError: 'tool crashed' });
    await deliverStepOutcome(h.input);
    expect(h.doneBodies).toEqual([]);
    const entry = h.journal.get(STEP_ID);
    expect(entry?.state).toBe('awaiting-upload');
    expect(entry?.doneBody?.status).toBe('failed');
    expect(entry?.doneBody?.errorMessage).toBe('tool crashed');
    expect(h.creds.claudeSubscriptionToken).toBeUndefined();
    expect(h.lines.some((line) => line.startsWith('transcript upload failed'))).toBe(true);
  });

  test('a stopped step reports stopped even when an error was recorded', async () => {
    const h = harness({ stopped: true, lastError: 'interrupted' });
    await deliverStepOutcome(h.input);
    expect(h.doneBodies.map((body) => body.status)).toEqual(['stopped']);
  });

  test('an info step with the capability uploads its deck and names it in done', async () => {
    const h = harness({});
    const deck = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('deck')]);
    const reportFile = join(h.root, 'reports', 'conv-1', 'report.md');
    mkdirSync(join(h.root, 'reports', 'conv-1', 'deliverables', 'slides'), { recursive: true });
    writeFileSync(reportFile, '# Findings');
    writeFileSync(join(h.root, 'reports', 'conv-1', 'deliverables', 'slides', 'deck.pptx'), deck);
    const generation = 1700000000123;
    const limits = { maxFiles: 5, maxTotalBytes: 1024, maxPageBytes: 1024, maxSlidesBytes: 1024 };
    const grants: unknown[] = [];
    const client = h.client as unknown as Record<string, unknown>;
    const plain = client.uploadUrls as (...args: unknown[]) => Promise<unknown>;
    client.uploadUrls = async (stepId: string, files: unknown[], deliverables?: unknown) => {
      if (deliverables === undefined) return plain(stepId, files);
      grants.push(deliverables);
      return {
        uploads: [],
        deliverables: [
          {
            name: 'deck.pptx',
            attachmentId: 'a1',
            received: false,
            url: '/api/machine/deliverable/a1',
            method: 'PUT',
            headers: {},
          },
        ],
      };
    };
    h.input.claimed = {
      ...h.input.claimed,
      todo: { ...h.input.claimed.todo!, output: 'info' },
      deliverables: { generation, limits },
    } as ClaimedStep;
    h.input.infoReportFile = reportFile;
    await deliverStepOutcome(h.input);
    const sha256 = createHash('sha256').update(deck).digest('hex');
    expect(grants).toEqual([
      { generation, entries: [{ kind: 'slides', name: 'deck.pptx', size: deck.length, sha256 }] },
    ]);
    expect(h.puts).toEqual(['/api/machine/deliverable/a1']);
    expect(h.doneBodies[0]).toMatchObject({
      status: 'success',
      report: '# Findings',
      generation,
      deliverables: [{ name: 'deck.pptx', sha256 }],
      deliverablesSkipped: [],
    });
    expect(h.journal.get(STEP_ID)).toBeNull();
    expect(existsSync(deliverablesOutboxOf(h.input.outboxDir, STEP_ID))).toBe(false);
  });

  test('a grant the server cannot take now keeps the snapshot in the journal', async () => {
    const h = harness({});
    const reportFile = join(h.root, 'reports', 'conv-1', 'report.md');
    mkdirSync(join(h.root, 'reports', 'conv-1', 'deliverables', 'pages'), { recursive: true });
    writeFileSync(reportFile, '# Findings');
    writeFileSync(join(h.root, 'reports', 'conv-1', 'deliverables', 'pages', 'a.html'), '<p>x</p>');
    const client = h.client as unknown as Record<string, unknown>;
    const plain = client.uploadUrls as (...args: unknown[]) => Promise<unknown>;
    client.uploadUrls = async (stepId: string, files: unknown[], deliverables?: unknown) => {
      if (deliverables === undefined) return plain(stepId, files);
      throw new MachineApiError(503, 'busy server');
    };
    h.input.claimed = {
      ...h.input.claimed,
      todo: { ...h.input.claimed.todo!, output: 'info' },
      deliverables: {
        generation: 7,
        limits: { maxFiles: 5, maxTotalBytes: 1024, maxPageBytes: 1024, maxSlidesBytes: 1024 },
      },
    } as ClaimedStep;
    h.input.infoReportFile = reportFile;
    await deliverStepOutcome(h.input);
    expect(h.doneBodies).toEqual([]);
    const entry = h.journal.get(STEP_ID);
    expect(entry?.doneBody?.report).toBe('# Findings');
    expect(entry?.deliverables?.files.map((f) => f.name)).toEqual(['a.html']);
    expect(existsSync(entry!.deliverables!.files[0]!.path)).toBe(true);
  });
});
