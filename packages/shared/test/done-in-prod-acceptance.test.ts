import { describe, expect, test } from 'vitest';
import {
  type AcceptanceAttachment,
  type AcceptanceMessage,
  evaluateStepAcceptance,
  LEGACY_SESSION_BRIEFS,
  LEGACY_SESSION_REWORK_BRIEFS,
  parseMissingEvidenceLine,
  SESSION_BRIEF,
  SESSION_REWORK_BRIEF,
} from '../src/index.js';

function toolMsg(
  name: string,
  args: Record<string, unknown>,
  opts: { result?: unknown; isError?: boolean; createdAt: number },
): AcceptanceMessage {
  return {
    role: 'assistant',
    createdAt: opts.createdAt,
    content: {
      kind: 'toolcall',
      call: {
        id: `call-${opts.createdAt}`,
        name,
        arguments: args,
        result: opts.result ?? 'ok',
        isError: opts.isError ?? false,
        startedAt: opts.createdAt,
        endedAt: opts.createdAt,
      },
    },
  };
}

function textMsg(text: string, createdAt: number): AcceptanceMessage {
  return {
    role: 'assistant',
    createdAt,
    content: [{ type: 'text', text }],
  };
}

function proof(overrides: Partial<AcceptanceAttachment> = {}): AcceptanceAttachment {
  return {
    id: 'att-1',
    createdBy: 'step:step-1',
    fileName: 'proof.json',
    mimeType: 'application/json',
    sizeBytes: 256,
    status: 'ready',
    grantId: 'grant-1',
    createdAt: 300,
    ...overrides,
  };
}

