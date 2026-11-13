import { join } from 'node:path';
import type { ClaimedStep, MachineDoneBody } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { EMPTY_SECRET_VAULT, type StepCredentials } from '../src/credentials.js';
import { StepJournal, TranscriptBuffer } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { deliverStepOutcome, type StepDeliveryInput } from '../src/step-deliver.js';
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
  return { input, journal, doneBodies, creds, lines };
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
});
