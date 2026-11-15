import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, MachineDoneBody } from '@cairn/shared';
import { classifyUserText, DELIVERABLE_LIMITS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { statePaths } from '../src/state.js';
import {
  type DeliverableSnapshot,
  deliverablesOutboxOf,
  snapshotDeliverables,
} from '../src/step-deliverables.js';
import { resumePendingUpload } from '../src/step-final-upload.js';
import { planStepPrompt } from '../src/step-prompt.js';
import { testTempDir } from './test-temp-dir.js';

const silent: DaemonLogger = {
  raw: () => undefined,
  prefixed: () => undefined,
  supervisor: () => undefined,
  machine: () => undefined,
  step: () => undefined,
  workspace: () => undefined,
  recover: () => undefined,
  wake: () => undefined,
  skills: () => undefined,
  gate: () => undefined,
  trust: () => undefined,
  mcp: () => undefined,
};

const capability = {
  generation: 1700000000123,
  limits: {
    maxFiles: DELIVERABLE_LIMITS.maxFiles,
    maxTotalBytes: DELIVERABLE_LIMITS.maxTotalBytes,
    maxPageBytes: 64,
    maxSlidesBytes: 64,
  },
};

const PAGE = Buffer.from('<h1>结论</h1>', 'utf8');
const DECK = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('deck')]);
const PDF = Buffer.from('%PDF-1.4\n', 'latin1');

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function layout() {
  const root = testTempDir('deliverables');
  const sourceDir = join(root, 'reports', 'conv-1', 'deliverables');
  const outboxDir = join(root, 'outbox');
  mkdirSync(join(sourceDir, 'pages'), { recursive: true });
  mkdirSync(join(sourceDir, 'slides'), { recursive: true });
  mkdirSync(outboxDir, { recursive: true });
  const snap = () => snapshotDeliverables({ sourceDir, outboxDir, stepId: 's1', capability });
  return { root, sourceDir, outboxDir, snap };
}