describe('done-in-prod acceptance contract', () => {
  test('rejects 0-byte or unknown-size attachments fail-closed on UI and API edits', () => {
    const emptyUi = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['apps/web/src/App.tsx'],
      messages: [
        toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 100 }),
        toolMsg('attach_file', { path: 'empty.png', caption: 'Live app' }, { createdAt: 200 }),
      ],
      attachments: [
        proof({
          fileName: 'empty.png',
          mimeType: 'image/png',
          sizeBytes: 0,
          createdAt: 200,
        }),
      ],
      stepIds: ['step-1'],
    });
    expect(emptyUi).toMatchObject({ ok: false, reason: 'missing-ui-screenshot' });
    if (!emptyUi.ok) expect(emptyUi.missingLine).not.toContain('\n');

    const unknownSizeApi = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['apps/server/src/routes-todos.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes-todos.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'curl -fsS http://127.0.0.1:8787/api/todos' },
          { result: '[]', createdAt: 200 },
        ),
        toolMsg('attach_file', { path: 'proof.json' }, { createdAt: 300 }),
      ],
      attachments: [proof({ sizeBytes: undefined, createdAt: 300 })],
      stepIds: ['step-1'],
    });
    expect(unknownSizeApi).toMatchObject({ ok: false, reason: 'missing-evidence' });
  });

  test('rejects API edits with missing proof, /health-only probes, stale SHA, and unverified prod claims', () => {
    const noAttachment = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['apps/server/src/routes/checkout.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes/checkout.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'curl -fsS http://127.0.0.1:8787/api/checkout' },
          { result: '{"ok":true}', createdAt: 200 },
        ),
      ],
      attachments: [],
      stepIds: ['step-1'],
    });
    expect(noAttachment).toMatchObject({ ok: false, retryable: true, reason: 'missing-evidence' });

    const healthOnly = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['apps/server/src/routes/checkout.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes/checkout.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'curl -fsS http://127.0.0.1:8787/health' },
          { result: '{"ok":true}', createdAt: 200 },
        ),
        toolMsg('attach_file', { path: 'health.json' }, { createdAt: 300 }),
      ],
      attachments: [proof({ fileName: 'health.json', createdAt: 300 })],
      stepIds: ['step-1'],
    });
    expect(healthOnly).toMatchObject({ ok: false, retryable: true, reason: 'unverified-api' });

    const staleSha = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      expectedCommit: 'abcdef1234567890',
      editedPaths: ['apps/server/src/routes/checkout.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes/checkout.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          {
            command:
              'curl -fsS http://127.0.0.1:8787/api/server/deploy && curl -fsS http://127.0.0.1:8787/api/checkout',
          },
          { result: '{"deployed":{"sha":"1111111222222"}}\n{"ok":true}', createdAt: 200 },
        ),
        toolMsg('attach_file', { path: 'checkout.json' }, { createdAt: 300 }),
      ],
      attachments: [proof({ fileName: 'checkout.json', createdAt: 300 })],
      stepIds: ['step-1'],
    });
    expect(staleSha).toMatchObject({ ok: false, retryable: true, reason: 'stale-deployed-target' });

    const bluffProdClaim = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      expectedCommit: 'abcdef1234567890',
      editedPaths: ['apps/server/src/routes/checkout.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes/checkout.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'curl -fsS http://127.0.0.1:8787/api/checkout' },
          { result: '{"ok":true}', createdAt: 200 },
        ),
        toolMsg(
          'attach_file',
          { path: 'checkout.json', caption: 'Verified in prod checkout' },
          { createdAt: 300 },
        ),
        textMsg('Verified in prod and confirmed working.', 350),
      ],
      attachments: [proof({ fileName: 'checkout.json', createdAt: 300 })],
      stepIds: ['step-1'],
    });
    expect(bluffProdClaim).toMatchObject({
      ok: false,
      retryable: true,
      reason: 'unverified-deployed-target',
    });

    const remoteUrlNoSha = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      expectedCommit: 'abcdef1234567890',
      editedPaths: ['apps/server/src/routes/checkout.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes/checkout.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'curl -fsS https://prod.example.com/api/checkout' },
          { result: '{"ok":true}', createdAt: 200 },
        ),
        toolMsg('attach_file', { path: 'checkout.json' }, { createdAt: 300 }),
      ],
      attachments: [proof({ fileName: 'checkout.json', createdAt: 300 })],
      stepIds: ['step-1'],
    });
    expect(remoteUrlNoSha).toMatchObject({
      ok: false,
      retryable: true,
      reason: 'unverified-deployed-target',
    });

    const http500Output = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['apps/server/src/routes/checkout.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes/checkout.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'curl -i http://127.0.0.1:8787/api/checkout' },
          { result: 'HTTP/1.1 500 Internal Server Error\n{"error":"boom"}', createdAt: 200 },
        ),
        toolMsg('attach_file', { path: 'checkout.json' }, { createdAt: 300 }),
      ],
      attachments: [proof({ fileName: 'checkout.json', createdAt: 300 })],
      stepIds: ['step-1'],
    });
    expect(http500Output).toMatchObject({
      ok: false,
      retryable: true,
      reason: 'failing-check',
    });

    const uiWithoutPostEditRun = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['apps/web/src/Board.tsx'],
      messages: [
        toolMsg('edit', { path: 'apps/web/src/Board.tsx' }, { createdAt: 100 }),
        toolMsg('attach_file', { path: 'live.png', caption: 'Live app' }, { createdAt: 200 }),
      ],
      attachments: [proof({ fileName: 'live.png', mimeType: 'image/png', createdAt: 200 })],
      stepIds: ['step-1'],
    });
    expect(uiWithoutPostEditRun).toMatchObject({ ok: false, retryable: true });

    const matchedSha = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      expectedCommit: 'abcdef1234567890',
      editedPaths: ['apps/server/src/routes/checkout.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/server/src/routes/checkout.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          {
            command:
              'curl -fsS http://127.0.0.1:8787/api/server/deploy && curl -fsS http://127.0.0.1:8787/api/checkout',
          },
          { result: '{"deployed":{"sha":"abcdef1234567890"}}\n{"ok":true}', createdAt: 200 },
        ),
        toolMsg(
          'attach_file',
          { path: 'checkout.json', caption: 'Verified in prod checkout' },
          { createdAt: 300 },
        ),
      ],
      attachments: [proof({ fileName: 'checkout.json', createdAt: 300 })],
      stepIds: ['step-1'],
    });
    expect(matchedSha).toMatchObject({ ok: true });
  });

  test('requires fresh non-empty proof for CLI, shared code, same-ms pre-edit, and mixed UI+API while preserving docOnly', () => {
    const cliNoAttach = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['scripts/check.mjs'],
      messages: [
        toolMsg('edit', { path: 'scripts/check.mjs' }, { createdAt: 100 }),
        toolMsg('bash', { command: 'node scripts/check.mjs' }, { result: 'PASS', createdAt: 200 }),
      ],
      attachments: [],
      stepIds: ['step-1'],
    });
    expect(cliNoAttach).toMatchObject({ ok: false, retryable: true, reason: 'missing-evidence' });

    const sharedCodeNoAttach = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['packages/shared/src/foo.ts'],
      messages: [
        toolMsg('edit', { path: 'packages/shared/src/foo.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'vitest run test/foo.test.ts' },
          { result: 'passed', createdAt: 200 },
        ),
      ],
      attachments: [],
      stepIds: ['step-1'],
    });
    expect(sharedCodeNoAttach).toMatchObject({
      ok: false,
      retryable: true,
      reason: 'missing-evidence',
    });

    const sameMsPreEdit = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['scripts/check.mjs'],
      messages: [
        toolMsg('attach_file', { path: 'old-output.txt' }, { createdAt: 200 }),
        toolMsg('edit', { path: 'scripts/check.mjs' }, { createdAt: 200 }),
        toolMsg('bash', { command: 'node scripts/check.mjs' }, { result: 'PASS', createdAt: 200 }),
      ],
      attachments: [proof({ fileName: 'old-output.txt', mimeType: 'text/plain', createdAt: 200 })],
      stepIds: ['step-1'],
    });
    expect(sameMsPreEdit).toMatchObject({ ok: false, retryable: true, reason: 'stale-evidence' });

    const mixedUiAndApiPartial = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['apps/web/src/Board.tsx', 'apps/server/src/routes/board.ts'],
      messages: [
        toolMsg('edit', { path: 'apps/web/src/Board.tsx' }, { createdAt: 100 }),
        toolMsg('edit', { path: 'apps/server/src/routes/board.ts' }, { createdAt: 110 }),
        toolMsg(
          'bash',
          { command: 'pnpm --filter @cairn/web exec vitest run test/board.unit.test.ts' },
          { result: 'passed', createdAt: 150 },
        ),
        toolMsg('attach_file', { path: 'live.png', caption: 'Live app' }, { createdAt: 200 }),
      ],
      attachments: [proof({ fileName: 'live.png', mimeType: 'image/png', createdAt: 200 })],
      stepIds: ['step-1'],
    });
    expect(mixedUiAndApiPartial).toMatchObject({
      ok: false,
      retryable: true,
      reason: 'unverified-api',
    });

    const docOnly = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['docs/guide.md'],
      messages: [
        toolMsg('edit', { path: 'docs/guide.md' }, { createdAt: 100 }),
        toolMsg('read_file', { path: 'docs/guide.md' }, { result: '# Guide', createdAt: 200 }),
      ],
      attachments: [],
      stepIds: ['step-1'],
    });
    expect(docOnly).toMatchObject({ ok: true });
  });

  test('keeps a doc read-back valid when the agent only writes and removes its own proof file afterwards', () => {
    const result = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'github',
      hasChanges: true,
      editedPaths: ['README.md'],
      messages: [
        toolMsg('edit', { path: 'README.md' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'cat README.md' },
          { result: 'Hello from Cairn.', createdAt: 200 },
        ),
        toolMsg(
          'bash',
          { command: 'mkdir -p .proof && cat README.md > .proof/readback.txt' },
          { result: 'ok', createdAt: 210 },
        ),
        toolMsg(
          'attach_file',
          { path: '.proof/readback.txt', caption: 'README read-back' },
          { createdAt: 220 },
        ),
        toolMsg(
          'bash',
          { command: 'rm -rf .proof && git status --short' },
          { result: '', createdAt: 230 },
        ),
      ],
      attachments: [
        proof({
          fileName: 'readback.txt',
          mimeType: 'text/plain',
          sizeBytes: 120,
          createdAt: 220,
        }),
      ],
      stepIds: ['step-1'],
    });
    expect(result).toMatchObject({ ok: true });

    const trackedDelete = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['README.md'],
      messages: [
        toolMsg('edit', { path: 'README.md' }, { createdAt: 100 }),
        toolMsg('bash', { command: 'cat README.md' }, { result: 'ok', createdAt: 200 }),
        toolMsg('bash', { command: 'rm README.md' }, { result: '', createdAt: 210 }),
      ],
      attachments: [],
      stepIds: ['step-1'],
    });
    expect(trackedDelete).toMatchObject({ ok: false, reason: 'unverified-doc' });

    const trackedDirDelete = evaluateStepAcceptance({
      output: 'code',
      repoKind: 'hosted',
      hasChanges: true,
      editedPaths: ['src/foo.ts'],
      messages: [
        toolMsg('edit', { path: 'src/foo.ts' }, { createdAt: 100 }),
        toolMsg(
          'bash',
          { command: 'vitest run test/foo.test.ts' },
          { result: 'passed', createdAt: 200 },
        ),
        toolMsg('bash', { command: 'rm -rf src' }, { result: '', createdAt: 210 }),
      ],
      attachments: [],
      stepIds: ['step-1'],
    });
    expect(trackedDirDelete).toMatchObject({ ok: false });
  });

  test('parses single-line missing evidence and folds prod verification into single-harness prompts', () => {
    expect(
      parseMissingEvidenceLine(
        'Summary\nWhat ran: curl\nMissing: Live request/response or DB row attached via `attach_file`.\nHow to unblock: Attach proof.',
      ),
    ).toBe('Live request/response or DB row attached via `attach_file`.');
    expect(
      parseMissingEvidenceLine(
        '[cairn acceptance check]\n\nMissing real acceptance: Live UI screenshot via attach_file\n\nRequired next step: Run app',
      ),
    ).toBe('Live UI screenshot via attach_file');
    expect(parseMissingEvidenceLine('Unrelated prompt text')).toBeNull();

    expect(SESSION_BRIEF).toMatch(/same session|same harness/i);
    expect(SESSION_BRIEF).toMatch(/deployed|running target/i);
    expect(SESSION_BRIEF).toContain('attach_file');
    expect(SESSION_REWORK_BRIEF).toContain('attach_file');
    expect(LEGACY_SESSION_BRIEFS.length).toBeGreaterThanOrEqual(3);
    expect(LEGACY_SESSION_REWORK_BRIEFS.length).toBeGreaterThanOrEqual(2);
  });
});