describe('deliverable snapshot', () => {
  test('copies verified files by kind and explains every skipped one', () => {
    const { root, sourceDir, outboxDir, snap } = layout();
    writeFileSync(join(sourceDir, 'pages', 'summary.html'), PAGE);
    writeFileSync(join(sourceDir, 'pages', 'notes.pdf'), PDF);
    writeFileSync(join(sourceDir, 'pages', 'SUMMARY.HTML'), PAGE);
    writeFileSync(join(sourceDir, 'pages', 'bad.html'), Buffer.from([0x3c, 0xff, 0x3e]));
    writeFileSync(join(sourceDir, 'slides', 'deck.pptx'), DECK);
    writeFileSync(join(sourceDir, 'slides', 'deck.pdf'), PDF);
    writeFileSync(join(sourceDir, 'slides', 'fake.pptx'), Buffer.from('not a zip'));
    writeFileSync(join(sourceDir, 'slides', 'huge.pptx'), Buffer.alloc(65, 0x50));
    writeFileSync(join(sourceDir, 'stray.html'), PAGE);
    writeFileSync(join(root, 'secret.txt'), 'outside');
    symlinkSync(join(root, 'secret.txt'), join(sourceDir, 'pages', 'link.html'));
    linkSync(join(root, 'secret.txt'), join(sourceDir, 'pages', 'hard.html'));
    execFileSync('mkfifo', [join(sourceDir, 'pages', 'pipe.html')]);

    const result = snap();

    expect(result.generation).toBe(capability.generation);
    expect(result.files.map((f) => [f.kind, f.name, f.size, f.sha256])).toEqual([
      ['slides', 'deck.pdf', PDF.length, sha(PDF)],
      ['slides', 'deck.pptx', DECK.length, sha(DECK)],
      ['page', 'SUMMARY.HTML', PAGE.length, sha(PAGE)],
    ]);
    for (const file of result.files) {
      expect(file.path.startsWith(deliverablesOutboxOf(outboxDir, 's1'))).toBe(true);
      expect(sha(readFileSync(file.path))).toBe(file.sha256);
    }
    expect(Object.fromEntries(result.skipped.map((s) => [s.name, s.reason]))).toEqual({
      'stray.html': 'outside-kind-folder',
      'fake.pptx': 'invalid-content',
      'huge.pptx': 'too-large',
      'bad.html': 'invalid-content',
      'hard.html': 'hard-link',
      'link.html': 'not-regular-file',
      'notes.pdf': 'unsupported-kind',
      'pipe.html': 'not-regular-file',
      'summary.html': 'duplicate-name',
    });
  });

  test('a symlinked kind folder rejects the whole snapshot', () => {
    const { root, sourceDir, outboxDir, snap } = layout();
    writeFileSync(join(sourceDir, 'slides', 'deck.pptx'), DECK);
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'page.html'), PAGE);
    execFileSync('rm', ['-r', join(sourceDir, 'pages')]);
    symlinkSync(elsewhere, join(sourceDir, 'pages'));

    expect(snap()).toEqual({
      generation: capability.generation,
      copyDir: deliverablesOutboxOf(outboxDir, 's1'),
      files: [],
      skipped: [{ name: 'deliverables', reason: 'unsafe-folder' }],
    });
    expect(existsSync(deliverablesOutboxOf(outboxDir, 's1'))).toBe(false);
  });

  test('file count and claim-wide bytes stop at the advertised limits', () => {
    const { sourceDir, snap } = layout();
    for (let i = 0; i < 6; i++) writeFileSync(join(sourceDir, 'slides', `d${i}.pptx`), DECK);
    const result = snap();
    expect(result.files).toHaveLength(capability.limits.maxFiles);
    expect(result.skipped).toEqual([{ name: 'd5.pptx', reason: 'over-file-limit' }]);

    const tight = snapshotDeliverables({
      sourceDir,
      outboxDir: join(sourceDir, '..', 'outbox2'),
      stepId: 's2',
      capability: { ...capability, limits: { ...capability.limits, maxTotalBytes: DECK.length } },
    });
    expect(tight.files.map((f) => f.name)).toEqual(['d0.pptx']);
    expect(tight.skipped[0]).toEqual({ name: 'd1.pptx', reason: 'over-size-limit' });
  });

  test('no deliverables folder yields an empty set', () => {
    const root = testTempDir('deliverables-none');
    expect(
      snapshotDeliverables({
        sourceDir: join(root, 'missing'),
        outboxDir: root,
        stepId: 's1',
        capability,
      }),
    ).toEqual({
      generation: capability.generation,
      copyDir: deliverablesOutboxOf(root, 's1'),
      files: [],
      skipped: [],
    });
  });
});

function fakeClient(opts: {
  receipt?: () => Promise<'claimed' | 'finished' | 'superseded'>;
  grant?: () => Promise<unknown>;
}) {
  const calls: string[] = [];
  const doneBodies: MachineDoneBody[] = [];
  const puts: string[] = [];
  const client = {
    uploadUrls: async (_stepId: string, _files: unknown[], deliverables?: unknown) => {
      calls.push(deliverables === undefined ? 'artifacts' : 'grant');
      if (deliverables === undefined) return { uploads: [] };
      if (opts.grant) return opts.grant();
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
          {
            name: 'page.html',
            attachmentId: 'a2',
            received: true,
            url: '/api/machine/deliverable/a2',
            method: 'PUT',
            headers: {},
          },
        ],
      };
    },
    putUpload: async () => undefined,
    putDeliverable: async (url: string) => {
      calls.push('put');
      puts.push(url);
    },
    deliverableReceipt: async () => {
      calls.push('receipt');
      return opts.receipt ? opts.receipt() : 'claimed';
    },
    done: async (_stepId: string, body: MachineDoneBody) => {
      calls.push('done');
      doneBodies.push(body);
    },
  };
  return { client: client as unknown as MachineApi, calls, doneBodies, puts };
}

function recoveryWorld() {
  const root = testTempDir('deliverables-recover');
  const paths = statePaths(root);
  mkdirSync(paths.outboxDir, { recursive: true });
  const journal = new StepJournal(paths.outboxDir);
  const copyDir = deliverablesOutboxOf(paths.outboxDir, 's1');
  mkdirSync(copyDir, { recursive: true });
  writeFileSync(join(copyDir, '0.pptx'), DECK);
  writeFileSync(join(copyDir, '1.html'), PAGE);
  const snapshot: DeliverableSnapshot = {
    generation: capability.generation,
    copyDir,
    files: [
      {
        kind: 'slides',
        name: 'deck.pptx',
        size: DECK.length,
        sha256: sha(DECK),
        path: join(copyDir, '0.pptx'),
      },
      {
        kind: 'page',
        name: 'page.html',
        size: PAGE.length,
        sha256: sha(PAGE),
        path: join(copyDir, '1.html'),
      },
    ],
    skipped: [{ name: 'chart.png', reason: 'unsupported-kind' }],
  };
  journal.claim({
    stepId: 's1',
    buildId: 'b1',
    kind: 'build',
    conversationId: 'conv-1',
    sessionAction: 'new',
    prompt: null,
  });
  const doneBody: MachineDoneBody = { status: 'success', report: '# r' };
  const entry = journal.update('s1', {
    state: 'awaiting-upload',
    doneBody,
    deliverables: snapshot,
  })!;
  return { paths, journal, entry, copyDir };
}

describe('deliverable recovery', () => {
  test('a claimed receipt replays grant, the missing PUT and done with the manifest', async () => {
    const w = recoveryWorld();
    const f = fakeClient({});
    await resumePendingUpload(
      { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
      w.entry,
    );
    expect(f.calls).toEqual(['receipt', 'artifacts', 'grant', 'put', 'done']);
    expect(f.puts).toEqual(['/api/machine/deliverable/a1']);
    expect(f.doneBodies).toEqual([
      {
        status: 'success',
        report: '# r',
        generation: capability.generation,
        deliverables: [
          { name: 'deck.pptx', sha256: sha(DECK) },
          { name: 'page.html', sha256: sha(PAGE) },
        ],
        deliverablesSkipped: [{ name: 'chart.png', reason: 'unsupported-kind' }],
      },
    ]);
    expect(w.journal.get('s1')).toBeNull();
    expect(existsSync(w.copyDir)).toBe(false);
  });

  test.each(['finished', 'superseded'] as const)(
    'a %s receipt drops the journal and outbox without uploading',
    async (state) => {
      const w = recoveryWorld();
      const f = fakeClient({ receipt: async () => state });
      await resumePendingUpload(
        { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
        w.entry,
      );
      expect(f.calls).toEqual(['receipt']);
      expect(w.journal.get('s1')).toBeNull();
      expect(existsSync(w.copyDir)).toBe(false);
    },
  );

  test('a receipt that cannot be read keeps the journal for the next round', async () => {
    const w = recoveryWorld();
    const f = fakeClient({
      receipt: async () => {
        throw new MachineApiError(503, 'down');
      },
    });
    await resumePendingUpload(
      { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
      w.entry,
    );
    expect(f.calls).toEqual(['receipt']);
    expect(w.journal.get('s1')?.deliverables).not.toBeNull();
  });

  test('a server without deliverables gets a report-only done, persisted first', async () => {
    const w = recoveryWorld();
    const f = fakeClient({
      receipt: async () => {
        throw new MachineApiError(404, 'not found');
      },
    });
    await resumePendingUpload(
      { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
      w.entry,
    );
    expect(f.calls).toEqual(['receipt', 'artifacts', 'done']);
    expect(f.doneBodies).toEqual([{ status: 'success', report: '# r' }]);
    expect(existsSync(w.copyDir)).toBe(false);
  });

  test('a grant without deliverable URLs falls back to a report-only done', async () => {
    const w = recoveryWorld();
    const f = fakeClient({ grant: async () => ({ uploads: [] }) });
    await resumePendingUpload(
      { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
      w.entry,
    );
    expect(f.calls).toEqual(['receipt', 'artifacts', 'grant', 'done']);
    expect(f.doneBodies).toEqual([{ status: 'success', report: '# r' }]);
  });

  test.each([413, 422])(
    'a permanent %i on the deliverables still sends the report, naming each file as rejected',
    async (status) => {
      const w = recoveryWorld();
      const f = fakeClient({
        grant: async () => {
          throw new MachineApiError(status, 'team attachment quota exceeded');
        },
      });
      await resumePendingUpload(
        { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
        w.entry,
        { failOnRejectedDone: true },
      );
      expect(f.doneBodies).toEqual([
        {
          status: 'success',
          report: '# r',
          generation: capability.generation,
          deliverables: [],
          deliverablesSkipped: [
            { name: 'chart.png', reason: 'unsupported-kind' },
            { name: 'deck.pptx', reason: 'upload-rejected' },
            { name: 'page.html', reason: 'upload-rejected' },
          ],
        },
      ]);
      expect(w.journal.get('s1')).toBeNull();
      expect(existsSync(w.copyDir)).toBe(false);
    },
  );

  test('a journal whose copies point outside the outbox reports without uploading them', async () => {
    const w = recoveryWorld();
    const entry = w.journal.update('s1', {
      deliverables: {
        ...w.entry.deliverables!,
        files: w.entry.deliverables!.files.map((file) => ({ ...file, path: '/etc/passwd' })),
      },
    })!;
    const f = fakeClient({});
    await resumePendingUpload(
      { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
      entry,
    );
    expect(f.puts).toEqual([]);
    expect(f.doneBodies[0]?.deliverables).toEqual([]);
  });

  test('a rejected set whose done is lost keeps the generation, so a later reclaim is protected', async () => {
    const w = recoveryWorld();
    const deps = (client: MachineApi) => ({
      client,
      journal: w.journal,
      logger: silent,
      paths: w.paths,
    });
    const first = fakeClient({
      grant: async () => {
        throw new MachineApiError(413, 'team attachment quota exceeded');
      },
    });
    const lostDone = first.client as unknown as { done: () => Promise<void> };
    lostDone.done = async () => {
      throw new TypeError('fetch failed');
    };
    await resumePendingUpload(deps(first.client), w.entry);
    const kept = w.journal.get('s1')!;
    expect(kept.deliverables).toBeNull();
    expect(kept.doneBody).toMatchObject({
      generation: capability.generation,
      deliverables: [],
      deliverablesSkipped: expect.arrayContaining([
        { name: 'deck.pptx', reason: 'upload-rejected' },
      ]),
    });

    const superseded = fakeClient({ receipt: async () => 'superseded' });
    await resumePendingUpload(deps(superseded.client), kept);
    expect(superseded.calls).toEqual(['receipt']);
    expect(w.journal.get('s1')).toBeNull();
  });

  test('a copy changed after the snapshot is not uploaded', async () => {
    const w = recoveryWorld();
    rmSync(join(w.copyDir, '0.pptx'));
    writeFileSync(join(w.paths.home, 'secret.bin'), DECK);
    symlinkSync(join(w.paths.home, 'secret.bin'), join(w.copyDir, '0.pptx'));
    const f = fakeClient({});
    await resumePendingUpload(
      { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
      w.entry,
    );
    expect(f.puts).toEqual([]);
    expect(f.doneBodies[0]?.deliverables).toEqual([]);
    expect(f.doneBodies[0]?.generation).toBe(capability.generation);
  });

  test('a 409 grant re-asks the receipt and drops a finished claim', async () => {
    const w = recoveryWorld();
    let receipts = 0;
    const f = fakeClient({
      receipt: async () => (receipts++ === 0 ? 'claimed' : 'finished'),
      grant: async () => {
        throw new MachineApiError(409, 'claimed again');
      },
    });
    await resumePendingUpload(
      { client: f.client, journal: w.journal, logger: silent, paths: w.paths },
      w.entry,
    );
    expect(f.calls).toEqual(['receipt', 'artifacts', 'grant', 'receipt']);
    expect(f.doneBodies).toEqual([]);
    expect(w.journal.get('s1')).toBeNull();
  });
});

function infoStep(withCapability: boolean): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '调研', spec: '写一页网页', output: 'info' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    ...(withCapability ? { deliverables: capability } : {}),
  } as ClaimedStep;
}

describe('deliverable prompt note', () => {
  test('only a claim with the capability names the folder, and the note stays out of the shown task', () => {
    const paths = { plansDir: '/s/plans', reportsDir: '/s/reports' };
    const withNote = planStepPrompt(infoStep(true), null, paths).prompt!;
    const without = planStepPrompt(infoStep(false), null, paths).prompt!;
    expect(withNote).toContain('/s/reports/conv-1/deliverables');
    expect(without).not.toContain('deliverables');
    expect(withNote.startsWith(without)).toBe(true);
    const task = { title: '调研', spec: '写一页网页' };
    expect(classifyUserText(withNote, task)).toBe('task-prompt');
  });
});
